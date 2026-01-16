import { randomUUID } from "crypto";
import { hitlBus } from "./hitl_bus.js";
import { validateBeacon, validateInstruction } from "../utils/validate.js";
import { saveBeacon, saveInstruction, updateInstructionStatus, getInstruction } from "../db/repo.js";
import { logger } from "../utils/logger.js";
import { notifyOpsHeadServiceRecoveryEscalation } from "../integrations/ops_notifier.js";
import { generateIncidentReport } from "../service_recovery/incident_report.js";
import { config } from "../config.js";

function nowIso() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

// In-memory escalation timers keyed by instruction_id.
// (Good enough for single-instance deployments. For HA, move to Redis / DB.)
const escalationTimers = new Map();

function armEscalationTimer({ instruction_id, delayMs, payload }) {
  if (!delayMs || delayMs <= 0) return;

  // Clear any existing timer.
  if (escalationTimers.has(instruction_id)) {
    clearTimeout(escalationTimers.get(instruction_id));
    escalationTimers.delete(instruction_id);
  }

  const t = setTimeout(async () => {
    try {
      // If already resolved, do nothing.
      const row = await getInstruction(instruction_id);
      const status = row?.status || row?.payload?.status || "PENDING";
      if (String(status).toUpperCase() !== "PENDING") {
        escalationTimers.delete(instruction_id);
        return;
      }

      // Generate a compact incident report (best-effort).
      const report = await generateIncidentReport(payload).catch((e) => {
        logger.warn({ err: e?.message || String(e) }, "generateIncidentReport failed");
        return null;
      });

      await notifyOpsHeadServiceRecoveryEscalation({
        ...payload,
        incident_report: report,
      });
    } catch (e) {
      logger.error({ err: e?.message || String(e) }, "service recovery escalation timer failed");
    } finally {
      escalationTimers.delete(instruction_id);
    }
  }, delayMs);

  escalationTimers.set(instruction_id, t);
}

function disarmEscalationTimer(instruction_id) {
  const t = escalationTimers.get(instruction_id);
  if (t) clearTimeout(t);
  escalationTimers.delete(instruction_id);
}

export async function createHitlInstructionForChatwoot({
  branch_id,
  query_category,
  staff_prompt,
  chatwoot_context,
  customer_text,
}) {
  const beacon_id = makeId("bcn");
  const instruction_id = makeId("ins");

  const beacon = {
    beacon_id,
    timestamp_iso: nowIso(),
    signal_source: "HITL_PHYSICAL_CHECK",
    location_id: branch_id,
    actor: {
      role: "CUSTOMER",
      name: "chatwoot_contact",
    },
    machine_payload: {
      context: "HITL_CHATWOOT",
      query_category,
      staff_prompt,
      chatwoot: chatwoot_context || {},
    },
    human_rlhf_payload: {
      response_type: "text",
      response_value: customer_text || "",
      confidence: 0.7,
    },
    tags: ["HITL", "CHATWOOT"],
  };

  if (!validateBeacon(beacon)) {
    const err = validateBeacon.errors?.[0]?.message || "Beacon validation failed";
    throw new Error(err);
  }
  await saveBeacon(beacon);

  const instruction = {
    instruction_id,
    beacon_id,
    created_at_iso: nowIso(),
    target: {
      app: "APP_GERENTE",
      location_id: branch_id,
    },
    priority: "HIGH",
    message: staff_prompt,
    actions: [
      {
        type: "REQUEST_APPROVAL",
        params: {
          question: staff_prompt,
          options: ["SI", "NO", "INFO"],
          response_format: "yes_no_info_comment",
          require_comment: false,
          meta: {
            hitl_request_type: "PHYSICAL_CHECK",
            context: "HITL_CHATWOOT",
            query_category,
            chatwoot: chatwoot_context || {},
            customer_text: customer_text || "",
          },
        },
      },
    ],
    confidence: 1,
    needs_human_clarification: false,
    rationale_bullets: [
      "Verificación física en tiempo real (HITL) requerida para evitar alucinación de estado.",
    ],
  };

  if (!validateInstruction(instruction)) {
    const err = validateInstruction.errors?.[0]?.message || "Instruction validation failed";
    throw new Error(err);
  }

  await saveInstruction(instruction);

  // Push to staff tablets via sockets (if attached)
  hitlBus.emit("hitl_request", { branch_id, instruction });

  return { beacon_id, instruction_id, instruction };
}

