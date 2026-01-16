-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRACIÓN: Habilitar pgvector para RAG Semántico
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- REQUISITOS:
-- - PostgreSQL 15+ (Railway lo soporta)
-- - pgvector extension habilitada
--
-- EJECUTAR EN RAILWAY:
-- 1. Conectar a tu base de datos desde Railway shell o psql
-- 2. Ejecutar este script completo
--
-- ═══════════════════════════════════════════════════════════════════════════

-- ==== PASO 1: Habilitar extensión pgvector ====
-- Railway PostgreSQL ya tiene pgvector instalado
CREATE EXTENSION IF NOT EXISTS vector;

-- Verificar que se instaló correctamente
SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';

-- ==== PASO 2: Tabla principal de embeddings ====
-- Almacena embeddings de FAQs, productos, conocimiento base
CREATE TABLE IF NOT EXISTS vector_embeddings (
  id BIGSERIAL PRIMARY KEY,
  
  -- Identificación única del contenido
  content_hash VARCHAR(64) UNIQUE NOT NULL,
  
  -- Categoría: faq, product, branch, knowledge, canned_response
  category VARCHAR(32) NOT NULL,
  
  -- Origen: config_hub, woocommerce, manual, sheets
  source VARCHAR(64) NOT NULL,
  
  -- Contenido original
  content_text TEXT NOT NULL,
  
  -- Metadata adicional (producto_id, branch_id, etc.)
  metadata JSONB DEFAULT '{}',
  
  -- Vector embedding (1536 dimensiones para text-embedding-3-small)
  embedding vector(1536),
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  -- Analytics
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ
);

-- Comentarios para documentación
COMMENT ON TABLE vector_embeddings IS 'Almacena embeddings vectoriales para búsqueda semántica RAG';
COMMENT ON COLUMN vector_embeddings.content_hash IS 'Hash SHA256 del contenido normalizado para deduplicación';
COMMENT ON COLUMN vector_embeddings.embedding IS 'Vector de 1536 dimensiones generado por text-embedding-3-small';

-- ==== PASO 3: Índice HNSW para búsquedas rápidas ====
-- HNSW (Hierarchical Navigable Small World) es más rápido que IVFFlat para < 1M vectores
-- Parámetros:
--   m=16: conexiones por nodo (mayor = más preciso pero más memoria)
--   ef_construction=64: calidad del índice durante construcción
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw 
ON vector_embeddings 
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Índices auxiliares para filtrado
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_category 
ON vector_embeddings (category);

CREATE INDEX IF NOT EXISTS idx_vector_embeddings_source 
ON vector_embeddings (source);

CREATE INDEX IF NOT EXISTS idx_vector_embeddings_expires 
ON vector_embeddings (expires_at) 
WHERE expires_at IS NOT NULL;

-- Índice GIN para búsquedas en metadata JSONB
CREATE INDEX IF NOT EXISTS idx_vector_embeddings_metadata 
ON vector_embeddings USING GIN (metadata);

-- ==== PASO 4: Tabla de caché de respuestas semántico ====
-- Reemplaza el semantic cache basado en hash exacto
CREATE TABLE IF NOT EXISTS vector_response_cache (
  id BIGSERIAL PRIMARY KEY,
  
  -- Query original
  query_hash VARCHAR(64) UNIQUE NOT NULL,
  query_text TEXT NOT NULL,
  
  -- Embedding de la query
  query_embedding vector(1536),
  
  -- Respuesta cacheada
  response_text TEXT NOT NULL,
  response_metadata JSONB DEFAULT '{}',
  
  -- Categoría para TTL diferenciado
  category VARCHAR(32) NOT NULL DEFAULT 'general',
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  
  -- Analytics
  hit_count INTEGER DEFAULT 0,
  last_hit_at TIMESTAMPTZ
);

COMMENT ON TABLE vector_response_cache IS 'Cache semántico de respuestas - busca queries similares, no exactas';

