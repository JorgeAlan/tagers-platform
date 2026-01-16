/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOWER ROUTES - Control Tower API endpoints
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints para el Control Tower PWA usado por socios.
 * 
 * /api/tower/dashboard  - KPIs del día
 * /api/tower/feed       - Feed de decisiones
 * /api/tower/branches   - Estado por sucursal
 * /api/tower/auth       - Autenticación
 * 
 * @version 0.1.0
 */

import { Router } from "express";
import { logger, query } from "@tagers/shared";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/tower/dashboard
 * Get dashboard KPIs
 */
router.get("/dashboard", async (req, res) => {
  try {
    // Get today's date in Mexico timezone
    const today = new Date().toLocaleDateString('en-CA', { 
      timeZone: 'America/Mexico_City' 
    });
    
    // Get summary stats
    const [casesResult, alertsResult, actionsResult] = await Promise.all([
      query(`
        SELECT 
          COUNT(*) FILTER (WHERE state = 'OPEN') as open_cases,
          COUNT(*) FILTER (WHERE state = 'INVESTIGATING') as investigating_cases,
          COUNT(*) FILTER (WHERE DATE(created_at) = $1) as cases_today
        FROM luca_cases
      `, [today]),
      query(`
        SELECT 
          COUNT(*) FILTER (WHERE state = 'ACTIVE') as active_alerts,
          COUNT(*) FILTER (WHERE severity = 'CRITICAL' AND state = 'ACTIVE') as critical_alerts
        FROM luca_alerts
      `),
      query(`
        SELECT COUNT(*) as pending_actions
        FROM luca_actions 
        WHERE state = 'PENDING' AND requires_approval = true
      `),
    ]);
    
    res.json({
      date: today,
      kpis: {
        cases: {
          open: parseInt(casesResult.rows[0]?.open_cases || 0),
          investigating: parseInt(casesResult.rows[0]?.investigating_cases || 0),
          today: parseInt(casesResult.rows[0]?.cases_today || 0),
        },
        alerts: {
          active: parseInt(alertsResult.rows[0]?.active_alerts || 0),
          critical: parseInt(alertsResult.rows[0]?.critical_alerts || 0),
        },
        actions: {
          pending: parseInt(actionsResult.rows[0]?.pending_actions || 0),
        },
      },
      // Placeholders for sales data (will come from Redshift sync)
      sales: {
        today: 0,
        vs_meta: 0,
        vs_yesterday: 0,
        ticket_avg: 0,
      },
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get dashboard");
    res.status(500).json({ error: "Failed to get dashboard" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FEED
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/tower/feed
 * Get feed of decision cards
 */
router.get("/feed", async (req, res) => {
  try {
    const { limit = 20 } = req.query;
    
    // Get pending actions (decision cards)
    const actionsResult = await query(`
      SELECT 
        action_id as id,
        'action' as type,
        action_type as subtype,
        title,
        description,
        case_id,
        severity,
        requires_approval,
        expected_impact,
        created_at
      FROM luca_actions 
      WHERE state = 'PENDING'
      ORDER BY 
        CASE severity 
          WHEN 'CRITICAL' THEN 1 
          WHEN 'HIGH' THEN 2 
          WHEN 'MEDIUM' THEN 3 
          ELSE 4 
        END,
        created_at DESC
      LIMIT $1
    `, [parseInt(limit)]);
    
    // Get active alerts
    const alertsResult = await query(`
      SELECT 
        alert_id as id,
        'alert' as type,
        alert_type as subtype,
        title,
        message as description,
        branch_id,
        severity,
        created_at
      FROM luca_alerts 
      WHERE state = 'ACTIVE'
      ORDER BY 
        CASE severity 
          WHEN 'CRITICAL' THEN 1 
          WHEN 'HIGH' THEN 2 
          WHEN 'MEDIUM' THEN 3 
          ELSE 4 
        END,
        created_at DESC
      LIMIT $1
    `, [parseInt(limit)]);
    
    // Merge and sort by severity + time
    const feed = [
      ...actionsResult.rows,
      ...alertsResult.rows,
    ].sort((a, b) => {
      const severityOrder = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
      const aSev = severityOrder[a.severity] || 5;
      const bSev = severityOrder[b.severity] || 5;
      if (aSev !== bSev) return aSev - bSev;
      return new Date(b.created_at) - new Date(a.created_at);
    }).slice(0, parseInt(limit));
    
    res.json({
      feed,
      total: feed.length,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get feed");
    res.status(500).json({ error: "Failed to get feed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BRANCHES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/tower/branches
 * Get branch status overview
 */
router.get("/branches", async (req, res) => {
  try {
    // Get branches with their alert counts
    const result = await query(`
      SELECT 
        b.branch_id,
        b.name,
        b.city,
        COUNT(a.alert_id) FILTER (WHERE a.state = 'ACTIVE') as active_alerts,
        COUNT(c.case_id) FILTER (WHERE c.state IN ('OPEN', 'INVESTIGATING')) as open_cases
      FROM (
        SELECT DISTINCT 
          scope->>'branch_id' as branch_id,
          scope->>'branch_name' as name,
          scope->>'city' as city
        FROM luca_cases
        WHERE scope->>'branch_id' IS NOT NULL
        UNION
        SELECT DISTINCT branch_id, branch_id as name, NULL as city
        FROM luca_alerts
        WHERE branch_id IS NOT NULL
      ) b
      LEFT JOIN luca_alerts a ON a.branch_id = b.branch_id
      LEFT JOIN luca_cases c ON c.scope->>'branch_id' = b.branch_id
      GROUP BY b.branch_id, b.name, b.city
      ORDER BY active_alerts DESC, open_cases DESC
    `);
    
    res.json({
      branches: result.rows,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get branches");
    res.status(500).json({ error: "Failed to get branches" });
  }
});

/**
 * GET /api/tower/branches/:id
 * Get single branch detail
 */
router.get("/branches/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get branch cases
    const casesResult = await query(`
      SELECT * FROM luca_cases 
      WHERE scope->>'branch_id' = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [id]);
    
    // Get branch alerts
    const alertsResult = await query(`
      SELECT * FROM luca_alerts 
      WHERE branch_id = $1
      ORDER BY created_at DESC
      LIMIT 10
    `, [id]);
    
    res.json({
      branch_id: id,
      cases: casesResult.rows,
      alerts: alertsResult.rows,
      // Placeholder for sales data
      sales: {
        today: 0,
        trend: [],
      },
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get branch detail");
    res.status(500).json({ error: "Failed to get branch detail" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTH (Placeholder - will be implemented in Iteration 2)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/tower/auth/login
 * Login to Control Tower
 */
router.post("/auth/login", async (req, res) => {
  // TODO: Implement JWT auth
  res.json({
    status: "not_implemented",
    message: "Auth coming in Iteration 2",
  });
});

/**
 * GET /api/tower/auth/me
 * Get current user
 */
router.get("/auth/me", async (req, res) => {
  // TODO: Implement JWT auth
  res.json({
    status: "not_implemented",
    message: "Auth coming in Iteration 2",
  });
});

export default router;
