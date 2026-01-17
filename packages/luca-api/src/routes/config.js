/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG ROUTES - API de Configuración
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints para ver y refrescar configuración desde Google Sheets
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { configLoader } from "../config/ConfigLoader.js";

const router = Router();

/**
 * GET /api/luca/config/status
 * Estado del sistema de configuración
 */
router.get("/status", (req, res) => {
  res.json(configLoader.getStatus());
});

/**
 * POST /api/luca/config/refresh
 * Fuerza recarga de configuración desde Sheets
 */
router.post("/refresh", async (req, res) => {
  try {
    const status = await configLoader.forceRefresh();
    res.json({
      success: true,
      message: "Configuration refreshed",
      status,
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: err?.message,
    });
  }
});

/**
 * GET /api/luca/config/branches
 * Lista todas las sucursales configuradas
 */
router.get("/branches", (req, res) => {
  const branches = configLoader.getAllBranches();
  res.json({
    count: branches.length,
    branches,
  });
});

/**
 * GET /api/luca/config/branches/:branchId
 * Detalle de una sucursal
 */
router.get("/branches/:branchId", (req, res) => {
  const branch = configLoader.getBranch(req.params.branchId);
  if (!branch) {
    return res.status(404).json({ error: "Branch not found" });
  }
  res.json(branch);
});

/**
 * GET /api/luca/config/thresholds
 * Todos los umbrales configurados
 */
router.get("/thresholds", (req, res) => {
  const thresholds = configLoader.getAllThresholds();
  res.json({
    count: thresholds.length,
    thresholds,
  });
});

/**
 * GET /api/luca/config/thresholds/:detectorId
 * Umbrales de un detector específico
 */
router.get("/thresholds/:detectorId", (req, res) => {
  const thresholds = configLoader.getDetectorThresholds(req.params.detectorId);
  res.json({
    detectorId: req.params.detectorId,
    count: thresholds.length,
    thresholds,
  });
});

/**
 * GET /api/luca/config/holidays
 * Todos los feriados configurados
 */
router.get("/holidays", (req, res) => {
  const holidays = configLoader.getAllHolidays();
  res.json({
    count: holidays.length,
    holidays,
  });
});

/**
 * GET /api/luca/config/seasons
 * Todas las temporadas configuradas
 */
router.get("/seasons", (req, res) => {
  const seasons = configLoader.getAllSeasons();
  res.json({
    count: seasons.length,
    seasons,
  });
});

/**
 * GET /api/luca/config/weather-impact
 * Impactos de clima configurados
 */
router.get("/weather-impact", (req, res) => {
  const impacts = configLoader.getAllWeatherImpacts();
  res.json({
    count: impacts.length,
    impacts,
  });
});

/**
 * GET /api/luca/config/fraud-patterns
 * Patrones de fraude configurados
 */
router.get("/fraud-patterns", (req, res) => {
  const patterns = configLoader.getAllFraudPatterns();
  const enabled = configLoader.getEnabledFraudPatterns();
  res.json({
    total: patterns.length,
    enabled: enabled.length,
    patterns,
  });
});

/**
 * GET /api/luca/config/roi-values
 * Valores de ROI configurados
 */
router.get("/roi-values", (req, res) => {
  const values = configLoader.getAllRoiValues();
  res.json(values);
});

/**
 * GET /api/luca/config/capacity
 * Capacidades por rol
 */
router.get("/capacity", (req, res) => {
  const capacities = configLoader.getAllRoleCapacities();
  res.json({
    count: capacities.length,
    roles: capacities,
  });
});

/**
 * GET /api/luca/config/autonomy
 * Niveles de autonomía
 */
router.get("/autonomy", (req, res) => {
  const levels = configLoader.getAllAutonomyLevels();
  res.json({
    count: levels.length,
    levels,
  });
});

/**
 * GET /api/luca/config/seasonality
 * Factores de estacionalidad
 */
router.get("/seasonality", (req, res) => {
  const dayOfWeek = [];
  for (let i = 0; i < 7; i++) {
    dayOfWeek.push({
      day: i,
      factor: configLoader.getDayOfWeekFactor(i),
    });
  }

  const months = [];
  for (let i = 1; i <= 12; i++) {
    months.push({
      month: i,
      factor: configLoader.getMonthFactor(i),
    });
  }

  const hours = [];
  for (let i = 0; i < 24; i++) {
    hours.push({
      hour: i,
      factor: configLoader.getHourFactor(i),
    });
  }

  res.json({
    dayOfWeek,
    months,
    hours,
  });
});

/**
 * GET /api/luca/config/venues
 * Venues configurados
 */
router.get("/venues", (req, res) => {
  const { city } = req.query;
  const venues = city 
    ? configLoader.getVenuesByCity(city)
    : configLoader.getAllVenues();
  
  res.json({
    count: venues.length,
    venues,
  });
});

/**
 * GET /api/luca/config/school-calendar
 * Calendario escolar
 */
router.get("/school-calendar", (req, res) => {
  const periods = configLoader.getAllSchoolPeriods();
  res.json({
    count: periods.length,
    periods,
  });
});

/**
 * GET /api/luca/config/schema
 * Schema de configuración (para documentación)
 */
router.get("/schema", (req, res) => {
  res.json({
    sheets: {
      LUCA_BRANCHES: {
        description: "Configuración de sucursales",
        columns: ["branch_id", "name", "city", "type", "lat", "lon", "daily_sales_baseline", "avg_ticket", "..."],
      },
      LUCA_STAFFING: {
        description: "Personal por sucursal y turno",
        columns: ["branch_id", "shift", "baristas", "kitchen", "floor", "cashier"],
      },
      LUCA_THRESHOLDS: {
        description: "Umbrales de detección",
        columns: ["detector_id", "metric", "threshold", "severity", "enabled"],
      },
      LUCA_WEATHER_IMPACT: {
        description: "Impacto del clima",
        columns: ["condition", "dine_in", "delivery", "takeaway", "beverages_cold", "beverages_hot"],
      },
      LUCA_HOLIDAYS: {
        description: "Feriados y días especiales",
        columns: ["date_key", "name", "type", "sales_impact", "is_closed"],
      },
      LUCA_SEASONS: {
        description: "Temporadas especiales",
        columns: ["season_id", "name", "start_date", "end_date", "sales_impact"],
      },
      LUCA_FRAUD_PATTERNS: {
        description: "Patrones de fraude",
        columns: ["pattern_id", "name", "enabled", "min_score", "weight_*"],
      },
      LUCA_ROI_VALUES: {
        description: "Valores de referencia para ROI",
        columns: ["key", "value", "unit", "description"],
      },
      LUCA_CAPACITY: {
        description: "Capacidades por rol",
        columns: ["role", "drinks_per_hour", "dishes_per_hour", "cost_per_hour"],
      },
      LUCA_SEASONALITY: {
        description: "Factores de estacionalidad",
        columns: ["period_type", "period_value", "factor"],
      },
    },
    envVars: {
      LUCA_CONFIG_SHEET_ID: "ID del Google Sheet con configuración",
      GOOGLE_SERVICE_ACCOUNT: "JSON de credenciales de servicio",
      LUCA_CONFIG_REFRESH_MS: "Intervalo de refresco (default: 300000)",
    },
  });
});

export default router;
