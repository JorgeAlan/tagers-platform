/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ALERT SERVICE - Gestión de alertas LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Las alertas son notificaciones que requieren atención.
 * Pueden derivar en casos si necesitan investigación más profunda.
 * 
 * Estados: ACTIVE → ACKNOWLEDGED → RESOLVED | ESCALATED
 */

import { logger, query } from "@tagers/shared";
import { logAudit } from "./auditService.js";
import { routeAlert } from "./routingService.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const ALERT_STATES = {
  ACTIVE: "ACTIVE",
  ACKNOWLEDGED: "ACKNOWLEDGED",
  RESOLVED: "RESOLVED",
  ESCALATED: "ESCALATED",
  EXPIRED: "EXPIRED",
};

export const ALERT_SEVERITIES = {
  LOW: "LOW",
  MEDIUM: "MEDIUM",
  HIGH: "HIGH",
  CRITICAL: "CRITICAL",
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateAlertId() {
  const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `ALT-${date}-${random}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una nueva alerta
 */
export async function createAlert({
  alertType,
  severity = "MEDIUM",
  title,
  message,
  branchId,
  fingerprint,
  source,
  detectorId,
  runId,
  caseId,
  expiresIn, // hours
  metadata = {},
}) {
  const alertId = generateAlertId();
  
  // Calcular expiración si se especifica
  let expiresAt = null;
  if (expiresIn) {
    expiresAt = new Date(Date.now() + expiresIn * 60 * 60 * 1000).toISOString();
  }
  
  // Verificar deduplicación por fingerprint
  if (fingerprint) {
    const existing = await query(`
      SELECT alert_id FROM luca_alerts
      WHERE fingerprint = $1 
        AND state = 'ACTIVE'
        AND created_at > NOW() - INTERVAL '24 hours'
    `, [fingerprint]);
    
    if (existing.rowCount > 0) {
      logger.info({ fingerprint, existingId: existing.rows[0].alert_id }, 
        "Alert deduplicated by fingerprint");
      return { deduplicated: true, existingAlertId: existing.rows[0].alert_id };
    }
  }
  
  const result = await query(`
    INSERT INTO luca_alerts (
      alert_id, alert_type, severity, title, message,
      branch_id, fingerprint, source, detector_id, run_id,
      case_id, expires_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    RETURNING *
  `, [
    alertId,
    alertType,
    severity.toUpperCase(),
    title,
    message,
    branchId,
    fingerprint,
    source,
    detectorId,
    runId,
    caseId,
    expiresAt,
  ]);
  
  const alert = result.rows[0];
  
  await logAudit({
    actorType: "system",
    actorId: source || "luca",
    action: "ALERT_CREATED",
    targetType: "alert",
    targetId: alertId,
    changes: { severity, alertType, branchId },
  });
  
  logger.info({ alertId, alertType, severity, branchId }, "Alert created");
  
  // Routing - enviar notificaciones según preferencias
  try {
    const notifications = await routeAlert(alert);
    
    // Guardar notificaciones enviadas
    if (notifications.length > 0) {
      await query(`
        UPDATE luca_alerts SET notifications_sent = $2 WHERE alert_id = $1
      `, [alertId, notifications]);
    }
    
    alert.notifications_sent = notifications;
  } catch (err) {
    logger.error({ alertId, err: err?.message }, "Failed to route alert");
  }
  
  return alert;
}

/**
 * Obtiene una alerta por ID
 */
export async function getAlert(alertId) {
  const result = await query(`
    SELECT a.*,
           c.title as case_title,
           c.state as case_state
    FROM luca_alerts a
    LEFT JOIN luca_cases c ON a.case_id = c.case_id
    WHERE a.alert_id = $1
  `, [alertId]);
  
  if (result.rowCount === 0) {
    return null;
  }
  
  return result.rows[0];
}

/**
 * Lista alertas con filtros
 */
export async function listAlerts({
  state = "ACTIVE",
  states, // Array
  severity,
  alertType,
  branchId,
  detectorId,
  includeExpired = false,
  limit = 50,
  offset = 0,
} = {}) {
  let sql = `
    SELECT a.*,
           c.title as case_title,
           c.state as case_state
    FROM luca_alerts a
    LEFT JOIN luca_cases c ON a.case_id = c.case_id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (state && !states) {
    sql += ` AND a.state = $${paramIndex++}`;
    params.push(state);
  }
  
  if (states && states.length > 0) {
    sql += ` AND a.state = ANY($${paramIndex++})`;
    params.push(states);
  }
  
  if (severity) {
    sql += ` AND a.severity = $${paramIndex++}`;
    params.push(severity);
  }
  
  if (alertType) {
    sql += ` AND a.alert_type = $${paramIndex++}`;
    params.push(alertType);
  }
  
  if (branchId) {
    sql += ` AND a.branch_id = $${paramIndex++}`;
    params.push(branchId);
  }
  
  if (detectorId) {
    sql += ` AND a.detector_id = $${paramIndex++}`;
    params.push(detectorId);
  }
  
  if (!includeExpired) {
    sql += ` AND (a.expires_at IS NULL OR a.expires_at > NOW())`;
  }
  
  sql += ` ORDER BY 
    CASE a.severity 
      WHEN 'CRITICAL' THEN 1 
      WHEN 'HIGH' THEN 2 
      WHEN 'MEDIUM' THEN 3 
      ELSE 4 
    END,
    a.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  
  return {
    alerts: result.rows,
    total: result.rowCount,
    limit,
    offset,
  };
}

/**
 * Obtiene alertas activas (para dashboard)
 */
export async function getActiveAlerts(limit = 50) {
  return listAlerts({
    states: [ALERT_STATES.ACTIVE, ALERT_STATES.ACKNOWLEDGED],
    includeExpired: false,
    limit,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSICIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Acknowledges una alerta
 */
export async function acknowledge(alertId, actorId) {
  const result = await query(`
    UPDATE luca_alerts SET
      state = 'ACKNOWLEDGED',
      acked_at = NOW(),
      acked_by = $2
    WHERE alert_id = $1 AND state = 'ACTIVE'
    RETURNING *
  `, [alertId, actorId]);
  
  if (result.rowCount === 0) {
    // Check if alert exists
    const existing = await getAlert(alertId);
    if (!existing) {
      throw new Error(`Alert not found: ${alertId}`);
    }
    throw new Error(`Alert already in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ALERT_ACKNOWLEDGED",
    targetType: "alert",
    targetId: alertId,
  });
  
  logger.info({ alertId, actorId }, "Alert acknowledged");
  
  return result.rows[0];
}

