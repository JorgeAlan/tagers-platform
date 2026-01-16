import fs from "fs";
import path from "path";
import { validateBeacon, validateInstruction, validateSignal, formatAjvErrors } from "../utils/validate.js";
import { logger } from "../utils/logger.js";
import { routeTask, fallbackModel } from "../model_router.js";
import { createStructuredJSON } from "../openai_client.js";
import { buildNormalizerPrompt } from "../engine/normalizer.js";
import { classifyRisk, deterministicInstruction, enforceRoutingAndAuthority } from "../engine/rule_engine.js";
import { saveBeacon, saveInstruction, updateInstructionStatus, blockVirtualStockBatch, reserveShadowInventory, releaseShadowInventory } from "../db/repo.js";
import { incrementIngest, addLatency, incrementError, recordInstruction } from "./metrics.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function loadPrompt(relPath) {
  const p = path.join(__dirname, "..", "..", relPath);
  return fs.readFileSync(p, "utf-8");
}

const KISS_SYSTEM_PROMPT = loadPrompt("prompts/kiss_system.md");

function upper(x) {
  return (x || "").toString().trim().toUpperCase();
}

function hasHumanSignal(beacon) {
  if (!beacon) return false;

  // Primary: explicit human RLHF payload
  const rlhf = beacon.human_rlhf_payload;
  if (rlhf && typeof rlhf === "object" && rlhf.response_value != null) return true;

  // Secondary: privileged human roles may send text in machine_payload (or other channels)
  const role = (beacon?.actor?.role || "").toString().trim().toUpperCase();
  const privileged = new Set(["BRUNO", "KARLA", "IAN", "JAZIEL", "GERENTE_SUCURSAL", "TANY"]);

  if (privileged.has(role)) return true;

  return false;
}


async function normalizeSignalWithFallback(beacon) {
  let route = routeTask("normalize_human_signal");

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await createStructuredJSON({
        ...route,
        instructions: buildNormalizerPrompt(),
        inputObject: beacon,
        schemaKey: "kiss_signal",
        schemaName: "KissNormalizedSignal",
        metadata: { beacon_id: beacon.beacon_id, task: "normalize_human_signal" },
      });

      if (!validateSignal(res.parsed)) {
        const err = new Error("OpenAI returned JSON, but it does not match kiss_signal schema.");
        err.details = formatAjvErrors(validateSignal.errors);
        throw err;
      }

      return { normalizedSignal: res.parsed, trace: res };
    } catch (err) {
      logger.warn({ err, model: route.model, attempt }, "normalize_human_signal failed");
      const next = fallbackModel(route.model);
      if (!next) break;
      route = { ...route, model: next };
    }
  }

  return { normalizedSignal: null, trace: null, error: "normalize_failed" };
}

async function generateInstructionWithFallback({ beacon, normalizedSignal, taskName }) {
  let route = routeTask(taskName);

  const inputObject = {
    beacon,
    normalized_signal: normalizedSignal,
    // We keep rules in the system prompt, but we still provide a compact copy.
    hard_rules_summary: {
      fifo: "Siempre vender más antiguo si está en excelentes condiciones.",
      life_days: { clasica: 2, nutella: 2, reina: 2, dulce: 2, explosion: 1, lotus: 1 },
      push_windows: ["Dec-24", "Dec-31", "Jan-02..Jan-11"],
      pull_only: ["Jan-12..Jan-18"],
      peak_shaving: ["Jan-02..Jan-05"],
    },
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await createStructuredJSON({
        ...route,
        instructions: KISS_SYSTEM_PROMPT,
        inputObject,
        schemaKey: "kiss_instruction_openai",
        schemaName: "KissInstruction",
        metadata: { beacon_id: beacon.beacon_id, task: taskName },
      });

      if (!validateInstruction(res.parsed)) {
        const err = new Error("OpenAI returned JSON, but it does not match kiss_instruction schema.");
        err.details = formatAjvErrors(validateInstruction.errors);
        throw err;
      }

      // Add trace (optional)
      res.parsed.model_trace = {
        model: res.model_used,
        service_tier: res.service_tier_used || route.service_tier,
        tokens_in: null,
        tokens_out: null,
      };

      return { instruction: res.parsed, trace: res };
    } catch (err) {
      logger.warn({ err, model: route.model, attempt }, "ops_instruction generation failed");
      const next = fallbackModel(route.model);
      if (!next) break;
      route = { ...route, model: next };
    }
  }

  return { instruction: null, trace: null, error: "instruction_failed" };
}

