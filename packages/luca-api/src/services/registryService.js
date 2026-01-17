/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REGISTRY SERVICE - Carga y gestiona configuración de LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El registry es el corazón de la modularidad de LUCA.
 * Toda la configuración vive aquí: fuentes, datasets, detectores, métricas.
 * 
 * Filosofía: Agregar una fuente o detector = config, no código.
 */

import { logger, query } from "@tagers/shared";

// Cache en memoria para evitar queries repetidos
let registryCache = {
  sources: [],
  datasets: [],
  dataProducts: [],
  metrics: [],
  detectors: [],
  lastRefresh: null,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

/**
 * Carga todo el registry desde la DB
 */
export async function loadRegistry(forceRefresh = false) {
  // Check cache
  if (!forceRefresh && registryCache.lastRefresh) {
    const age = Date.now() - registryCache.lastRefresh;
    if (age < CACHE_TTL_MS) {
      return registryCache;
    }
  }

  logger.info("Loading LUCA registry from database");

  try {
    const [sources, datasets, dataProducts, metrics, detectors] = await Promise.all([
      query("SELECT * FROM registry_sources WHERE is_active = true ORDER BY name"),
      query("SELECT * FROM registry_datasets WHERE is_active = true ORDER BY name"),
      query("SELECT * FROM registry_data_products WHERE is_active = true ORDER BY name"),
      query("SELECT * FROM registry_metrics WHERE is_active = true ORDER BY name"),
      query("SELECT * FROM registry_detectors WHERE is_active = true ORDER BY name"),
    ]);

    registryCache = {
      sources: sources.rows,
      datasets: datasets.rows,
      dataProducts: dataProducts.rows,
      metrics: metrics.rows,
      detectors: detectors.rows,
      lastRefresh: Date.now(),
    };

    logger.info({
      sources: sources.rowCount,
      datasets: datasets.rowCount,
      dataProducts: dataProducts.rowCount,
      metrics: metrics.rowCount,
      detectors: detectors.rowCount,
    }, "Registry loaded");

    return registryCache;
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to load registry");
    throw err;
  }
}

/**
 * Obtiene un detector por ID
 */
export async function getDetector(detectorId) {
  const registry = await loadRegistry();
  return registry.detectors.find(d => d.detector_id === detectorId);
}

/**
 * Obtiene todos los detectores activos
 */
export async function getActiveDetectors() {
  const registry = await loadRegistry();
  return registry.detectors.filter(d => d.is_active);
}

/**
 * Obtiene detectores que deben ejecutarse ahora según su schedule
 */
export async function getDetectorsDueForExecution() {
  const detectors = await getActiveDetectors();
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();
  
  // Filtrar detectores cuyo schedule coincide con la hora actual
  // Schedule format: "0 8,14,20 * * *" (cron)
  return detectors.filter(d => {
    if (!d.schedule) return false;
    return matchesCronSchedule(d.schedule, currentHour, currentMinute);
  });
}

/**
 * Verifica si un schedule cron coincide con la hora actual
 * Simplificado: solo soporta formato "minute hour * * *"
 */
function matchesCronSchedule(schedule, currentHour, currentMinute) {
  try {
    const parts = schedule.split(" ");
    if (parts.length < 5) return false;
    
    const [minute, hour] = parts;
    
    // Check minute
    if (minute !== "*" && minute !== "*/30") {
      if (!minute.split(",").includes(String(currentMinute))) {
        // For "0" minute, only match at minute 0
        if (minute === "0" && currentMinute !== 0) return false;
        if (minute !== "0" && minute !== String(currentMinute)) return false;
      }
    } else if (minute === "*/30") {
      if (currentMinute !== 0 && currentMinute !== 30) return false;
    }
    
    // Check hour
    if (hour !== "*") {
      const hours = hour.split(",").map(h => parseInt(h));
      if (!hours.includes(currentHour)) return false;
    }
    
    return true;
  } catch (err) {
    logger.warn({ schedule, err: err?.message }, "Failed to parse cron schedule");
    return false;
  }
}

/**
 * Obtiene un data product por ID
 */
export async function getDataProduct(dpId) {
  const registry = await loadRegistry();
  return registry.dataProducts.find(dp => dp.dp_id === dpId);
}

/**
 * Obtiene todas las fuentes
 */
export async function getSources() {
  const registry = await loadRegistry();
  return registry.sources;
}

/**
 * Obtiene todas las métricas
 */
export async function getMetrics() {
  const registry = await loadRegistry();
  return registry.metrics;
}

/**
 * Actualiza el estado de un detector después de una ejecución
 */
export async function updateDetectorStatus(detectorId, status, runId = null) {
  try {
    await query(
      `UPDATE registry_detectors 
       SET last_run_at = NOW(), 
           last_run_status = $2,
           updated_at = NOW()
       WHERE detector_id = $1`,
      [detectorId, status]
    );
    
    // Invalidar cache
    registryCache.lastRefresh = null;
    
    logger.info({ detectorId, status }, "Detector status updated");
  } catch (err) {
    logger.error({ detectorId, err: err?.message }, "Failed to update detector status");
  }
}

/**
 * Obtiene el resumen del registry para API/UI
 */
export async function getRegistrySummary() {
  const registry = await loadRegistry();
  
  return {
    sources: registry.sources.map(s => ({
      id: s.source_id,
      name: s.name,
      type: s.type,
      lastSync: s.last_sync_at,
      status: s.last_sync_status,
    })),
    dataProducts: registry.dataProducts.map(dp => ({
      id: dp.dp_id,
      name: dp.name,
      category: dp.category,
      lastMaterialized: dp.last_materialized_at,
    })),
    detectors: registry.detectors.map(d => ({
      id: d.detector_id,
      name: d.name,
      agent: d.agent_name,
      category: d.category,
      schedule: d.schedule,
      lastRun: d.last_run_at,
      lastStatus: d.last_run_status,
      isActive: d.is_active,
    })),
    metrics: registry.metrics.map(m => ({
      id: m.metric_id,
      name: m.name,
      category: m.category,
      unit: m.unit,
    })),
    cacheAge: registryCache.lastRefresh 
      ? Math.round((Date.now() - registryCache.lastRefresh) / 1000)
      : null,
  };
}

/**
 * Fuerza recarga del registry
 */
export async function reloadRegistry() {
  registryCache.lastRefresh = null;
  return loadRegistry(true);
}

export default {
  loadRegistry,
  getDetector,
  getActiveDetectors,
  getDetectorsDueForExecution,
  getDataProduct,
  getSources,
  getMetrics,
  updateDetectorStatus,
  getRegistrySummary,
  reloadRegistry,
};
