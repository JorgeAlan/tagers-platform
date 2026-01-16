import { v4 as uuidv4 } from "uuid";

/**
 * Regla: esta capa NO usa LLM para reglas duras (routing, autoridad, prioridades base).
 * El LLM redacta; el motor de reglas manda.
 */

function nowISO() {
  return new Date().toISOString();
}

function upper(x) {
  return (x || "").toString().trim().toUpperCase();
}

function isPlainObject(x) {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function safeMachinePayload(beacon) {
  const mp = beacon?.machine_payload;
  return isPlainObject(mp) ? mp : {};
}

// ==== HARD RULES (T3) ====

const LIFE_DAYS = {
  clasica: 2, nutella: 2, reina: 2, dulce_de_leche: 2, dulce: 2, explosion: 1, lotus: 1,
};

const PEAK_SHAVING_DATES = [{ start: "01-02", end: "01-05" }];
const PULL_ONLY_WINDOWS = [{ start: "01-12", end: "01-18" }];

function parseMMDD(mmdd) {
  const [mm, dd] = mmdd.split("-").map(Number);
  return { month: mm, day: dd };
}

function isInDateRange(dateStr, ranges) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  const month = d.getMonth() + 1;
  const day = d.getDate();
  for (const range of ranges) {
    const start = parseMMDD(range.start);
    const end = parseMMDD(range.end);
    if (month === start.month && day >= start.day && day <= end.day) return true;
  }
  return false;
}

function isPeakShaving(timestampIso) { return isInDateRange(timestampIso, PEAK_SHAVING_DATES); }
function isPullOnly(timestampIso) { return isInDateRange(timestampIso, PULL_ONLY_WINDOWS); }

function getLifeDays(sku) {
  if (!sku) return null;
  const normalized = sku.toLowerCase().replace(/rosca[_-]?/gi, "").replace(/[_-]/g, "_").trim();
  for (const [key, days] of Object.entries(LIFE_DAYS)) {
    if (normalized.includes(key)) return days;
  }
  return null;
}

export function validateHardRules({ instruction, beacon }) {
  const violations = [];
  const timestampIso = beacon?.timestamp_iso || nowISO();
  const actions = instruction?.actions || [];
  
  for (const action of actions) {
    if (!action || typeof action !== "object") continue;
    const actionType = upper(action.type);
    const params = action.params || {};
    
    if (actionType === "RESERVE_SHADOW_INVENTORY") {
      const sku = params.sku;
      const lifeDays = getLifeDays(sku);
      if (lifeDays === 1 && isPeakShaving(timestampIso)) {
        violations.push({
          rule: "NO_PEAK_SHAVING_1DAY", sku, life_days: lifeDays, blocked_action: actionType,
          reason: `SKU ${sku} tiene vida útil de 1 día, no elegible para peak shaving`,
        });
      }
    }
    
    if (isPullOnly(timestampIso)) {
      const pushActions = ["RESERVE_SHADOW_INVENTORY", "PAUSE_FUTURE_WEB_SALES"];
      if (pushActions.includes(actionType)) {
        violations.push({
          rule: "PULL_ONLY_WINDOW", blocked_action: actionType,
          reason: "Estamos en ventana pull-only; no se permiten acciones de push",
        });
      }
    }
  }
  
  if (violations.length > 0) {
    return {
      valid: false, violations,
      fallback_action: { type: "ESCALATE_TO_CONTROL_TOWER", params: { reason: "HARD_RULE_VIOLATION", violations } },
    };
  }
  return { valid: true, violations: [] };
}

// ==== SEVERITY & RISK ====