// Execute side effects for certain action types
async function executeActionSideEffects({ instruction, beacon }) {
  const actions = instruction?.actions || [];
  
  for (const action of actions) {
    const actionType = upper(action?.type);
    const params = action?.params || {};

    // VIP shadow inventory (approved by CONTROL_TOWER)
    if (actionType === "RESERVE_SHADOW_INVENTORY") {
      const location_id = params.location_id || beacon?.location_id;
      const sku = params.sku;
      const qty = Number.isFinite(Number(params.qty)) ? Number(params.qty) : 0;

      // Optional TTL
      let expires_at = params.expires_at || null;
      const ttlMin = Number.isFinite(Number(params.ttl_minutes)) ? Number(params.ttl_minutes) : null;
      if (!expires_at && ttlMin && ttlMin > 0) {
        expires_at = new Date(Date.now() + ttlMin * 60_000).toISOString();
      }

      if (location_id && sku && qty > 0) {
        try {
          await reserveShadowInventory({
            location_id,
            sku,
            qty,
            expires_at,
            beacon_id: beacon?.beacon_id,
            reason: params.reason || "VIP_APPROVED",
            reserved_by: params.reserved_by || beacon?.actor?.role || "UNKNOWN",
          });
          logger.info({ location_id, sku, qty, expires_at }, "Shadow inventory reserved");
        } catch (err) {
          incrementError();
          logger.error({ err, params }, "Failed to reserve shadow inventory");
        }
      }
    }

    if (actionType === "RELEASE_SHADOW_INVENTORY") {
      const location_id = params.location_id || beacon?.location_id;
      const sku = params.sku;
      const qty = Number.isFinite(Number(params.qty)) ? Number(params.qty) : 0;

      if (location_id && sku && qty > 0) {
        try {
          await releaseShadowInventory({
            location_id,
            sku,
            qty,
            beacon_id: beacon?.beacon_id,
            reason: params.reason || "RELEASE_REQUEST",
          });
          logger.info({ location_id, sku, qty }, "Shadow inventory released");
        } catch (err) {
          incrementError();
          logger.error({ err, params }, "Failed to release shadow inventory");
        }
      }
    }
    
    // Auto-block virtual stock when QA rejects
    if (actionType === "BLOCK_VIRTUAL_STOCK_BATCH") {
      try {
        await blockVirtualStockBatch({
          batch_id: params.batch_id,
          sku: params.sku,
          location_id: params.location_id || beacon?.location_id,
          qty: params.qty || 0,
          reason: params.reason,
          blocked_by: params.blocked_by || beacon?.actor?.role,
          beacon_id: beacon?.beacon_id,
        });
        logger.info({ batch_id: params.batch_id, sku: params.sku }, "Virtual stock blocked");
      } catch (err) {
        logger.error({ err, params }, "Failed to block virtual stock");
      }
    }
  }
}

