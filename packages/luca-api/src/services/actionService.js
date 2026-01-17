/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACTION SERVICE - Gestión de acciones LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Las acciones son lo que LUCA propone hacer para resolver un caso.
 * Pueden requerir aprobación humana antes de ejecutarse.
 * 
 * Estados: PENDING → APPROVED/REJECTED → EXECUTING → EXECUTED/FAILED
 */

import { logger, query } from "@tagers/shared";
import { logAudit } from "./auditService.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const ACTION_STATES = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
};

export const ACTION_TYPES = {
  NOTIFY_MANAGER: "NOTIFY_MANAGER",
  SCHEDULE_MEETING: "SCHEDULE_MEETING",
  CREATE_REPORT: "CREATE_REPORT",
  SEND_ALERT: "SEND_ALERT",
  ADJUST_INVENTORY: "ADJUST_INVENTORY",
  MODIFY_SCHEDULE: "MODIFY_SCHEDULE",
  GENERATE_EXPEDIENTE: "GENERATE_EXPEDIENTE",
  CUSTOM: "CUSTOM",
};

export const APPROVAL_LEVELS = {
  AUTO: "AUTO",           // Ejecutar automáticamente
  DRAFT: "DRAFT",         // Crear borrador, revisar después
  APPROVAL: "APPROVAL",   // Requiere aprobación explícita
  CRITICAL: "CRITICAL",   // Requiere aprobación de owner
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateActionId() {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ACT-${date}-${random}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Propone una nueva acción
 */
export async function proposeAction({
  actionType,
  title,
  description,
  severity = "MEDIUM",
  requiresApproval = true,
  approvalLevel = "APPROVAL",
  params = {},
  expectedImpact = {},
  caseId,
  proposedBy = "system",
}) {
  const actionId = generateActionId();
  
  // Si es AUTO, marcar como aprobada directamente
  const initialState = approvalLevel === APPROVAL_LEVELS.AUTO 
    ? ACTION_STATES.APPROVED 
    : ACTION_STATES.PENDING;
  
  const result = await query(`
    INSERT INTO luca_actions (
      action_id, action_type, state, title, description,
      severity, requires_approval, approval_level,
      params, expected_impact, case_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING *
  `, [
    actionId,
    actionType,
    initialState,
    title,
    description,
    severity.toUpperCase(),
    requiresApproval,
    approvalLevel,
    params,
    expectedImpact,
    caseId,
  ]);
  
  const action = result.rows[0];
  
  await logAudit({
    actorType: "system",
    actorId: proposedBy,
    action: "ACTION_PROPOSED",
    targetType: "action",
    targetId: actionId,
    changes: { actionType, approvalLevel, caseId },
  });
  
  logger.info({ actionId, actionType, caseId, approvalLevel }, "Action proposed");
  
  return action;
}

/**
 * Obtiene una acción por ID
 */
export async function getAction(actionId) {
  const result = await query(`
    SELECT a.*,
           c.title as case_title,
           c.state as case_state,
           c.case_type
    FROM luca_actions a
    LEFT JOIN luca_cases c ON a.case_id = c.case_id
    WHERE a.action_id = $1
  `, [actionId]);
  
  if (result.rowCount === 0) {
    return null;
  }
  
  return result.rows[0];
}

/**
 * Lista acciones con filtros
 */
export async function listActions({
  state,
  states, // Array
  actionType,
  caseId,
  approvalLevel,
  pendingApproval = false,
  limit = 50,
  offset = 0,
} = {}) {
  let sql = `
    SELECT a.*,
           c.title as case_title,
           c.state as case_state
    FROM luca_actions a
    LEFT JOIN luca_cases c ON a.case_id = c.case_id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (state) {
    sql += ` AND a.state = $${paramIndex++}`;
    params.push(state);
  }
  
  if (states && states.length > 0) {
    sql += ` AND a.state = ANY($${paramIndex++})`;
    params.push(states);
  }
  
  if (actionType) {
    sql += ` AND a.action_type = $${paramIndex++}`;
    params.push(actionType);
  }
  
  if (caseId) {
    sql += ` AND a.case_id = $${paramIndex++}`;
    params.push(caseId);
  }
  
  if (approvalLevel) {
    sql += ` AND a.approval_level = $${paramIndex++}`;
    params.push(approvalLevel);
  }
  
  if (pendingApproval) {
    sql += ` AND a.state = 'PENDING' AND a.requires_approval = true`;
  }
  
  sql += ` ORDER BY a.created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  
  return {
    actions: result.rows,
    total: result.rowCount,
    limit,
    offset,
  };
}

/**
 * Obtiene acciones pendientes de aprobación
 */
export async function getPendingApprovals(limit = 50) {
  return listActions({
    pendingApproval: true,
    limit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSICIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aprueba una acción
 */
export async function approve(actionId, actorId, notes = null) {
  const result = await query(`
    UPDATE luca_actions SET
      state = 'APPROVED',
      approved_at = NOW(),
      approved_by = $2
    WHERE action_id = $1 AND state = 'PENDING'
    RETURNING *
  `, [actionId, actorId]);
  
  if (result.rowCount === 0) {
    const existing = await getAction(actionId);
    if (!existing) {
      throw new Error(`Action not found: ${actionId}`);
    }
    throw new Error(`Cannot approve action in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ACTION_APPROVED",
    targetType: "action",
    targetId: actionId,
    context: { notes },
  });
  
  logger.info({ actionId, actorId }, "Action approved");
  
  return result.rows[0];
}

/**
 * Rechaza una acción
 */
export async function reject(actionId, actorId, reason) {
  const result = await query(`
    UPDATE luca_actions SET
      state = 'REJECTED',
      rejected_at = NOW(),
      rejected_by = $2,
      rejection_reason = $3
    WHERE action_id = $1 AND state = 'PENDING'
    RETURNING *
  `, [actionId, actorId, reason || ""]);
  
  if (result.rowCount === 0) {
    const existing = await getAction(actionId);
    if (!existing) {
      throw new Error(`Action not found: ${actionId}`);
    }
    throw new Error(`Cannot reject action in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ACTION_REJECTED",
    targetType: "action",
    targetId: actionId,
    changes: { reason },
  });
  
  logger.info({ actionId, actorId, reason }, "Action rejected");
  
  return result.rows[0];
}

/**
 * Inicia la ejecución de una acción
 */
export async function execute(actionId, executedBy = "system") {
  const action = await getAction(actionId);
  if (!action) {
    throw new Error(`Action not found: ${actionId}`);
  }
  
  if (action.state !== ACTION_STATES.APPROVED) {
    throw new Error(`Cannot execute action in state: ${action.state}`);
  }
  
  // Marcar como ejecutando
  await query(`
    UPDATE luca_actions SET
      state = 'EXECUTING',
      executed_at = NOW(),
      executed_by = $2
    WHERE action_id = $1
  `, [actionId, executedBy]);
  
  logger.info({ actionId, executedBy }, "Action execution started");
  
  // Aquí iría la lógica real de ejecución según el tipo
  // Por ahora retornamos para que el caller maneje la ejecución
  
  return {
    ...action,
    state: ACTION_STATES.EXECUTING,
    executed_at: new Date().toISOString(),
    executed_by: executedBy,
  };
}

/**
 * Marca una acción como ejecutada exitosamente
 */
export async function markExecuted(actionId, executionResult = {}) {
  const result = await query(`
    UPDATE luca_actions SET
      state = 'EXECUTED',
      execution_result = $2
    WHERE action_id = $1 AND state = 'EXECUTING'
    RETURNING *
  `, [actionId, executionResult]);
  
  if (result.rowCount === 0) {
    const existing = await getAction(actionId);
    if (!existing) {
      throw new Error(`Action not found: ${actionId}`);
    }
    throw new Error(`Cannot mark executed action in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "system",
    actorId: "executor",
    action: "ACTION_EXECUTED",
    targetType: "action",
    targetId: actionId,
    changes: { result: executionResult },
  });
  
  logger.info({ actionId }, "Action executed successfully");
  
  return result.rows[0];
}

/**
 * Marca una acción como fallida
 */
export async function markFailed(actionId, error) {
  const result = await query(`
    UPDATE luca_actions SET
      state = 'FAILED',
      execution_result = $2
    WHERE action_id = $1 AND state = 'EXECUTING'
    RETURNING *
  `, [actionId, { error: error?.message || error }]);
  
  if (result.rowCount === 0) {
    const existing = await getAction(actionId);
    if (!existing) {
      throw new Error(`Action not found: ${actionId}`);
    }
    throw new Error(`Cannot mark failed action in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "system",
    actorId: "executor",
    action: "ACTION_FAILED",
    targetType: "action",
    targetId: actionId,
    changes: { error: error?.message || error },
  });
  
  logger.error({ actionId, error: error?.message }, "Action execution failed");
  
  return result.rows[0];
}

/**
 * Cancela una acción pendiente
 */
export async function cancel(actionId, actorId, reason) {
  const result = await query(`
    UPDATE luca_actions SET
      state = 'CANCELLED',
      rejected_at = NOW(),
      rejected_by = $2,
      rejection_reason = $3
    WHERE action_id = $1 AND state IN ('PENDING', 'APPROVED')
    RETURNING *
  `, [actionId, actorId, reason || "Cancelled"]);
  
  if (result.rowCount === 0) {
    const existing = await getAction(actionId);
    if (!existing) {
      throw new Error(`Action not found: ${actionId}`);
    }
    throw new Error(`Cannot cancel action in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ACTION_CANCELLED",
    targetType: "action",
    targetId: actionId,
    changes: { reason },
  });
  
  logger.info({ actionId, actorId, reason }, "Action cancelled");
  
  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE IMPACTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra el impacto real de una acción ejecutada
 */
export async function recordImpact(actionId, actualImpact) {
  const result = await query(`
    UPDATE luca_actions SET
      actual_impact = $2
    WHERE action_id = $1 AND state = 'EXECUTED'
    RETURNING *
  `, [actionId, actualImpact]);
  
  if (result.rowCount === 0) {
    throw new Error(`Action not found or not executed: ${actionId}`);
  }
  
  await logAudit({
    actorType: "system",
    actorId: "impact_tracker",
    action: "IMPACT_RECORDED",
    targetType: "action",
    targetId: actionId,
    changes: { actualImpact },
  });
  
  logger.info({ actionId, actualImpact }, "Action impact recorded");
  
  return result.rows[0];
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de acciones
 */
export async function getActionStats(days = 30) {
  const result = await query(`
    SELECT 
      state,
      action_type,
      approval_level,
      COUNT(*) as count,
      AVG(EXTRACT(EPOCH FROM (COALESCE(approved_at, rejected_at, NOW()) - created_at)) / 60) as avg_minutes_to_decision
    FROM luca_actions
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY state, action_type, approval_level
    ORDER BY count DESC
  `);
  
  const byState = {};
  const byType = {};
  const byApprovalLevel = {};
  
  for (const row of result.rows) {
    byState[row.state] = (byState[row.state] || 0) + parseInt(row.count);
    byType[row.action_type] = (byType[row.action_type] || 0) + parseInt(row.count);
    byApprovalLevel[row.approval_level] = (byApprovalLevel[row.approval_level] || 0) + parseInt(row.count);
  }
  
  // Calcular approval rate
  const approvalRate = byState.APPROVED && byState.REJECTED
    ? (byState.APPROVED / (byState.APPROVED + byState.REJECTED) * 100).toFixed(1)
    : null;
  
  return {
    byState,
    byType,
    byApprovalLevel,
    total: Object.values(byState).reduce((a, b) => a + b, 0),
    approvalRate,
    details: result.rows,
  };
}

export default {
  ACTION_STATES,
  ACTION_TYPES,
  APPROVAL_LEVELS,
  proposeAction,
  getAction,
  listActions,
  getPendingApprovals,
  approve,
  reject,
  execute,
  markExecuted,
  markFailed,
  cancel,
  recordImpact,
  getActionStats,
};
