/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASE ROUTES - API completa para casos, alertas y acciones
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * /api/luca/cases    - Gestión de casos con state machine
 * /api/luca/alerts   - Gestión de alertas con routing
 * /api/luca/actions  - Gestión de acciones con approval flow
 * /api/luca/audit    - Historial de operaciones
 */

import { Router } from "express";
import { logger } from "@tagers/shared";

// Services
import caseService from "../services/caseService.js";
import alertService from "../services/alertService.js";
import actionService from "../services/actionService.js";
import auditService from "../services/auditService.js";
import { checkQuietHours } from "../services/routingService.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// CASES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/cases
 * Lista casos con filtros
 */
router.get("/cases", async (req, res) => {
  try {
    const {
      state,
      states,
      type,
      severity,
      branch,
      detector_id,
      limit = 50,
      offset = 0,
      order_by,
      order_dir,
    } = req.query;
    
    const result = await caseService.listCases({
      state,
      states: states ? states.split(",") : undefined,
      caseType: type,
      severity,
      branchId: branch,
      detectorId: detector_id,
      limit: parseInt(limit),
      offset: parseInt(offset),
      orderBy: order_by,
      orderDir: order_dir,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list cases");
    res.status(500).json({ error: "Failed to list cases" });
  }
});

/**
 * GET /api/luca/cases/open
 * Lista casos abiertos (para dashboard)
 */
router.get("/cases/open", async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await caseService.getOpenCases(parseInt(limit));
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get open cases");
    res.status(500).json({ error: "Failed to get open cases" });
  }
});

/**
 * GET /api/luca/cases/stats
 * Estadísticas de casos
 */
router.get("/cases/stats", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await caseService.getCaseStats(parseInt(days));
    res.json(stats);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get case stats");
    res.status(500).json({ error: "Failed to get case stats" });
  }
});

/**
 * GET /api/luca/cases/:id
 * Detalle de un caso
 */
router.get("/cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const caseData = await caseService.getCase(id);
    
    if (!caseData) {
      return res.status(404).json({ error: "Case not found" });
    }
    
    res.json(caseData);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get case");
    res.status(500).json({ error: "Failed to get case" });
  }
});

/**
 * POST /api/luca/cases
 * Crear un caso manualmente
 */
router.post("/cases", async (req, res) => {
  try {
    const {
      case_type,
      severity,
      title,
      description,
      scope,
      evidence,
      created_by,
    } = req.body;
    
    if (!case_type || !title) {
      return res.status(400).json({ 
        error: "Missing required fields: case_type, title" 
      });
    }
    
    const newCase = await caseService.createCase({
      caseType: case_type,
      severity,
      title,
      description,
      scope,
      evidence,
      source: "manual",
      createdBy: created_by || "user",
    });
    
    res.status(201).json(newCase);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to create case");
    res.status(500).json({ error: err?.message || "Failed to create case" });
  }
});

/**
 * POST /api/luca/cases/:id/transition
 * Ejecutar una transición de estado
 */
