/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INSIGHTS ENGINE - Aggregator v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Agrega eventos en métricas útiles:
 * - Cada hora: para dashboards en tiempo real
 * - Cada día: para reportes diarios
 * - Cada semana: para tendencias
 * 
 * También detecta anomalías y genera alertas.
 * 
 * @version 1.0.0
 */

import { logger } from "../../utils/logger.js";
import { getPool } from "../../db/repo.js";

// ═══════════════════════════════════════════════════════════════════════════
// AGREGACIÓN POR HORA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrega eventos de la última hora
 * Diseñado para correr cada hora (cron: 0 * * * *)
 */
export async function aggregateHourly() {
  const pool = getPool();
  if (!pool) {
    logger.warn("No DB pool available for hourly aggregation");
    return null;
  }
  
  const startTime = Date.now();
  
  try {
    // Obtener hora a agregar (hora anterior completa)
    const hourStart = new Date();
    hourStart.setMinutes(0, 0, 0);
    hourStart.setHours(hourStart.getHours() - 1);
    
    const hourEnd = new Date(hourStart);
    hourEnd.setHours(hourEnd.getHours() + 1);
    
    logger.info({ hourStart, hourEnd }, "Starting hourly aggregation");
    
    // Agregar por canal y sucursal
    const result = await pool.query(`
      WITH hourly_events AS (
        SELECT * FROM conversation_events
        WHERE created_at >= $1 AND created_at < $2
      ),
      aggregated AS (
        SELECT
          COALESCE(channel, 'unknown') as channel,
          COALESCE(branch_id, 'unknown') as branch_id,
          COUNT(*) as total_messages,
          COUNT(DISTINCT conversation_id) as total_conversations,
          COUNT(DISTINCT contact_id) as unique_contacts,
          
          -- Por categoría
          jsonb_object_agg(
            COALESCE(category_counts.event_category, 'unknown'),
            category_counts.category_count
          ) FILTER (WHERE category_counts.event_category IS NOT NULL) as events_by_category,
          
          -- Sentimiento
          COUNT(*) FILTER (WHERE sentiment = 'positive') as sentiment_positive,
          COUNT(*) FILTER (WHERE sentiment = 'neutral') as sentiment_neutral,
          COUNT(*) FILTER (WHERE sentiment = 'negative') as sentiment_negative,
          AVG(sentiment_score) as avg_sentiment_score,
          
          -- Operacional
          AVG(response_time_seconds) FILTER (WHERE response_time_seconds IS NOT NULL) as avg_response_time_seconds,
          COUNT(*) FILTER (WHERE was_resolved = true AND required_human = false) as resolved_by_bot,
          COUNT(*) FILTER (WHERE required_human = true) as escalated_to_human
          
        FROM hourly_events
        CROSS JOIN LATERAL (
          SELECT event_category, COUNT(*) as category_count
          FROM hourly_events he2
          WHERE he2.channel = hourly_events.channel 
            AND COALESCE(he2.branch_id, 'unknown') = COALESCE(hourly_events.branch_id, 'unknown')
          GROUP BY event_category
        ) category_counts
        GROUP BY channel, branch_id
      )
      INSERT INTO insights_hourly (
        hour_start, channel, branch_id,
        total_messages, total_conversations, unique_contacts,
        events_by_category,
        sentiment_positive, sentiment_neutral, sentiment_negative, avg_sentiment_score,
        avg_response_time_seconds, resolved_by_bot, escalated_to_human
      )
      SELECT
        $1::timestamptz as hour_start,
        channel, branch_id,
        total_messages, total_conversations, unique_contacts,
        COALESCE(events_by_category, '{}'::jsonb),
        sentiment_positive, sentiment_neutral, sentiment_negative, avg_sentiment_score,
        avg_response_time_seconds::integer, resolved_by_bot, escalated_to_human
      FROM aggregated
      ON CONFLICT (hour_start, channel, branch_id) DO UPDATE SET
        total_messages = EXCLUDED.total_messages,
        total_conversations = EXCLUDED.total_conversations,
        unique_contacts = EXCLUDED.unique_contacts,
        events_by_category = EXCLUDED.events_by_category,
        sentiment_positive = EXCLUDED.sentiment_positive,
        sentiment_neutral = EXCLUDED.sentiment_neutral,
        sentiment_negative = EXCLUDED.sentiment_negative,
        avg_sentiment_score = EXCLUDED.avg_sentiment_score,
        avg_response_time_seconds = EXCLUDED.avg_response_time_seconds,
        resolved_by_bot = EXCLUDED.resolved_by_bot,
        escalated_to_human = EXCLUDED.escalated_to_human
      RETURNING *
    `, [hourStart, hourEnd]);
    
    // Calcular top productos de la hora
    await aggregateTopProducts(pool, hourStart, hourEnd, "hourly");
    
    const processingTime = Date.now() - startTime;
    logger.info({ 
      hourStart, 
      rowsAggregated: result.rowCount,
      processingTimeMs: processingTime 
    }, "Hourly aggregation completed");
    
    return {
      hourStart,
      rowsAggregated: result.rowCount,
      processingTimeMs: processingTime,
    };
  } catch (error) {
    logger.error({ error: error.message }, "Hourly aggregation failed");
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// AGREGACIÓN DIARIA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrega eventos del día anterior
 * Diseñado para correr diario (cron: 0 3 * * *)
 */
export async function aggregateDaily() {
  const pool = getPool();
  if (!pool) {
    logger.warn("No DB pool available for daily aggregation");
    return null;
  }
  
  const startTime = Date.now();
  
  try {
    // Día anterior
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() - 1);
    const dateStr = targetDate.toISOString().split("T")[0];
    
    const dayStart = new Date(dateStr + "T00:00:00Z");
    const dayEnd = new Date(dateStr + "T23:59:59Z");
    
    logger.info({ date: dateStr }, "Starting daily aggregation");
    
    // Agregación principal
    const result = await pool.query(`
      WITH daily_events AS (
        SELECT * FROM conversation_events
        WHERE created_at >= $1 AND created_at < $2
      ),
      order_stats AS (
        SELECT
          channel,
          branch_id,
          COUNT(*) FILTER (WHERE event_type = 'order_started') as orders_started,
          COUNT(*) FILTER (WHERE event_type = 'order_completed') as orders_completed,
          COUNT(*) FILTER (WHERE event_type = 'order_abandoned') as orders_abandoned,
          COUNT(*) FILTER (WHERE event_type = 'order_cancelled') as orders_cancelled
        FROM daily_events
        GROUP BY channel, branch_id
      ),
      complaint_stats AS (
        SELECT
          channel,
          branch_id,
          COUNT(*) as complaints_total,
          jsonb_object_agg(event_type, cnt) as complaints_by_type
        FROM (
          SELECT channel, branch_id, event_type, COUNT(*) as cnt
          FROM daily_events
          WHERE event_category = 'complaint'
          GROUP BY channel, branch_id, event_type
        ) sub
        GROUP BY channel, branch_id
      ),
      contact_stats AS (
        SELECT
          channel,
          branch_id,
          COUNT(DISTINCT contact_id) as unique_contacts
        FROM daily_events
        GROUP BY channel, branch_id
      )
      INSERT INTO insights_daily (
        date, channel, branch_id,
        total_messages, total_conversations, unique_contacts,
        orders_started, orders_completed, orders_abandoned, orders_cancelled,
        conversion_rate, abandonment_rate,
        complaints_total, complaints_by_type,
        avg_sentiment_score,
        resolved_by_bot, escalated_to_human, bot_effectiveness
      )
      SELECT
        $3::date as date,
        COALESCE(de.channel, 'unknown') as channel,
        COALESCE(de.branch_id, 'unknown') as branch_id,
        COUNT(*) as total_messages,
        COUNT(DISTINCT de.conversation_id) as total_conversations,
        COALESCE(cs.unique_contacts, 0) as unique_contacts,
        COALESCE(os.orders_started, 0) as orders_started,
        COALESCE(os.orders_completed, 0) as orders_completed,
        COALESCE(os.orders_abandoned, 0) as orders_abandoned,
        COALESCE(os.orders_cancelled, 0) as orders_cancelled,
        CASE WHEN COALESCE(os.orders_started, 0) > 0 
          THEN (COALESCE(os.orders_completed, 0)::decimal / os.orders_started * 100)
          ELSE 0 
        END as conversion_rate,
        CASE WHEN COALESCE(os.orders_started, 0) > 0 
          THEN (COALESCE(os.orders_abandoned, 0)::decimal / os.orders_started * 100)
          ELSE 0 
        END as abandonment_rate,
        COALESCE(cmp.complaints_total, 0) as complaints_total,
        COALESCE(cmp.complaints_by_type, '{}'::jsonb) as complaints_by_type,
        AVG(de.sentiment_score) as avg_sentiment_score,
        COUNT(*) FILTER (WHERE de.was_resolved = true AND de.required_human = false) as resolved_by_bot,
        COUNT(*) FILTER (WHERE de.required_human = true) as escalated_to_human,
        CASE WHEN COUNT(*) FILTER (WHERE de.was_resolved = true) > 0
          THEN (COUNT(*) FILTER (WHERE de.was_resolved = true AND de.required_human = false)::decimal / 
                COUNT(*) FILTER (WHERE de.was_resolved = true) * 100)
          ELSE 0
        END as bot_effectiveness
      FROM daily_events de
      LEFT JOIN order_stats os ON de.channel = os.channel AND de.branch_id = os.branch_id
      LEFT JOIN complaint_stats cmp ON de.channel = cmp.channel AND de.branch_id = cmp.branch_id
      LEFT JOIN contact_stats cs ON de.channel = cs.channel AND de.branch_id = cs.branch_id
      GROUP BY de.channel, de.branch_id, os.orders_started, os.orders_completed, 
               os.orders_abandoned, os.orders_cancelled, cmp.complaints_total, 
               cmp.complaints_by_type, cs.unique_contacts
      ON CONFLICT (date, channel, branch_id) DO UPDATE SET
        total_messages = EXCLUDED.total_messages,
        total_conversations = EXCLUDED.total_conversations,
        unique_contacts = EXCLUDED.unique_contacts,
        orders_started = EXCLUDED.orders_started,
        orders_completed = EXCLUDED.orders_completed,
        orders_abandoned = EXCLUDED.orders_abandoned,
        orders_cancelled = EXCLUDED.orders_cancelled,
        conversion_rate = EXCLUDED.conversion_rate,
        abandonment_rate = EXCLUDED.abandonment_rate,
        complaints_total = EXCLUDED.complaints_total,
        complaints_by_type = EXCLUDED.complaints_by_type,
        avg_sentiment_score = EXCLUDED.avg_sentiment_score,
        resolved_by_bot = EXCLUDED.resolved_by_bot,
        escalated_to_human = EXCLUDED.escalated_to_human,
        bot_effectiveness = EXCLUDED.bot_effectiveness
      RETURNING *
    `, [dayStart, dayEnd, dateStr]);
    
    // Calcular top productos del día
    await aggregateTopProducts(pool, dayStart, dayEnd, "daily", dateStr);
    
    // Calcular horarios pico
    await aggregatePeakHours(pool, dayStart, dayEnd, dateStr);
    
    // Calcular top eventos
    await aggregateTopEvents(pool, dayStart, dayEnd, dateStr);
    
    const processingTime = Date.now() - startTime;
    logger.info({ 
      date: dateStr, 
      rowsAggregated: result.rowCount,
      processingTimeMs: processingTime 
    }, "Daily aggregation completed");
    
    return {
      date: dateStr,
      rowsAggregated: result.rowCount,
      processingTimeMs: processingTime,
    };
  } catch (error) {
    logger.error({ error: error.message }, "Daily aggregation failed");
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES AUXILIARES DE AGREGACIÓN
// ═══════════════════════════════════════════════════════════════════════════

async function aggregateTopProducts(pool, startTime, endTime, period, dateStr = null) {
  try {
    const result = await pool.query(`
      SELECT 
        product,
        COUNT(*) as mentions
      FROM conversation_events,
           jsonb_array_elements_text(entities->'products') as product
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY product
      ORDER BY mentions DESC
      LIMIT 10
    `, [startTime, endTime]);
    
    const topProducts = result.rows.map(r => ({
      product: r.product,
      count: parseInt(r.mentions, 10)
    }));
    
    // Actualizar en la tabla correspondiente
    if (period === "daily" && dateStr) {
      await pool.query(`
        UPDATE insights_daily 
        SET top_products_inquired = $1
        WHERE date = $2
      `, [JSON.stringify(topProducts), dateStr]);
    }
    
    return topProducts;
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to aggregate top products");
    return [];
  }
}

async function aggregatePeakHours(pool, startTime, endTime, dateStr) {
  try {
    const result = await pool.query(`
      SELECT 
        EXTRACT(HOUR FROM created_at) as hour,
        COUNT(*) as messages
      FROM conversation_events
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY EXTRACT(HOUR FROM created_at)
      ORDER BY messages DESC
    `, [startTime, endTime]);
    
    const peakHours = result.rows.map(r => ({
      hour: parseInt(r.hour, 10),
      messages: parseInt(r.messages, 10)
    }));
    
    await pool.query(`
      UPDATE insights_daily 
      SET peak_hours = $1
      WHERE date = $2
    `, [JSON.stringify(peakHours), dateStr]);
    
    return peakHours;
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to aggregate peak hours");
    return [];
  }
}

async function aggregateTopEvents(pool, startTime, endTime, dateStr) {
  try {
    const result = await pool.query(`
      SELECT 
        event_type,
        event_category,
        COUNT(*) as count
      FROM conversation_events
      WHERE created_at >= $1 AND created_at < $2
        AND event_type != 'unknown'
      GROUP BY event_type, event_category
      ORDER BY count DESC
      LIMIT 20
    `, [startTime, endTime]);
    
    const topEvents = result.rows.map(r => ({
      type: r.event_type,
      category: r.event_category,
      count: parseInt(r.count, 10)
    }));
    
    await pool.query(`
      UPDATE insights_daily 
      SET top_events = $1
      WHERE date = $2
    `, [JSON.stringify(topEvents), dateStr]);
    
    return topEvents;
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to aggregate top events");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECCIÓN DE ANOMALÍAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta anomalías comparando con histórico
 * Genera alertas si encuentra problemas
 */
export async function detectAnomalies() {
  const pool = getPool();
  if (!pool) return [];
  
  const alerts = [];
  
  try {
    // 1. Detectar pico de quejas
    const complaintSpike = await pool.query(`SELECT * FROM check_complaint_spike(50)`);
    for (const row of complaintSpike.rows) {
      alerts.push({
        type: "complaint_spike",
        severity: row.increase_pct > 100 ? "high" : "medium",
        branchId: row.branch_id,
        title: `Pico de quejas en ${row.branch_id || 'general'}`,
        message: `${row.today_complaints} quejas hoy vs promedio de ${parseFloat(row.avg_complaints).toFixed(1)} (+${parseFloat(row.increase_pct).toFixed(0)}%)`,
        data: row,
      });
    }
    
    // 2. Detectar caída de sentimiento
    const sentimentDrop = await pool.query(`
      WITH today_sentiment AS (
        SELECT AVG(sentiment_score) as avg_score
        FROM conversation_events
        WHERE created_at >= CURRENT_DATE
      ),
      historical_sentiment AS (
        SELECT AVG(avg_sentiment_score) as avg_score
        FROM insights_daily
        WHERE date >= CURRENT_DATE - INTERVAL '7 days'
          AND date < CURRENT_DATE
      )
      SELECT 
        t.avg_score as today_score,
        h.avg_score as historical_score,
        ((t.avg_score - h.avg_score) / NULLIF(ABS(h.avg_score), 0) * 100) as change_pct
      FROM today_sentiment t, historical_sentiment h
      WHERE h.avg_score IS NOT NULL
        AND ((t.avg_score - h.avg_score) / NULLIF(ABS(h.avg_score), 0) * 100) < -20
    `);
    
    for (const row of sentimentDrop.rows) {
      alerts.push({
        type: "sentiment_drop",
        severity: parseFloat(row.change_pct) < -40 ? "high" : "medium",
        title: "Caída en sentimiento de clientes",
        message: `Sentimiento promedio: ${parseFloat(row.today_score).toFixed(2)} vs histórico ${parseFloat(row.historical_score).toFixed(2)} (${parseFloat(row.change_pct).toFixed(0)}%)`,
        data: row,
      });
    }
    
    // 3. Detectar productos agotados recurrentes
    const stockoutTrend = await pool.query(`
      SELECT 
        entities->>'product' as product,
        COUNT(*) as stockout_mentions
      FROM conversation_events
      WHERE event_type = 'product_unavailable'
        AND created_at >= CURRENT_DATE - INTERVAL '3 days'
      GROUP BY entities->>'product'
      HAVING COUNT(*) >= 3
    `);
    
    for (const row of stockoutTrend.rows) {
      alerts.push({
        type: "product_stockout_trend",
        severity: "medium",
        title: `Producto frecuentemente agotado: ${row.product}`,
        message: `${row.stockout_mentions} menciones de falta de stock en 3 días`,
        data: row,
      });
    }
    
    // Guardar alertas
    for (const alert of alerts) {
      await saveAlert(pool, alert);
    }
    
    logger.info({ alertsGenerated: alerts.length }, "Anomaly detection completed");
    return alerts;
    
  } catch (error) {
    logger.error({ error: error.message }, "Anomaly detection failed");
    return [];
  }
}

async function saveAlert(pool, alert) {
  try {
    await pool.query(`
      INSERT INTO insights_alerts (
        alert_type, severity, branch_id, channel,
        title, message, data
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      alert.type,
      alert.severity,
      alert.branchId || null,
      alert.channel || null,
      alert.title,
      alert.message,
      JSON.stringify(alert.data || {}),
    ]);
  } catch (error) {
    logger.warn({ error: error.message, alert: alert.type }, "Failed to save alert");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES ÚTILES PARA API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene resumen del día actual
 */
export async function getTodaySummary() {
  const pool = getPool();
  if (!pool) return null;
  
  try {
    const result = await pool.query(`SELECT * FROM get_today_summary()`);
    return result.rows[0] || null;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get today summary");
    return null;
  }
}

/**
 * Obtiene insights diarios para un rango de fechas
 */
export async function getDailyInsights(startDate, endDate, branchId = null) {
  const pool = getPool();
  if (!pool) return [];
  
  try {
    let query = `
      SELECT * FROM insights_daily
      WHERE date >= $1 AND date <= $2
    `;
    const params = [startDate, endDate];
    
    if (branchId) {
      query += ` AND branch_id = $3`;
      params.push(branchId);
    }
    
    query += ` ORDER BY date DESC`;
    
    const result = await pool.query(query, params);
    return result.rows;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get daily insights");
    return [];
  }
}

/**
 * Obtiene alertas activas
 */
export async function getActiveAlerts() {
  const pool = getPool();
  if (!pool) return [];
  
  try {
    const result = await pool.query(`
      SELECT * FROM insights_alerts
      WHERE status = 'active'
      ORDER BY 
        CASE severity 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END,
        created_at DESC
    `);
    return result.rows;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get active alerts");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  aggregateHourly,
  aggregateDaily,
  detectAnomalies,
  getTodaySummary,
  getDailyInsights,
  getActiveAlerts,
};
