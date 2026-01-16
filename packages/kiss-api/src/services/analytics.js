/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ANALYTICS SERVICE - Métricas y conversiones del chatbot
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Trackea eventos clave del chatbot:
 * - Conversaciones iniciadas
 * - Flujos de pedidos iniciados/completados/abandonados
 * - Pagos generados/completados
 * - Handoffs a agentes humanos
 * - Satisfacción del cliente
 * 
 * Los datos se almacenan en Postgres para análisis posterior.
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { getPool } from "../db/repo.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const analyticsConfig = {
  enabled: process.env.ANALYTICS_ENABLED !== "false",
  tableName: "analytics_events",
  metricsTable: "analytics_metrics_daily",
  retentionDays: parseInt(process.env.ANALYTICS_RETENTION_DAYS || "90", 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS DE EVENTOS
// ═══════════════════════════════════════════════════════════════════════════

export const EVENT_TYPES = {
  // Conversaciones
  CONVERSATION_STARTED: "conversation_started",
  CONVERSATION_ENDED: "conversation_ended",
  MESSAGE_RECEIVED: "message_received",
  MESSAGE_SENT: "message_sent",
  
  // Flujos de pedidos
  ORDER_FLOW_STARTED: "order_flow_started",
  ORDER_FLOW_STEP: "order_flow_step",
  ORDER_FLOW_COMPLETED: "order_flow_completed",
  ORDER_FLOW_ABANDONED: "order_flow_abandoned",
  
  // Pagos
  PAYMENT_LINK_CREATED: "payment_link_created",
  PAYMENT_COMPLETED: "payment_completed",
  PAYMENT_FAILED: "payment_failed",
  
  // Handoffs
  HANDOFF_REQUESTED: "handoff_requested",
  HANDOFF_COMPLETED: "handoff_completed",
  
  // Proactive messaging
  PROACTIVE_SENT: "proactive_sent",
  PROACTIVE_RESPONDED: "proactive_responded",
  
  // A/B Testing
  AB_VARIANT_ASSIGNED: "ab_variant_assigned",
  AB_CONVERSION: "ab_conversion",
  
  // Satisfacción
  FEEDBACK_POSITIVE: "feedback_positive",
  FEEDBACK_NEGATIVE: "feedback_negative",
  
  // Errores
  AI_ERROR: "ai_error",
  SYSTEM_ERROR: "system_error",
};

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

let _initialized = false;

async function ensureTables() {
  if (_initialized) return;
  
  const pool = getPool();
  if (!pool) return;
  
  try {
    // Tabla principal de eventos
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${analyticsConfig.tableName} (
        id SERIAL PRIMARY KEY,
        event_type TEXT NOT NULL,
        conversation_id TEXT,
        contact_id TEXT,
        channel TEXT, -- whatsapp, messenger, instagram
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    // Índices para queries comunes
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_type_date 
      ON ${analyticsConfig.tableName}(event_type, created_at DESC)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_conversation 
      ON ${analyticsConfig.tableName}(conversation_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_analytics_created 
      ON ${analyticsConfig.tableName}(created_at DESC)
    `);
    
    // Tabla de métricas diarias (agregadas)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${analyticsConfig.metricsTable} (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        metric_name TEXT NOT NULL,
        channel TEXT,
        value NUMERIC NOT NULL,
        metadata JSONB DEFAULT '{}',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(date, metric_name, channel)
      )
    `);
    
    _initialized = true;
    logger.info("[ANALYTICS] Tables initialized");
    
  } catch (error) {
    logger.error({ err: error.message }, "[ANALYTICS] Failed to initialize tables");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE EVENTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra un evento de analytics
 * 
 * @param {string} eventType - Tipo de evento (usar EVENT_TYPES)
 * @param {Object} data - Datos del evento
 * @param {string} [data.conversationId]
 * @param {string} [data.contactId]
 * @param {string} [data.channel]
 * @param {Object} [data.metadata]
 */
export async function trackEvent(eventType, data = {}) {
  if (!analyticsConfig.enabled) return;
  
  await ensureTables();
  const pool = getPool();
  if (!pool) return;
  
  try {
    await pool.query(`
      INSERT INTO ${analyticsConfig.tableName}
      (event_type, conversation_id, contact_id, channel, metadata)
      VALUES ($1, $2, $3, $4, $5)
    `, [
      eventType,
      data.conversationId || null,
      data.contactId || null,
      data.channel || null,
      JSON.stringify(data.metadata || {}),
    ]);
    
    logger.debug({ eventType, conversationId: data.conversationId }, "[ANALYTICS] Event tracked");
    
  } catch (error) {
    logger.warn({ err: error.message, eventType }, "[ANALYTICS] Failed to track event");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS PARA EVENTOS COMUNES
// ═══════════════════════════════════════════════════════════════════════════

export async function trackConversationStarted(conversationId, channel, contactId) {
  return trackEvent(EVENT_TYPES.CONVERSATION_STARTED, {
    conversationId,
    contactId,
    channel,
  });
}

export async function trackOrderFlowStarted(conversationId, channel) {
  return trackEvent(EVENT_TYPES.ORDER_FLOW_STARTED, {
    conversationId,
    channel,
    metadata: { step: "init" },
  });
}

export async function trackOrderFlowStep(conversationId, step, draftSummary = {}) {
  return trackEvent(EVENT_TYPES.ORDER_FLOW_STEP, {
    conversationId,
    metadata: { step, draft: draftSummary },
  });
}

export async function trackOrderFlowCompleted(conversationId, orderData = {}) {
  return trackEvent(EVENT_TYPES.ORDER_FLOW_COMPLETED, {
    conversationId,
    metadata: {
      orderId: orderData.orderId,
      amount: orderData.amount,
      items: orderData.items,
      branch: orderData.branch,
    },
  });
}

export async function trackOrderFlowAbandoned(conversationId, lastStep, draft = {}) {
  return trackEvent(EVENT_TYPES.ORDER_FLOW_ABANDONED, {
    conversationId,
    metadata: { lastStep, draft },
  });
}

export async function trackPaymentLinkCreated(conversationId, paymentData = {}) {
  return trackEvent(EVENT_TYPES.PAYMENT_LINK_CREATED, {
    conversationId,
    metadata: {
      provider: paymentData.provider,
      amount: paymentData.amount,
      orderId: paymentData.orderId,
    },
  });
}

export async function trackPaymentCompleted(conversationId, paymentData = {}) {
  return trackEvent(EVENT_TYPES.PAYMENT_COMPLETED, {
    conversationId,
    metadata: {
      provider: paymentData.provider,
      amount: paymentData.amount,
      orderId: paymentData.orderId,
      paymentId: paymentData.paymentId,
    },
  });
}

export async function trackHandoffRequested(conversationId, reason) {
  return trackEvent(EVENT_TYPES.HANDOFF_REQUESTED, {
    conversationId,
    metadata: { reason },
  });
}

export async function trackABVariantAssigned(conversationId, experimentId, variant) {
  return trackEvent(EVENT_TYPES.AB_VARIANT_ASSIGNED, {
    conversationId,
    metadata: { experimentId, variant },
  });
}

export async function trackABConversion(conversationId, experimentId, variant, conversionData = {}) {
  return trackEvent(EVENT_TYPES.AB_CONVERSION, {
    conversationId,
    metadata: { experimentId, variant, ...conversionData },
  });
}

export async function trackFeedback(conversationId, isPositive, comment = null) {
  return trackEvent(
    isPositive ? EVENT_TYPES.FEEDBACK_POSITIVE : EVENT_TYPES.FEEDBACK_NEGATIVE,
    {
      conversationId,
      metadata: { comment },
    }
  );
}

export async function trackError(conversationId, errorType, errorMessage) {
  return trackEvent(
    errorType === "ai" ? EVENT_TYPES.AI_ERROR : EVENT_TYPES.SYSTEM_ERROR,
    {
      conversationId,
      metadata: { errorType, errorMessage },
    }
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS AGREGADAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Actualiza una métrica diaria (upsert)
 */
export async function updateDailyMetric(metricName, value, channel = null, metadata = {}) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return;
  
  const today = new Date().toISOString().split("T")[0];
  
  try {
    await pool.query(`
      INSERT INTO ${analyticsConfig.metricsTable}
      (date, metric_name, channel, value, metadata)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (date, metric_name, channel) 
      DO UPDATE SET 
        value = ${analyticsConfig.metricsTable}.value + $4,
        updated_at = NOW()
    `, [today, metricName, channel, value, JSON.stringify(metadata)]);
    
  } catch (error) {
    logger.warn({ err: error.message, metricName }, "[ANALYTICS] Failed to update metric");
  }
}

/**
 * Incrementa un contador diario
 */
export async function incrementMetric(metricName, channel = null) {
  return updateDailyMetric(metricName, 1, channel);
}

// ═══════════════════════════════════════════════════════════════════════════
// QUERIES DE ANÁLISIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene conteo de eventos por tipo en un rango de fechas
 */
export async function getEventCounts(startDate, endDate, channel = null) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return {};
  
  try {
    let query = `
      SELECT event_type, COUNT(*) as count
      FROM ${analyticsConfig.tableName}
      WHERE created_at >= $1 AND created_at < $2
    `;
    const params = [startDate, endDate];
    
    if (channel) {
      query += ` AND channel = $3`;
      params.push(channel);
    }
    
    query += ` GROUP BY event_type ORDER BY count DESC`;
    
    const result = await pool.query(query, params);
    
    const counts = {};
    for (const row of result.rows) {
      counts[row.event_type] = parseInt(row.count);
    }
    
    return counts;
    
  } catch (error) {
    logger.error({ err: error.message }, "[ANALYTICS] Failed to get event counts");
    return {};
  }
}

/**
 * Calcula tasa de conversión de pedidos
 */
export async function getOrderConversionRate(startDate, endDate, channel = null) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return null;
  
  try {
    let baseQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'order_flow_started') as started,
        COUNT(*) FILTER (WHERE event_type = 'order_flow_completed') as completed,
        COUNT(*) FILTER (WHERE event_type = 'order_flow_abandoned') as abandoned
      FROM ${analyticsConfig.tableName}
      WHERE created_at >= $1 AND created_at < $2
    `;
    const params = [startDate, endDate];
    
    if (channel) {
      baseQuery += ` AND channel = $3`;
      params.push(channel);
    }
    
    const result = await pool.query(baseQuery, params);
    const row = result.rows[0];
    
    const started = parseInt(row.started) || 0;
    const completed = parseInt(row.completed) || 0;
    const abandoned = parseInt(row.abandoned) || 0;
    
    return {
      started,
      completed,
      abandoned,
      conversionRate: started > 0 ? ((completed / started) * 100).toFixed(2) : 0,
      abandonmentRate: started > 0 ? ((abandoned / started) * 100).toFixed(2) : 0,
    };
    
  } catch (error) {
    logger.error({ err: error.message }, "[ANALYTICS] Failed to get conversion rate");
    return null;
  }
}

/**
 * Obtiene resumen de pagos
 */
export async function getPaymentsSummary(startDate, endDate) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return null;
  
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE event_type = 'payment_link_created') as links_created,
        COUNT(*) FILTER (WHERE event_type = 'payment_completed') as payments_completed,
        COUNT(*) FILTER (WHERE event_type = 'payment_failed') as payments_failed,
        SUM(
          CASE WHEN event_type = 'payment_completed' 
          THEN (metadata->>'amount')::numeric 
          ELSE 0 END
        ) as total_revenue
      FROM ${analyticsConfig.tableName}
      WHERE created_at >= $1 AND created_at < $2
    `, [startDate, endDate]);
    
    const row = result.rows[0];
    
    return {
      linksCreated: parseInt(row.links_created) || 0,
      paymentsCompleted: parseInt(row.payments_completed) || 0,
      paymentsFailed: parseInt(row.payments_failed) || 0,
      totalRevenue: parseFloat(row.total_revenue) || 0,
      conversionRate: row.links_created > 0 
        ? ((row.payments_completed / row.links_created) * 100).toFixed(2) 
        : 0,
    };
    
  } catch (error) {
    logger.error({ err: error.message }, "[ANALYTICS] Failed to get payments summary");
    return null;
  }
}

/**
 * Obtiene métricas diarias agregadas
 */
export async function getDailyMetrics(startDate, endDate, metricNames = []) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return [];
  
  try {
    let query = `
      SELECT date, metric_name, channel, value
      FROM ${analyticsConfig.metricsTable}
      WHERE date >= $1 AND date <= $2
    `;
    const params = [startDate, endDate];
    
    if (metricNames.length > 0) {
      query += ` AND metric_name = ANY($3)`;
      params.push(metricNames);
    }
    
    query += ` ORDER BY date DESC, metric_name`;
    
    const result = await pool.query(query, params);
    return result.rows;
    
  } catch (error) {
    logger.error({ err: error.message }, "[ANALYTICS] Failed to get daily metrics");
    return [];
  }
}

/**
 * Genera resumen de dashboard
 */
export async function getDashboardSummary(daysBack = 7) {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - daysBack);
  
  const [eventCounts, orderConversion, paymentsSummary] = await Promise.all([
    getEventCounts(startDate, endDate),
    getOrderConversionRate(startDate, endDate),
    getPaymentsSummary(startDate, endDate),
  ]);
  
  return {
    period: {
      start: startDate.toISOString().split("T")[0],
      end: endDate.toISOString().split("T")[0],
      days: daysBack,
    },
    conversations: {
      started: eventCounts[EVENT_TYPES.CONVERSATION_STARTED] || 0,
      messages: (eventCounts[EVENT_TYPES.MESSAGE_RECEIVED] || 0) + 
                (eventCounts[EVENT_TYPES.MESSAGE_SENT] || 0),
    },
    orders: orderConversion,
    payments: paymentsSummary,
    handoffs: {
      requested: eventCounts[EVENT_TYPES.HANDOFF_REQUESTED] || 0,
      completed: eventCounts[EVENT_TYPES.HANDOFF_COMPLETED] || 0,
    },
    proactive: {
      sent: eventCounts[EVENT_TYPES.PROACTIVE_SENT] || 0,
      responded: eventCounts[EVENT_TYPES.PROACTIVE_RESPONDED] || 0,
    },
    feedback: {
      positive: eventCounts[EVENT_TYPES.FEEDBACK_POSITIVE] || 0,
      negative: eventCounts[EVENT_TYPES.FEEDBACK_NEGATIVE] || 0,
    },
    errors: {
      ai: eventCounts[EVENT_TYPES.AI_ERROR] || 0,
      system: eventCounts[EVENT_TYPES.SYSTEM_ERROR] || 0,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// LIMPIEZA DE DATOS ANTIGUOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Elimina eventos más antiguos que retentionDays
 */
export async function cleanupOldEvents() {
  await ensureTables();
  const pool = getPool();
  if (!pool) return 0;
  
  try {
    const result = await pool.query(`
      DELETE FROM ${analyticsConfig.tableName}
      WHERE created_at < NOW() - INTERVAL '${analyticsConfig.retentionDays} days'
    `);
    
    const deleted = result.rowCount;
    if (deleted > 0) {
      logger.info({ deleted, retentionDays: analyticsConfig.retentionDays }, "[ANALYTICS] Cleaned up old events");
    }
    
    return deleted;
    
  } catch (error) {
    logger.error({ err: error.message }, "[ANALYTICS] Failed to cleanup old events");
    return 0;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

export function isEnabled() {
  return analyticsConfig.enabled;
}

export function getConfig() {
  return {
    enabled: analyticsConfig.enabled,
    retentionDays: analyticsConfig.retentionDays,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION LOG
// ═══════════════════════════════════════════════════════════════════════════

logger.info(`[ANALYTICS] ✓ Service initialized`, {
  enabled: analyticsConfig.enabled,
  retentionDays: analyticsConfig.retentionDays,
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const analyticsService = {
  // Core
  trackEvent,
  EVENT_TYPES,
  
  // Helpers
  trackConversationStarted,
  trackOrderFlowStarted,
  trackOrderFlowStep,
  trackOrderFlowCompleted,
  trackOrderFlowAbandoned,
  trackPaymentLinkCreated,
  trackPaymentCompleted,
  trackHandoffRequested,
  trackABVariantAssigned,
  trackABConversion,
  trackFeedback,
  trackError,
  
  // Metrics
  updateDailyMetric,
  incrementMetric,
  
  // Analysis
  getEventCounts,
  getOrderConversionRate,
  getPaymentsSummary,
  getDailyMetrics,
  getDashboardSummary,
  
  // Maintenance
  cleanupOldEvents,
  
  // Config
  isEnabled,
  getConfig,
};

export default analyticsService;
