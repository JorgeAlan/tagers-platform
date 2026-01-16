/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INSIGHTS ENGINE - API Routes v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints para acceder a insights y métricas.
 * 
 * @version 1.0.0
 */

import express from "express";
import { logger } from "../../utils/logger.js";
import { getPool } from "../../db/repo.js";
import aggregator from "../aggregators/insightsAggregator.js";
import discovery from "../discovery/patternDiscovery.js";
import { EVENT_CATALOG, EVENT_CATEGORIES } from "../eventCatalog.js";

export const insightsRouter = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD - Resumen general
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/dashboard
 * Resumen completo para dashboard
 */
insightsRouter.get("/dashboard", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    // Resumen de hoy
    const todaySummary = await aggregator.getTodaySummary();
    
    // Alertas activas
    const alerts = await aggregator.getActiveAlerts();
    
    // Últimos 7 días
    const endDate = new Date().toISOString().split("T")[0];
    const startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const weeklyInsights = await aggregator.getDailyInsights(startDate, endDate);
    
    // Patrones pendientes
    const pendingPatterns = await discovery.getPendingPatterns();
    
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      today: todaySummary,
      alerts: {
        count: alerts.length,
        critical: alerts.filter(a => a.severity === "critical").length,
        high: alerts.filter(a => a.severity === "high").length,
        items: alerts.slice(0, 5),
      },
      weekly: {
        days: weeklyInsights.length,
        totalMessages: weeklyInsights.reduce((sum, d) => sum + (d.total_messages || 0), 0),
        totalOrders: weeklyInsights.reduce((sum, d) => sum + (d.orders_completed || 0), 0),
        avgSentiment: weeklyInsights.length > 0 
          ? (weeklyInsights.reduce((sum, d) => sum + parseFloat(d.avg_sentiment_score || 0), 0) / weeklyInsights.length).toFixed(3)
          : null,
      },
      discovery: {
        pendingPatterns: pendingPatterns.length,
      },
    });
  } catch (error) {
    logger.error({ error: error.message }, "Dashboard endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS DIARIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/daily
 * Insights por día
 * Query params: start_date, end_date, branch_id
 */
insightsRouter.get("/daily", async (req, res) => {
  try {
    const { start_date, end_date, branch_id } = req.query;
    
    const endDate = end_date || new Date().toISOString().split("T")[0];
    const startDate = start_date || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    
    const insights = await aggregator.getDailyInsights(startDate, endDate, branch_id);
    
    res.json({
      ok: true,
      period: { start: startDate, end: endDate },
      branch_id: branch_id || "all",
      count: insights.length,
      data: insights,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Daily insights endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/products
 * Top productos mencionados
 */
insightsRouter.get("/products", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { days = 7, limit = 20 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        product,
        COUNT(*) as mentions,
        COUNT(*) FILTER (WHERE event_category = 'complaint') as complaints,
        COUNT(*) FILTER (WHERE event_category = 'praise') as praises,
        COUNT(*) FILTER (WHERE event_type = 'product_unavailable') as stockouts
      FROM conversation_events,
           jsonb_array_elements_text(entities->'products') as product
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY product
      ORDER BY mentions DESC
      LIMIT $1
    `, [parseInt(limit)]);
    
    res.json({
      ok: true,
      period_days: parseInt(days),
      count: result.rows.length,
      products: result.rows,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Products insights endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUCURSALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/branches
 * Comparativa de sucursales
 */
insightsRouter.get("/branches", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { days = 7 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        COALESCE(branch_id, 'unknown') as branch_id,
        COALESCE(branch_name, branch_id, 'Sin sucursal') as branch_name,
        COUNT(*) as total_messages,
        COUNT(DISTINCT conversation_id) as conversations,
        COUNT(*) FILTER (WHERE event_category = 'complaint') as complaints,
        COUNT(*) FILTER (WHERE event_category = 'praise') as praises,
        AVG(sentiment_score) as avg_sentiment,
        COUNT(*) FILTER (WHERE event_type = 'order_completed') as orders
      FROM conversation_events
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY branch_id, branch_name
      ORDER BY total_messages DESC
    `);
    
    res.json({
      ok: true,
      period_days: parseInt(days),
      count: result.rows.length,
      branches: result.rows,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Branches insights endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// QUEJAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/complaints
 * Análisis de quejas
 */
insightsRouter.get("/complaints", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { days = 7 } = req.query;
    
    // Por tipo
    const byType = await pool.query(`
      SELECT 
        event_type,
        COUNT(*) as count,
        AVG(sentiment_score) as avg_sentiment
      FROM conversation_events
      WHERE event_category = 'complaint'
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY event_type
      ORDER BY count DESC
    `);
    
    // Por sucursal
    const byBranch = await pool.query(`
      SELECT 
        COALESCE(branch_id, 'unknown') as branch_id,
        COUNT(*) as count
      FROM conversation_events
      WHERE event_category = 'complaint'
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY branch_id
      ORDER BY count DESC
    `);
    
    // Por día (tendencia)
    const trend = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count
      FROM conversation_events
      WHERE event_category = 'complaint'
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `);
    
    // Ejemplos recientes
    const recent = await pool.query(`
      SELECT 
        event_type, branch_id, message_content, sentiment_score, created_at
      FROM conversation_events
      WHERE event_category = 'complaint'
        AND created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      ORDER BY created_at DESC
      LIMIT 10
    `);
    
    res.json({
      ok: true,
      period_days: parseInt(days),
      total: byType.rows.reduce((sum, r) => sum + parseInt(r.count), 0),
      by_type: byType.rows,
      by_branch: byBranch.rows,
      trend: trend.rows,
      recent_examples: recent.rows,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Complaints insights endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HORARIOS PICO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/peak-hours
 * Análisis de horarios pico
 */
insightsRouter.get("/peak-hours", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { days = 7 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        EXTRACT(DOW FROM created_at) as day_of_week,
        COUNT(*) as messages
      FROM conversation_events
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY EXTRACT(HOUR FROM created_at), EXTRACT(DOW FROM created_at)
      ORDER BY hour, day_of_week
    `);
    
    // Transformar a heatmap
    const heatmap = {};
    const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
    
    for (const row of result.rows) {
      const hour = parseInt(row.hour);
      const day = dayNames[parseInt(row.day_of_week)];
      if (!heatmap[hour]) heatmap[hour] = {};
      heatmap[hour][day] = parseInt(row.messages);
    }
    
    // Top horas
    const hourlyTotals = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as messages
      FROM conversation_events
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY messages DESC
    `);
    
    res.json({
      ok: true,
      period_days: parseInt(days),
      heatmap,
      top_hours: hourlyTotals.rows.slice(0, 5),
      all_hours: hourlyTotals.rows,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Peak hours endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSIONES / ABANDONO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/conversions
 * Análisis de conversión y abandono de pedidos
 */
insightsRouter.get("/conversions", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { days = 30 } = req.query;
    
    const result = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) FILTER (WHERE event_type = 'order_started') as started,
        COUNT(*) FILTER (WHERE event_type = 'order_completed') as completed,
        COUNT(*) FILTER (WHERE event_type = 'order_abandoned') as abandoned,
        COUNT(*) FILTER (WHERE event_type = 'order_cancelled') as cancelled
      FROM conversation_events
      WHERE created_at >= NOW() - INTERVAL '${parseInt(days)} days'
        AND event_type IN ('order_started', 'order_completed', 'order_abandoned', 'order_cancelled')
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    
    // Calcular totales y tasas
    const totals = {
      started: result.rows.reduce((sum, r) => sum + parseInt(r.started || 0), 0),
      completed: result.rows.reduce((sum, r) => sum + parseInt(r.completed || 0), 0),
      abandoned: result.rows.reduce((sum, r) => sum + parseInt(r.abandoned || 0), 0),
      cancelled: result.rows.reduce((sum, r) => sum + parseInt(r.cancelled || 0), 0),
    };
    
    totals.conversionRate = totals.started > 0 
      ? ((totals.completed / totals.started) * 100).toFixed(1) 
      : 0;
    totals.abandonmentRate = totals.started > 0 
      ? ((totals.abandoned / totals.started) * 100).toFixed(1) 
      : 0;
    
    res.json({
      ok: true,
      period_days: parseInt(days),
      totals,
      daily: result.rows,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Conversions endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ALERTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/alerts
 * Lista de alertas
 */
insightsRouter.get("/alerts", async (req, res) => {
  try {
    const alerts = await aggregator.getActiveAlerts();
    res.json({
      ok: true,
      count: alerts.length,
      alerts,
    });
  } catch (error) {
    logger.error({ error: error.message }, "Alerts endpoint failed");
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/alerts/:id/acknowledge
 * Reconocer una alerta
 */
insightsRouter.post("/alerts/:id/acknowledge", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { id } = req.params;
    const { acknowledged_by } = req.body;
    
    await pool.query(`
      UPDATE insights_alerts 
      SET status = 'acknowledged', acknowledged_at = NOW(), acknowledged_by = $2
      WHERE id = $1
    `, [id, acknowledged_by || "system"]);
    
    res.json({ ok: true, message: "Alert acknowledged" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/alerts/:id/resolve
 * Resolver una alerta
 */
insightsRouter.post("/alerts/:id/resolve", async (req, res) => {
  try {
    const pool = getPool();
    if (!pool) {
      return res.status(503).json({ ok: false, error: "Database not available" });
    }
    
    const { id } = req.params;
    const { resolved_by, resolution_notes } = req.body;
    
    await pool.query(`
      UPDATE insights_alerts 
      SET status = 'resolved', resolved_at = NOW(), resolved_by = $2, resolution_notes = $3
      WHERE id = $1
    `, [id, resolved_by || "system", resolution_notes]);
    
    res.json({ ok: true, message: "Alert resolved" });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-APRENDIZAJE / PATRONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/patterns/pending
 * Patrones descubiertos pendientes de aprobación
 */
insightsRouter.get("/patterns/pending", async (req, res) => {
  try {
    const patterns = await discovery.getPendingPatterns();
    res.json({
      ok: true,
      count: patterns.length,
      patterns,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/patterns/:id/approve
 * Aprobar un patrón descubierto
 */
insightsRouter.post("/patterns/:id/approve", async (req, res) => {
  try {
    const { id } = req.params;
    const { approved_by } = req.body;
    
    const result = await discovery.approvePattern(id, approved_by || "api");
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/patterns/:id/reject
 * Rechazar un patrón descubierto
 */
insightsRouter.post("/patterns/:id/reject", async (req, res) => {
  try {
    const { id } = req.params;
    const { rejected_by, reason } = req.body;
    
    const result = await discovery.rejectPattern(id, rejected_by || "api", reason);
    res.json(result);
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE EVENTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /insights/events/catalog
 * Catálogo de tipos de eventos
 */
insightsRouter.get("/events/catalog", (req, res) => {
  res.json({
    ok: true,
    categories: EVENT_CATEGORIES,
    events: EVENT_CATALOG.map(e => ({
      type: e.type,
      category: e.category,
      description: e.description,
      keywords: e.keywords?.slice(0, 5),
    })),
    total: EVENT_CATALOG.length,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN / OPERACIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /insights/admin/aggregate/hourly
 * Forzar agregación horaria
 */
insightsRouter.post("/admin/aggregate/hourly", async (req, res) => {
  try {
    const result = await aggregator.aggregateHourly();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/admin/aggregate/daily
 * Forzar agregación diaria
 */
insightsRouter.post("/admin/aggregate/daily", async (req, res) => {
  try {
    const result = await aggregator.aggregateDaily();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/admin/detect-anomalies
 * Forzar detección de anomalías
 */
insightsRouter.post("/admin/detect-anomalies", async (req, res) => {
  try {
    const alerts = await aggregator.detectAnomalies();
    res.json({ ok: true, alertsGenerated: alerts.length, alerts });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

/**
 * POST /insights/admin/discover-patterns
 * Forzar descubrimiento de patrones
 */
insightsRouter.post("/admin/discover-patterns", async (req, res) => {
  try {
    const result = await discovery.discoverPatterns();
    res.json({ ok: true, result });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

export default insightsRouter;
