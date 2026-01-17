/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASE SERVICE - Gestión completa de casos LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Un caso es la unidad de trabajo principal de LUCA.
 * Flujo: Finding → Case → Evidence → Hypothesis → Diagnosis → Action → Outcome
 */

import { logger, query } from "@tagers/shared";
import { 
  CASE_STATES, 
  CASE_EVENTS, 
  canTransition, 
  getNextState, 
  getAvailableTransitions,
  getStateMetadata,
} from "../state/caseStateMachine.js";
import { logAudit } from "./auditService.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateCaseId() {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `CASE-${date}-${random}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD BÁSICO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un nuevo caso
 */
export async function createCase({
  caseType,
  severity = "MEDIUM",
  title,
  description,
  scope = {},
  evidence = [],
  source,
  detectorId,
  runId,
  createdBy = "system",
}) {
  const caseId = generateCaseId();
  
  const result = await query(`
    INSERT INTO luca_cases (
      case_id, case_type, severity, state, title, description,
      scope, evidence, source, detector_id, run_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    caseId,
    caseType,
    severity.toUpperCase(),
    CASE_STATES.OPEN,
    title,
    description,
    scope,
    evidence,
    source,
    detectorId,
    runId,
  ]);
  
  const newCase = result.rows[0];
  
  await logAudit({
    actorType: "system",
    actorId: createdBy,
    action: "CASE_CREATED",
    targetType: "case",
    targetId: caseId,
    changes: { state: CASE_STATES.OPEN, severity, caseType },
  });
  
  logger.info({ caseId, caseType, severity }, "Case created");
  
  return newCase;
}

/**
 * Obtiene un caso por ID con toda su información
 */
export async function getCase(caseId) {
  const result = await query(`
    SELECT c.*,
           COALESCE(
             (SELECT json_agg(a.* ORDER BY a.created_at DESC) 
              FROM luca_actions a WHERE a.case_id = c.case_id),
             '[]'
           ) as actions,
           COALESCE(
             (SELECT json_agg(al.* ORDER BY al.created_at DESC) 
              FROM luca_alerts al WHERE al.case_id = c.case_id),
             '[]'
           ) as related_alerts
    FROM luca_cases c
    WHERE c.case_id = $1
  `, [caseId]);
  
  if (result.rowCount === 0) {
    return null;
  }
  
  const caseData = result.rows[0];
  
  // Agregar metadata del estado
  caseData.state_metadata = getStateMetadata(caseData.state);
  caseData.available_transitions = getAvailableTransitions(caseData.state);
  
  return caseData;
}

/**
 * Lista casos con filtros
 */
export async function listCases({
  state,
  states, // Array de estados
  caseType,
  severity,
  branchId,
  detectorId,
  assignedTo,
  limit = 50,
  offset = 0,
  orderBy = "created_at",
  orderDir = "DESC",
} = {}) {
  let sql = `
    SELECT c.*,
           (SELECT COUNT(*) FROM luca_actions a WHERE a.case_id = c.case_id) as action_count,
           (SELECT COUNT(*) FROM luca_alerts al WHERE al.case_id = c.case_id) as alert_count
    FROM luca_cases c
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (state) {
    sql += ` AND c.state = $${paramIndex++}`;
    params.push(state);
  }
  
  if (states && states.length > 0) {
    sql += ` AND c.state = ANY($${paramIndex++})`;
    params.push(states);
  }
  
  if (caseType) {
    sql += ` AND c.case_type = $${paramIndex++}`;
    params.push(caseType);
  }
  
  if (severity) {
    sql += ` AND c.severity = $${paramIndex++}`;
    params.push(severity);
  }
  
  if (branchId) {
    sql += ` AND c.scope->>'branch_id' = $${paramIndex++}`;
    params.push(branchId);
  }
  
  if (detectorId) {
    sql += ` AND c.detector_id = $${paramIndex++}`;
    params.push(detectorId);
  }
  
  // Validar orderBy para prevenir SQL injection
  const validOrderBy = ["created_at", "updated_at", "severity", "state"];
  const safeOrderBy = validOrderBy.includes(orderBy) ? orderBy : "created_at";
  const safeOrderDir = orderDir.toUpperCase() === "ASC" ? "ASC" : "DESC";
  
  sql += ` ORDER BY c.${safeOrderBy} ${safeOrderDir} LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  
  // Agregar metadata a cada caso
  const cases = result.rows.map(c => ({
    ...c,
    available_transitions: getAvailableTransitions(c.state),
  }));
  
  return {
    cases,
    total: result.rowCount,
    limit,
    offset,
  };
}

/**
 * Obtiene casos abiertos (no CLOSED)
 */
export async function getOpenCases(limit = 50) {
  return listCases({
    states: Object.values(CASE_STATES).filter(s => s !== CASE_STATES.CLOSED),
    limit,
    orderBy: "updated_at",
    orderDir: "DESC",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSICIONES DE ESTADO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta una transición de estado en un caso
 */
export async function transitionCase(caseId, event, { actorId, context = {}, notes } = {}) {
  // Obtener caso actual
  const caseData = await getCase(caseId);
  if (!caseData) {
    throw new Error(`Case not found: ${caseId}`);
  }
  
  // Validar transición
  if (!canTransition(caseData.state, event)) {
    const available = getAvailableTransitions(caseData.state);
    throw new Error(
      `Invalid transition: ${event} from ${caseData.state}. ` +
      `Available: ${available.join(", ") || "none"}`
    );
  }
  
  const nextState = getNextState(caseData.state, event);
  const previousState = caseData.state;
  
  // Actualizar caso
  const updateData = {
    state: nextState,
    updated_at: new Date().toISOString(),
  };
  
  // Si se cierra, registrar closed_at
  if (nextState === CASE_STATES.CLOSED) {
    updateData.closed_at = new Date().toISOString();
    updateData.closed_by = actorId || "system";
  }
  
  const result = await query(`
    UPDATE luca_cases SET
      state = $2,
      updated_at = NOW()
      ${nextState === CASE_STATES.CLOSED ? ", closed_at = NOW(), closed_by = $4" : ""}
    WHERE case_id = $1
    RETURNING *
  `, nextState === CASE_STATES.CLOSED 
    ? [caseId, nextState, actorId || "system"] 
    : [caseId, nextState]
  );
  
  // Audit log
  await logAudit({
    actorType: actorId ? "user" : "system",
    actorId: actorId || "system",
    action: `CASE_${event}`,
    targetType: "case",
    targetId: caseId,
    changes: { from: previousState, to: nextState, event },
    context: { ...context, notes },
  });
  
  logger.info({
    caseId,
    from: previousState,
    to: nextState,
    event,
    actorId,
  }, "Case state transitioned");
  
  return {
    ...result.rows[0],
    previous_state: previousState,
    transition: { event, from: previousState, to: nextState },
    available_transitions: getAvailableTransitions(nextState),
  };
}

/**
 * Inicia investigación de un caso
 */
export async function startInvestigation(caseId, actorId) {
  return transitionCase(caseId, CASE_EVENTS.START_INVESTIGATION, { actorId });
}

/**
 * Cierra caso como ruido
 */
export async function closeAsNoise(caseId, actorId, notes) {
  const result = await transitionCase(caseId, CASE_EVENTS.CLOSE_AS_NOISE, {
    actorId,
    notes,
    context: { closeReason: "noise" },
  });
  
  // Actualizar outcome
  await query(`
    UPDATE luca_cases SET outcome = $2 WHERE case_id = $1
  `, [caseId, { reason: "noise", notes }]);
  
  return result;
}

/**
 * Cierra caso como falso positivo
 */
export async function closeAsFalsePositive(caseId, actorId, notes) {
  const result = await transitionCase(caseId, CASE_EVENTS.CLOSE_AS_FALSE_POSITIVE, {
    actorId,
    notes,
    context: { closeReason: "false_positive" },
  });
  
  await query(`
    UPDATE luca_cases SET outcome = $2 WHERE case_id = $1
  `, [caseId, { reason: "false_positive", notes }]);
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// EVIDENCIA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrega evidencia a un caso
 */
export async function addEvidence(caseId, evidence, actorId = "system") {
  const caseData = await getCase(caseId);
  if (!caseData) {
    throw new Error(`Case not found: ${caseId}`);
  }
  
  // Validar que podemos agregar evidencia en este estado
  const validStates = [CASE_STATES.OPEN, CASE_STATES.INVESTIGATING];
  if (!validStates.includes(caseData.state)) {
    throw new Error(`Cannot add evidence in state: ${caseData.state}`);
  }
  
  // Agregar evidencia con timestamp
  const newEvidence = {
    id: `EV-${Date.now()}`,
    ...evidence,
    added_at: new Date().toISOString(),
    added_by: actorId,
  };
  
  const currentEvidence = caseData.evidence || [];
  
  const result = await query(`
    UPDATE luca_cases SET
      evidence = $2,
      updated_at = NOW()
    WHERE case_id = $1
    RETURNING *
  `, [caseId, [...currentEvidence, newEvidence]]);
  
  await logAudit({
    actorType: actorId === "system" ? "system" : "user",
    actorId,
    action: "EVIDENCE_ADDED",
    targetType: "case",
    targetId: caseId,
    changes: { evidence: newEvidence },
  });
  
  logger.info({ caseId, evidenceId: newEvidence.id }, "Evidence added to case");
  
  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// HIPÓTESIS Y DIAGNÓSTICO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrega una hipótesis al caso
 */
export async function addHypothesis(caseId, hypothesis, actorId = "system") {
  const caseData = await getCase(caseId);
  if (!caseData) {
    throw new Error(`Case not found: ${caseId}`);
  }
  
  const newHypothesis = {
    id: `HYP-${Date.now()}`,
    ...hypothesis,
    confidence: hypothesis.confidence || 0.5,
    added_at: new Date().toISOString(),
    added_by: actorId,
    status: "pending", // pending, confirmed, rejected
  };
  
  const currentHypotheses = caseData.hypotheses || [];
  
  const result = await query(`
    UPDATE luca_cases SET
      hypotheses = $2,
      updated_at = NOW()
    WHERE case_id = $1
    RETURNING *
  `, [caseId, [...currentHypotheses, newHypothesis]]);
  
  await logAudit({
    actorType: actorId === "system" ? "system" : "user",
    actorId,
    action: "HYPOTHESIS_ADDED",
    targetType: "case",
    targetId: caseId,
    changes: { hypothesis: newHypothesis },
  });
  
  return result.rows[0];
}

/**
 * Diagnostica un caso (confirma hipótesis principal)
 */
export async function diagnose(caseId, { diagnosisText, confirmedHypothesisId, actorId } = {}) {
  const caseData = await getCase(caseId);
  if (!caseData) {
    throw new Error(`Case not found: ${caseId}`);
  }
  
  // Crear o actualizar diagnóstico
  const diagnosis = {
    text: diagnosisText,
    confirmed_hypothesis_id: confirmedHypothesisId,
    diagnosed_at: new Date().toISOString(),
    diagnosed_by: actorId || "system",
  };
  
  await query(`
    UPDATE luca_cases SET
      diagnosis = $2,
      updated_at = NOW()
    WHERE case_id = $1
  `, [caseId, diagnosis]);
  
  // Transicionar a DIAGNOSED
  return transitionCase(caseId, CASE_EVENTS.DIAGNOSE, {
    actorId,
    context: { diagnosis },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCIONES RECOMENDADAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recomienda una acción para el caso
 */
export async function recommendAction(caseId, action, actorId = "system") {
  const caseData = await getCase(caseId);
  if (!caseData) {
    throw new Error(`Case not found: ${caseId}`);
  }
  
  // Crear la acción en luca_actions
  const actionId = `ACT-${Date.now()}-${Math.random().toString(36).substring(2, 6).toUpperCase()}`;
  
  await query(`
    INSERT INTO luca_actions (
      action_id, action_type, title, description, severity,
      requires_approval, approval_level, params, expected_impact, case_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  `, [
    actionId,
    action.type || "CUSTOM",
    action.title,
    action.description,
    action.severity || caseData.severity,
    action.requires_approval !== false,
    action.approval_level || "APPROVAL",
    action.params || {},
    action.expected_impact || {},
    caseId,
  ]);
  
  // Agregar a recommended_actions del caso
  const currentActions = caseData.recommended_actions || [];
  await query(`
    UPDATE luca_cases SET
      recommended_actions = $2,
      updated_at = NOW()
    WHERE case_id = $1
  `, [caseId, [...currentActions, { action_id: actionId, ...action }]]);
  
  // Transicionar a RECOMMENDED
  const result = await transitionCase(caseId, CASE_EVENTS.RECOMMEND_ACTION, {
    actorId,
    context: { action_id: actionId },
  });
  
  await logAudit({
    actorType: actorId === "system" ? "system" : "user",
    actorId,
    action: "ACTION_RECOMMENDED",
    targetType: "case",
    targetId: caseId,
    changes: { action_id: actionId, action_type: action.type },
  });
  
  return { ...result, recommended_action_id: actionId };
}

/**
 * Aprueba una acción del caso
 */
export async function approveAction(caseId, actionId, actorId) {
  // Actualizar la acción
  const actionResult = await query(`
    UPDATE luca_actions SET
      state = 'APPROVED',
      approved_at = NOW(),
      approved_by = $3
    WHERE case_id = $1 AND action_id = $2
    RETURNING *
  `, [caseId, actionId, actorId]);
  
  if (actionResult.rowCount === 0) {
    throw new Error(`Action not found: ${actionId}`);
  }
  
  // Transicionar caso
  const result = await transitionCase(caseId, CASE_EVENTS.APPROVE_ACTION, {
    actorId,
    context: { action_id: actionId },
  });
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ACTION_APPROVED",
    targetType: "action",
    targetId: actionId,
    context: { case_id: caseId },
  });
  
  return result;
}

/**
 * Rechaza una acción del caso
 */
export async function rejectAction(caseId, actionId, actorId, reason) {
  // Actualizar la acción
  const actionResult = await query(`
    UPDATE luca_actions SET
      state = 'REJECTED',
      rejected_at = NOW(),
      rejected_by = $3,
      rejection_reason = $4
    WHERE case_id = $1 AND action_id = $2
    RETURNING *
  `, [caseId, actionId, actorId, reason]);
  
  if (actionResult.rowCount === 0) {
    throw new Error(`Action not found: ${actionId}`);
  }
  
  // Transicionar caso de vuelta a DIAGNOSED
  const result = await transitionCase(caseId, CASE_EVENTS.REJECT_ACTION, {
    actorId,
    context: { action_id: actionId, reason },
    notes: reason,
  });
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ACTION_REJECTED",
    targetType: "action",
    targetId: actionId,
    context: { case_id: caseId, reason },
  });
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// EJECUCIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicia la ejecución de una acción
 */
export async function startExecution(caseId, actionId, actorId = "system") {
  await query(`
    UPDATE luca_actions SET
      state = 'EXECUTING',
      executed_at = NOW(),
      executed_by = $3
    WHERE case_id = $1 AND action_id = $2
  `, [caseId, actionId, actorId]);
  
  return transitionCase(caseId, CASE_EVENTS.START_EXECUTION, {
    actorId,
    context: { action_id: actionId },
  });
}

/**
 * Marca ejecución como exitosa
 */
export async function executionSuccess(caseId, actionId, result, actorId = "system") {
  await query(`
    UPDATE luca_actions SET
      state = 'EXECUTED',
      execution_result = $3
    WHERE case_id = $1 AND action_id = $2
  `, [caseId, actionId, result || {}]);
  
  return transitionCase(caseId, CASE_EVENTS.EXECUTION_SUCCESS, {
    actorId,
    context: { action_id: actionId, result },
  });
}

/**
 * Marca ejecución como fallida
 */
export async function executionFailed(caseId, actionId, error, actorId = "system") {
  await query(`
    UPDATE luca_actions SET
      state = 'APPROVED',
      execution_result = $3
    WHERE case_id = $1 AND action_id = $2
  `, [caseId, actionId, { error: error?.message || error }]);
  
  return transitionCase(caseId, CASE_EVENTS.EXECUTION_FAILED, {
    actorId,
    context: { action_id: actionId, error: error?.message || error },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CIERRE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cierra un caso con outcome
 */
export async function closeCase(caseId, { outcome, actorId, notes } = {}) {
  const caseData = await getCase(caseId);
  if (!caseData) {
    throw new Error(`Case not found: ${caseId}`);
  }
  
  // Determinar el evento de cierre según el estado actual
  let closeEvent;
  switch (caseData.state) {
    case CASE_STATES.OPEN:
      closeEvent = CASE_EVENTS.CLOSE_AS_NOISE;
      break;
    case CASE_STATES.INVESTIGATING:
      closeEvent = CASE_EVENTS.CLOSE_AS_FALSE_POSITIVE;
      break;
    case CASE_STATES.DIAGNOSED:
      closeEvent = CASE_EVENTS.CLOSE_NO_ACTION_NEEDED;
      break;
    case CASE_STATES.APPROVED:
      closeEvent = CASE_EVENTS.CANCEL;
      break;
    case CASE_STATES.EXECUTED:
      closeEvent = CASE_EVENTS.SKIP_MEASUREMENT;
      break;
    case CASE_STATES.MEASURED:
      closeEvent = CASE_EVENTS.CLOSE_WITH_LEARNINGS;
      break;
    default:
      throw new Error(`Cannot close case in state: ${caseData.state}`);
  }
  
  // Actualizar outcome
  await query(`
    UPDATE luca_cases SET outcome = $2 WHERE case_id = $1
  `, [caseId, outcome || { notes }]);
  
  return transitionCase(caseId, closeEvent, { actorId, notes });
}

/**
 * Reabre un caso cerrado
 */
export async function reopenCase(caseId, actorId, reason) {
  const result = await transitionCase(caseId, CASE_EVENTS.REOPEN, {
    actorId,
    notes: reason,
    context: { reopen_reason: reason },
  });
  
  // Limpiar closed_at y closed_by
  await query(`
    UPDATE luca_cases SET closed_at = NULL, closed_by = NULL WHERE case_id = $1
  `, [caseId]);
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de casos
 */
export async function getCaseStats(days = 30) {
  const result = await query(`
    SELECT 
      state,
      case_type,
      severity,
      COUNT(*) as count,
      AVG(EXTRACT(EPOCH FROM (COALESCE(closed_at, NOW()) - created_at)) / 3600) as avg_hours_to_close
    FROM luca_cases
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY state, case_type, severity
    ORDER BY count DESC
  `);
  
  const byState = {};
  const byType = {};
  const bySeverity = {};
  
  for (const row of result.rows) {
    byState[row.state] = (byState[row.state] || 0) + parseInt(row.count);
    byType[row.case_type] = (byType[row.case_type] || 0) + parseInt(row.count);
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + parseInt(row.count);
  }
  
  return {
    byState,
    byType,
    bySeverity,
    total: Object.values(byState).reduce((a, b) => a + b, 0),
    details: result.rows,
  };
}

export default {
  createCase,
  getCase,
  listCases,
  getOpenCases,
  transitionCase,
  startInvestigation,
  closeAsNoise,
  closeAsFalsePositive,
  addEvidence,
  addHypothesis,
  diagnose,
  recommendAction,
  approveAction,
  rejectAction,
  startExecution,
  executionSuccess,
  executionFailed,
  closeCase,
  reopenCase,
  getCaseStats,
  CASE_STATES,
  CASE_EVENTS,
};