router.post("/cases/:id/transition", async (req, res) => {
  try {
    const { id } = req.params;
    const { event, actor_id, context, notes } = req.body;
    
    if (!event) {
      return res.status(400).json({ error: "Missing required field: event" });
    }
    
    const result = await caseService.transitionCase(id, event, {
      actorId: actor_id,
      context,
      notes,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to transition case");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/investigate
 * Iniciar investigación
 */
router.post("/cases/:id/investigate", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id } = req.body;
    
    const result = await caseService.startInvestigation(id, actor_id);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to start investigation");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/evidence
 * Agregar evidencia
 */
router.post("/cases/:id/evidence", async (req, res) => {
  try {
    const { id } = req.params;
    const { evidence, actor_id } = req.body;
    
    if (!evidence) {
      return res.status(400).json({ error: "Missing required field: evidence" });
    }
    
    const result = await caseService.addEvidence(id, evidence, actor_id);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to add evidence");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/hypothesis
 * Agregar hipótesis
 */
router.post("/cases/:id/hypothesis", async (req, res) => {
  try {
    const { id } = req.params;
    const { hypothesis, actor_id } = req.body;
    
    if (!hypothesis) {
      return res.status(400).json({ error: "Missing required field: hypothesis" });
    }
    
    const result = await caseService.addHypothesis(id, hypothesis, actor_id);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to add hypothesis");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/diagnose
 * Diagnosticar caso
 */
router.post("/cases/:id/diagnose", async (req, res) => {
  try {
    const { id } = req.params;
    const { diagnosis_text, confirmed_hypothesis_id, actor_id } = req.body;
    
    const result = await caseService.diagnose(id, {
      diagnosisText: diagnosis_text,
      confirmedHypothesisId: confirmed_hypothesis_id,
      actorId: actor_id,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to diagnose case");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/recommend
 * Recomendar acción
 */
router.post("/cases/:id/recommend", async (req, res) => {
  try {
    const { id } = req.params;
    const { action, actor_id } = req.body;
    
    if (!action || !action.title) {
      return res.status(400).json({ 
        error: "Missing required field: action with title" 
      });
    }
    
    const result = await caseService.recommendAction(id, action, actor_id);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to recommend action");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/actions/:actionId/approve
 * Aprobar acción de un caso
 */
router.post("/cases/:id/actions/:actionId/approve", async (req, res) => {
  try {
    const { id, actionId } = req.params;
    const { actor_id } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const result = await caseService.approveAction(id, actionId, actor_id);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to approve action");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/actions/:actionId/reject
 * Rechazar acción de un caso
 */
router.post("/cases/:id/actions/:actionId/reject", async (req, res) => {
  try {
    const { id, actionId } = req.params;
    const { actor_id, reason } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const result = await caseService.rejectAction(id, actionId, actor_id, reason);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to reject action");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/close
 * Cerrar un caso
 */
router.post("/cases/:id/close", async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, actor_id, notes } = req.body;
    
    const result = await caseService.closeCase(id, {
      outcome,
      actorId: actor_id,
      notes,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to close case");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cases/:id/reopen
 * Reabrir un caso cerrado
 */
router.post("/cases/:id/reopen", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id, reason } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const result = await caseService.reopenCase(id, actor_id, reason);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to reopen case");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/cases/:id/timeline
 * Timeline de un caso (audit log)
 */
router.get("/cases/:id/timeline", async (req, res) => {
  try {
    const { id } = req.params;
    
    const timeline = await auditService.getCaseTimeline(id);
    res.json({ timeline });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get case timeline");
    res.status(500).json({ error: "Failed to get case timeline" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/alerts
 * Lista alertas con filtros
 */
router.get("/alerts", async (req, res) => {
  try {
    const {
      state,
      states,
      severity,
      type,
      branch,
      detector_id,
      include_expired,
      limit = 50,
      offset = 0,
    } = req.query;
    
    const result = await alertService.listAlerts({
      state,
      states: states ? states.split(",") : undefined,
      severity,
      alertType: type,
      branchId: branch,
      detectorId: detector_id,
      includeExpired: include_expired === "true",
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list alerts");
    res.status(500).json({ error: "Failed to list alerts" });
  }
});

/**
 * GET /api/luca/alerts/active
 * Alertas activas (para dashboard)
 */
router.get("/alerts/active", async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await alertService.getActiveAlerts(parseInt(limit));
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get active alerts");
    res.status(500).json({ error: "Failed to get active alerts" });
  }
});

/**
 * GET /api/luca/alerts/stats
 * Estadísticas de alertas
 */
router.get("/alerts/stats", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await alertService.getAlertStats(parseInt(days));
    res.json(stats);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get alert stats");
    res.status(500).json({ error: "Failed to get alert stats" });
  }
});

/**
 * GET /api/luca/alerts/:id
 * Detalle de una alerta
 */
router.get("/alerts/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const alert = await alertService.getAlert(id);
    
    if (!alert) {
      return res.status(404).json({ error: "Alert not found" });
    }
    
    res.json(alert);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get alert");
    res.status(500).json({ error: "Failed to get alert" });
  }
});

/**
 * POST /api/luca/alerts
 * Crear alerta manualmente
 */
router.post("/alerts", async (req, res) => {
  try {
    const {
      alert_type,
      severity,
      title,
      message,
      branch_id,
      expires_in,
    } = req.body;
    
    if (!alert_type || !title) {
      return res.status(400).json({
        error: "Missing required fields: alert_type, title"
      });
    }
    
    const alert = await alertService.createAlert({
      alertType: alert_type,
      severity,
      title,
      message,
      branchId: branch_id,
      source: "manual",
      expiresIn: expires_in,
    });
    
    res.status(201).json(alert);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to create alert");
    res.status(500).json({ error: err?.message || "Failed to create alert" });
  }
});

/**
 * POST /api/luca/alerts/:id/ack
 * Acknowledge alerta
 */
router.post("/alerts/:id/ack", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const alert = await alertService.acknowledge(id, actor_id);
    res.json(alert);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to acknowledge alert");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/alerts/:id/resolve
 * Resolver alerta
 */
router.post("/alerts/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id, resolution } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const alert = await alertService.resolve(id, {
      actorId: actor_id,
      resolution,
    });
    
    res.json(alert);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to resolve alert");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/alerts/:id/escalate
 * Escalar alerta a caso
 */
router.post("/alerts/:id/escalate", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const result = await alertService.escalateToCase(id, actor_id);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to escalate alert");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/alerts/batch/ack
 * Acknowledge múltiples alertas
 */
router.post("/alerts/batch/ack", async (req, res) => {
  try {
    const { alert_ids, actor_id } = req.body;
    
    if (!alert_ids || !actor_id) {
      return res.status(400).json({
        error: "Missing required fields: alert_ids, actor_id"
      });
    }
    
    const results = await alertService.acknowledgeMany(alert_ids, actor_id);
    res.json({ results });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to batch acknowledge alerts");
    res.status(500).json({ error: "Failed to batch acknowledge alerts" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/actions
 * Lista acciones con filtros
 */
router.get("/actions", async (req, res) => {
  try {
    const {
      state,
      states,
      type,
      case_id,
      approval_level,
      pending_approval,
      limit = 50,
      offset = 0,
    } = req.query;
    
    const result = await actionService.listActions({
      state,
      states: states ? states.split(",") : undefined,
      actionType: type,
      caseId: case_id,
      approvalLevel: approval_level,
      pendingApproval: pending_approval === "true",
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list actions");
    res.status(500).json({ error: "Failed to list actions" });
  }
});

/**
 * GET /api/luca/actions/pending
 * Acciones pendientes de aprobación
 */
router.get("/actions/pending", async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const result = await actionService.getPendingApprovals(parseInt(limit));
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get pending actions");
    res.status(500).json({ error: "Failed to get pending actions" });
  }
});

/**
 * GET /api/luca/actions/stats
 * Estadísticas de acciones
 */
router.get("/actions/stats", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await actionService.getActionStats(parseInt(days));
    res.json(stats);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get action stats");
    res.status(500).json({ error: "Failed to get action stats" });
  }
});

/**
 * GET /api/luca/actions/:id
 * Detalle de una acción
 */
router.get("/actions/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const action = await actionService.getAction(id);
    
    if (!action) {
      return res.status(404).json({ error: "Action not found" });
    }
    
    res.json(action);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get action");
    res.status(500).json({ error: "Failed to get action" });
  }
});

/**
 * POST /api/luca/actions/:id/approve
 * Aprobar acción
 */
router.post("/actions/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id, notes } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const action = await actionService.approve(id, actor_id, notes);
    res.json(action);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to approve action");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/:id/reject
 * Rechazar acción
 */
router.post("/actions/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id, reason } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const action = await actionService.reject(id, actor_id, reason);
    res.json(action);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to reject action");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/:id/execute
 * Ejecutar acción
 */
router.post("/actions/:id/execute", async (req, res) => {
  try {
    const { id } = req.params;
    const { executed_by } = req.body;
    
    const action = await actionService.execute(id, executed_by);
    res.json(action);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to execute action");
    res.status(400).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/:id/cancel
 * Cancelar acción
 */
router.post("/actions/:id/cancel", async (req, res) => {
  try {
    const { id } = req.params;
    const { actor_id, reason } = req.body;
    
    if (!actor_id) {
      return res.status(400).json({ error: "Missing required field: actor_id" });
    }
    
    const action = await actionService.cancel(id, actor_id, reason);
    res.json(action);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to cancel action");
    res.status(400).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/audit
 * Consultar audit log
 */
router.get("/audit", async (req, res) => {
  try {
    const {
      actor_type,
      actor_id,
      action,
      target_type,
      target_id,
      from_date,
      to_date,
      limit = 100,
      offset = 0,
    } = req.query;
    
    const result = await auditService.queryAuditLog({
      actorType: actor_type,
      actorId: actor_id,
      action,
      targetType: target_type,
      targetId: target_id,
      fromDate: from_date,
      toDate: to_date,
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to query audit log");
    res.status(500).json({ error: "Failed to query audit log" });
  }
});

/**
 * GET /api/luca/audit/stats
 * Estadísticas del audit log
 */
router.get("/audit/stats", async (req, res) => {
  try {
    const { days = 30 } = req.query;
    const stats = await auditService.getAuditStats(parseInt(days));
    res.json(stats);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get audit stats");
    res.status(500).json({ error: "Failed to get audit stats" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTING INFO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/routing/status
 * Estado del routing (quiet hours, etc)
 */
router.get("/routing/status", async (req, res) => {
  try {
    const status = checkQuietHours();
    res.json(status);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get routing status");
    res.status(500).json({ error: "Failed to get routing status" });
  }
});

export default router;
