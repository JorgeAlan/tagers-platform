/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RUN SERVICE - CRUD de ejecuciones de detectores
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { logger, query } from "@tagers/shared";

/**
 * Lista runs con filtros opcionales
 */
export async function listRuns({
  detectorId,
  status,
  limit = 50,
  offset = 0,
  fromDate,
  toDate,
} = {}) {
  let sql = `
    SELECT 
      r.*,
      d.name as detector_name,
      d.agent_name,
      d.category
    FROM detector_runs r
    LEFT JOIN registry_detectors d ON r.detector_id = d.detector_id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (detectorId) {
    sql += ` AND r.detector_id = $${paramIndex++}`;
    params.push(detectorId);
  }
  
  if (status) {
    sql += ` AND r.status = $${paramIndex++}`;
    params.push(status);
  }
  
  if (fromDate) {
    sql += ` AND r.started_at >= $${paramIndex++}`;
    params.push(fromDate);
  }
  
  if (toDate) {
    sql += ` AND r.started_at <= $${paramIndex++}`;
    params.push(toDate);
  }
  
  sql += ` ORDER BY r.started_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  
  return {
    runs: result.rows,
    total: result.rowCount,
    limit,
    offset,
  };
}

/**
 * Obtiene un run por ID con sus findings
 */
export async function getRun(runId, includeFindings = true) {
  const runResult = await query(`
    SELECT 
      r.*,
      d.name as detector_name,
      d.agent_name,
      d.category,
      d.thresholds
    FROM detector_runs r
    LEFT JOIN registry_detectors d ON r.detector_id = d.detector_id
    WHERE r.run_id = $1
  `, [runId]);
  
  if (runResult.rowCount === 0) {
    return null;
  }
  
  const run = runResult.rows[0];
  
  if (includeFindings) {
    const findingsResult = await query(`
      SELECT * FROM detector_findings 
      WHERE run_id = $1 
      ORDER BY severity, created_at
    `, [runId]);
    
    run.findings = findingsResult.rows;
  }
  
  return run;
}

/**
 * Obtiene estadísticas de runs
 */
export async function getRunStats(detectorId = null, days = 30) {
  let sql = `
    SELECT 
      detector_id,
      COUNT(*) as total_runs,
      COUNT(*) FILTER (WHERE status = 'completed') as successful,
      COUNT(*) FILTER (WHERE status = 'failed') as failed,
      AVG(duration_ms) as avg_duration_ms,
      SUM(findings_count) as total_findings,
      SUM(alerts_created) as total_alerts,
      SUM(cases_created) as total_cases,
      MAX(started_at) as last_run
    FROM detector_runs
    WHERE started_at > NOW() - INTERVAL '${days} days'
  `;
  
  const params = [];
  
  if (detectorId) {
    sql += ` AND detector_id = $1`;
    params.push(detectorId);
  }
  
  sql += ` GROUP BY detector_id ORDER BY total_runs DESC`;
  
  const result = await query(sql, params);
  
  return result.rows;
}

/**
 * Obtiene runs recientes (para dashboard)
 */
export async function getRecentRuns(limit = 10) {
  const result = await query(`
    SELECT 
      r.run_id,
      r.detector_id,
      d.name as detector_name,
      d.agent_name,
      r.status,
      r.started_at,
      r.duration_ms,
      r.findings_count,
      r.alerts_created,
      r.cases_created,
      r.error_message
    FROM detector_runs r
    LEFT JOIN registry_detectors d ON r.detector_id = d.detector_id
    ORDER BY r.started_at DESC
    LIMIT $1
  `, [limit]);
  
  return result.rows;
}

/**
 * Cancela un run en curso
 */
export async function cancelRun(runId) {
  const result = await query(`
    UPDATE detector_runs
    SET status = 'cancelled',
        completed_at = NOW(),
        error_message = 'Cancelled by user'
    WHERE run_id = $1 AND status = 'running'
    RETURNING *
  `, [runId]);
  
  if (result.rowCount === 0) {
    logger.warn({ runId }, "Run not found or not running");
    return null;
  }
  
  logger.info({ runId }, "Run cancelled");
  return result.rows[0];
}

export default {
  listRuns,
  getRun,
  getRunStats,
  getRecentRuns,
  cancelRun,
};