export async function createHitlAdhocSearchRequestForChatwoot({
  branch_id,
  query_category,
  staff_prompt,
  chatwoot_context,
  customer_text,
  object_description,
  options = ["ENCONTRADO", "NO_ENCONTRADO", "INFO"],
  comment_placeholder = null,
}) {
  const beacon_id = makeId("bcn");
  const instruction_id = makeId("ins");

  const beacon = {
    beacon_id,
    timestamp_iso: nowIso(),
    signal_source: "HITL_ADHOC_SEARCH_REQUEST",
    location_id: branch_id,
    actor: {
      role: "CUSTOMER",
      name: "chatwoot_contact",
    },
    machine_payload: {
      context: "HITL_CHATWOOT",
      query_category,
      staff_prompt,
      object_description: object_description || null,
      chatwoot: chatwoot_context || {},
    },
    human_rlhf_payload: {
      response_type: "text",
      response_value: customer_text || "",
      confidence: 0.7,
    },
    tags: ["HITL", "CHATWOOT", "ADHOC"],
  };

  if (!validateBeacon(beacon)) {
    const err = validateBeacon.errors?.[0]?.message || "Beacon validation failed";
    throw new Error(err);
  }
  await saveBeacon(beacon);

  // We keep action type = REQUEST_APPROVAL for schema compatibility, but change response_format.
  const question = object_description
    ? `${staff_prompt}\n\nObjeto: ${object_description}`
    : staff_prompt;

  const instruction = {
    instruction_id,
    beacon_id,
    created_at_iso: nowIso(),
    target: {
      app: "APP_GERENTE",
      location_id: branch_id,
    },
    priority: "HIGH",
    message: question,
    actions: [
      {
        type: "REQUEST_APPROVAL",
        params: {
          question,
          // Buttons (HITL) + free text (dynamic)
          options,
          response_format: "adhoc_search_text",
          require_comment: true,
          comment_placeholder:
            comment_placeholder ||
            "Ej: Está en caja / Lo dejamos con el gerente / No apareció en mesa 12.",
          meta: {
            hitl_request_type: "ADHOC_SEARCH_REQUEST",
            context: "HITL_CHATWOOT",
            query_category,
            object_description: object_description || null,
            chatwoot: chatwoot_context || {},
            customer_text: customer_text || "",
          },
        },
      },
    ],
    confidence: 1,
    needs_human_clarification: false,
    rationale_bullets: [
      "Solicitud ad-hoc a staff para confirmar hallazgos (objetos perdidos / amenidades dinámicas).",
    ],
  };

  if (!validateInstruction(instruction)) {
    const err = validateInstruction.errors?.[0]?.message || "Instruction validation failed";
    throw new Error(err);
  }

  await saveInstruction(instruction);

  hitlBus.emit("hitl_request", { branch_id, instruction });
  return { beacon_id, instruction_id, instruction };
}

export async function createCustomerAtRiskInstructionForChatwoot({
  branch_id,
  sentiment,
  customer_text,
  chatwoot_context,
  contact,
  conversation_messages,
}) {
  const beacon_id = makeId("bcn");
  const instruction_id = makeId("ins");

  const beacon = {
    beacon_id,
    timestamp_iso: nowIso(),
    signal_source: "CUSTOMER_AT_RISK",
    location_id: branch_id,
    actor: {
      role: "CUSTOMER",
      name: contact?.name || "chatwoot_contact",
      id: contact?.phone || null,
    },
    machine_payload: {
      context: "SERVICE_RECOVERY",
      sentiment: sentiment || null,
      chatwoot: chatwoot_context || {},
      conversation_messages: conversation_messages || null,
      customer_text: customer_text || "",
    },
    tags: ["SERVICE_RECOVERY", "CHATWOOT", "CRISIS"],
  };

  if (!validateBeacon(beacon)) {
    const err = validateBeacon.errors?.[0]?.message || "Beacon validation failed";
    throw new Error(err);
  }
  await saveBeacon(beacon);

  const headline = "CLIENTE MOLESTO EN CHAT";
  const branchLabel = branch_id ? `Sucursal: ${branch_id}` : "Sucursal: (sin identificar)";
  const convLabel = chatwoot_context?.conversation_id ? `Chat: ${chatwoot_context.conversation_id}` : "";
  const who = contact?.name ? `Cliente: ${contact.name}` : "";

  const msg = [headline, branchLabel, convLabel, who].filter(Boolean).join(" • ");

  const instruction = {
    instruction_id,
    beacon_id,
    created_at_iso: nowIso(),
    target: {
      app: "APP_GERENTE",
      location_id: branch_id,
    },
    priority: "CRITICAL",
    display: {
      bg_color: "#ff2b2b",
      emoji: "⚠️",
      ttl_seconds: 180,
    },
    message: msg,
    actions: [
      {
        type: "REQUEST_APPROVAL",
        params: {
          question: "Marca ATENDIDO cuando ya estés con el cliente (en chat o en piso).",
          options: ["ATENDIDO"],
          response_format: "ack_only",
          require_comment: false,
          meta: {
            hitl_request_type: "CUSTOMER_AT_RISK",
            context: "SERVICE_RECOVERY",
            sentiment: sentiment || null,
            chatwoot: chatwoot_context || {},
            contact: contact || null,
            customer_text: customer_text || "",
          },
        },
      },
    ],
    confidence: 1,
    needs_human_clarification: false,
    rationale_bullets: [
      "Alerta crítica por cliente molesto/urgente.",
      "Se requiere acuse de atención para evitar escalamiento.",
    ],
  };

  if (!validateInstruction(instruction)) {
    const err = validateInstruction.errors?.[0]?.message || "Instruction validation failed";
    throw new Error(err);
  }

  await saveInstruction(instruction);
  hitlBus.emit("hitl_request", { branch_id, instruction });

  // Arm escalation timer (3 minutes by default; configurable).
  armEscalationTimer({
    instruction_id,
    delayMs: config.serviceRecovery?.escalationDelayMs || 180_000,
    payload: {
      branch_id,
      instruction_id,
      beacon_id,
      sentiment: sentiment || null,
      chatwoot_context: chatwoot_context || {},
      contact: contact || null,
      customer_text: customer_text || "",
      conversation_messages: conversation_messages || null,
    },
  });

  return { beacon_id, instruction_id, instruction };
}

