-- ═══════════════════════════════════════════════════════════════════════════
-- INSIGHTS ENGINE - Database Schema v1.0
-- ═══════════════════════════════════════════════════════════════════════════
-- Motor de análisis de conversaciones para Tagers
-- Auto-aprendizaje de eventos y generación de insights
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: conversation_events
-- Cada interacción clasificada con su evento, sentimiento y entidades
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversation_events (
  id SERIAL PRIMARY KEY,
  
  -- Identificadores
  conversation_id VARCHAR(100) NOT NULL,
  message_id VARCHAR(100),
  contact_id VARCHAR(100),
  
  -- Contexto
  channel VARCHAR(20) NOT NULL, -- whatsapp, instagram, facebook, web
  branch_id VARCHAR(50),
  branch_name VARCHAR(100),
  
  -- Clasificación del evento
  event_type VARCHAR(100) NOT NULL, -- order_inquiry, complaint_wait_time, etc
  event_category VARCHAR(50) NOT NULL, -- order, product, branch, delivery, complaint, etc
  confidence DECIMAL(3,2) DEFAULT 0.0, -- 0.00 - 1.00
  
  -- Sentimiento
  sentiment VARCHAR(20), -- positive, neutral, negative
  sentiment_score DECIMAL(3,2), -- -1.00 a 1.00
  frustration_level INTEGER DEFAULT 0, -- 0-5
  urgency_level INTEGER DEFAULT 0, -- 0-5
  
  -- Entidades extraídas (JSONB para flexibilidad)
  entities JSONB DEFAULT '{}',
  -- Ejemplos de entities:
  -- { "products": ["concha", "cuerno"], "quantity": 12 }
  -- { "branch": "polanco", "complaint_type": "wait_time", "wait_minutes": 40 }
  -- { "order_id": "12345", "status_requested": true }
  
  -- Mensaje original (para debugging y re-entrenamiento)
  message_content TEXT,
  message_direction VARCHAR(10) DEFAULT 'incoming', -- incoming, outgoing
  
  -- Resultado de la interacción
  was_resolved BOOLEAN DEFAULT FALSE,
  required_human BOOLEAN DEFAULT FALSE,
  response_time_seconds INTEGER,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Índices para queries rápidos
  CONSTRAINT valid_sentiment CHECK (sentiment IN ('positive', 'neutral', 'negative'))
);

