/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LEARNING ROUTES - API para Feedback, Métricas y Aprendizaje
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { feedbackProcessor, FeedbackTypes } from "../learning/FeedbackProcessor.js";
import { thresholdTuner } from "../learning/ThresholdTuner.js";
import { patternLearner, PatternStates } from "../learning/PatternLearner.js";
import { detectorMetrics, AnalysisPeriods } from "../metrics/DetectorMetrics.js";
import { actionMetrics } from "../metrics/ActionMetrics.js";
import { roiCalculator, ImpactCategories, ImpactSources } from "../metrics/ROICalculator.js";
import { weeklyLearningReport } from "../reports/WeeklyLearningReport.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/learning/feedback
 * Registra feedback explícito
 */
router.post("/feedback", async (req, res) => {
  try {
    const { finding_id, case_id, label, user_id, comment } = req.body;
    
    if (!label) {
      return res.status(400).json({ error: "label required" });
    }
    
    const result = await feedbackProcessor.recordExplicitFeedback({
      findingId: finding_id,
      caseId: case_id,
      label,
      userId: user_id,
      comment,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to record feedback");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/feedback/types
 * Lista tipos de feedback disponibles
 */
router.get("/feedback/types", (req, res) => {
  res.json(FeedbackTypes);
});

/**
 * GET /api/luca/learning/feedback/summary
 * Resumen de feedback
 */
router.get("/feedback/summary", async (req, res) => {
  try {
    const summary = await feedbackProcessor.getSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/feedback/finding/:findingId
 * Feedback para un finding específico
 */
router.get("/feedback/finding/:findingId", async (req, res) => {
  try {
    const { findingId } = req.params;
    const feedback = await feedbackProcessor.getFeedbackForFinding(findingId);
    res.json({ findingId, feedback });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// THRESHOLD TUNING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/learning/tuning/status
 * Estado del threshold tuner
 */
router.get("/tuning/status", (req, res) => {
  res.json(thresholdTuner.getStatus());
});

/**
 * POST /api/luca/learning/tuning/analyze/:detector
 * Analiza un detector para posible ajuste
 */
router.post("/tuning/analyze/:detector", async (req, res) => {
  try {
    const { detector } = req.params;
    const analysis = await thresholdTuner.analyzeDetector(detector);
    res.json(analysis);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/learning/tuning/apply
 * Aplica un ajuste de umbral
 */
router.post("/tuning/apply", async (req, res) => {
  try {
    const { detector, adjustment, approved_by } = req.body;
    
    if (!detector || !adjustment) {
      return res.status(400).json({ error: "detector and adjustment required" });
    }
    
    const result = await thresholdTuner.applyAdjustment(detector, adjustment, {
      approvedBy: approved_by,
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/learning/tuning/approve/:detector
 * Aprueba ajuste pendiente
 */
router.post("/tuning/approve/:detector", async (req, res) => {
  try {
    const { detector } = req.params;
    const { approved_by } = req.body;
    
    const result = await thresholdTuner.approveAdjustment(detector, approved_by);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/learning/tuning/reject/:detector
 * Rechaza ajuste pendiente
 */
router.post("/tuning/reject/:detector", async (req, res) => {
  try {
    const { detector } = req.params;
    const { rejected_by, reason } = req.body;
    
    const result = await thresholdTuner.rejectAdjustment(detector, rejected_by, reason);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/tuning/pending
 * Ajustes pendientes de aprobación
 */
router.get("/tuning/pending", (req, res) => {
  res.json(thresholdTuner.getPendingAdjustments());
});

/**
 * GET /api/luca/learning/tuning/history
 * Historial de ajustes
 */
router.get("/tuning/history", (req, res) => {
  const { detector, limit } = req.query;
  res.json(thresholdTuner.getAdjustmentHistory({ 
    detector, 
    limit: parseInt(limit) || 50 
  }));
});

/**
 * POST /api/luca/learning/tuning/auto-tune
 * Ejecuta auto-tuning
 */
router.post("/tuning/auto-tune", async (req, res) => {
  try {
    const results = await thresholdTuner.runAutoTuning();
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/learning/patterns
 * Lista todos los patterns
 */
router.get("/patterns", (req, res) => {
  const { state, type, limit } = req.query;
  
  let patterns = patternLearner.getAllPatterns();
  
  if (state) {
    patterns = patterns.filter(p => p.state === state);
  }
  if (type) {
    patterns = patterns.filter(p => p.type === type);
  }
  if (limit) {
    patterns = patterns.slice(0, parseInt(limit));
  }
  
  res.json({ patterns, count: patterns.length });
});

/**
 * GET /api/luca/learning/patterns/summary
 * Resumen de patterns
 */
router.get("/patterns/summary", (req, res) => {
  res.json(patternLearner.getSummary());
});

/**
 * GET /api/luca/learning/patterns/:patternId
 * Detalle de un pattern
 */
router.get("/patterns/:patternId", (req, res) => {
  const { patternId } = req.params;
  const pattern = patternLearner.getPattern(patternId);
  
  if (!pattern) {
    return res.status(404).json({ error: "Pattern not found" });
  }
  
  res.json(pattern);
});

/**
 * POST /api/luca/learning/patterns/:patternId/approve
 * Aprueba un pattern
 */
router.post("/patterns/:patternId/approve", async (req, res) => {
  try {
    const { patternId } = req.params;
    const { approved_by } = req.body;
    
    const result = await patternLearner.approvePattern(patternId, approved_by);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/learning/patterns/:patternId/reject
 * Rechaza un pattern
 */
router.post("/patterns/:patternId/reject", async (req, res) => {
  try {
    const { patternId } = req.params;
    const { rejected_by, reason } = req.body;
    
    const result = await patternLearner.rejectPattern(patternId, rejected_by, reason);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/learning/metrics/detectors
 * Métricas de todos los detectores
 */
router.get("/metrics/detectors", async (req, res) => {
  try {
    const { period } = req.query;
    const report = await detectorMetrics.generatePerformanceReport(
      period || AnalysisPeriods.WEEKLY
    );
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/metrics/detectors/:detector
 * Métricas de un detector específico
 */
router.get("/metrics/detectors/:detector", async (req, res) => {
  try {
    const { detector } = req.params;
    const { period } = req.query;
    
    const metrics = await detectorMetrics.calculateMetrics(
      detector, 
      { period: period || AnalysisPeriods.WEEKLY }
    );
    res.json(metrics);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/metrics/detectors/ranking
 * Ranking de detectores
 */
router.get("/metrics/detectors/ranking", async (req, res) => {
  try {
    const { period } = req.query;
    const ranking = await detectorMetrics.getDetectorRanking(
      period || AnalysisPeriods.WEEKLY
    );
    res.json(ranking);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/metrics/actions
 * Métricas de acciones
 */
router.get("/metrics/actions", async (req, res) => {
  try {
    const { period } = req.query;
    const report = await actionMetrics.generateReport({ 
      period: period || "weekly" 
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/learning/roi/impact
 * Registra un impacto
 */
router.post("/roi/impact", async (req, res) => {
  try {
    const { source, category, amount, description, case_id, action_id, metadata } = req.body;
    
    const result = await roiCalculator.recordImpact({
      source,
      category,
      amount,
      description,
      caseId: case_id,
      actionId: action_id,
      metadata,
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/roi
 * Calcula ROI
 */
router.get("/roi", async (req, res) => {
  try {
    const { period } = req.query;
    const roi = await roiCalculator.calculateROI({ 
      period: period || "monthly" 
    });
    res.json(roi);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/roi/report
 * Reporte completo de ROI
 */
router.get("/roi/report", async (req, res) => {
  try {
    const { period } = req.query;
    const report = await roiCalculator.generateROIReport({ 
      period: period || "monthly" 
    });
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/roi/categories
 * Categorías de impacto disponibles
 */
router.get("/roi/categories", (req, res) => {
  res.json({
    categories: ImpactCategories,
    sources: ImpactSources,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/learning/reports/weekly
 * Genera reporte semanal
 */
router.post("/reports/weekly", async (req, res) => {
  try {
    const report = await weeklyLearningReport.generate();
    res.json(report);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/learning/reports/weekly/latest
 * Obtiene último reporte semanal
 */
router.get("/reports/weekly/latest", (req, res) => {
  const history = weeklyLearningReport.getReportHistory(1);
  
  if (history.length === 0) {
    return res.status(404).json({ error: "No reports available" });
  }
  
  res.json(history[0]);
});

/**
 * GET /api/luca/learning/reports/weekly/history
 * Historial de reportes
 */
router.get("/reports/weekly/history", (req, res) => {
  const { limit } = req.query;
  const history = weeklyLearningReport.getReportHistory(parseInt(limit) || 12);
  res.json({ reports: history, count: history.length });
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/learning/status
 * Estado del sistema de aprendizaje
 */
router.get("/status", async (req, res) => {
  const feedbackSummary = await feedbackProcessor.getSummary();
  const tunerStatus = thresholdTuner.getStatus();
  const patternSummary = patternLearner.getSummary();

  res.json({
    service: "learning",
    status: "operational",
    feedback: {
      total: feedbackSummary.total,
      pending: feedbackSummary.pending,
    },
    tuning: {
      weeklyAdjustments: tunerStatus.weeklyAdjustments,
      pendingApprovals: tunerStatus.pendingApprovals,
    },
    patterns: {
      total: patternSummary.total,
      pendingReview: patternSummary.pendingReview,
    },
  });
});

export default router;