function inferSeverityFromBeacon(beacon) {
  const src = upper(beacon?.signal_source);
  const mp = safeMachinePayload(beacon);
  const hinted = upper(mp?.severity || beacon?.metadata?.severity || "");
  if (["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(hinted)) return hinted;
  if (src === "OPS_TRAFFIC_ALERT") return "HIGH";
  if (src === "PRODUCTION_WEB_SPIKE") return "HIGH";
  if (src === "QA_BATCH_FINISHED") return "MEDIUM";
  if (src === "QA_BATCH_RESULT") return "MEDIUM";
  if (src === "SHIFT_END_CHECKIN") return "LOW";
  if (src === "HUMAN_DECISION_RESPONSE") return "LOW";
  if (src.includes("CANCEL")) return "LOW";
  return "LOW";
}

export function classifyRisk({ normalizedSignal, beacon }) {
  const sev = upper(normalizedSignal?.severity || inferSeverityFromBeacon(beacon));
  if (sev === "CRITICAL") return { priority: "CRITICAL", taskName: "ops_instruction_critical" };
  if (sev === "HIGH") return { priority: "HIGH", taskName: "ops_instruction_high_risk" };
  if (sev === "MEDIUM") return { priority: "MEDIUM", taskName: "ops_instruction_low_risk" };
  return { priority: "LOW", taskName: "ops_instruction_low_risk" };
}

// ==== ROUTING ====

export function chooseTargetApp({ normalizedSignal, beacon }) {
  const src = upper(beacon?.signal_source);
  const sig = upper(normalizedSignal?.signal_type || "");

  if (src === "OPS_TRAFFIC_ALERT") return "APP_OPS_HEAD";
  if (src === "PRODUCTION_WEB_SPIKE") return "APP_PRODUCTION";
  if (src === "QA_BATCH_FINISHED") return "APP_QA";
  if (src === "QA_BATCH_RESULT") return "CONTROL_TOWER";
  if (src === "SHIFT_END_CHECKIN") return "APP_GERENTE";
  if (src === "HUMAN_DECISION_RESPONSE") return "CONTROL_TOWER";

  switch (sig) {
    case "VIP_REQUEST_INTENT": return "CONTROL_TOWER";
    case "VIP_PRESSURE": return "CONTROL_TOWER";
    case "CANCEL_REASON": return "CONTROL_TOWER";
    case "OPS_REALLOCATION": return "APP_OPS_HEAD";
    case "PRODUCTION_CONSTRAINT": return "APP_PRODUCTION";
    case "QUALITY_ISSUE": return "APP_QA";
    case "SHIFT_INCIDENT_LOG": return "APP_AUDIT";
    case "STOCK_DISCREPANCY": return "APP_GERENTE";
    case "HUMAN_DECISION_RESPONSE": return "CONTROL_TOWER";
    default: break;
  }

  if (src.includes("CANCEL")) return "CONTROL_TOWER";

  const role = upper(beacon?.actor?.role);
  if (role === "TANY") return "CONTROL_TOWER";
  if (role === "KARLA") return "APP_OPS_HEAD";
  if (role === "IAN") return "APP_PRODUCTION";
  if (role === "JAZIEL") return "APP_QA";
  if (role === "ANDRES") return "APP_AUDIT";
  if (role === "JORGE") return "SYSTEM";
  if (role === "BRUNO") return "CONTROL_TOWER";
  if (role === "GERENTE_SUCURSAL" || role === "GERENTE") return "APP_GERENTE";
  if (role === "CAJERO") return "APP_CAJERO";
  if (role === "RUNNER") return "APP_RUNNER";

  return "SYSTEM";
}

// ==== ACTION SANITIZATION ====

function sanitizeActionsForTarget(actions, targetApp) {
  const allow = {
    CONTROL_TOWER: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","REQUEST_APPROVAL","ALERT_FIFO","ALERT_STOCKOUT","RESERVE_SHADOW_INVENTORY","RELEASE_SHADOW_INVENTORY","ESCALATE_TO_CONTROL_TOWER","PAUSE_FUTURE_WEB_SALES","UPDATE_MAX_DAILY_CAPACITY","REALLOCATE_STAFF","BLOCK_VIRTUAL_STOCK_BATCH","CREATE_INCIDENT_LOG"]),
    APP_OPS_HEAD: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","REQUEST_APPROVAL","REALLOCATE_STAFF","ESCALATE_TO_CONTROL_TOWER"]),
    APP_PRODUCTION: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","REQUEST_APPROVAL","UPDATE_MAX_DAILY_CAPACITY","ESCALATE_TO_CONTROL_TOWER"]),
    APP_QA: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","REQUEST_APPROVAL","BLOCK_VIRTUAL_STOCK_BATCH","ESCALATE_TO_CONTROL_TOWER"]),
    APP_AUDIT: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","CREATE_INCIDENT_LOG","ESCALATE_TO_CONTROL_TOWER"]),
    APP_GERENTE: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","ALERT_STOCKOUT","CREATE_INCIDENT_LOG","ESCALATE_TO_CONTROL_TOWER"]),
    APP_CAJERO: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","ALERT_FIFO","ESCALATE_TO_CONTROL_TOWER"]),
    APP_RUNNER: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","ALERT_FIFO","ESCALATE_TO_CONTROL_TOWER"]),
    APP_BRUNO: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO"]),
    SYSTEM: new Set(["NONE","LOG_ONLY","REQUEST_MORE_INFO","ESCALATE_TO_CONTROL_TOWER"]),
  };

  const allowed = allow[targetApp] || allow.SYSTEM;
  let hadDisallowed = false;
  const cleaned = [];

  for (const a of Array.isArray(actions) ? actions : []) {
    if (!a || typeof a !== "object") continue;
    const t = upper(a.type);
    if (!t) continue;
    if (allowed.has(t)) cleaned.push({ ...a, type: t });
    else hadDisallowed = true;
  }

  if (hadDisallowed && targetApp !== "CONTROL_TOWER") {
    const already = cleaned.some((x) => upper(x?.type) === "ESCALATE_TO_CONTROL_TOWER");
    if (!already) {
      cleaned.push({ type: "ESCALATE_TO_CONTROL_TOWER", params: { reason: "ACTION_NOT_AUTHORIZED_FOR_TARGET_APP", target_app: targetApp } });
    }
  }

  return cleaned;
}

// ==== ENFORCEMENT ====

export function enforceRoutingAndAuthority({ beacon, normalizedSignal, instruction, forcedPriority }) {
  if (!instruction || typeof instruction !== "object") return instruction;

  const targetApp = chooseTargetApp({ normalizedSignal, beacon });
  const location_id = beacon?.location_id || instruction?.target?.location_id || "unknown";

  instruction.target = instruction.target || { app: targetApp, location_id, user_id: null };
  instruction.target.app = targetApp;
  instruction.target.location_id = location_id;

  if (forcedPriority) instruction.priority = forcedPriority;

  const role = upper(beacon?.actor?.role);
  if (role === "BRUNO") {
    const allowed = new Set(["LOG_ONLY", "REQUEST_MORE_INFO", "REQUEST_APPROVAL", "ESCALATE_TO_CONTROL_TOWER"]);
    const proposed = [];
    const kept = [];

    for (const a of Array.isArray(instruction.actions) ? instruction.actions : []) {
      if (!a || typeof a !== "object") continue;
      const t = upper(a.type);
      if (!t) continue;
      if (allowed.has(t)) kept.push({ ...a, type: t });
      else proposed.push({ ...a, type: t });
    }

    if (proposed.length > 0) {
      kept.push({ type: "REQUEST_APPROVAL", params: { note: "BRUNO_NON_OPERATIONAL", proposed_actions: proposed } });
    }

    if (kept.length === 0) {
      kept.push({ type: "LOG_ONLY", params: { note: "BRUNO_NON_OPERATIONAL" } });
    }

    instruction.actions = kept;
  }

  const hardRuleResult = validateHardRules({ instruction, beacon });
  if (!hardRuleResult.valid) {
    instruction.actions = [
      hardRuleResult.fallback_action,
      { type: "LOG_ONLY", params: { hard_rule_violations: hardRuleResult.violations } },
    ];
    instruction.rationale_bullets = [
      "Acción bloqueada por regla dura.",
      ...hardRuleResult.violations.map(v => v.reason).slice(0, 2),
    ];
  }

  instruction.actions = sanitizeActionsForTarget(instruction.actions, targetApp);

  return instruction;
}

// ==== DETERMINISTIC INSTRUCTION BUILDER ====

export function deterministicInstruction({ beacon, normalizedSignal }) {
  const instruction_id = `INS_${uuidv4()}`;
  const created_at_iso = nowISO();

  const src = upper(beacon?.signal_source);
  const mp = safeMachinePayload(beacon);
  const location_id = beacon?.location_id || "unknown";
  const actorRole = upper(beacon?.actor?.role);

  const effectiveSeverity = upper(normalizedSignal?.severity || inferSeverityFromBeacon(beacon));
  let { priority } = classifyRisk({ normalizedSignal: { severity: effectiveSeverity }, beacon });

  const targetApp = chooseTargetApp({ normalizedSignal, beacon });

  let message = "Sin acción. Registrado.";
  let actions = [{ type: "LOG_ONLY", params: {} }];
  let rationale = ["Registro de beacon para análisis posterior."];
  let confidence = normalizedSignal?.confidence ?? 0.7;

  // ----------------------------
  // Machine → chat triggers
  // ----------------------------

  if (src === "OPS_TRAFFIC_ALERT") {
    const fromLoc = mp.from_location_id || mp.from || null;
    const toLoc = mp.to_location_id || mp.to || null;
    const eta = Number.isFinite(Number(mp.eta_minutes)) ? Number(mp.eta_minutes) : null;

    message = [
      "ALERTA OPS: riesgo de atoro/colapso operativo.",
      eta != null ? `ETA estimada: ${eta} min.` : null,
      fromLoc && toLoc ? `¿Reasignar staff de ${fromLoc} → ${toLoc}?` : "¿Necesitas re-balanceo de staff ahora?",
      "Opciones: APROBAR / NO POR AHORA.",
    ].filter(Boolean).join(" ");

    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Aprobar reallocation de staff?",
        options: ["APROBAR", "NO_POR_AHORA"],
        proposed_action: { type: "REALLOCATE_STAFF", params: { from_location_id: fromLoc, to_location_id: toLoc, eta_minutes: eta } },
      },
    }];

    rationale = ["Trigger machine→chat: OPS_TRAFFIC_ALERT requiere decisión humana (Karla)."];
    confidence = 0.9;
  }

  if (src === "PRODUCTION_WEB_SPIKE") {
    const demand = mp.demand ?? mp.orders_estimated ?? null;
    const capacity = mp.capacity ?? mp.max_daily_capacity ?? null;

    message = [
      "PICO WEB: demanda > capacidad.",
      demand != null ? `Demanda: ${demand}.` : null,
      capacity != null ? `Capacidad: ${capacity}.` : null,
      "¿Puedes aumentar capacidad hoy (horno extra / ritmo)?",
      "Opciones: SI / NO (si NO, se escala a Control Tower para pausar ventas futuras).",
    ].filter(Boolean).join(" ");

    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Puedes aumentar capacidad hoy?",
        options: ["SI", "NO"],
        proposed_action: { type: "UPDATE_MAX_DAILY_CAPACITY", params: { suggested_delta: mp.suggested_delta ?? null, demand, capacity } },
        if_no_then: { type: "ESCALATE_TO_CONTROL_TOWER", params: { reason: "PRODUCTION_NO_CAPACITY" } },
      },
    }];

    rationale = ["Ian decide capacidad; si no hay capacidad, Tany decide pausa/limitación web."];
    confidence = 0.9;
  }

  if (src === "QA_BATCH_FINISHED") {
    const batchId = mp.batch_id || mp.batchId || null;
    const sku = mp.sku || null;
    const qty = mp.qty || null;

    message = [
      "QA: lote terminado y requiere verificación.",
      batchId ? `Batch: ${batchId}.` : null,
      sku ? `SKU: ${sku}.` : null,
      qty ? `Cantidad: ${qty}.` : null,
      "¿Aprobado o Rechazado?",
    ].filter(Boolean).join(" ");

    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Resultado QA?",
        options: ["APROBAR", "RECHAZAR"],
        batch_id: batchId,
        sku: sku,
        qty: qty,
        on_reject: { type: "BLOCK_VIRTUAL_STOCK_BATCH", params: { batch_id: batchId, sku, location_id } },
      },
    }];

    rationale = ["Trigger machine→chat: QA_BATCH_FINISHED requiere decisión binaria (Jaziel)."];
    confidence = 0.9;
  }

  // QA_BATCH_RESULT: Response from Jaziel after reviewing a batch
  if (src === "QA_BATCH_RESULT") {
    const decision = upper(mp.decision);
    const batchId = mp.batch_id || null;
    const sku = mp.sku || null;
    const reason = mp.reason || "Sin motivo especificado";
    const qtyInspected = mp.qty_inspected || mp.qty || null;

    if (decision === "RECHAZAR") {
      message = `QA RECHAZÓ lote ${batchId || "?"}: ${reason}`;
      actions = [
        {
          type: "BLOCK_VIRTUAL_STOCK_BATCH",
          params: { batch_id: batchId, sku, location_id, reason, blocked_by: actorRole || "QA" },
        },
        {
          type: "ESCALATE_TO_CONTROL_TOWER",
          params: { reason: "QA_BATCH_REJECTED", batch_id: batchId, sku, qty_affected: qtyInspected },
        },
      ];
      rationale = [
        "Lote rechazado por QA (Jaziel).",
        "Stock virtual bloqueado automáticamente.",
        "Control Tower notificado para decisión de merma/retrabajo.",
      ];
      priority = "HIGH";
    } else if (decision === "APROBAR") {
      message = `QA APROBÓ lote ${batchId || "?"} (${qtyInspected || "?"} unidades).`;
      actions = [{ type: "LOG_ONLY", params: { batch_id: batchId, sku, approved: true } }];
      rationale = ["Lote aprobado. Stock virtual disponible para venta."];
    } else {
      message = `QA resultado desconocido para lote ${batchId || "?"}`;
      actions = [{ type: "REQUEST_MORE_INFO", params: { ask: "¿Cuál es el resultado QA? APROBAR o RECHAZAR." } }];
      rationale = ["Decisión QA no clara; se requiere confirmación."];
    }
    confidence = 0.95;
  }

  if (src === "SHIFT_END_CHECKIN") {
    const shiftId = mp.shift_id || mp.shiftId || null;

    message = [
      "CIERRE DE TURNO: registra incidentes relevantes (si aplica).",
      shiftId ? `Shift: ${shiftId}.` : null,
      "Formato: incident_type + 1 línea (sin dramatizar).",
    ].filter(Boolean).join(" ");

    actions = [{ type: "CREATE_INCIDENT_LOG", params: { shift_id: shiftId, requested_by: "SYSTEM", location_id } }];
    rationale = ["Trigger machine→chat: cierre de turno; bitácora estructurada para auditoría."];
    confidence = 0.85;
  }

  // ----------------------------
  // HUMAN_DECISION_RESPONSE (Reply Protocol)
  // ----------------------------

  const sig = upper(normalizedSignal?.signal_type || "");

  if (sig === "HUMAN_DECISION_RESPONSE" || src === "HUMAN_DECISION_RESPONSE") {
    const decision = upper(mp.decision);
    const originalInstructionId = mp.original_instruction_id;
    const actionType = upper(mp.action_type);
    const decisionParams = mp.decision_params || {};

    if (decision === "APROBAR" || decision === "SI") {
      if (decisionParams.proposed_action) {
        const proposed = decisionParams.proposed_action;
        message = `Decisión APROBADA: ejecutando ${proposed.type}.`;
        actions = [{ type: proposed.type, params: { ...proposed.params, approved_by: actorRole } }];
        rationale = [`Usuario ${actorRole} aprobó acción ${proposed.type}.`];
      } else {
        message = `Aprobación registrada (sin acción automática).`;
        actions = [{ type: "LOG_ONLY", params: { decision, original_instruction_id: originalInstructionId } }];
        rationale = ["Aprobación genérica registrada."];
      }
    } else if (decision === "RECHAZAR" || decision === "NO" || decision === "NO_POR_AHORA") {
      if (decisionParams.if_no_then) {
        const fallback = decisionParams.if_no_then;
        message = `Decisión RECHAZADA: ejecutando fallback ${fallback.type}.`;
        actions = [{ type: fallback.type, params: { ...fallback.params, rejected_by: actorRole } }];
        rationale = [`Usuario ${actorRole} rechazó; se ejecuta acción de fallback.`];
      } else {
        message = `Decisión RECHAZADA: acción original cancelada.`;
        actions = [{ type: "LOG_ONLY", params: { decision, original_instruction_id: originalInstructionId, cancelled: true } }];
        rationale = ["Rechazo registrado. No hay acción de fallback."];
      }
    } else {
      message = `Respuesta humana registrada: ${decision}`;
      actions = [{ type: "LOG_ONLY", params: { decision, raw: mp } }];
      rationale = ["Respuesta no binaria; registrada para análisis."];
    }
    confidence = 0.95;
  }

  // ----------------------------
  // Normalized human signals (no LLM path)
  // ----------------------------

  if (sig === "CANCEL_REASON" || src.includes("POS_CANCEL")) {
    const summary = normalizedSignal?.summary || (mp.reason || mp.cancel_reason || "Cancelación POS");
    message = `Cancelación registrada: ${summary}`;
    actions = [{ type: "LOG_ONLY", params: { cancel_reason: summary } }];
    rationale = ["Insight POS para reducir fricciones/cancelaciones."];
  }

  if (sig === "VIP_REQUEST_INTENT") {
    message = `Solicitud VIP (pendiente de aprobación): ${normalizedSignal?.summary || ""}`.trim();
    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Aprobar solicitud VIP?",
        options: ["APROBAR", "RECHAZAR"],
        requested: normalizedSignal?.entities || {},
        proposed_action: {
          type: "RESERVE_SHADOW_INVENTORY",
          params: {
            location_id,
            sku: normalizedSignal?.entities?.sku ?? null,
            qty: normalizedSignal?.entities?.qty ?? null,
            customer_segment: normalizedSignal?.entities?.customer_segment ?? "VIP",
          },
        },
      },
    }];
    rationale = ["Bruno es sensor estratégico: la solicitud se convierte en aprobación para Control Tower (Tany)."];
  }

  if (sig === "VIP_PRESSURE") {
    message = `CRISIS: ${normalizedSignal?.summary || "Presión VIP/operativa"}`;
    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Activar respuesta de crisis?",
        options: ["PAUSAR_VENTAS_FUTURAS", "SOLO_MONITOREAR"],
        proposed_action: { type: "PAUSE_FUTURE_WEB_SALES", params: { scope: "web", location_id } },
      },
    }];
    rationale = ["Crisis real requiere decisión de alto impacto (Kill Switch es solo CONTROL_TOWER)."];
  }

  if (sig === "OPS_REALLOCATION") {
    message = `Re-balanceo operativo requerido: ${normalizedSignal?.summary || ""}`.trim();
    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Autorizar reallocation de staff?",
        options: ["APROBAR", "NO_POR_AHORA"],
        proposed_action: { type: "REALLOCATE_STAFF", params: normalizedSignal?.entities || {} },
      },
    }];
    rationale = ["Karla autoriza movimientos de personal; no usa Kill Switch."];
  }

  if (sig === "PRODUCTION_CONSTRAINT") {
    message = `Producción limitada: ${normalizedSignal?.summary || ""}`.trim();
    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Puedes aumentar capacidad hoy?",
        options: ["SI", "NO"],
        proposed_action: { type: "UPDATE_MAX_DAILY_CAPACITY", params: normalizedSignal?.entities || {} },
        if_no_then: { type: "ESCALATE_TO_CONTROL_TOWER", params: { reason: "PRODUCTION_NO_CAPACITY" } },
      },
    }];
    rationale = ["Ian decide capacidad; si no, se escala a Tany para pausa/limitación web."];
  }

  if (sig === "QUALITY_ISSUE") {
    message = `Calidad en riesgo: ${normalizedSignal?.summary || ""}`.trim();
    actions = [{
      type: "REQUEST_APPROVAL",
      params: {
        question: "¿Rechazar lote / bloquear stock virtual?",
        options: ["RECHAZAR", "APROBAR"],
        proposed_action: { type: "BLOCK_VIRTUAL_STOCK_BATCH", params: normalizedSignal?.entities || {} },
      },
    }];
    rationale = ["Jaziel puede rechazar lote; sistema bloquea stock virtual de ese lote/SKU."];
  }

  if (sig === "SHIFT_INCIDENT_LOG") {
    message = `Bitácora registrada: ${normalizedSignal?.summary || ""}`.trim();
    actions = [{ type: "CREATE_INCIDENT_LOG", params: normalizedSignal?.entities || {} }];

    if (["HIGH", "CRITICAL"].includes(effectiveSeverity)) {
      actions.push({ type: "ESCALATE_TO_CONTROL_TOWER", params: { reason: "SHIFT_INCIDENT_HIGH_SEVERITY" } });
    }

    rationale = ["Bitácora legal/auditable. Escala solo si severidad alta o riesgo operativo."];
  }

  if (sig === "STOCK_DISCREPANCY") {
    message = `Revisar físico vs sistema: ${normalizedSignal?.summary || ""}`.trim();
    actions = [
      { type: "REQUEST_MORE_INFO", params: { ask: "Confirma conteo físico y registra ajuste si aplica." } },
      { type: "ALERT_STOCKOUT", params: { detail: normalizedSignal?.summary || "" } },
    ];
    rationale = ["Operativo primero (Gerente). Auditoría lo ve por agregación."];
  }

  const instruction = {
    instruction_id,
    beacon_id: beacon?.beacon_id,
    created_at_iso,
    target: { app: targetApp, location_id, user_id: beacon?.actor?.id || null },
    priority,
    display: null,
    message,
    actions,
    confidence,
    needs_human_clarification: false,
    clarification_question: null,
    rationale_bullets: (Array.isArray(rationale) ? rationale : []).slice(0, 3),
    model_trace: null,
  };

  return enforceRoutingAndAuthority({ beacon, normalizedSignal, instruction, forcedPriority: priority });
}
