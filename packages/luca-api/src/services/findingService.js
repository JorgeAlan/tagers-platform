/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FINDING SERVICE - CRUD de hallazgos de detectores
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Los findings son el output de los detectores.
 * Pueden convertirse en alerts o cases.
 * El feedback (labeling) permite mejorar los detectores.
 */

import { logger, query } from "@tagers/shared";

/**
 * Lista findings con filtros opcionales
 */
export async function listFindings({
  detectorId,
  runId,
  branchId,
  status,
  severity,
  unlabeledOnly = false,
  limit = 50,
  offset = 0,
  fromDate,
  toDate,
} = {}) {
  let sql = `
    SELECT 
      f.*,
      d.name as detector_name,
      d.agent_name
    FROM detector_findings f
    LEFT JOIN registry_detectors d ON f.detector_id = d.detector_id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (detectorId) {
    sql += ` AND f.detector_id = $${paramIndex++}`;
    params.push(detectorId);
  }
  
  if (runId) {
    sql += ` AND f.run_id = $${paramIndex++}`;
    params.push(runId);
  }
  
  if (branchId) {
    sql += ` AND f.branch_id = $${paramIndex++}`;
    params.push(branchId);
  }
  
  if (status) {
    sql += ` AND f.status = $${paramIndex++}`;
    params.push(status);
  }
  
  if (severity) {
    sql += ` AND f.severity = $${paramIndex++}`;
    params.push(severity);
  }
  
  if (unlabeledOnly) {
    sql += ` AND f.is_true_positive IS NULL`;
  }
  
  if (fromDate) {
    sql += ` AND f.created_at >= $${paramIndex++}`;
    params.push(fromDate);
  }
  
  if (toDate) {
    sql += ` AND f.created_at <= $${paramIndex++}`;
    params.push(toDate);
  }
  
  sql += `
    ORDER BY 
      CASE f.severity 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END,
      f.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex}
  `;
  params.push(limit, offset);
  
  const result = await query(sql, params);
  
  return {
    findings: result.rows,
    total: result.rowCount,
    limit,
    offset,
  };
}

/**
 * Obtiene un finding por ID
 */
export async function getFinding(findingId) {
  const result = await query(`
    SELECT 
      f.*,
      d.name as detector_name,
      d.agent_name,
      d.category,
      r.status as run_status,
      r.started_at as run_started_at
    FROM detector_findings f
    LEFT JOIN registry_detectors d ON f.detector_id = d.detector_id
    LEFT JOIN detector_runs r ON f.run_id = r.run_id
    WHERE f.finding_id = $1
  `, [findingId]);
  
  if (result.rowCount === 0) {
    return null;
  }
  
  // Obtener historial de labels
  const labelsResult = await query(`
    SELECT * FROM finding_labels
    WHERE finding_id = $1
    ORDER BY created_at DESC
  `, [findingId]);
  
  const finding = result.rows[0];
  finding.label_history = labelsResult.rows;
  
  return finding;
}

/**
 * Etiqueta un finding (true positive, false positive, unclear)
 */
export async function labelFinding(findingId, { label, labeledBy, notes }) {
  // Validar label
  const validLabels = ["true_positive", "false_positive", "unclear"];
  if (!validLabels.includes(label)) {
    throw new Error(`Invalid label: ${label}. Must be one of: ${validLabels.join(", ")}`);
  }
  
  // Actualizar finding
  const isTruePositive = label === "true_positive" ? true : 
                        label === "false_positive" ? false : null;
  
  await query(`
    UPDATE detector_findings
    SET is_true_positive = $2,
        labeled_by = $3,
        labeled_at = NOW(),
        label_notes = $4
    WHERE finding_id = $1
  `, [findingId, isTruePositive, labeledBy, notes]);
  
  // Guardar en historial
  await query(`
    INSERT INTO finding_labels (finding_id, label, labeled_by, notes)
    VALUES ($1, $2, $3, $4)
  `, [findingId, label, labeledBy, notes]);
  
  logger.info({ findingId, label, labeledBy }, "Finding labeled");
  
  return getFinding(findingId);
}

/**
 * Marca finding como acknowledged
 */
export async function acknowledgeFinding(findingId, acknowledgedBy) {
  const result = await query(`
    UPDATE detector_findings
    SET status = 'acknowledged'
    WHERE finding_id = $1 AND status = 'new'
    RETURNING *
  `, [findingId]);
  
  if (result.rowCount === 0) {
    logger.warn({ findingId }, "Finding not found or already acknowledged");
    return null;
  }
  
  logger.info({ findingId, acknowledgedBy }, "Finding acknowledged");
  return result.rows[0];
}

/**
 * Descarta un finding
 */
export async function dismissFinding(findingId, { dismissedBy, reason }) {
  const result = await query(`
    UPDATE detector_findings
    SET status = 'dismissed',
        label_notes = $3
    WHERE finding_id = $1 AND status IN ('new', 'acknowledged')
    RETURNING *
  `, [findingId, dismissedBy, reason]);
  
  if (result.rowCount === 0) {
    logger.warn({ findingId }, "Finding not found or already processed");
    return null;
  }
  
  // También marcar como false positive para aprendizaje
  await labelFinding(findingId, {
    label: "false_positive",
    labeledBy: dismissedBy,
    notes: reason || "Dismissed by user",
  });
  
  logger.info({ findingId, dismissedBy, reason }, "Finding dismissed");
  return result.rows[0];
}

/**
 * Obtiene findings por sucursal (para dashboard de sucursal)
 */
export async function getFindingsByBranch(branchId, limit = 20) {
  const result = await query(`
    SELECT 
      f.*,
      d.name as detector_name,
      d.agent_name
    FROM detector_findings f
    LEFT JOIN registry_detectors d ON f.detector_id = d.detector_id
    WHERE f.branch_id = $1
    ORDER BY 
      CASE f.severity 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END,
      f.created_at DESC
    LIMIT $2
  `, [branchId, limit]);
  
  return result.rows;
}

/**
 * Obtiene estadísticas de findings para métricas de detector
 */
export async function getFindingStats(detectorId = null, days = 30) {
  let sql = `
    SELECT 
      detector_id,
      COUNT(*) as total_findings,
      COUNT(*) FILTER (WHERE is_true_positive = true) as true_positives,
      COUNT(*) FILTER (WHERE is_true_positive = false) as false_positives,
      COUNT(*) FILTER (WHERE is_true_positive IS NULL) as unlabeled,
      COUNT(*) FILTER (WHERE severity = 'critical') as critical,
      COUNT(*) FILTER (WHERE severity = 'high') as high,
      COUNT(*) FILTER (WHERE severity = 'medium') as medium,
      COUNT(*) FILTER (WHERE severity = 'low') as low,
      COUNT(*) FILTER (WHERE status = 'converted') as converted
    FROM detector_findings
    WHERE created_at > NOW() - INTERVAL '${days} days'
  `;
  
  const params = [];
  
  if (detectorId) {
    sql += ` AND detector_id = $1`;
    params.push(detectorId);
  }
  
  sql += ` GROUP BY detector_id ORDER BY total_findings DESC`;
  
  const result = await query(sql, params);
  
  // Calcular precision para cada detector
  return result.rows.map(row => ({
    ...row,
    precision: row.true_positives + row.false_positives > 0
      ? (row.true_positives / (row.true_positives + row.false_positives)).toFixed(2)
      : null,
    label_rate: row.total_findings > 0
      ? ((row.true_positives + row.false_positives) / row.total_findings).toFixed(2)
      : 0,
  }));
}

/**
 * Obtiene findings recientes sin etiquetar (para queue de labeling)
 */
export async function getUnlabeledFindings(limit = 20) {
  const result = await query(`
    SELECT 
      f.*,
      d.name as detector_name,
      d.agent_name
    FROM detector_findings f
    LEFT JOIN registry_detectors d ON f.detector_id = d.detector_id
    WHERE f.is_true_positive IS NULL
      AND f.status NOT IN ('dismissed')
    ORDER BY 
      CASE f.severity 
        WHEN 'critical' THEN 1 
        WHEN 'high' THEN 2 
        WHEN 'medium' THEN 3 
        ELSE 4 
      END,
      f.created_at DESC
    LIMIT $1
  `, [limit]);
  
  return result.rows;
}

export default {
  listFindings,
  getFinding,
  labelFinding,
  acknowledgeFinding,
  dismissFinding,
  getFindingsByBranch,
  getFindingStats,
  getUnlabeledFindings,
};
