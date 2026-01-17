/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DETECTOR RUNNER - Ejecuta detectores individuales
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Factory pattern para instanciar y ejecutar detectores.
 * El detector se selecciona por detector_id del registry.
 */

import { logger } from "@tagers/shared";
import { getDetector } from "../services/registryService.js";

// Importar detectores disponibles
import { SalesAnomalyDetector } from "./detectors/salesAnomalyDetector.js";
// import { FraudDiscountsDetector } from "./detectors/fraudDiscountsDetector.js";
// import { NoSalesAlertDetector } from "./detectors/noSalesAlertDetector.js";

// Registry de clases de detectores
const DETECTOR_CLASSES = {
  "sales_anomaly": SalesAnomalyDetector,
  // "fraud_discounts": FraudDiscountsDetector,
  // "no_sales_alert": NoSalesAlertDetector,
  // "sales_hourly_pattern": SalesHourlyPatternDetector,
};

/**
 * Ejecuta un detector por su ID
 * @param {string} detectorId - ID del detector en registry
 * @param {Object} scope - Opcional: scope de ejecución (branches, fechas)
 * @returns {Object} Resultado de la ejecución
 */
export async function runDetector(detectorId, scope = {}) {
  logger.info({ detectorId, scope }, "Starting detector run");
  
  // 1. Obtener configuración del detector del registry
  const config = await getDetector(detectorId);
  
  if (!config) {
    throw new Error(`Detector not found in registry: ${detectorId}`);
  }
  
  if (!config.is_active) {
    throw new Error(`Detector is disabled: ${detectorId}`);
  }
  
  // 2. Obtener la clase del detector
  const DetectorClass = DETECTOR_CLASSES[detectorId];
  
  if (!DetectorClass) {
    // Si no hay clase específica, usar detector genérico o lanzar error
    throw new Error(`No detector class implemented for: ${detectorId}. ` +
                   `Available: ${Object.keys(DETECTOR_CLASSES).join(", ")}`);
  }
  
  // 3. Instanciar y ejecutar
  const detector = new DetectorClass(config);
  const result = await detector.execute(scope);
  
  logger.info({
    detectorId,
    runId: result.runId,
    findings: result.findings.length,
    alertsCreated: result.alertsCreated,
    casesCreated: result.casesCreated,
  }, "Detector run completed");
  
  return result;
}

/**
 * Ejecuta múltiples detectores en paralelo
 * @param {Array} detectorIds - Array de IDs de detectores
 * @param {Object} scope - Scope compartido
 * @returns {Object} Resultados de todas las ejecuciones
 */
export async function runDetectors(detectorIds, scope = {}) {
  logger.info({ detectorIds, scope }, "Running multiple detectors");
  
  const results = await Promise.allSettled(
    detectorIds.map(id => runDetector(id, scope))
  );
  
  const summary = {
    total: detectorIds.length,
    successful: 0,
    failed: 0,
    results: [],
  };
  
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const detectorId = detectorIds[i];
    
    if (result.status === "fulfilled") {
      summary.successful++;
      summary.results.push({
        detectorId,
        status: "success",
        runId: result.value.runId,
        findings: result.value.findings.length,
        alertsCreated: result.value.alertsCreated,
        casesCreated: result.value.casesCreated,
      });
    } else {
      summary.failed++;
      summary.results.push({
        detectorId,
        status: "failed",
        error: result.reason?.message,
      });
    }
  }
  
  logger.info(summary, "Multiple detectors completed");
  
  return summary;
}

/**
 * Lista detectores disponibles con su estado
 */
export function getAvailableDetectors() {
  return Object.keys(DETECTOR_CLASSES).map(id => ({
    id,
    implemented: true,
    class: DETECTOR_CLASSES[id].name,
  }));
}

export default {
  runDetector,
  runDetectors,
  getAvailableDetectors,
};