-- Índices para consultas frecuentes
CREATE INDEX IF NOT EXISTS idx_events_created_at ON conversation_events(created_at);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON conversation_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_category ON conversation_events(event_category);
CREATE INDEX IF NOT EXISTS idx_events_channel ON conversation_events(channel);
CREATE INDEX IF NOT EXISTS idx_events_branch ON conversation_events(branch_id);
CREATE INDEX IF NOT EXISTS idx_events_sentiment ON conversation_events(sentiment);
CREATE INDEX IF NOT EXISTS idx_events_conversation ON conversation_events(conversation_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: event_types_catalog
-- Catálogo de todos los tipos de eventos conocidos
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS event_types_catalog (
  id SERIAL PRIMARY KEY,
  event_type VARCHAR(100) UNIQUE NOT NULL,
  category VARCHAR(50) NOT NULL,
  description TEXT,
  keywords TEXT[], -- Para matching rápido
  examples TEXT[], -- Ejemplos de mensajes
  is_enabled BOOLEAN DEFAULT TRUE,
  is_auto_discovered BOOLEAN DEFAULT FALSE,
  discovery_count INTEGER DEFAULT 0, -- Cuántas veces se detectó antes de aprobar
  approved_at TIMESTAMPTZ,
  approved_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: unclassified_messages
-- Mensajes que no pudieron clasificarse - para auto-aprendizaje
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS unclassified_messages (
  id SERIAL PRIMARY KEY,
  conversation_id VARCHAR(100),
  message_content TEXT NOT NULL,
  channel VARCHAR(20),
  branch_id VARCHAR(50),
  
  -- Para clustering
  embedding VECTOR(1536), -- OpenAI embeddings
  cluster_id INTEGER, -- Asignado por el descubridor
  
  -- Estado
  status VARCHAR(20) DEFAULT 'pending', -- pending, clustered, proposed, approved, rejected
  proposed_event_type VARCHAR(100),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_unclassified_status ON unclassified_messages(status);
CREATE INDEX IF NOT EXISTS idx_unclassified_cluster ON unclassified_messages(cluster_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: discovered_patterns
-- Patrones descubiertos automáticamente para revisión humana
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS discovered_patterns (
  id SERIAL PRIMARY KEY,
  
  -- Propuesta de evento
  proposed_event_type VARCHAR(100) NOT NULL,
  proposed_category VARCHAR(50),
  proposed_description TEXT,
  
  -- Evidencia
  sample_messages TEXT[], -- Top 10 ejemplos
  message_count INTEGER NOT NULL,
  common_keywords TEXT[],
  
  -- Estado
  status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected, merged
  reviewed_at TIMESTAMPTZ,
  reviewed_by VARCHAR(100),
  merged_into VARCHAR(100), -- Si se fusionó con otro evento existente
  
  -- Metadata
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  confidence_score DECIMAL(3,2)
);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: insights_hourly
-- Agregaciones por hora para dashboards en tiempo real
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS insights_hourly (
  id SERIAL PRIMARY KEY,
  hour_start TIMESTAMPTZ NOT NULL,
  
  -- Dimensiones
  channel VARCHAR(20),
  branch_id VARCHAR(50),
  
  -- Métricas
  total_messages INTEGER DEFAULT 0,
  total_conversations INTEGER DEFAULT 0,
  unique_contacts INTEGER DEFAULT 0,
  
  -- Por categoría
  events_by_category JSONB DEFAULT '{}', -- {"order": 45, "complaint": 12, ...}
  events_by_type JSONB DEFAULT '{}', -- {"order_inquiry": 30, "order_completed": 15, ...}
  
  -- Sentimiento
  sentiment_positive INTEGER DEFAULT 0,
  sentiment_neutral INTEGER DEFAULT 0,
  sentiment_negative INTEGER DEFAULT 0,
  avg_sentiment_score DECIMAL(4,3),
  
  -- Operacional
  avg_response_time_seconds INTEGER,
  resolved_by_bot INTEGER DEFAULT 0,
  escalated_to_human INTEGER DEFAULT 0,
  
  -- Productos mencionados
  top_products JSONB DEFAULT '[]', -- [{"product": "concha", "count": 25}, ...]
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(hour_start, channel, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_insights_hourly_time ON insights_hourly(hour_start);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: insights_daily
-- Agregaciones diarias para reportes
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS insights_daily (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  
  -- Dimensiones
  channel VARCHAR(20),
  branch_id VARCHAR(50),
  
  -- Volumen
  total_messages INTEGER DEFAULT 0,
  total_conversations INTEGER DEFAULT 0,
  unique_contacts INTEGER DEFAULT 0,
  new_contacts INTEGER DEFAULT 0,
  returning_contacts INTEGER DEFAULT 0,
  
  -- Conversión
  orders_started INTEGER DEFAULT 0,
  orders_completed INTEGER DEFAULT 0,
  orders_abandoned INTEGER DEFAULT 0,
  orders_cancelled INTEGER DEFAULT 0,
  conversion_rate DECIMAL(5,2), -- %
  abandonment_rate DECIMAL(5,2), -- %
  
  -- Satisfacción
  complaints_total INTEGER DEFAULT 0,
  complaints_by_type JSONB DEFAULT '{}',
  praises_total INTEGER DEFAULT 0,
  nps_estimate DECIMAL(5,2),
  
  -- Sentimiento
  avg_sentiment_score DECIMAL(4,3),
  frustration_incidents INTEGER DEFAULT 0,
  
  -- Eficiencia del bot
  resolved_by_bot INTEGER DEFAULT 0,
  escalated_to_human INTEGER DEFAULT 0,
  bot_effectiveness DECIMAL(5,2), -- %
  
  -- Top productos
  top_products_inquired JSONB DEFAULT '[]',
  top_products_ordered JSONB DEFAULT '[]',
  products_not_found JSONB DEFAULT '[]',
  products_unavailable JSONB DEFAULT '[]',
  
  -- Horarios pico
  peak_hours JSONB DEFAULT '[]', -- [{"hour": 14, "messages": 120}, ...]
  
  -- Eventos más frecuentes
  top_events JSONB DEFAULT '[]',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(date, channel, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_insights_daily_date ON insights_daily(date);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: insights_alerts
-- Alertas generadas por anomalías
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS insights_alerts (
  id SERIAL PRIMARY KEY,
  
  -- Tipo de alerta
  alert_type VARCHAR(50) NOT NULL, -- complaint_spike, sentiment_drop, new_pattern, etc
  severity VARCHAR(20) NOT NULL, -- low, medium, high, critical
  
  -- Contexto
  branch_id VARCHAR(50),
  channel VARCHAR(20),
  
  -- Detalle
  title VARCHAR(200) NOT NULL,
  message TEXT NOT NULL,
  data JSONB DEFAULT '{}', -- Datos adicionales para contexto
  
  -- Estado
  status VARCHAR(20) DEFAULT 'active', -- active, acknowledged, resolved, dismissed
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  resolution_notes TEXT,
  
  -- Notificación
  notified_channels JSONB DEFAULT '[]', -- ["whatsapp", "email", "slack"]
  notified_at TIMESTAMPTZ,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON insights_alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON insights_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON insights_alerts(created_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: contact_profiles
-- Perfil acumulado de cada contacto para personalización
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contact_profiles (
  id SERIAL PRIMARY KEY,
  contact_id VARCHAR(100) UNIQUE NOT NULL,
  
  -- Identificación
  phone VARCHAR(20),
  name VARCHAR(200),
  email VARCHAR(200),
  
  -- Comportamiento
  first_contact_at TIMESTAMPTZ,
  last_contact_at TIMESTAMPTZ,
  total_conversations INTEGER DEFAULT 0,
  total_orders INTEGER DEFAULT 0,
  total_spent DECIMAL(10,2) DEFAULT 0,
  
  -- Preferencias detectadas
  preferred_channel VARCHAR(20),
  preferred_branch VARCHAR(50),
  preferred_products JSONB DEFAULT '[]',
  dietary_restrictions JSONB DEFAULT '[]',
  
  -- Sentimiento histórico
  avg_sentiment DECIMAL(4,3),
  complaint_count INTEGER DEFAULT 0,
  praise_count INTEGER DEFAULT 0,
  
  -- Segmentación
  customer_type VARCHAR(50), -- new, regular, vip, at_risk, churned
  lifetime_value_estimate DECIMAL(10,2),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_profiles_type ON contact_profiles(customer_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIONES ÚTILES
-- ═══════════════════════════════════════════════════════════════════════════

-- Función para obtener insights rápidos del día actual
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
$$ LANGUAGE plpgsql;

-- Función para detectar anomalías (usado por alertas)
CREATE OR REPLACE FUNCTION check_complaint_spike(threshold_pct INTEGER DEFAULT 50)
RETURNS TABLE (
  branch_id VARCHAR,
  today_complaints BIGINT,
  avg_complaints DECIMAL,
  increase_pct DECIMAL
) AS $$
BEGIN
  RETURN QUERY
  WITH today_data AS (
    SELECT 
      ce.branch_id,
      COUNT(*) as complaints
    FROM conversation_events ce
    WHERE ce.event_category = 'complaint'
      AND ce.created_at >= CURRENT_DATE
    GROUP BY ce.branch_id
  ),
  historical AS (
    SELECT 
      ce.branch_id,
      AVG(daily_count) as avg_complaints
    FROM (
      SELECT branch_id, DATE(created_at) as dt, COUNT(*) as daily_count
      FROM conversation_events
      WHERE event_category = 'complaint'
        AND created_at >= CURRENT_DATE - INTERVAL '7 days'
        AND created_at < CURRENT_DATE
      GROUP BY branch_id, DATE(created_at)
    ) ce
    GROUP BY ce.branch_id
  )
  SELECT 
    t.branch_id,
    t.complaints as today_complaints,
    COALESCE(h.avg_complaints, 0) as avg_complaints,
    CASE 
      WHEN COALESCE(h.avg_complaints, 0) = 0 THEN 100
      ELSE ((t.complaints - h.avg_complaints) / h.avg_complaints * 100)
    END as increase_pct
  FROM today_data t
  LEFT JOIN historical h ON t.branch_id = h.branch_id
  WHERE CASE 
    WHEN COALESCE(h.avg_complaints, 0) = 0 THEN TRUE
    ELSE ((t.complaints - h.avg_complaints) / h.avg_complaints * 100) > threshold_pct
  END;
END;
$$ LANGUAGE plpgsql;
