/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DETECTOR ROUTES - API endpoints para detectores, runs y findings
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * /api/luca/detectors   - Lista y gestión de detectores
 * /api/luca/runs        - Historial de ejecuciones
 * /api/luca/findings    - Hallazgos y labeling
 * /api/luca/config      - Configuración del registry
 */

import { Router } from "express";
import { logger } from "@tagers/shared";

// Services
import registryService from "../services/registryService.js";
import runService from "../services/runService.js";
import findingService from "../services/findingService.js";
import { triggerDetector, getQueueStatus } from "../engine/scheduledRunner.js";
import { getAvailableDetectors } from "../engine/detectorRunner.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG / REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/config
 * Obtiene el resumen del registry
 */
router.get("/config", async (req, res) => {
  try {
    const summary = await registryService.getRegistrySummary();
    res.json(summary);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get config");
    res.status(500).json({ error: "Failed to get config" });
  }
});

/**
 * POST /api/luca/config/reload
 * Fuerza recarga del registry
 */
router.post("/config/reload", async (req, res) => {
  try {
    await registryService.reloadRegistry();
    const summary = await registryService.getRegistrySummary();
    res.json({ 
      message: "Registry reloaded",
      ...summary,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to reload config");
    res.status(500).json({ error: "Failed to reload config" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// DETECTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/detectors
 * Lista todos los detectores
 */
router.get("/detectors", async (req, res) => {
  try {
    const registry = await registryService.loadRegistry();
    const implemented = getAvailableDetectors();
    
    // Combinar info del registry con estado de implementación
    const detectors = registry.detectors.map(d => ({
      id: d.detector_id,
      name: d.name,
      description: d.description,
      agent: d.agent_name,
      category: d.category,
      outputType: d.output_type,
      schedule: d.schedule,
      thresholds: d.thresholds,
      isActive: d.is_active,
      lastRun: d.last_run_at,
      lastStatus: d.last_run_status,
      inputDataProducts: d.input_data_products,
      implemented: implemented.some(i => i.id === d.detector_id),
    }));
    
    res.json({
      detectors,
      total: detectors.length,
      active: detectors.filter(d => d.isActive).length,
      implemented: implemented.length,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list detectors");
    res.status(500).json({ error: "Failed to list detectors" });
  }
});

/**
 * GET /api/luca/detectors/:id
 * Obtiene detalle de un detector
 */
router.get("/detectors/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const detector = await registryService.getDetector(id);
    
    if (!detector) {
      return res.status(404).json({ error: "Detector not found" });
    }
    
    // Obtener stats
    const stats = await runService.getRunStats(id, 30);
    const findingStats = await findingService.getFindingStats(id, 30);
    
    res.json({
      ...detector,
      stats: stats[0] || null,
      findingStats: findingStats[0] || null,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get detector");
    res.status(500).json({ error: "Failed to get detector" });
  }
});

/**
 * POST /api/luca/detectors/:id/trigger
 * Ejecuta un detector manualmente
 */
router.post("/detectors/:id/trigger", async (req, res) => {
  try {
    const { id } = req.params;
    const { scope, triggeredBy } = req.body;
    
    logger.info({ detectorId: id, triggeredBy, scope }, "Manual detector trigger");
    
    const result = await triggerDetector(id, scope || {}, triggeredBy || "api");
    
    res.json({
      message: "Detector executed",
      runId: result.runId,
      findings: result.findings?.length || 0,
      alertsCreated: result.alertsCreated || 0,
      casesCreated: result.casesCreated || 0,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to trigger detector");
    res.status(500).json({ error: err?.message || "Failed to trigger detector" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// RUNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/runs
 * Lista ejecuciones de detectores
 */
router.get("/runs", async (req, res) => {
  try {
    const { 
      detector_id, 
      status, 
      limit = 50, 
      offset = 0,
      from_date,
      to_date,
    } = req.query;
    
    const result = await runService.listRuns({
      detectorId: detector_id,
      status,
      limit: parseInt(limit),
      offset: parseInt(offset),
      fromDate: from_date,
      toDate: to_date,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list runs");
    res.status(500).json({ error: "Failed to list runs" });
  }
});

/**
 * GET /api/luca/runs/recent
 * Obtiene runs recientes (para dashboard)
 */
router.get("/runs/recent", async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const runs = await runService.getRecentRuns(parseInt(limit));
    res.json({ runs });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get recent runs");
    res.status(500).json({ error: "Failed to get recent runs" });
  }
});

/**
 * GET /api/luca/runs/stats
 * Obtiene estadísticas de runs
 */
router.get("/runs/stats", async (req, res) => {
  try {
    const { detector_id, days = 30 } = req.query;
    const stats = await runService.getRunStats(detector_id, parseInt(days));
    res.json({ stats });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get run stats");
    res.status(500).json({ error: "Failed to get run stats" });
  }
});

/**
 * GET /api/luca/runs/:id
 * Obtiene detalle de un run
 */
router.get("/runs/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { include_findings = "true" } = req.query;
    
    const run = await runService.getRun(id, include_findings === "true");
    
    if (!run) {
      return res.status(404).json({ error: "Run not found" });
    }
    
    res.json(run);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get run");
    res.status(500).json({ error: "Failed to get run" });
  }
});

/**
 * POST /api/luca/runs/:id/cancel
 * Cancela un run en curso
 */
router.post("/runs/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    
    const run = await runService.cancelRun(id);
    
    if (!run) {
      return res.status(404).json({ error: "Run not found or not running" });
    }
    
    res.json({ message: "Run cancelled", run });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to cancel run");
    res.status(500).json({ error: "Failed to cancel run" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FINDINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/findings
 * Lista findings
 */
router.get("/findings", async (req, res) => {
  try {
    const {
      detector_id,
      run_id,
      branch_id,
      status,
      severity,
      unlabeled_only,
      limit = 50,
      offset = 0,
      from_date,
      to_date,
    } = req.query;
    
    const result = await findingService.listFindings({
      detectorId: detector_id,
      runId: run_id,
      branchId: branch_id,
      status,
      severity,
      unlabeledOnly: unlabeled_only === "true",
      limit: parseInt(limit),
      offset: parseInt(offset),
      fromDate: from_date,
      toDate: to_date,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list findings");
    res.status(500).json({ error: "Failed to list findings" });
  }
});

/**
 * GET /api/luca/findings/unlabeled
 * Obtiene findings sin etiquetar (para queue de labeling)
 */
router.get("/findings/unlabeled", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const findings = await findingService.getUnlabeledFindings(parseInt(limit));
    res.json({ findings, total: findings.length });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get unlabeled findings");
    res.status(500).json({ error: "Failed to get unlabeled findings" });
  }
});

/**
 * GET /api/luca/findings/stats
 * Obtiene estadísticas de findings
 */
router.get("/findings/stats", async (req, res) => {
  try {
    const { detector_id, days = 30 } = req.query;
    const stats = await findingService.getFindingStats(detector_id, parseInt(days));
    res.json({ stats });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get finding stats");
    res.status(500).json({ error: "Failed to get finding stats" });
  }
});

/**
 * GET /api/luca/findings/:id
 * Obtiene detalle de un finding
 */
router.get("/findings/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const finding = await findingService.getFinding(id);
    
    if (!finding) {
      return res.status(404).json({ error: "Finding not found" });
    }
    
    res.json(finding);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get finding");
    res.status(500).json({ error: "Failed to get finding" });
  }
});

/**
 * POST /api/luca/findings/:id/label
 * Etiqueta un finding
 */
router.post("/findings/:id/label", async (req, res) => {
  try {
    const { id } = req.params;
    const { label, labeled_by, notes } = req.body;
    
    if (!label || !labeled_by) {
      return res.status(400).json({ 
        error: "Missing required fields: label, labeled_by" 
      });
    }
    
    const finding = await findingService.labelFinding(id, {
      label,
      labeledBy: labeled_by,
      notes,
    });
    
    res.json({ message: "Finding labeled", finding });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to label finding");
    res.status(500).json({ error: err?.message || "Failed to label finding" });
  }
});

/**
 * POST /api/luca/findings/:id/acknowledge
 * Marca finding como acknowledged
 */
router.post("/findings/:id/acknowledge", async (req, res) => {
  try {
    const { id } = req.params;
    const { acknowledged_by } = req.body;
    
    const finding = await findingService.acknowledgeFinding(id, acknowledged_by);
    
    if (!finding) {
      return res.status(404).json({ error: "Finding not found or already acknowledged" });
    }
    
    res.json({ message: "Finding acknowledged", finding });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to acknowledge finding");
    res.status(500).json({ error: "Failed to acknowledge finding" });
  }
});

/**
 * POST /api/luca/findings/:id/dismiss
 * Descarta un finding
 */
router.post("/findings/:id/dismiss", async (req, res) => {
  try {
    const { id } = req.params;
    const { dismissed_by, reason } = req.body;
    
    if (!dismissed_by) {
      return res.status(400).json({ error: "Missing required field: dismissed_by" });
    }
    
    const finding = await findingService.dismissFinding(id, {
      dismissedBy: dismissed_by,
      reason,
    });
    
    if (!finding) {
      return res.status(404).json({ error: "Finding not found or already processed" });
    }
    
    res.json({ message: "Finding dismissed", finding });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to dismiss finding");
    res.status(500).json({ error: "Failed to dismiss finding" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/queue
 * Obtiene estado de la cola de jobs
 */
router.get("/queue", async (req, res) => {
  try {
    const status = await getQueueStatus();
    res.json(status);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get queue status");
    res.status(500).json({ error: "Failed to get queue status" });
  }
});

export default router;
