/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACTIONS ROUTES - API para Action Bus y Las Manos
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { actionBus, ActionState } from "../actions/ActionBus.js";
import { actionExecutor } from "../actions/ActionExecutor.js";
import { approvalService } from "../approval/ApprovalService.js";
import { 
  AutonomyConfig, 
  listActions, 
  listActionsByLevel 
} from "../autonomy/AutonomyLevels.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// ACTION BUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/actions/propose
 * Proponer una acción para ejecución
 */
router.post("/propose", async (req, res) => {
  try {
    const { type, payload, context, reason, requestedBy } = req.body;

    if (!type) {
      return res.status(400).json({ error: "type required" });
    }

    const result = await actionBus.propose({
      type,
      payload: payload || {},
      context: context || {},
      reason,
      requestedBy: requestedBy || "api",
    });

    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Action proposal failed");
    res.status(500).json({ error: err?.message || "Proposal failed" });
  }
});

/**
 * POST /api/luca/actions/:actionId/approve
 * Aprobar una acción pendiente
 */
router.post("/:actionId/approve", async (req, res) => {
  try {
    const { actionId } = req.params;
    const { approvedBy, code2FA } = req.body;

    if (!approvedBy) {
      return res.status(400).json({ error: "approvedBy required" });
    }

    let result;

    if (code2FA) {
      result = await actionBus.verify2FAAndApprove(actionId, approvedBy, code2FA);
    } else {
      result = await actionBus.approve(actionId, approvedBy);
    }

    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Action approval failed");
    res.status(400).json({ error: err?.message || "Approval failed" });
  }
});

/**
 * POST /api/luca/actions/:actionId/confirm
 * Confirmar un draft
 */
router.post("/:actionId/confirm", async (req, res) => {
  try {
    const { actionId } = req.params;
    const { confirmedBy } = req.body;

    if (!confirmedBy) {
      return res.status(400).json({ error: "confirmedBy required" });
    }

    const result = await actionBus.confirm(actionId, confirmedBy);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Action confirmation failed");
    res.status(400).json({ error: err?.message || "Confirmation failed" });
  }
});

/**
 * POST /api/luca/actions/:actionId/reject
 * Rechazar una acción pendiente
 */
router.post("/:actionId/reject", async (req, res) => {
  try {
    const { actionId } = req.params;
    const { rejectedBy, reason } = req.body;

    if (!rejectedBy) {
      return res.status(400).json({ error: "rejectedBy required" });
    }

    const result = await actionBus.reject(actionId, rejectedBy, reason);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Action rejection failed");
    res.status(400).json({ error: err?.message || "Rejection failed" });
  }
});

/**
 * POST /api/luca/actions/:actionId/cancel
 * Cancelar una acción pendiente
 */
router.post("/:actionId/cancel", async (req, res) => {
  try {
    const { actionId } = req.params;
    const { cancelledBy, reason } = req.body;

    const result = await actionBus.cancel(actionId, cancelledBy, reason);
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Action cancellation failed");
    res.status(400).json({ error: err?.message || "Cancellation failed" });
  }
});

/**
 * GET /api/luca/actions/:actionId
 * Obtener una acción por ID
 */
router.get("/:actionId", async (req, res) => {
  try {
    const { actionId } = req.params;
    const action = await actionBus.getAction(actionId);

    if (!action) {
      return res.status(404).json({ error: "Action not found" });
    }

    res.json(action);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/:actionId/dry-run
 * Ejecutar en modo dry-run (sin efectos)
 */
router.post("/:actionId/dry-run", async (req, res) => {
  try {
    const { actionId } = req.params;
    const action = await actionBus.getAction(actionId);

    if (!action) {
      return res.status(404).json({ error: "Action not found" });
    }

    const result = await actionExecutor.dryRun(action);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// APPROVALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/actions/pending
 * Listar acciones pendientes de aprobación
 */
router.get("/pending", async (req, res) => {
  try {
    const { level, limit } = req.query;
    const pending = await approvalService.getPendingApprovals({
      level,
      limit: limit ? parseInt(limit) : 20,
    });
    res.json({ pending, count: pending.length });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/actions/stats
 * Estadísticas de aprobaciones
 */
router.get("/stats", async (req, res) => {
  try {
    const stats = await approvalService.getApprovalStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/process-expired
 * Procesar acciones expiradas
 */
router.post("/process-expired", async (req, res) => {
  try {
    const expiredCount = await approvalService.processExpiredActions();
    res.json({ processed: expiredCount });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTONOMY CONFIG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/actions/config
 * Obtener configuración de autonomía
 */
router.get("/config", (req, res) => {
  res.json({
    actions: listActions(),
    levels: ["AUTO", "DRAFT", "APPROVAL", "CRITICAL"],
  });
});

/**
 * GET /api/luca/actions/config/:level
 * Obtener acciones por nivel de autonomía
 */
router.get("/config/:level", (req, res) => {
  const { level } = req.params;
  const actions = listActionsByLevel(level.toUpperCase());
  res.json({ level, actions });
});

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/actions/handlers
 * Listar handlers disponibles
 */
router.get("/handlers", (req, res) => {
  const handlers = actionExecutor.listHandlers();
  res.json({ handlers });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUICK ACTIONS (atajos para acciones comunes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/actions/quick/notify
 * Atajo para enviar notificación
 */
router.post("/quick/notify", async (req, res) => {
  try {
    const { user_id, message, urgency } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: "user_id and message required" });
    }

    const result = await actionBus.propose({
      type: "NOTIFY_SOCIO",
      payload: { user_id, message },
      reason: "Quick notification",
      requestedBy: "api",
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/quick/alert
 * Atajo para enviar alerta
 */
router.post("/quick/alert", async (req, res) => {
  try {
    const { title, message, severity, branch_id } = req.body;

    if (!title || !message) {
      return res.status(400).json({ error: "title and message required" });
    }

    const result = await actionBus.propose({
      type: "SEND_ALERT",
      payload: { title, message, severity, branch_id },
      reason: "Quick alert",
      requestedBy: "api",
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/actions/quick/flag-employee
 * Atajo para marcar empleado
 */
router.post("/quick/flag-employee", async (req, res) => {
  try {
    const { employee_id, branch_id, reason, flag_type } = req.body;

    if (!employee_id || !reason) {
      return res.status(400).json({ error: "employee_id and reason required" });
    }

    const result = await actionBus.propose({
      type: "FLAG_EMPLOYEE",
      payload: { employee_id, branch_id, reason, flag_type },
      reason,
      requestedBy: "api",
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
