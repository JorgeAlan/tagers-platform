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
 * Get personalized feed of decision cards for Tower PWA
 */
router.get("/feed", async (req, res) => {
  try {
    const { user_id = "jorge", limit = 20 } = req.query;
    
    // Get pending actions (action_required cards)
    const actionsResult = await query(`
      SELECT 
        a.action_id,
        a.action_type,
        a.title,
        a.description,
        a.case_id,
        a.severity,
        a.requires_approval,
        a.expected_impact,
        a.created_at,
        c.title as case_title,
        c.scope
      FROM luca_actions a
      LEFT JOIN luca_cases c ON a.case_id = c.case_id
      WHERE a.state = 'PENDING' AND a.requires_approval = true
      ORDER BY 
        CASE a.severity 
          WHEN 'CRITICAL' THEN 1 
          WHEN 'HIGH' THEN 2 
          WHEN 'MEDIUM' THEN 3 
          ELSE 4 
        END,
        a.created_at DESC
      LIMIT $1
    `, [parseInt(limit)]);
    
    // Get active alerts (alert_active cards)
    const alertsResult = await query(`
      SELECT 
        alert_id,
        alert_type,
        title,
        message,
        branch_id,
        severity,
        source,
        detector_id,
        created_at
      FROM luca_alerts 
      WHERE state = 'ACTIVE'
        AND (expires_at IS NULL OR expires_at > NOW())
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
    
    // Get recent case updates (case_update cards)
    const caseUpdatesResult = await query(`
      SELECT 
        c.case_id,
        c.case_type,
        c.title,
        c.state,
        c.severity,
        c.scope,
        c.updated_at,
        (SELECT action FROM luca_audit_log 
         WHERE target_type = 'case' AND target_id = c.case_id 
         ORDER BY created_at DESC LIMIT 1) as last_action
      FROM luca_cases c
      WHERE c.updated_at > NOW() - INTERVAL '24 hours'
        AND c.state != 'CLOSED'
      ORDER BY c.updated_at DESC
      LIMIT 5
    `);
    
    // Transform to FeedCard format
    const feed = [];
    
    // Action cards (highest priority)
    for (const action of actionsResult.rows) {
      feed.push({
        id: `action-${action.action_id}`,
        type: "action_required",
        priority: getSeverityPriority(action.severity),
        title: action.title,
        subtitle: action.case_title || action.action_type,
        body: action.description || "",
        actions: {
          primary: { label: "Aprobar", action: "approve" },
          secondary: { label: "Rechazar", action: "reject" },
        },
        source: "LUCA",
        branch_id: action.scope?.branch_id,
        case_id: action.case_id,
        action_id: action.action_id,
        created_at: action.created_at,
        metadata: {
          severity: action.severity,
          expected_impact: action.expected_impact,
        },
      });
    }
    
    // Alert cards
    for (const alert of alertsResult.rows) {
      feed.push({
        id: `alert-${alert.alert_id}`,
        type: "alert_active",
        priority: getSeverityPriority(alert.severity) + 10, // Lower than actions
        title: alert.title,
        subtitle: alert.alert_type,
        body: alert.message || "",
        source: alert.source || alert.detector_id || "LUCA",
        branch_id: alert.branch_id,
        alert_id: alert.alert_id,
        created_at: alert.created_at,
        metadata: {
          severity: alert.severity,
        },
      });
    }
    
    // Case update cards
    for (const update of caseUpdatesResult.rows) {
      feed.push({
        id: `case-${update.case_id}-${Date.now()}`,
        type: "case_update",
        priority: 50, // Low priority
        title: `Caso actualizado: ${update.title}`,
        subtitle: `Estado: ${update.state}`,
        body: update.last_action ? `Última acción: ${update.last_action}` : "",
        source: "Sistema",
        branch_id: update.scope?.branch_id,
        case_id: update.case_id,
        created_at: update.updated_at,
        metadata: {
          severity: update.severity,
          state: update.state,
        },
      });
    }
    
    // Sort by priority (lower is higher priority)
    feed.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return new Date(b.created_at) - new Date(a.created_at);
    });
    
    res.json({
      feed: feed.slice(0, parseInt(limit)),
      total: feed.length,
      user_id,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get feed");
    res.status(500).json({ error: "Failed to get feed" });
  }
});

function getSeverityPriority(severity) {
  const mapping = { CRITICAL: 1, HIGH: 2, MEDIUM: 3, LOW: 4 };
  return mapping[severity] || 5;
}

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

// ═══════════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/tower/preferences
 * Get user preferences
 */
router.get("/preferences", async (req, res) => {
  try {
    const { user_id = "jorge" } = req.query;
    
    const result = await query(`
      SELECT user_id, name, role, notification_prefs, watchlists
      FROM tower_users
      WHERE user_id = $1
    `, [user_id]);
    
    if (result.rowCount === 0) {
      return res.json({
        notification_prefs: {
          severity_min: "MEDIUM",
          channels: ["tower"],
          quiet_hours: { start: 22, end: 7 },
          sound_enabled: true,
        },
        watchlists: {
          branches: [],
          detectors: [],
        },
        theme: "system",
      });
    }
    
    const user = result.rows[0];
    res.json({
      ...user.notification_prefs,
      watchlists: user.watchlists || { branches: [], detectors: [] },
      theme: "system",
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get preferences");
    res.status(500).json({ error: "Failed to get preferences" });
  }
});

/**
 * POST /api/tower/preferences
 * Update user preferences
 */
router.post("/preferences", async (req, res) => {
  try {
    const { user_id = "jorge" } = req.query;
    const { notification_prefs, watchlists } = req.body;
    
    await query(`
      INSERT INTO tower_users (user_id, name, notification_prefs, watchlists)
      VALUES ($1, $1, $2, $3)
      ON CONFLICT (user_id) DO UPDATE SET
        notification_prefs = $2,
        watchlists = $3,
        updated_at = NOW()
    `, [user_id, notification_prefs, watchlists]);
    
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to save preferences");
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PUSH NOTIFICATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/tower/push-subscribe
 * Subscribe to push notifications
 */
router.post("/push-subscribe", async (req, res) => {
  try {
    const { user_id = "jorge" } = req.query;
    const subscription = req.body;
    
    // Store push subscription
    await query(`
      UPDATE tower_users SET
        push_subscription = $2,
        updated_at = NOW()
      WHERE user_id = $1
    `, [user_id, subscription]);
    
    logger.info({ user_id }, "Push subscription saved");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to save push subscription");
    res.status(500).json({ error: "Failed to save push subscription" });
  }
});

/**
 * POST /api/tower/push-unsubscribe
 * Unsubscribe from push notifications
 */
router.post("/push-unsubscribe", async (req, res) => {
  try {
    const { user_id = "jorge" } = req.query;
    
    await query(`
      UPDATE tower_users SET
        push_subscription = NULL,
        updated_at = NOW()
      WHERE user_id = $1
    `, [user_id]);
    
    res.json({ success: true });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to remove push subscription");
    res.status(500).json({ error: "Failed to remove push subscription" });
  }
});

export default router;