/**
 * Resuelve una alerta
 */
export async function resolve(alertId, { actorId, resolution }) {
  const result = await query(`
    UPDATE luca_alerts SET
      state = 'RESOLVED',
      resolved_at = NOW(),
      resolved_by = $2,
      resolution = $3
    WHERE alert_id = $1 AND state IN ('ACTIVE', 'ACKNOWLEDGED')
    RETURNING *
  `, [alertId, actorId, resolution || ""]);
  
  if (result.rowCount === 0) {
    const existing = await getAlert(alertId);
    if (!existing) {
      throw new Error(`Alert not found: ${alertId}`);
    }
    throw new Error(`Cannot resolve alert in state: ${existing.state}`);
  }
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ALERT_RESOLVED",
    targetType: "alert",
    targetId: alertId,
    changes: { resolution },
  });
  
  logger.info({ alertId, actorId, resolution }, "Alert resolved");
  
  return result.rows[0];
}

/**
 * Escala una alerta a caso
 */
export async function escalateToCase(alertId, actorId) {
  const alert = await getAlert(alertId);
  if (!alert) {
    throw new Error(`Alert not found: ${alertId}`);
  }
  
  if (alert.case_id) {
    throw new Error(`Alert already linked to case: ${alert.case_id}`);
  }
  
  // Importar dinámicamente para evitar dependencia circular
  const { createCase } = await import("./caseService.js");
  
  // Crear caso desde la alerta
  const newCase = await createCase({
    caseType: alert.alert_type,
    severity: alert.severity,
    title: alert.title,
    description: alert.message,
    scope: { branch_id: alert.branch_id },
    evidence: [{
      type: "alert",
      alert_id: alertId,
      data: alert,
    }],
    source: alert.source,
    detectorId: alert.detector_id,
    runId: alert.run_id,
    createdBy: actorId,
  });
  
  // Actualizar alerta
  await query(`
    UPDATE luca_alerts SET
      state = 'ESCALATED',
      case_id = $2,
      resolved_at = NOW(),
      resolved_by = $3,
      resolution = 'Escalated to case'
    WHERE alert_id = $1
  `, [alertId, newCase.case_id, actorId]);
  
  await logAudit({
    actorType: "user",
    actorId,
    action: "ALERT_ESCALATED",
    targetType: "alert",
    targetId: alertId,
    changes: { case_id: newCase.case_id },
  });
  
  logger.info({ alertId, caseId: newCase.case_id, actorId }, "Alert escalated to case");
  
  return {
    alert: await getAlert(alertId),
    case: newCase,
  };
}