export async function ingestHandler(req, res) {
  const startTime = Date.now();
  const beacon = req.body;

  if (!validateBeacon(beacon)) {
    return res.status(400).json({
      ok: false,
      error: "INVALID_BEACON",
      details: formatAjvErrors(validateBeacon.errors),
    });
  }

  await saveBeacon(beacon);

  const src = upper(beacon?.signal_source);
  let modelUsed = null;
  let fallbackUsed = false;

  // Handle HUMAN_DECISION_RESPONSE: mark original instruction as resolved
  if (src === "HUMAN_DECISION_RESPONSE") {
    const mp = beacon?.machine_payload || {};
    const originalId = mp.original_instruction_id;
    
    if (originalId) {
      try {
        await updateInstructionStatus({
          instruction_id: originalId,
          status: "RESOLVED",
          resolved_by: beacon?.actor?.role || "UNKNOWN",
          resolution_beacon_id: beacon.beacon_id,
        });
        logger.info({ originalId, resolution: beacon.beacon_id }, "Instruction resolved by human decision");
      } catch (err) {
        logger.error({ err, originalId }, "Failed to update instruction status");
      }
    }
  }

  // Deterministic-only sources: do NOT call OpenAI.
  // These sources are machine→chat triggers or structured reply protocol payloads.
  const deterministicOnlySources = new Set([
    "OPS_TRAFFIC_ALERT",
    "PRODUCTION_WEB_SPIKE",
    "QA_BATCH_FINISHED",
    "QA_BATCH_RESULT",
    "SHIFT_END_CHECKIN",
    "HUMAN_DECISION_RESPONSE",
  ]);

  if (deterministicOnlySources.has(src)) {
    const instruction = deterministicInstruction({ beacon, normalizedSignal: null });
    await saveInstruction(instruction);
    await executeActionSideEffects({ instruction, beacon });

    const latency = Date.now() - startTime;
    incrementIngest({ model: "deterministic", fallback: false, signal_source: beacon.signal_source });
    recordInstruction({ target_app: instruction?.target?.app, priority: instruction?.priority });
    addLatency(latency);

    return res.status(200).json({ ok: true, beacon_id: beacon.beacon_id, instruction });
  }

  // Cheap path: no human signal → do not call OpenAI
  if (!hasHumanSignal(beacon)) {
    const instruction = deterministicInstruction({ beacon, normalizedSignal: null });
    await saveInstruction(instruction);
    await executeActionSideEffects({ instruction, beacon });
    
    const latency = Date.now() - startTime;
    incrementIngest({ model: "deterministic", fallback: false, signal_source: beacon.signal_source });
    recordInstruction({ target_app: instruction?.target?.app, priority: instruction?.priority });
    addLatency(latency);
    
    return res.status(200).json({ ok: true, beacon_id: beacon.beacon_id, instruction });
  }

  // 1) Normalize (cheap model)
  const { normalizedSignal, trace: normTrace } = await normalizeSignalWithFallback(beacon);

  if (!normalizedSignal) {
    const instruction = deterministicInstruction({ beacon, normalizedSignal: { signal_type: "OTHER", summary: "Señal humana no normalizada", confidence: 0.2 } });
    await saveInstruction(instruction);
    await executeActionSideEffects({ instruction, beacon });
    
    const latency = Date.now() - startTime;
    incrementIngest({ model: "deterministic-fallback", fallback: true, signal_source: beacon.signal_source });
    incrementError();
    recordInstruction({ target_app: instruction?.target?.app, priority: instruction?.priority });
    addLatency(latency);
    
    return res.status(200).json({ ok: true, beacon_id: beacon.beacon_id, instruction, warning: "normalize_failed" });
  }

  modelUsed = normTrace?.model_used || "unknown";

  // 2) Decide risk
  const { priority, taskName } = classifyRisk({ normalizedSignal, beacon });

  // 3) LOW/MEDIUM → deterministic to save cost
  if (priority === "LOW" || priority === "MEDIUM") {
    const instruction = deterministicInstruction({ beacon, normalizedSignal });
    await saveInstruction(instruction);
    await executeActionSideEffects({ instruction, beacon });
    
    const latency = Date.now() - startTime;
    incrementIngest({ model: modelUsed, fallback: false, signal_source: beacon.signal_source });
    recordInstruction({ target_app: instruction?.target?.app, priority: instruction?.priority });
    addLatency(latency);
    
    return res.status(200).json({ ok: true, beacon_id: beacon.beacon_id, normalized_signal: normalizedSignal, instruction });
  }

  // 4) High/critical → use stronger model to produce coherent instruction JSON
  const { instruction, trace: insTrace } = await generateInstructionWithFallback({ beacon, normalizedSignal, taskName });

  if (!instruction) {
    const fallback = deterministicInstruction({ beacon, normalizedSignal });
    fallback.priority = priority;
    fallback.actions = [{ type: "ESCALATE_TO_CONTROL_TOWER", params: { reason: "AI instruction generation failed" } }];
    fallback.message = "Escalar a Control Tower: señal de alto riesgo registrada.";
    fallback.rationale_bullets = ["Señal de alto riesgo. Falló generación AI; se escala."];

    const enforcedFallback = enforceRoutingAndAuthority({ beacon, normalizedSignal, instruction: fallback, forcedPriority: priority });
    await saveInstruction(enforcedFallback);
    await executeActionSideEffects({ instruction: enforcedFallback, beacon });
    
    const latency = Date.now() - startTime;
    incrementIngest({ model: modelUsed, fallback: true, signal_source: beacon.signal_source });
    incrementError();
    recordInstruction({ target_app: enforcedFallback?.target?.app, priority: enforcedFallback?.priority });
    addLatency(latency);

    return res.status(200).json({
      ok: true,
      beacon_id: beacon.beacon_id,
      normalized_signal: normalizedSignal,
      instruction: enforcedFallback,
      warning: "instruction_failed",
    });
  }

  modelUsed = insTrace?.model_used || modelUsed;

  // Hard-enforce routing + priority even if the model hallucinates.
  const enforced = enforceRoutingAndAuthority({ beacon, normalizedSignal, instruction, forcedPriority: priority });

  await saveInstruction(enforced);
  await executeActionSideEffects({ instruction: enforced, beacon });
  
  const latency = Date.now() - startTime;
  incrementIngest({ model: modelUsed, fallback: false, signal_source: beacon.signal_source });
  recordInstruction({ target_app: enforced?.target?.app, priority: enforced?.priority });
  addLatency(latency);

  return res.status(200).json({
    ok: true,
    beacon_id: beacon.beacon_id,
    normalized_signal: normalizedSignal,
    instruction: enforced,
  });
}
