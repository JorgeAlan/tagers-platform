-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Sistema de Memoria de Conversación Persistente y Resumida
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- IMPLEMENTA:
-- 1. conversation_summaries: Resúmenes comprimidos de conversaciones antiguas
-- 2. conversation_messages: Historial completo persistente
-- 3. conversation_facts: Hechos/preferencias a largo plazo con embeddings
-- 
-- BENEFICIOS:
-- - Sobrevive reinicios del servidor
-- - Comprime conversaciones antiguas sin perder contexto importante
-- - Permite "recordar" preferencias del cliente días después
-- - Integración con pgvector para búsqueda semántica
--
-- EJECUTAR EN RAILWAY:
-- psql $DATABASE_URL < src/db/migrations/003_conversation_memory.sql
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ==== PASO 0: Habilitar extensión pgvector si no existe ====
CREATE EXTENSION IF NOT EXISTS vector;


-- ==== PASO 1: Tabla de resúmenes de conversación (PRIMERO por dependencias) ====
-- Almacena resúmenes comprimidos de conversaciones antiguas
CREATE TABLE IF NOT EXISTS conversation_summaries (
  id BIGSERIAL PRIMARY KEY,
  
  -- Identificador de conversación
  conversation_id TEXT NOT NULL,
  
  -- Identificador del contacto (para vincular resúmenes entre conversaciones)
  contact_id TEXT,
  
  -- Resumen generado por LLM
  summary_text TEXT NOT NULL,
  
  -- Rango de mensajes resumidos
  messages_start_at TIMESTAMPTZ NOT NULL,
  messages_end_at TIMESTAMPTZ NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  
  -- Tokens estimados del resumen (para control de contexto)
  estimated_tokens INTEGER,
  
  -- Embedding del resumen para búsqueda semántica
  summary_embedding vector(1536),
  
  -- Metadata del resumen (modelo usado, versión, etc.)
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- TTL para limpieza automática (NULL = no expira)
  expires_at TIMESTAMPTZ
);