/**
 * Expirar alertas vencidas (llamado por job)
 */
export async function expireAlerts() {
  const result = await query(`
    UPDATE luca_alerts SET
      state = 'EXPIRED'
    WHERE state = 'ACTIVE'
      AND expires_at IS NOT NULL
      AND expires_at < NOW()
    RETURNING alert_id
  `);
  
  if (result.rowCount > 0) {
    logger.info({ count: result.rowCount }, "Alerts expired");
  }
  
  return result.rows.map(r => r.alert_id);
}

// ═══════════════════════════════════════════════════════════════════════════
// BATCH OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Acknowledge múltiples alertas
 */
export async function acknowledgeMany(alertIds, actorId) {
  const results = [];
  
  for (const alertId of alertIds) {
    try {
      const alert = await acknowledge(alertId, actorId);
      results.push({ alertId, success: true, alert });
    } catch (err) {
      results.push({ alertId, success: false, error: err.message });
    }
  }
  
  return results;
}

/**
 * Resolve múltiples alertas
 */
export async function resolveMany(alertIds, actorId, resolution) {
  const results = [];
  
  for (const alertId of alertIds) {
    try {
      const alert = await resolve(alertId, { actorId, resolution });
      results.push({ alertId, success: true, alert });
    } catch (err) {
      results.push({ alertId, success: false, error: err.message });
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de alertas
 */
export async function getAlertStats(days = 30) {
  const result = await query(`
    SELECT 
      state,
      severity,
      alert_type,
      branch_id,
      COUNT(*) as count,
      AVG(EXTRACT(EPOCH FROM (COALESCE(acked_at, NOW()) - created_at)) / 60) as avg_minutes_to_ack,
      AVG(EXTRACT(EPOCH FROM (COALESCE(resolved_at, NOW()) - created_at)) / 60) as avg_minutes_to_resolve
    FROM luca_alerts
    WHERE created_at > NOW() - INTERVAL '${days} days'
    GROUP BY state, severity, alert_type, branch_id
    ORDER BY count DESC
  `);
  
  const byState = {};
  const bySeverity = {};
  const byType = {};
  const byBranch = {};
  
  for (const row of result.rows) {
    byState[row.state] = (byState[row.state] || 0) + parseInt(row.count);
    bySeverity[row.severity] = (bySeverity[row.severity] || 0) + parseInt(row.count);
    byType[row.alert_type] = (byType[row.alert_type] || 0) + parseInt(row.count);
    if (row.branch_id) {
      byBranch[row.branch_id] = (byBranch[row.branch_id] || 0) + parseInt(row.count);
    }
  }
  
  return {
    byState,
    bySeverity,
    byType,
    byBranch,
    total: Object.values(byState).reduce((a, b) => a + b, 0),
    details: result.rows,
  };
}

/**
 * Obtiene alertas por sucursal
 */
export async function getAlertsByBranch(branchId, limit = 20) {
  return listAlerts({
    branchId,
    states: [ALERT_STATES.ACTIVE, ALERT_STATES.ACKNOWLEDGED],
    limit,
  });
}

export default {
  ALERT_STATES,
  ALERT_SEVERITIES,
  createAlert,
  getAlert,
  listAlerts,
  getActiveAlerts,
  acknowledge,
  resolve,
  escalateToCase,
  expireAlerts,
  acknowledgeMany,
  resolveMany,
  getAlertStats,
  getAlertsByBranch,
};