-- Índice HNSW para el cache
CREATE INDEX IF NOT EXISTS idx_vector_response_cache_hnsw 
ON vector_response_cache 
USING hnsw (query_embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_vector_response_cache_expires 
ON vector_response_cache (expires_at) 
WHERE expires_at IS NOT NULL;

-- ==== PASO 5: Función de similitud coseno (helper) ====
-- PostgreSQL con pgvector ya tiene el operador <=> para distancia coseno
-- Esta función es un wrapper más legible
CREATE OR REPLACE FUNCTION cosine_similarity(a vector, b vector)
RETURNS float8 AS $$
BEGIN
  RETURN 1 - (a <=> b);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION cosine_similarity IS 'Calcula similitud coseno entre dos vectores (1 = idénticos, 0 = ortogonales)';

-- ==== PASO 6: Función de búsqueda semántica ====
CREATE OR REPLACE FUNCTION search_similar_embeddings(
  query_vector vector(1536),
  similarity_threshold float8 DEFAULT 0.78,
  max_results int DEFAULT 5,
  filter_category varchar DEFAULT NULL,
  filter_source varchar DEFAULT NULL
)
RETURNS TABLE (
  id bigint,
  content_hash varchar,
  category varchar,
  source varchar,
  content_text text,
  metadata jsonb,
  similarity float8
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ve.id,
    ve.content_hash,
    ve.category,
    ve.source,
    ve.content_text,
    ve.metadata,
    1 - (ve.embedding <=> query_vector) AS similarity
  FROM vector_embeddings ve
  WHERE 
    (ve.expires_at IS NULL OR ve.expires_at > NOW())
    AND 1 - (ve.embedding <=> query_vector) >= similarity_threshold
    AND (filter_category IS NULL OR ve.category = filter_category)
    AND (filter_source IS NULL OR ve.source = filter_source)
  ORDER BY ve.embedding <=> query_vector
  LIMIT max_results;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION search_similar_embeddings IS 'Busca embeddings similares a un vector query con filtros opcionales';

-- ==== PASO 7: Función de mantenimiento ====
CREATE OR REPLACE FUNCTION cleanup_expired_vectors()
RETURNS TABLE (
  deleted_embeddings bigint,
  deleted_cache bigint
) AS $$
DECLARE
  emb_count bigint;
  cache_count bigint;
BEGIN
  DELETE FROM vector_embeddings 
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS emb_count = ROW_COUNT;
  
  DELETE FROM vector_response_cache 
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  GET DIAGNOSTICS cache_count = ROW_COUNT;
  
  RETURN QUERY SELECT emb_count, cache_count;
END;
$$ LANGUAGE plpgsql;

-- ==== PASO 8: Vista de estadísticas ====
CREATE OR REPLACE VIEW vector_store_stats AS
SELECT
  (SELECT COUNT(*) FROM vector_embeddings WHERE expires_at IS NULL OR expires_at > NOW()) as active_embeddings,
  (SELECT COUNT(*) FROM vector_response_cache WHERE expires_at IS NULL OR expires_at > NOW()) as active_cache_entries,
  (SELECT COUNT(DISTINCT category) FROM vector_embeddings) as categories,
  (SELECT COUNT(DISTINCT source) FROM vector_embeddings) as sources,
  (SELECT COALESCE(SUM(hit_count), 0) FROM vector_embeddings) as total_embedding_hits,
  (SELECT COALESCE(SUM(hit_count), 0) FROM vector_response_cache) as total_cache_hits,
  (SELECT pg_size_pretty(pg_total_relation_size('vector_embeddings'))) as embeddings_table_size,
  (SELECT pg_size_pretty(pg_total_relation_size('vector_response_cache'))) as cache_table_size;

-- ==== VERIFICACIÓN ====
-- Ejecuta esto para verificar que todo está correcto
DO $$
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'MIGRACIÓN PGVECTOR COMPLETADA';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'Tablas creadas:';
  RAISE NOTICE '  - vector_embeddings (embeddings de conocimiento)';
  RAISE NOTICE '  - vector_response_cache (cache semántico de respuestas)';
  RAISE NOTICE '';
  RAISE NOTICE 'Índices HNSW creados para búsquedas rápidas';
  RAISE NOTICE 'Funciones helper: cosine_similarity, search_similar_embeddings';
  RAISE NOTICE '';
  RAISE NOTICE 'Siguiente paso: Poblar embeddings desde Config Hub';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
END $$;
