/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TWIN ROUTES - API para Digital Twin y Simulador
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { BranchTwin, getAllBranchTwins, getBranchConfigs } from "../twin/BranchTwin.js";
import { demandForecaster } from "../twin/DemandForecaster.js";
import { CapacityModel, getAllCapacitySummaries } from "../twin/CapacityModel.js";
import { simulator, ScenarioTypes } from "../twin/Simulator.js";
import { staffingOptimizer } from "../optimization/StaffingOptimizer.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// BRANCH TWIN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/twin/branches
 * Lista todas las sucursales con configuración
 */
router.get("/branches", (req, res) => {
  const branchConfigs = getBranchConfigs();
  const branches = Object.entries(branchConfigs).map(([id, config]) => ({
    id,
    name: config.name,
    city: config.city,
    type: config.type,
    hours: config.hours,
  }));
  res.json({ branches, count: branches.length });
});

/**
 * GET /api/luca/twin/branches/:branchId
 * Detalle de una sucursal
 */
router.get("/branches/:branchId", (req, res) => {
  const { branchId } = req.params;
  
  try {
    const twin = new BranchTwin(branchId);
    res.json(twin.getSummary());
  } catch (err) {
    res.status(404).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/branches/:branchId/config
 * Configuración completa de una sucursal
 */
router.get("/branches/:branchId/config", (req, res) => {
  const { branchId } = req.params;
  
  try {
    const twin = new BranchTwin(branchId);
    res.json(twin.getConfig());
  } catch (err) {
    res.status(404).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DEMAND FORECAST
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/twin/forecast/:branchId
 * Forecast de demanda para una sucursal
 */
router.get("/forecast/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { date } = req.query;
    
    const forecast = await demandForecaster.forecastDay(
      branchId, 
      date ? new Date(date) : new Date()
    );
    
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/forecast/:branchId/range
 * Forecast para rango de días
 */
router.get("/forecast/:branchId/range", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { start_date, days } = req.query;
    
    const forecast = await demandForecaster.forecastRange(
      branchId,
      start_date ? new Date(start_date) : new Date(),
      parseInt(days) || 7
    );
    
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/forecast/all
 * Forecast para todas las sucursales
 */
router.get("/forecast/all", async (req, res) => {
  try {
    const { date } = req.query;
    const forecast = await demandForecaster.forecastAllBranches(
      date ? new Date(date) : new Date()
    );
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/forecast/summary
 * Resumen de forecast para briefing
 */
router.get("/forecast/summary", async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await demandForecaster.getForForecastSummary(
      date ? new Date(date) : new Date()
    );
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CAPACITY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/twin/capacity/:branchId
 * Capacidad de una sucursal
 */
router.get("/capacity/:branchId", (req, res) => {
  try {
    const { branchId } = req.params;
    const model = new CapacityModel(branchId);
    res.json(model.getCurrentCapacitySummary());
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/capacity/all
 * Capacidad de todas las sucursales
 */
router.get("/capacity/all", (req, res) => {
  res.json(getAllCapacitySummaries());
});

/**
 * POST /api/luca/twin/capacity/:branchId/analyze
 * Analiza capacidad con staff específico
 */
router.post("/capacity/:branchId/analyze", (req, res) => {
  try {
    const { branchId } = req.params;
    const { staff, expected_transactions } = req.body;
    
    const model = new CapacityModel(branchId);
    const utilization = model.calculateUtilization(staff, expected_transactions);
    const bottleneck = model.identifyBottleneck(staff, { transactions: expected_transactions });
    const breakpoint = model.calculateBreakpoint(staff);
    
    res.json({
      staff,
      expectedTransactions: expected_transactions,
      utilization,
      bottleneck,
      breakpoint,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SIMULATOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/twin/simulator/scenarios
 * Lista tipos de escenarios disponibles
 */
router.get("/simulator/scenarios", (req, res) => {
  res.json({
    types: ScenarioTypes,
    examples: {
      demand_change: {
        type: "demand_change",
        params: { changePercent: 20 },
        description: "¿Qué pasa si aumentamos 20% las ventas?",
      },
      staff_change: {
        type: "staff_change",
        params: { staffChanges: { kitchen: -1 } },
        description: "¿Qué pasa si quitamos 1 cocinero?",
      },
      weather_event: {
        type: "weather_event",
        params: { weatherType: "rain", intensity: "heavy" },
        description: "¿Qué pasa si hay tormenta?",
      },
      special_date: {
        type: "special_date",
        params: { dateName: "dia_de_reyes" },
        description: "¿Cuánto personal para Día de Reyes?",
      },
    },
  });
});

/**
 * POST /api/luca/twin/simulator/run
 * Ejecuta una simulación
 */
router.post("/simulator/run", async (req, res) => {
  try {
    const { branch_id, scenario } = req.body;
    
    if (!branch_id || !scenario) {
      return res.status(400).json({ error: "branch_id and scenario required" });
    }
    
    const result = await simulator.simulate(branch_id, scenario);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/twin/simulator/compare
 * Compara múltiples escenarios
 */
router.post("/simulator/compare", async (req, res) => {
  try {
    const { branch_id, scenarios } = req.body;
    
    if (!branch_id || !scenarios || !Array.isArray(scenarios)) {
      return res.status(400).json({ error: "branch_id and scenarios array required" });
    }
    
    const result = await simulator.compareScenarios(branch_id, scenarios);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STAFFING OPTIMIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/twin/staffing/levels
 * Lista niveles de servicio disponibles
 */
router.get("/staffing/levels", (req, res) => {
  res.json({
    BASIC: { name: "Básico", waitTime: 15, coverage: 0.7 },
    STANDARD: { name: "Estándar", waitTime: 10, coverage: 0.85 },
    PREMIUM: { name: "Premium", waitTime: 5, coverage: 0.95 },
  });
});

/**
 * GET /api/luca/twin/staffing/optimize/:branchId
 * Optimiza staff para un día
 */
router.get("/staffing/optimize/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { date, service_level } = req.query;
    
    const result = await staffingOptimizer.optimizeDay(
      branchId,
      date ? new Date(date) : new Date(),
      { serviceLevel: service_level }
    );
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/staffing/optimize/:branchId/week
 * Optimiza staff para una semana
 */
router.get("/staffing/optimize/:branchId/week", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { start_date, service_level } = req.query;
    
    const result = await staffingOptimizer.optimizeWeek(
      branchId,
      start_date ? new Date(start_date) : new Date(),
      { serviceLevel: service_level }
    );
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/staffing/schedule/:branchId
 * Genera horario semanal optimizado
 */
router.get("/staffing/schedule/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { start_date, service_level } = req.query;
    
    const schedule = await staffingOptimizer.generateWeeklySchedule(
      branchId,
      start_date ? new Date(start_date) : new Date(),
      { serviceLevel: service_level }
    );
    
    res.json(schedule);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/staffing/compare/:branchId
 * Compara niveles de servicio
 */
router.get("/staffing/compare/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { date } = req.query;
    
    const result = await staffingOptimizer.compareServiceLevels(
      branchId,
      date ? new Date(date) : new Date()
    );
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/twin/staffing/summary
 * Resumen de optimización para todas las sucursales
 */
router.get("/staffing/summary", async (req, res) => {
  try {
    const { date } = req.query;
    const summary = await staffingOptimizer.getOptimizationSummary(
      date ? new Date(date) : new Date()
    );
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/twin/status
 * Estado del sistema de Digital Twin
 */
router.get("/status", (req, res) => {
  res.json({
    service: "digital_twin",
    status: "operational",
    branches: Object.keys(getBranchConfigs()).length,
    capabilities: [
      "demand_forecast",
      "capacity_modeling",
      "what_if_simulation",
      "staffing_optimization",
    ],
  });
});

export default router;
