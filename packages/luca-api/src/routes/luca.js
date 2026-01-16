/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA ROUTES - Core LUCA API endpoints
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * /api/luca/cases     - Case management
 * /api/luca/alerts    - Alert management
 * /api/luca/actions   - Action management
 * /api/luca/brief     - Morning briefing
 * /api/luca/memory    - Episodic memory
 * 
 * @version 0.1.0
 */

import { Router } from "express";
import { logger, query } from "@tagers/shared";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// CASES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/cases
 * List cases with optional filters
 */
router.get("/cases", async (req, res) => {
  try {
    const { state, type, branch, limit = 50 } = req.query;
    
    let sql = `
      SELECT * FROM luca_cases 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (state) {
      sql += ` AND state = $${paramIndex++}`;
      params.push(state);
    }
    if (type) {
      sql += ` AND case_type = $${paramIndex++}`;
      params.push(type);
    }
    if (branch) {
      sql += ` AND scope->>'branch_id' = $${paramIndex++}`;
      params.push(branch);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
    
    const result = await query(sql, params);
    
    res.json({
      cases: result.rows,
      total: result.rowCount,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list cases");
    res.status(500).json({ error: "Failed to list cases" });
  }
});

/**
 * GET /api/luca/cases/:id
 * Get case detail
 */
router.get("/cases/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await query(
      `SELECT * FROM luca_cases WHERE case_id = $1`,
      [id]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Case not found" });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get case");
    res.status(500).json({ error: "Failed to get case" });
  }
});

/**
 * POST /api/luca/cases/:id/close
 * Close a case
 */
router.post("/cases/:id/close", async (req, res) => {
  try {
    const { id } = req.params;
    const { outcome, closed_by } = req.body;
    
    const result = await query(
      `UPDATE luca_cases 
       SET state = 'CLOSED', 
           outcome = $2,
           closed_at = NOW(),
           closed_by = $3
       WHERE case_id = $1
       RETURNING *`,
      [id, outcome || {}, closed_by || "system"]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Case not found" });
    }
    
    logger.info({ caseId: id }, "Case closed");
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to close case");
    res.status(500).json({ error: "Failed to close case" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/alerts
 * List active alerts
 */
router.get("/alerts", async (req, res) => {
  try {
    const { state = "ACTIVE", severity, branch, limit = 50 } = req.query;
    
    let sql = `
      SELECT * FROM luca_alerts 
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;
    
    if (state) {
      sql += ` AND state = $${paramIndex++}`;
      params.push(state);
    }
    if (severity) {
      sql += ` AND severity = $${paramIndex++}`;
      params.push(severity);
    }
    if (branch) {
      sql += ` AND branch_id = $${paramIndex++}`;
      params.push(branch);
    }
    
    sql += ` ORDER BY created_at DESC LIMIT $${paramIndex}`;
    params.push(parseInt(limit));
    
    const result = await query(sql, params);
    
    res.json({
      alerts: result.rows,
      total: result.rowCount,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list alerts");
    res.status(500).json({ error: "Failed to list alerts" });
  }
});

/**
 * POST /api/luca/alerts/:id/ack
 * Acknowledge an alert
 */
router.post("/alerts/:id/ack", async (req, res) => {
  try {
    const { id } = req.params;
    const { acked_by } = req.body;
    
    const result = await query(
      `UPDATE luca_alerts 
       SET state = 'ACKNOWLEDGED',
           acked_at = NOW(),
           acked_by = $2
       WHERE alert_id = $1
       RETURNING *`,
      [id, acked_by || "system"]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Alert not found" });
    }
    
    logger.info({ alertId: id }, "Alert acknowledged");
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to acknowledge alert");
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

/**
 * POST /api/luca/alerts/:id/resolve
 * Resolve an alert
 */
router.post("/alerts/:id/resolve", async (req, res) => {
  try {
    const { id } = req.params;
    const { resolution, resolved_by } = req.body;
    
    const result = await query(
      `UPDATE luca_alerts 
       SET state = 'RESOLVED',
           resolved_at = NOW(),
           resolution = $2,
           resolved_by = $3
       WHERE alert_id = $1
       RETURNING *`,
      [id, resolution || "", resolved_by || "system"]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Alert not found" });
    }
    
    logger.info({ alertId: id }, "Alert resolved");
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to resolve alert");
    res.status(500).json({ error: "Failed to resolve alert" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/actions
 * List pending actions
 */
router.get("/actions", async (req, res) => {
  try {
    const { state = "PENDING", limit = 50 } = req.query;
    
    const result = await query(
      `SELECT * FROM luca_actions 
       WHERE state = $1
       ORDER BY created_at DESC 
       LIMIT $2`,
      [state, parseInt(limit)]
    );
    
    res.json({
      actions: result.rows,
      total: result.rowCount,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list actions");
    res.status(500).json({ error: "Failed to list actions" });
  }
});

/**
 * POST /api/luca/actions/:id/approve
 * Approve an action
 */
router.post("/actions/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { approved_by } = req.body;
    
    const result = await query(
      `UPDATE luca_actions 
       SET state = 'APPROVED',
           approved_at = NOW(),
           approved_by = $2
       WHERE action_id = $1 AND requires_approval = true
       RETURNING *`,
      [id, approved_by || "system"]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Action not found or doesn't require approval" });
    }
    
    logger.info({ actionId: id, approvedBy: approved_by }, "Action approved");
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to approve action");
    res.status(500).json({ error: "Failed to approve action" });
  }
});

/**
 * POST /api/luca/actions/:id/reject
 * Reject an action
 */
router.post("/actions/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { rejected_by, reason } = req.body;
    
    const result = await query(
      `UPDATE luca_actions 
       SET state = 'REJECTED',
           rejected_at = NOW(),
           rejected_by = $2,
           rejection_reason = $3
       WHERE action_id = $1
       RETURNING *`,
      [id, rejected_by || "system", reason || ""]
    );
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Action not found" });
    }
    
    logger.info({ actionId: id, rejectedBy: rejected_by }, "Action rejected");
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to reject action");
    res.status(500).json({ error: "Failed to reject action" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BRIEFING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/brief/today
 * Get today's briefing
 */
router.get("/brief/today", async (req, res) => {
  try {
    // TODO: Implement briefing generator
    res.json({
      date: new Date().toISOString().split("T")[0],
      status: "not_implemented",
      message: "Briefing generator coming in Iteration 3",
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get briefing");
    res.status(500).json({ error: "Failed to get briefing" });
  }
});

export default router;
