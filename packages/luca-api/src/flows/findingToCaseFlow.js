/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FINDING TO CASE FLOW - Convierte findings en alerts y cases
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Este flow es el puente entre el Execution Engine (Iteración 2) y 
 * el Case Management (Iteración 3).
 * 
 * Reglas:
 * - Finding severity HIGH/CRITICAL → Alert
 * - Finding severity CRITICAL con output_type="case" → Case directamente
 * - Multiple findings del mismo tipo en poco tiempo → Single Alert/Case
 */

import { logger } from "@tagers/shared";
import { createAlert } from "../services/alertService.js";
import { createCase, addEvidence } from "../services/caseService.js";
import { logAudit } from "../services/auditService.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_TO_OUTPUT = {
  CRITICAL: "case",      // Always create case
  HIGH: "alert",         // Create alert, can escalate to case
  MEDIUM: "alert",       // Create alert
  LOW: "insight",        // Just log, no alert
};

// Cooldown para deduplicación (en minutos)
const DEDUP_COOLDOWN_MINUTES = 60;

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FLOW
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Procesa un finding y lo convierte en alert o case según corresponda
 */
export async function processFinding(finding, detector) {
  const outputType = detector?.output_type || SEVERITY_TO_OUTPUT[finding.severity] || "alert";
  
  logger.info({
    findingId: finding.finding_id,
    severity: finding.severity,
    outputType,
    detectorId: detector?.detector_id,
  }, "Processing finding");
  
  try {
    switch (outputType) {
      case "case":
        return await createCaseFromFinding(finding, detector);
        
      case "alert":
        return await createAlertFromFinding(finding, detector);
        
      case "insight":
        // Just log, no action needed
        logger.info({ findingId: finding.finding_id }, "Finding recorded as insight");
        return { type: "insight", findingId: finding.finding_id };
        
      default:
        logger.warn({ outputType }, "Unknown output type, defaulting to alert");
        return await createAlertFromFinding(finding, detector);
    }
  } catch (err) {
    logger.error({
      findingId: finding.finding_id,
      err: err?.message,
    }, "Failed to process finding");
    throw err;
  }
}

/**
 * Procesa múltiples findings de un detector run
 */