-- Índices para summaries
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_conversation 
ON conversation_summaries(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_contact 
ON conversation_summaries(contact_id, created_at DESC) 
WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_summaries_expires 
ON conversation_summaries(expires_at) 
WHERE expires_at IS NOT NULL;

-- Índice HNSW para búsquedas semánticas en resúmenes
CREATE INDEX IF NOT EXISTS idx_conversation_summaries_embedding_hnsw 
ON conversation_summaries 
USING hnsw (summary_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE conversation_summaries IS 'Resúmenes comprimidos de conversaciones antiguas generados por LLM';


-- ==== PASO 2: Tabla de mensajes de conversación ====
-- Almacena todos los mensajes de conversación persistentemente
CREATE TABLE IF NOT EXISTS conversation_messages (
  id BIGSERIAL PRIMARY KEY,
  
  -- Identificador de conversación (de Chatwoot/WhatsApp)
  conversation_id TEXT NOT NULL,
  
  -- Identificador del contacto/cliente (opcional, para vincular entre conversaciones)
  contact_id TEXT,
  
  -- Rol del mensaje
  role VARCHAR(16) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  
  -- Contenido del mensaje
  content TEXT NOT NULL,
  
  -- Metadata adicional (canal, agente, etc.)
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  message_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Flag para saber si ya fue incluido en un resumen
  summarized BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- ID del resumen que incluye este mensaje (si aplica)
  summary_id BIGINT REFERENCES conversation_summaries(id) ON DELETE SET NULL
);

-- Índices para búsquedas eficientes de mensajes
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conversation 
ON conversation_messages(conversation_id, message_timestamp DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_messages_contact 
ON conversation_messages(contact_id, message_timestamp DESC) 
WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_unsummarized 
ON conversation_messages(conversation_id, summarized, message_timestamp) 
WHERE summarized = FALSE;

CREATE INDEX IF NOT EXISTS idx_conversation_messages_timestamp 
ON conversation_messages(message_timestamp DESC);

COMMENT ON TABLE conversation_messages IS 'Historial completo de mensajes de conversación - persistente';
COMMENT ON COLUMN conversation_messages.summarized IS 'TRUE si ya fue incluido en un resumen comprimido';


-- ==== PASO 3: Tabla de hechos/preferencias a largo plazo ====
-- Almacena información persistente extraída de conversaciones
CREATE TABLE IF NOT EXISTS conversation_facts (
  id BIGSERIAL PRIMARY KEY,
  
  -- Identificador del contacto (vincula facts entre conversaciones)
  contact_id TEXT NOT NULL,
  
  -- Identificador de conversación donde se extrajo el fact
  source_conversation_id TEXT NOT NULL,
  
  -- Tipo de fact
  fact_type VARCHAR(32) NOT NULL CHECK (fact_type IN (
    'preference',      -- Preferencia del cliente (le gusta X, no le gusta Y)
    'personal_info',   -- Info personal (nombre, ubicación, etc.)
    'order_history',   -- Info de pedidos anteriores
    'feedback',        -- Feedback sobre productos/servicio
    'dietary',         -- Restricciones dietéticas/alergias
    'occasion',        -- Ocasiones especiales (cumpleaños, etc.)
    'other'            -- Otros
  )),
  
  -- Contenido del fact
  fact_key TEXT NOT NULL,          -- Ej: "producto_favorito", "ubicacion"
  fact_value TEXT NOT NULL,        -- Ej: "Rosca de Reyes", "CDMX"
  
  -- Embedding del fact para búsqueda semántica
  fact_embedding vector(1536),
  
  -- Confianza del fact (0-1)
  confidence NUMERIC(3,2) NOT NULL DEFAULT 0.8,
  
  -- Metadata
  metadata JSONB DEFAULT '{}',
  
  -- Timestamps
  extracted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Flag para facts que pueden haber cambiado
  is_stale BOOLEAN NOT NULL DEFAULT FALSE,
  
  -- TTL (NULL = no expira)
  expires_at TIMESTAMPTZ,
  
  -- Constraint para evitar duplicados exactos
  UNIQUE(contact_id, fact_type, fact_key)
);

-- Índices para facts
CREATE INDEX IF NOT EXISTS idx_conversation_facts_contact 
ON conversation_facts(contact_id);

CREATE INDEX IF NOT EXISTS idx_conversation_facts_type 
ON conversation_facts(contact_id, fact_type);

CREATE INDEX IF NOT EXISTS idx_conversation_facts_expires 
ON conversation_facts(expires_at) 
WHERE expires_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_facts_stale 
ON conversation_facts(is_stale, last_confirmed_at) 
WHERE is_stale = TRUE;

-- Índice HNSW para búsquedas semánticas en facts
CREATE INDEX IF NOT EXISTS idx_conversation_facts_embedding_hnsw 
ON conversation_facts 
USING hnsw (fact_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

COMMENT ON TABLE conversation_facts IS 'Hechos y preferencias extraídos de conversaciones - memoria a largo plazo';


-- ==== PASO 4: Funciones helper ====

-- Función para obtener contexto de memoria para un contacto
CREATE OR REPLACE FUNCTION get_memory_context(
  p_conversation_id TEXT,
  p_contact_id TEXT DEFAULT NULL,
  p_max_recent_messages INTEGER DEFAULT 20,
  p_max_summaries INTEGER DEFAULT 3,
  p_max_facts INTEGER DEFAULT 10
)
RETURNS TABLE (
  context_type VARCHAR(16),
  content TEXT,
  timestamp_at TIMESTAMPTZ,
  metadata JSONB
) AS $$
BEGIN
  -- 1. Mensajes recientes (no resumidos)
  RETURN QUERY
  SELECT 
    'message'::VARCHAR(16) as context_type,
    m.role || ': ' || m.content as content,
    m.message_timestamp as timestamp_at,
    m.metadata
  FROM conversation_messages m
  WHERE m.conversation_id = p_conversation_id
    AND m.summarized = FALSE
  ORDER BY m.message_timestamp DESC
  LIMIT p_max_recent_messages;
  
  -- 2. Resúmenes de esta conversación
  RETURN QUERY
  SELECT 
    'summary'::VARCHAR(16) as context_type,
    s.summary_text as content,
    s.created_at as timestamp_at,
    s.metadata
  FROM conversation_summaries s
  WHERE s.conversation_id = p_conversation_id
    AND (s.expires_at IS NULL OR s.expires_at > NOW())
  ORDER BY s.created_at DESC
  LIMIT p_max_summaries;
  
  -- 3. Facts del contacto (si se proporciona contact_id)
  IF p_contact_id IS NOT NULL THEN
    RETURN QUERY
    SELECT 
      'fact'::VARCHAR(16) as context_type,
      f.fact_type || '/' || f.fact_key || ': ' || f.fact_value as content,
      f.last_confirmed_at as timestamp_at,
      f.metadata
    FROM conversation_facts f
    WHERE f.contact_id = p_contact_id
      AND f.is_stale = FALSE
      AND (f.expires_at IS NULL OR f.expires_at > NOW())
    ORDER BY f.confidence DESC, f.last_confirmed_at DESC
    LIMIT p_max_facts;
  END IF;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_memory_context IS 'Obtiene contexto de memoria completo para inyectar en el LLM';


-- Función para marcar mensajes como resumidos
CREATE OR REPLACE FUNCTION mark_messages_summarized(
  p_conversation_id TEXT,
  p_before_timestamp TIMESTAMPTZ,
  p_summary_id BIGINT
)
RETURNS INTEGER AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  UPDATE conversation_messages
  SET 
    summarized = TRUE,
    summary_id = p_summary_id
  WHERE conversation_id = p_conversation_id
    AND message_timestamp < p_before_timestamp
    AND summarized = FALSE;
  
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION mark_messages_summarized IS 'Marca mensajes como incluidos en un resumen';


-- Función para limpiar mensajes antiguos ya resumidos
CREATE OR REPLACE FUNCTION cleanup_old_summarized_messages(
  p_older_than_days INTEGER DEFAULT 30
)
RETURNS TABLE (
  deleted_messages BIGINT,
  deleted_summaries BIGINT,
  deleted_facts BIGINT
) AS $$
DECLARE
  msg_count BIGINT;
  sum_count BIGINT;
  fact_count BIGINT;
BEGIN
  -- Eliminar mensajes resumidos muy antiguos
  DELETE FROM conversation_messages
  WHERE summarized = TRUE
    AND message_timestamp < NOW() - (p_older_than_days || ' days')::INTERVAL;
  GET DIAGNOSTICS msg_count = ROW_COUNT;
  
  -- Eliminar resúmenes expirados
  DELETE FROM conversation_summaries
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS sum_count = ROW_COUNT;
  
  -- Eliminar facts expirados
  DELETE FROM conversation_facts
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS fact_count = ROW_COUNT;
  
  RETURN QUERY SELECT msg_count, sum_count, fact_count;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION cleanup_old_summarized_messages IS 'Limpia datos antiguos de memoria';


-- ==== PASO 5: Vista de estadísticas de memoria ====
CREATE OR REPLACE VIEW conversation_memory_stats AS
SELECT
  (SELECT COUNT(*) FROM conversation_messages) as total_messages,
  (SELECT COUNT(*) FROM conversation_messages WHERE summarized = FALSE) as unsummarized_messages,
  (SELECT COUNT(DISTINCT conversation_id) FROM conversation_messages) as unique_conversations,
  (SELECT COUNT(DISTINCT contact_id) FROM conversation_messages WHERE contact_id IS NOT NULL) as unique_contacts,
  (SELECT COUNT(*) FROM conversation_summaries WHERE expires_at IS NULL OR expires_at > NOW()) as active_summaries,
  (SELECT COUNT(*) FROM conversation_facts WHERE is_stale = FALSE AND (expires_at IS NULL OR expires_at > NOW())) as active_facts,
  (SELECT COALESCE(SUM(message_count), 0) FROM conversation_summaries) as total_summarized_messages,
  (SELECT pg_size_pretty(pg_total_relation_size('conversation_messages'))) as messages_table_size,
  (SELECT pg_size_pretty(pg_total_relation_size('conversation_summaries'))) as summaries_table_size,
  (SELECT pg_size_pretty(pg_total_relation_size('conversation_facts'))) as facts_table_size;


-- ==== VERIFICACIÓN ====
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRACIÓN CONVERSATION MEMORY COMPLETADA';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Tablas creadas:';
  RAISE NOTICE '  - conversation_summaries (resúmenes comprimidos con embeddings)';
  RAISE NOTICE '  - conversation_messages (historial persistente)';
  RAISE NOTICE '  - conversation_facts (memoria a largo plazo con embeddings)';
  RAISE NOTICE '';
  RAISE NOTICE 'Funciones helper:';
  RAISE NOTICE '  - get_memory_context() - Obtiene contexto para LLM';
  RAISE NOTICE '  - mark_messages_summarized() - Marca mensajes resumidos';
  RAISE NOTICE '  - cleanup_old_summarized_messages() - Limpieza automática';
  RAISE NOTICE '';
  RAISE NOTICE 'Vista de estadísticas: conversation_memory_stats';
  RAISE NOTICE 'Índices HNSW creados para búsquedas semánticas';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
