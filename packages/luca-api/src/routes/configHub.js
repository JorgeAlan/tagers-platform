/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG ROUTES - API para LUCA Config Hub
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { lucaConfigHub } from "../config/LucaConfigHub.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH & STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/health
 * Estado del Config Hub
 */
router.get("/health", (req, res) => {
  res.json(lucaConfigHub.getHealth());
});

/**
 * POST /api/luca/config/refresh
 * Fuerza refresh desde Google Sheets
 */
router.post("/refresh", async (req, res) => {
  try {
    const result = await lucaConfigHub.refresh();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BRANCHES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/branches
 * Lista todas las sucursales configuradas
 */
router.get("/branches", (req, res) => {
  const branches = lucaConfigHub.getAllBranches();
  res.json({ branches, count: branches.length });
});

/**
 * GET /api/luca/config/branches/:branchId
 * Configuración de una sucursal específica
 */
router.get("/branches/:branchId", (req, res) => {
  const branch = lucaConfigHub.getBranch(req.params.branchId);
  
  if (!branch) {
    return res.status(404).json({ error: "Branch not found" });
  }
  
  res.json(branch);
});

// ═══════════════════════════════════════════════════════════════════════════
// THRESHOLDS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/thresholds
 * Lista todos los umbrales
 */
router.get("/thresholds", (req, res) => {
  const { detector } = req.query;
  
  if (detector) {
    const thresholds = lucaConfigHub.getDetectorThresholds(detector);
    return res.json({ detector, thresholds, count: thresholds.length });
  }
  
  // Todos los umbrales agrupados por detector
  const raw = lucaConfigHub.getRawSheet('thresholds');
  res.json({ thresholds: raw?.rows || [], count: raw?.count || 0 });
});

/**
 * GET /api/luca/config/thresholds/:detector/:metric
 * Umbral específico
 */
router.get("/thresholds/:detector/:metric", (req, res) => {
  const { detector, metric } = req.params;
  const threshold = lucaConfigHub.getThreshold(detector, metric);
  
  if (threshold === null) {
    return res.status(404).json({ error: "Threshold not found" });
  }
  
  res.json({ detector, metric, threshold });
});

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/weather
 * Lista todos los impactos de clima
 */
router.get("/weather", (req, res) => {
  const impacts = lucaConfigHub.getAllWeatherImpacts();
  res.json({ impacts, count: impacts.length });
});

/**
 * GET /api/luca/config/weather/:condition
 * Impacto de una condición específica
 */
router.get("/weather/:condition", (req, res) => {
  const impact = lucaConfigHub.getWeatherImpact(req.params.condition);
  
  if (!impact) {
    return res.status(404).json({ error: "Weather condition not found" });
  }
  
  res.json(impact);
});

// ═══════════════════════════════════════════════════════════════════════════
// HOLIDAYS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/holidays
 * Lista todos los feriados
 */
router.get("/holidays", (req, res) => {
  const holidays = lucaConfigHub.getAllHolidays();
  res.json({ holidays, count: holidays.length });
});

/**
 * GET /api/luca/config/holidays/:date
 * Feriado por fecha (formato: MM-DD)
 */
router.get("/holidays/:date", (req, res) => {
  const holiday = lucaConfigHub.getHoliday(req.params.date);
  
  if (!holiday) {
    return res.status(404).json({ error: "Holiday not found" });
  }
  
  res.json(holiday);
});

// ═══════════════════════════════════════════════════════════════════════════
// CAPACITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/capacity
 * Lista todas las capacidades por rol
 */
router.get("/capacity", (req, res) => {
  const capacities = lucaConfigHub.getAllCapacities();
  res.json({ capacities, count: capacities.length });
});

/**
 * GET /api/luca/config/capacity/:role
 * Capacidad de un rol específico
 */
router.get("/capacity/:role", (req, res) => {
  const capacity = lucaConfigHub.getRoleCapacity(req.params.role);
  
  if (!capacity) {
    return res.status(404).json({ error: "Role not found" });
  }
  
  res.json(capacity);
});

// ═══════════════════════════════════════════════════════════════════════════
// ROI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/roi
 * Lista todos los valores de ROI
 */
router.get("/roi", (req, res) => {
  const raw = lucaConfigHub.getRawSheet('roi');
  res.json({ values: raw?.rows || [], count: raw?.count || 0 });
});

/**
 * GET /api/luca/config/roi/:key
 * Valor de ROI específico
 */
router.get("/roi/:key", (req, res) => {
  const value = lucaConfigHub.getRoiValue(req.params.key);
  
  if (value === null) {
    return res.status(404).json({ error: "ROI value not found" });
  }
  
  res.json({ key: req.params.key, value });
});

// ═══════════════════════════════════════════════════════════════════════════
// RAW SHEET ACCESS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config/sheets
 * Lista pestañas disponibles
 */
router.get("/sheets", (req, res) => {
  const health = lucaConfigHub.getHealth();
  res.json({ sheets: health.sheetsLoaded });
});

/**
 * GET /api/luca/config/sheets/:name
 * Datos crudos de una pestaña
 */
router.get("/sheets/:name", (req, res) => {
  const data = lucaConfigHub.getRawSheet(req.params.name);
  
  if (!data) {
    return res.status(404).json({ error: "Sheet not found" });
  }
  
  res.json(data);
});

export default router;