export async function processFindings(findings, detector) {
  const results = {
    cases: [],
    alerts: [],
    insights: [],
    errors: [],
  };
  
  // Agrupar findings por tipo para deduplicación
  const groupedFindings = groupFindingsByType(findings);
  
  for (const [type, typeFindings] of Object.entries(groupedFindings)) {
    if (typeFindings.length === 1) {
      // Single finding, procesar normalmente
      try {
        const result = await processFinding(typeFindings[0], detector);
        addToResults(results, result);
      } catch (err) {
        results.errors.push({
          findingId: typeFindings[0].finding_id,
          error: err?.message,
        });
      }
    } else {
      // Multiple findings del mismo tipo, consolidar
      try {
        const result = await processConsolidatedFindings(typeFindings, detector);
        addToResults(results, result);
      } catch (err) {
        results.errors.push({
          findingType: type,
          count: typeFindings.length,
          error: err?.message,
        });
      }
    }
  }
  
  logger.info({
    detectorId: detector?.detector_id,
    totalFindings: findings.length,
    casesCreated: results.cases.length,
    alertsCreated: results.alerts.length,
    insights: results.insights.length,
    errors: results.errors.length,
  }, "Findings processed");
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// CASE CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un caso a partir de un finding
 */
async function createCaseFromFinding(finding, detector) {
  const caseType = mapFindingTypeToCase(finding.type, detector);
  
  const newCase = await createCase({
    caseType,
    severity: finding.severity,
    title: finding.title,
    description: finding.description,
    scope: {
      branch_id: finding.branch_id,
      date: finding.detected_at,
    },
    evidence: [{
      type: "finding",
      finding_id: finding.finding_id,
      detector_id: detector?.detector_id,
      data: {
        metric_value: finding.metric_value,
        baseline_value: finding.baseline_value,
        deviation_pct: finding.deviation_pct,
        evidence: finding.evidence,
      },
      added_at: new Date().toISOString(),
      added_by: "system",
    }],
    source: "detector",
    detectorId: detector?.detector_id,
    runId: finding.run_id,
    createdBy: "luca",
  });
  
  await logAudit({
    actorType: "detector",
    actorId: detector?.detector_id || "unknown",
    action: "CASE_FROM_FINDING",
    targetType: "case",
    targetId: newCase.case_id,
    context: {
      finding_id: finding.finding_id,
      severity: finding.severity,
    },
  });
  
  logger.info({
    caseId: newCase.case_id,
    findingId: finding.finding_id,
  }, "Case created from finding");
  
  return {
    type: "case",
    caseId: newCase.case_id,
    findingId: finding.finding_id,
    case: newCase,
  };
}

/**
 * Crea un caso consolidado de múltiples findings
 */
async function createConsolidatedCase(findings, detector) {
  const primaryFinding = findings[0]; // El más severo o primero
  const caseType = mapFindingTypeToCase(primaryFinding.type, detector);
  
  // Crear evidencia de cada finding
  const evidence = findings.map(f => ({
    type: "finding",
    finding_id: f.finding_id,
    detector_id: detector?.detector_id,
    data: {
      metric_value: f.metric_value,
      baseline_value: f.baseline_value,
      deviation_pct: f.deviation_pct,
      evidence: f.evidence,
    },
    added_at: new Date().toISOString(),
    added_by: "system",
  }));
  
  // Determinar severidad máxima
  const maxSeverity = getMaxSeverity(findings.map(f => f.severity));
  
  // Obtener branches afectadas
  const branches = [...new Set(findings.map(f => f.branch_id).filter(Boolean))];
  
  const newCase = await createCase({
    caseType,
    severity: maxSeverity,
    title: `${primaryFinding.type}: ${findings.length} anomalías detectadas`,
    description: `Se detectaron ${findings.length} anomalías del tipo ${primaryFinding.type} en ${branches.length} sucursales.`,
    scope: {
      branches,
      finding_count: findings.length,
      date: primaryFinding.detected_at,
    },
    evidence,
    source: "detector",
    detectorId: detector?.detector_id,
    runId: primaryFinding.run_id,
    createdBy: "luca",
  });
  
  logger.info({
    caseId: newCase.case_id,
    findingCount: findings.length,
  }, "Consolidated case created");
  
  return {
    type: "case",
    caseId: newCase.case_id,
    findingIds: findings.map(f => f.finding_id),
    case: newCase,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ALERT CREATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una alerta a partir de un finding
 */
async function createAlertFromFinding(finding, detector) {
  // Crear fingerprint para deduplicación
  const fingerprint = createFingerprint(finding, detector);
  
  const alert = await createAlert({
    alertType: mapFindingTypeToAlert(finding.type),
    severity: finding.severity,
    title: finding.title,
    message: finding.description,
    branchId: finding.branch_id,
    fingerprint,
    source: "detector",
    detectorId: detector?.detector_id,
    runId: finding.run_id,
    expiresIn: getExpirationHours(finding.severity),
    metadata: {
      metric_value: finding.metric_value,
      baseline_value: finding.baseline_value,
      deviation_pct: finding.deviation_pct,
    },
  });
  
  // Si fue deduplicada, retornar eso
  if (alert.deduplicated) {
    logger.info({
      findingId: finding.finding_id,
      existingAlertId: alert.existingAlertId,
    }, "Finding deduplicated to existing alert");
    
    return {
      type: "alert",
      deduplicated: true,
      alertId: alert.existingAlertId,
      findingId: finding.finding_id,
    };
  }
  
  logger.info({
    alertId: alert.alert_id,
    findingId: finding.finding_id,
  }, "Alert created from finding");
  
  return {
    type: "alert",
    alertId: alert.alert_id,
    findingId: finding.finding_id,
    alert,
  };
}

/**
 * Crea una alerta consolidada de múltiples findings
 */
async function createConsolidatedAlert(findings, detector) {
  const primaryFinding = findings[0];
  const maxSeverity = getMaxSeverity(findings.map(f => f.severity));
  const branches = [...new Set(findings.map(f => f.branch_id).filter(Boolean))];
  
  const fingerprint = `consolidated-${detector?.detector_id}-${primaryFinding.type}-${Date.now()}`;
  
  const alert = await createAlert({
    alertType: mapFindingTypeToAlert(primaryFinding.type),
    severity: maxSeverity,
    title: `${findings.length} ${primaryFinding.type} detectados`,
    message: `Se detectaron ${findings.length} anomalías en ${branches.length} sucursales: ${branches.join(", ")}`,
    branchId: branches[0], // Primary branch
    fingerprint,
    source: "detector",
    detectorId: detector?.detector_id,
    runId: primaryFinding.run_id,
    expiresIn: getExpirationHours(maxSeverity),
    metadata: {
      finding_count: findings.length,
      branches,
      finding_ids: findings.map(f => f.finding_id),
    },
  });
  
  logger.info({
    alertId: alert.alert_id,
    findingCount: findings.length,
  }, "Consolidated alert created");
  
  return {
    type: "alert",
    alertId: alert.alert_id,
    findingIds: findings.map(f => f.finding_id),
    alert,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrupa findings por tipo
 */
function groupFindingsByType(findings) {
  return findings.reduce((acc, finding) => {
    const type = finding.type || "unknown";
    if (!acc[type]) {
      acc[type] = [];
    }
    acc[type].push(finding);
    return acc;
  }, {});
}

/**
 * Procesa findings consolidados (mismo tipo)
 */
async function processConsolidatedFindings(findings, detector) {
  const maxSeverity = getMaxSeverity(findings.map(f => f.severity));
  const outputType = detector?.output_type || SEVERITY_TO_OUTPUT[maxSeverity] || "alert";
  
  if (outputType === "case") {
    return await createConsolidatedCase(findings, detector);
  } else {
    return await createConsolidatedAlert(findings, detector);
  }
}

/**
 * Obtiene severidad máxima
 */
function getMaxSeverity(severities) {
  const order = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
  for (const sev of order) {
    if (severities.includes(sev)) {
      return sev;
    }
  }
  return "MEDIUM";
}

/**
 * Mapea tipo de finding a tipo de caso
 */
function mapFindingTypeToCase(findingType, detector) {
  const mapping = {
    critical_sales_drop: "SALES_ANOMALY",
    sales_drop: "SALES_ANOMALY",
    sales_spike: "SALES_ANOMALY",
    negative_trend: "SALES_TREND",
    no_sales_gap: "OPERATIONAL_ISSUE",
    sweethearting: "FRAUD",
    excessive_discounts: "FRAUD",
    cash_preference: "FRAUD",
  };
  
  return mapping[findingType] || detector?.case_type || "GENERAL";
}

/**
 * Mapea tipo de finding a tipo de alerta
 */
function mapFindingTypeToAlert(findingType) {
  const mapping = {
    critical_sales_drop: "SALES_DROP",
    sales_drop: "SALES_DROP",
    sales_spike: "SALES_SPIKE",
    negative_trend: "TREND_ALERT",
    no_sales_gap: "NO_SALES",
    sweethearting: "FRAUD_ALERT",
    excessive_discounts: "DISCOUNT_ALERT",
    cash_preference: "CASH_ALERT",
  };
  
  return mapping[findingType] || "ANOMALY";
}

/**
 * Crea fingerprint para deduplicación
 */
function createFingerprint(finding, detector) {
  const parts = [
    detector?.detector_id || "unknown",
    finding.type,
    finding.branch_id || "all",
    finding.severity,
  ];
  
  return parts.join("-");
}

/**
 * Obtiene horas de expiración según severidad
 */
function getExpirationHours(severity) {
  const mapping = {
    CRITICAL: 48,
    HIGH: 24,
    MEDIUM: 12,
    LOW: 6,
  };
  
  return mapping[severity] || 24;
}

/**
 * Agrega resultado a la estructura de resultados
 */
function addToResults(results, result) {
  switch (result.type) {
    case "case":
      results.cases.push(result);
      break;
    case "alert":
      results.alerts.push(result);
      break;
    case "insight":
      results.insights.push(result);
      break;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  processFinding,
  processFindings,
  createCaseFromFinding,
  createAlertFromFinding,
};
