/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUDIT SERVICE - Registro de todas las operaciones en LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Registra quién hizo qué, cuándo, y qué cambió.
 * Esencial para compliance y debugging.
 */

import { logger, query } from "@tagers/shared";

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra una entrada en el audit log
 */
export async function logAudit({
  actorType,  // user, system, detector, scheduler
  actorId,
  action,     // CASE_CREATED, ALERT_ACKNOWLEDGED, ACTION_APPROVED, etc.
  targetType, // case, alert, action, finding, detector
  targetId,
  changes = {},
  context = {},
}) {
  try {
    await query(`
      INSERT INTO luca_audit_log (
        actor_type, actor_id, action, target_type, target_id, changes, context
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [actorType, actorId, action, targetType, targetId, changes, context]);
    
    logger.debug({
      actorType,
      actorId,
      action,
      targetType,
      targetId,
    }, "Audit logged");
  } catch (err) {
    // No fallar si audit log falla, solo loggear
    logger.error({ err: err?.message, action, targetId }, "Failed to log audit");
  }
}

/**
 * Obtiene historial de audit para un target específico
 */
export async function getAuditHistory(targetType, targetId, limit = 50) {
  const result = await query(`
    SELECT * FROM luca_audit_log
    WHERE target_type = $1 AND target_id = $2
    ORDER BY created_at DESC
    LIMIT $3
  `, [targetType, targetId, limit]);
  
  return result.rows;
}

/**
 * Obtiene actividad de un actor
 */
export async function getActorActivity(actorId, days = 30, limit = 100) {
  const result = await query(`
    SELECT * FROM luca_audit_log
    WHERE actor_id = $1
      AND created_at > NOW() - INTERVAL '${days} days'
    ORDER BY created_at DESC
    LIMIT $2
  `, [actorId, limit]);
  
  return result.rows;
}

/**
 * Obtiene audit log con filtros
 */
export async function queryAuditLog({
  actorType,
  actorId,
  action,
  targetType,
  targetId,
  fromDate,
  toDate,
  limit = 100,
  offset = 0,
} = {}) {
  let sql = `
    SELECT * FROM luca_audit_log
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (actorType) {
    sql += ` AND actor_type = $${paramIndex++}`;
    params.push(actorType);
  }
  
  if (actorId) {
    sql += ` AND actor_id = $${paramIndex++}`;
    params.push(actorId);
  }
  
  if (action) {
    sql += ` AND action = $${paramIndex++}`;
    params.push(action);
  }
  
  if (targetType) {
    sql += ` AND target_type = $${paramIndex++}`;
    params.push(targetType);
  }
  
  if (targetId) {
    sql += ` AND target_id = $${paramIndex++}`;
    params.push(targetId);
  }
  
  if (fromDate) {
    sql += ` AND created_at >= $${paramIndex++}`;
    params.push(fromDate);
  }
  
  if (toDate) {
    sql += ` AND created_at <= $${paramIndex++}`;
    params.push(toDate);
  }
  
  sql += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  
  return {
    entries: result.rows,
    total: result.rowCount,
    limit,
    offset,
  };
}

/**
 * Obtiene estadísticas del audit log
 */
export async function getAuditStats(days = 30) {
  const result = await query(`
    SELECT 
      action,
      actor_type,
      target_type,
      COUNT(*) as count
    FROM luca_audit_log
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY action, actor_type, target_type
    ORDER BY count DESC
  `);
  
  const byAction = {};
  const byActorType = {};
  const byTargetType = {};
  
  for (const row of result.rows) {
    byAction[row.action] = (byAction[row.action] || 0) + parseInt(row.count);
    byActorType[row.actor_type] = (byActorType[row.actor_type] || 0) + parseInt(row.count);
    byTargetType[row.target_type] = (byTargetType[row.target_type] || 0) + parseInt(row.count);
  }
  
  return {
    byAction,
    byActorType,
    byTargetType,
    total: Object.values(byAction).reduce((a, b) => a + b, 0),
    details: result.rows,
  };
}

/**
 * Obtiene timeline de un caso (todas las operaciones relacionadas)
 */
export async function getCaseTimeline(caseId) {
  // Obtener audit del caso
  const caseAudit = await getAuditHistory("case", caseId, 100);
  
  // Obtener audit de acciones del caso
  const actionsResult = await query(`
    SELECT action_id FROM luca_actions WHERE case_id = $1
  `, [caseId]);
  
  const actionIds = actionsResult.rows.map(r => r.action_id);
  
  let actionAudit = [];
  if (actionIds.length > 0) {
    const actionAuditResult = await query(`
      SELECT * FROM luca_audit_log
      WHERE target_type = 'action' AND target_id = ANY($1)
      ORDER BY created_at DESC
    `, [actionIds]);
    actionAudit = actionAuditResult.rows;
  }
  
  // Obtener audit de alertas del caso
  const alertsResult = await query(`
    SELECT alert_id FROM luca_alerts WHERE case_id = $1
  `, [caseId]);
  
  const alertIds = alertsResult.rows.map(r => r.alert_id);
  
  let alertAudit = [];
  if (alertIds.length > 0) {
    const alertAuditResult = await query(`
      SELECT * FROM luca_audit_log
      WHERE target_type = 'alert' AND target_id = ANY($1)
      ORDER BY created_at DESC
    `, [alertIds]);
    alertAudit = alertAuditResult.rows;
  }
  
  // Combinar y ordenar por fecha
  const timeline = [...caseAudit, ...actionAudit, ...alertAudit]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  
  return timeline;
}

export default {
  logAudit,
  getAuditHistory,
  getActorActivity,
  queryAuditLog,
  getAuditStats,
  getCaseTimeline,
};
