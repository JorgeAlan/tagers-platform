/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INSIGHTS ENGINE - Main Entry Point v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Motor de análisis de conversaciones para Tagers.
 * 
 * Componentes:
 * - Event Extractor: Clasifica mensajes en tiempo real
 * - Aggregator: Resume métricas por hora/día/semana
 * - Pattern Discovery: Auto-aprende nuevos tipos de eventos
 * - Alerts: Detecta anomalías y notifica
 * - API: Endpoints para dashboards
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { getPool } from "../db/repo.js";

// Importar componentes
import eventExtractor from "./extractors/eventExtractor.js";
import aggregator from "./aggregators/insightsAggregator.js";
import patternDiscovery from "./discovery/patternDiscovery.js";
import { insightsRouter } from "./api/routes.js";
import { EVENT_CATALOG, EVENT_CATEGORIES } from "./eventCatalog.js";

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════════

let isInitialized = false;
let cronJobs = {
  hourly: null,
  daily: null,
  anomaly: null,
  discovery: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa el motor de insights
 * 
 * @param {Object} options
 * @param {Object} options.openaiClient - Cliente OpenAI para clasificación AI
 * @param {boolean} options.startCronJobs - Iniciar cron jobs automáticamente
 */
export async function initInsightsEngine(options = {}) {
  if (isInitialized) {
    logger.warn("Insights engine already initialized");
    return { ok: true, message: "Already initialized" };
  }
  
  logger.info("Initializing Insights Engine...");
  
  try {
    // 1. Verificar DB
    const pool = getPool();
    if (!pool) {
      logger.warn("No database pool - Insights Engine will be limited");
    }
    
    // 2. Configurar cliente OpenAI
    if (options.openaiClient) {
      eventExtractor.setOpenAIClient(options.openaiClient);
      patternDiscovery.setOpenAIClient(options.openaiClient);
      logger.info("OpenAI client configured for AI classification");
    }
    
    // 3. Inicializar tablas si no existen
    if (pool) {
      await initTables(pool);
    }
    
    // 4. Iniciar cron jobs si se solicita
    if (options.startCronJobs !== false) {
      startCronJobs();
    }
    
    isInitialized = true;
    logger.info("✅ Insights Engine initialized successfully");
    
    return { ok: true };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to initialize Insights Engine");
    return { ok: false, error: error.message };
  }
}

async function initTables(pool) {
  try {
    // Verificar si las tablas existen
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'conversation_events'
      )
    `);
    
    if (!tableCheck.rows[0].exists) {
      logger.info("Insights tables not found - creating automatically...");
      await createInsightsTables(pool);
    } else {
      logger.info("Insights tables already exist");
    }
  } catch (error) {
    logger.warn({ error: error.message }, "Could not verify insights tables");
  }
}

/**
 * Crea todas las tablas del motor de insights automáticamente
 */
async function createInsightsTables(pool) {
  const tables = [
    // conversation_events
    `CREATE TABLE IF NOT EXISTS conversation_events (
      id SERIAL PRIMARY KEY,
      conversation_id VARCHAR(100) NOT NULL,
      message_id VARCHAR(100),
      contact_id VARCHAR(100),
      channel VARCHAR(20) NOT NULL,
      branch_id VARCHAR(50),
      branch_name VARCHAR(100),
      event_type VARCHAR(100) NOT NULL,
      event_category VARCHAR(50) NOT NULL,
      confidence DECIMAL(3,2) DEFAULT 0.0,
      sentiment VARCHAR(20),
      sentiment_score DECIMAL(3,2),
      frustration_level INTEGER DEFAULT 0,
      urgency_level INTEGER DEFAULT 0,
      entities JSONB DEFAULT '{}',
      message_content TEXT,
      message_direction VARCHAR(10) DEFAULT 'incoming',
      was_resolved BOOLEAN DEFAULT FALSE,
      required_human BOOLEAN DEFAULT FALSE,
      response_time_seconds INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    
    // event_types_catalog
    `CREATE TABLE IF NOT EXISTS event_types_catalog (
      id SERIAL PRIMARY KEY,
      event_type VARCHAR(100) UNIQUE NOT NULL,
      category VARCHAR(50) NOT NULL,
      description TEXT,
      keywords TEXT[],
      examples TEXT[],
      is_enabled BOOLEAN DEFAULT TRUE,
      is_auto_discovered BOOLEAN DEFAULT FALSE,
      discovery_count INTEGER DEFAULT 0,
      approved_at TIMESTAMPTZ,
      approved_by VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    
    // unclassified_messages
    `CREATE TABLE IF NOT EXISTS unclassified_messages (
      id SERIAL PRIMARY KEY,
      conversation_id VARCHAR(100),
      message_content TEXT NOT NULL,
      channel VARCHAR(20),
      branch_id VARCHAR(50),
      embedding VECTOR(1536),
      cluster_id INTEGER,
      status VARCHAR(20) DEFAULT 'pending',
      proposed_event_type VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      processed_at TIMESTAMPTZ
    )`,
    
    // discovered_patterns
    `CREATE TABLE IF NOT EXISTS discovered_patterns (
      id SERIAL PRIMARY KEY,
      proposed_event_type VARCHAR(100) NOT NULL,
      proposed_category VARCHAR(50),
      proposed_description TEXT,
      sample_messages TEXT[],
      message_count INTEGER NOT NULL,
      common_keywords TEXT[],
      status VARCHAR(20) DEFAULT 'pending',
      reviewed_at TIMESTAMPTZ,
      reviewed_by VARCHAR(100),
      merged_into VARCHAR(100),
      discovered_at TIMESTAMPTZ DEFAULT NOW(),
      confidence_score DECIMAL(3,2)
    )`,
    
    // insights_hourly
    `CREATE TABLE IF NOT EXISTS insights_hourly (
      id SERIAL PRIMARY KEY,
      hour_start TIMESTAMPTZ NOT NULL,
      channel VARCHAR(20),
      branch_id VARCHAR(50),
      total_messages INTEGER DEFAULT 0,
      total_conversations INTEGER DEFAULT 0,
      unique_contacts INTEGER DEFAULT 0,
      events_by_category JSONB DEFAULT '{}',
      events_by_type JSONB DEFAULT '{}',
      sentiment_positive INTEGER DEFAULT 0,
      sentiment_neutral INTEGER DEFAULT 0,
      sentiment_negative INTEGER DEFAULT 0,
      avg_sentiment_score DECIMAL(4,3),
      avg_response_time_seconds INTEGER,
      resolved_by_bot INTEGER DEFAULT 0,
      escalated_to_human INTEGER DEFAULT 0,
      top_products JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(hour_start, channel, branch_id)
    )`,
    
    // insights_daily
    `CREATE TABLE IF NOT EXISTS insights_daily (
      id SERIAL PRIMARY KEY,
      date DATE NOT NULL,
      channel VARCHAR(20),
      branch_id VARCHAR(50),
      total_messages INTEGER DEFAULT 0,
      total_conversations INTEGER DEFAULT 0,
      unique_contacts INTEGER DEFAULT 0,
      new_contacts INTEGER DEFAULT 0,
      returning_contacts INTEGER DEFAULT 0,
      orders_started INTEGER DEFAULT 0,
      orders_completed INTEGER DEFAULT 0,
      orders_abandoned INTEGER DEFAULT 0,
      orders_cancelled INTEGER DEFAULT 0,
      conversion_rate DECIMAL(5,2),
      abandonment_rate DECIMAL(5,2),
      complaints_total INTEGER DEFAULT 0,
      complaints_by_type JSONB DEFAULT '{}',
      praises_total INTEGER DEFAULT 0,
      nps_estimate DECIMAL(5,2),
      avg_sentiment_score DECIMAL(4,3),
      frustration_incidents INTEGER DEFAULT 0,
      resolved_by_bot INTEGER DEFAULT 0,
      escalated_to_human INTEGER DEFAULT 0,
      bot_effectiveness DECIMAL(5,2),
      top_products_inquired JSONB DEFAULT '[]',
      top_products_ordered JSONB DEFAULT '[]',
      products_not_found JSONB DEFAULT '[]',
      products_unavailable JSONB DEFAULT '[]',
      peak_hours JSONB DEFAULT '[]',
      top_events JSONB DEFAULT '[]',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(date, channel, branch_id)
    )`,
    
    // insights_alerts
    `CREATE TABLE IF NOT EXISTS insights_alerts (
      id SERIAL PRIMARY KEY,
      alert_type VARCHAR(50) NOT NULL,
      severity VARCHAR(20) NOT NULL,
      branch_id VARCHAR(50),
      channel VARCHAR(20),
      title VARCHAR(200) NOT NULL,
      message TEXT NOT NULL,
      data JSONB DEFAULT '{}',
      status VARCHAR(20) DEFAULT 'active',
      acknowledged_at TIMESTAMPTZ,
      acknowledged_by VARCHAR(100),
      resolved_at TIMESTAMPTZ,
      resolved_by VARCHAR(100),
      resolution_notes TEXT,
      notified_channels JSONB DEFAULT '[]',
      notified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    
    // contact_profiles
    `CREATE TABLE IF NOT EXISTS contact_profiles (
      id SERIAL PRIMARY KEY,
      contact_id VARCHAR(100) UNIQUE NOT NULL,
      phone VARCHAR(20),
      name VARCHAR(200),
      email VARCHAR(200),
      first_contact_at TIMESTAMPTZ,
      last_contact_at TIMESTAMPTZ,
      total_conversations INTEGER DEFAULT 0,
      total_orders INTEGER DEFAULT 0,
      total_spent DECIMAL(10,2) DEFAULT 0,
      preferred_channel VARCHAR(20),
      preferred_branch VARCHAR(50),
      preferred_products JSONB DEFAULT '[]',
      dietary_restrictions JSONB DEFAULT '[]',
      avg_sentiment DECIMAL(4,3),
      complaint_count INTEGER DEFAULT 0,
      praise_count INTEGER DEFAULT 0,
      customer_type VARCHAR(50),
      lifetime_value_estimate DECIMAL(10,2),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
  ];
  
  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_events_created_at ON conversation_events(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_events_event_type ON conversation_events(event_type)`,
    `CREATE INDEX IF NOT EXISTS idx_events_category ON conversation_events(event_category)`,
    `CREATE INDEX IF NOT EXISTS idx_events_channel ON conversation_events(channel)`,
    `CREATE INDEX IF NOT EXISTS idx_events_branch ON conversation_events(branch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_events_sentiment ON conversation_events(sentiment)`,
    `CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_unclassified_status ON unclassified_messages(status)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_hourly_time ON insights_hourly(hour_start)`,
    `CREATE INDEX IF NOT EXISTS idx_insights_daily_date ON insights_daily(date)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_status ON insights_alerts(status)`,
    `CREATE INDEX IF NOT EXISTS idx_alerts_severity ON insights_alerts(severity)`,
    `CREATE INDEX IF NOT EXISTS idx_contact_profiles_type ON contact_profiles(customer_type)`,
  ];
  
  // Crear tablas
  for (const sql of tables) {
    try {
      await pool.query(sql);
    } catch (e) {
      logger.warn({ error: e.message }, "Table creation warning (may already exist)");
    }
  }
  
  // Crear índices
  for (const sql of indexes) {
    try {
      await pool.query(sql);
    } catch (e) {
      // Índices pueden fallar si ya existen, está bien
    }
  }
  
  // Crear función de resumen
  try {
    await pool.query(`
      CREATE OR REPLACE FUNCTION get_today_summary()
      RETURNS TABLE (
        total_messages BIGINT,
        total_conversations BIGINT,
        orders_completed BIGINT,
        complaints BIGINT,
        avg_sentiment DECIMAL,
        bot_resolved_pct DECIMAL
      ) AS $$
      BEGIN
        RETURN QUERY
        SELECT 
          COUNT(*) as total_messages,
          COUNT(DISTINCT conversation_id) as total_conversations,
          COUNT(*) FILTER (WHERE event_type = 'order_completed') as orders_completed,
          COUNT(*) FILTER (WHERE event_category = 'complaint') as complaints,
          AVG(sentiment_score) as avg_sentiment,
          (COUNT(*) FILTER (WHERE was_resolved AND NOT required_human)::DECIMAL / 
           NULLIF(COUNT(*) FILTER (WHERE was_resolved), 0) * 100) as bot_resolved_pct
        FROM conversation_events
        WHERE created_at >= CURRENT_DATE;
      END;
      $$ LANGUAGE plpgsql
    `);
  } catch (e) {
    logger.warn({ error: e.message }, "Function creation warning");
  }
  
  logger.info("✅ Insights tables created automatically");
}

// ═══════════════════════════════════════════════════════════════════════════
// CRON JOBS
// ═══════════════════════════════════════════════════════════════════════════

function startCronJobs() {
  logger.info("Starting Insights cron jobs...");
  
  // Agregación horaria (cada hora en punto)
  cronJobs.hourly = setInterval(async () => {
    const now = new Date();
    if (now.getMinutes() === 0) { // Solo al inicio de cada hora
      try {
        await aggregator.aggregateHourly();
      } catch (error) {
        logger.error({ error: error.message }, "Hourly aggregation cron failed");
      }
    }
  }, 60 * 1000); // Revisar cada minuto
  
  // Agregación diaria (3am)
  cronJobs.daily = setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 0) {
      try {
        await aggregator.aggregateDaily();
      } catch (error) {
        logger.error({ error: error.message }, "Daily aggregation cron failed");
      }
    }
  }, 60 * 1000);
  
  // Detección de anomalías (cada 30 min)
  cronJobs.anomaly = setInterval(async () => {
    try {
      await aggregator.detectAnomalies();
    } catch (error) {
      logger.error({ error: error.message }, "Anomaly detection cron failed");
    }
  }, 30 * 60 * 1000);
  
  // Descubrimiento de patrones (3:30am)
  cronJobs.discovery = setInterval(async () => {
    const now = new Date();
    if (now.getHours() === 3 && now.getMinutes() === 30) {
      try {
        await patternDiscovery.discoverPatterns();
      } catch (error) {
        logger.error({ error: error.message }, "Pattern discovery cron failed");
      }
    }
  }, 60 * 1000);
  
  logger.info("Insights cron jobs started");
}

function stopCronJobs() {
  for (const [name, interval] of Object.entries(cronJobs)) {
    if (interval) {
      clearInterval(interval);
      cronJobs[name] = null;
    }
  }
  logger.info("Insights cron jobs stopped");
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: PROCESAR MENSAJE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Procesa un mensaje y extrae evento
 * Llamar desde el webhook de Chatwoot
 * 
 * @param {Object} messageData
 * @returns {Object} Evento extraído
 */
export async function processMessage(messageData) {
  if (!isInitialized) {
    logger.warn("Insights engine not initialized - skipping message processing");
    return null;
  }
  
  try {
    const event = await eventExtractor.extractEvent(messageData);
    return event;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to process message for insights");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export {
  // Router para montar en Express
  insightsRouter,
  
  // Catálogo de eventos
  EVENT_CATALOG,
  EVENT_CATEGORIES,
  
  // Componentes individuales
  eventExtractor,
  aggregator,
  patternDiscovery,
  
  // Control
  stopCronJobs,
};

export default {
  init: initInsightsEngine,
  processMessage,
  router: insightsRouter,
  eventExtractor,
  aggregator,
  patternDiscovery,
  stopCronJobs,
};