export function waitForHitlResponse(instruction_id, ttlMs = 45_000) {
  return new Promise((resolve, reject) => {
    const eventName = `resolved:${instruction_id}`;
    const t = setTimeout(() => {
      hitlBus.removeAllListeners(eventName);
      reject(new Error("HITL_TIMEOUT"));
    }, ttlMs);

    hitlBus.once(eventName, (payload) => {
      clearTimeout(t);
      resolve(payload);
    });
  });
}

export async function recordHitlResponse({ instruction_id, branch_id, actor, decision, comment }) {
  const instructionRow = await getInstruction(instruction_id);
  if (!instructionRow) throw new Error("INSTRUCTION_NOT_FOUND");

  // Derive branch from instruction when not provided (HTTP fallback endpoint may omit it).
  const effectiveBranch =
    branch_id ||
    instructionRow?.target?.location_id ||
    instructionRow?.payload?.target?.location_id ||
    null;

  // If already resolved, allow idempotency.
  const currentStatus = (instructionRow?.status || instructionRow?.payload?.status || "PENDING").toUpperCase();
  if (currentStatus !== "PENDING") {
    disarmEscalationTimer(instruction_id);
    return {
      instruction_id,
      beacon_id: instructionRow?.resolution_beacon_id || null,
      branch_id: effectiveBranch,
      decision,
      comment: comment || "",
      actor,
      status: currentStatus,
    };
  }

  const beacon_id = makeId("bcn");
  const beacon = {
    beacon_id,
    timestamp_iso: nowIso(),
    signal_source: "HUMAN_DECISION_RESPONSE",
    location_id: effectiveBranch,
    actor: {
      role: actor?.role || "GERENTE_SUCURSAL",
      name: actor?.name || "staff_tablet",
      user_id: actor?.user_id || null,
      device_id: actor?.device_id || null,
    },
    machine_payload: {
      context: "HITL_CHATWOOT",
      original_instruction_id: instruction_id,
      decision,
      comment: comment || "",
    },
    human_rlhf_payload: {
      response_type: "text",
      response_value: comment || decision,
      confidence: 0.9,
    },
    tags: ["HITL", "STAFF_RESPONSE"],
  };

  if (!validateBeacon(beacon)) {
    const err = validateBeacon.errors?.[0]?.message || "Beacon validation failed";
    throw new Error(err);
  }
  await saveBeacon(beacon);

  await updateInstructionStatus({
    instruction_id,
    status: "RESOLVED",
    resolved_by: actor?.user_id || actor?.name || "staff_tablet",
    resolution_beacon_id: beacon_id,
  });

  // Cancel any pending escalation once staff acknowledged.
  disarmEscalationTimer(instruction_id);

  const payload = { instruction_id, beacon_id, branch_id: effectiveBranch, decision, comment: comment || "", actor: beacon.actor };
  hitlBus.emit(`resolved:${instruction_id}`, payload);

  return payload;
}
