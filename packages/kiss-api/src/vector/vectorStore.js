/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VECTOR STORE - Base de Datos Vectorial con pgvector
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * REEMPLAZA semanticCache.js con búsquedas semánticas REALES usando:
 * - pgvector: Extensión de PostgreSQL para vectores
 * - OpenAI Embeddings: text-embedding-3-small (1536 dimensiones)
 * 
 * BENEFICIOS:
 * - "¿Tienen pan de reyes?" = "¿Venden roscas?" (similitud semántica ~0.92)
 * - Sin hardcodear keywords ni synonyms
 * - Escala a miles de documentos
 * - Persistente (sobrevive reinicios)
 * 
 * @version 2.0.0
 */

import { Pool } from "pg";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getEmbedding, getEmbeddingBatch } from "./embeddings.js";
import { getVectorPoolConfig } from "../db/poolConfig.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const vectorConfig = {
  enabled: process.env.VECTOR_STORE_ENABLED !== "false",
  
  // Dimensiones del modelo de embeddings
  dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
  
  // Umbral de similitud para considerar match
  similarityThreshold: parseFloat(process.env.VECTOR_SIMILARITY_THRESHOLD || "0.78"),
  
  // Número máximo de resultados por búsqueda
  maxResults: parseInt(process.env.VECTOR_MAX_RESULTS || "5", 10),
  
  // TTL por categoría (milisegundos) - para cache de embeddings
  ttl: {
    faq: parseInt(process.env.VECTOR_TTL_FAQ_MS || String(7 * 24 * 60 * 60 * 1000), 10),      // 7 días
    product: parseInt(process.env.VECTOR_TTL_PRODUCT_MS || String(24 * 60 * 60 * 1000), 10), // 24 horas
    knowledge: parseInt(process.env.VECTOR_TTL_KNOWLEDGE_MS || String(4 * 60 * 60 * 1000), 10), // 4 horas
    response: parseInt(process.env.VECTOR_TTL_RESPONSE_MS || String(2 * 60 * 60 * 1000), 10), // 2 horas
  },
  
  // Índices HNSW para búsquedas rápidas
  hnsw: {
    m: parseInt(process.env.HNSW_M || "16", 10),
    efConstruction: parseInt(process.env.HNSW_EF_CONSTRUCTION || "64", 10),
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// POOL DE CONEXIONES
// ═══════════════════════════════════════════════════════════════════════════

let pool = null;
let pgvectorReady = false;

function ensurePool() {
  if (!config.databaseUrl) return null;
  if (pool) return pool;
  
  pool = new Pool(getVectorPoolConfig(config.databaseUrl));
  pool.on("error", (err) => logger.error({ err }, "Vector store pool error"));
  
  return pool;
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DE PGVECTOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa pgvector y crea las tablas necesarias
 */
export async function initVectorStore() {
  const p = ensurePool();
  
  if (!p) {
    logger.warn("DATABASE_URL not set. Vector store disabled.");
    return { ok: false, reason: "no_database" };
  }
  
  if (!vectorConfig.enabled) {
    logger.info("Vector store disabled by config");
    return { ok: false, reason: "disabled" };
  }
  
  try {
    // 1. Habilitar extensión pgvector
    await p.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
    logger.info("pgvector extension enabled");
    
    // 2. Crear tabla principal de embeddings
    await p.query(`
      CREATE TABLE IF NOT EXISTS vector_embeddings (
        id BIGSERIAL PRIMARY KEY,
        
        -- Identificación
        content_hash VARCHAR(64) UNIQUE NOT NULL,
        category VARCHAR(32) NOT NULL,
        source VARCHAR(64) NOT NULL,
        
        -- Contenido
        content_text TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        
        -- Vector embedding (1536 dimensiones para text-embedding-3-small)
        embedding vector(${vectorConfig.dimensions}),
        
        -- Control
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        
        -- Stats
        hit_count INTEGER DEFAULT 0,
        last_hit_at TIMESTAMPTZ
      );
    `);
    
    // 3. Crear índice HNSW para búsquedas rápidas por similitud coseno
    // HNSW es más rápido que IVFFlat para datasets < 1M vectores
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_vector_embeddings_hnsw 
      ON vector_embeddings 
      USING hnsw (embedding vector_cosine_ops)
      WITH (m = ${vectorConfig.hnsw.m}, ef_construction = ${vectorConfig.hnsw.efConstruction});
    `);
    
    // 4. Índices auxiliares
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_vector_embeddings_category 
      ON vector_embeddings (category);
    `);
    
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_vector_embeddings_source 
      ON vector_embeddings (source);
    `);
    
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_vector_embeddings_expires 
      ON vector_embeddings (expires_at) 
      WHERE expires_at IS NOT NULL;
    `);
    
    // 5. Tabla de caché de respuestas (semantic cache mejorado)
    await p.query(`
      CREATE TABLE IF NOT EXISTS vector_response_cache (
        id BIGSERIAL PRIMARY KEY,
        
        -- Query original y su embedding
        query_hash VARCHAR(64) UNIQUE NOT NULL,
        query_text TEXT NOT NULL,
        query_embedding vector(${vectorConfig.dimensions}),
        
        -- Respuesta cacheada
        response_text TEXT NOT NULL,
        response_metadata JSONB DEFAULT '{}',
        
        -- Categorización
        category VARCHAR(32) NOT NULL DEFAULT 'general',
        
        -- Control
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        
        -- Stats
        hit_count INTEGER DEFAULT 0,
        last_hit_at TIMESTAMPTZ
      );
    `);
    
    // 6. Índice HNSW para caché de respuestas
    await p.query(`
      CREATE INDEX IF NOT EXISTS idx_vector_response_cache_hnsw 
      ON vector_response_cache 
      USING hnsw (query_embedding vector_cosine_ops)
      WITH (m = ${vectorConfig.hnsw.m}, ef_construction = ${vectorConfig.hnsw.efConstruction});
    `);
    
    pgvectorReady = true;
    logger.info({
      dimensions: vectorConfig.dimensions,
      similarityThreshold: vectorConfig.similarityThreshold,
      hnswM: vectorConfig.hnsw.m,
    }, "Vector store initialized successfully");
    
    return { ok: true, storage: "pgvector" };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to initialize vector store");
    pgvectorReady = false;
    return { ok: false, reason: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES DE EMBEDDINGS
// ═══════════════════════════════════════════════════════════════════════════

import crypto from "crypto";

/**
 * Genera hash de contenido para deduplicación
 */
function hashContent(text) {
  return crypto
    .createHash("sha256")
    .update(normalizeForHash(text))
    .digest("hex")
    .substring(0, 16);
}

/**
 * Normaliza texto para hashing (más agresivo que para búsqueda)
 */
function normalizeForHash(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¿¡?!.,;:'"()\[\]{}]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Formatea vector para PostgreSQL
 */
function formatVectorForPg(vector) {
  if (!vector || !Array.isArray(vector)) return null;
  return `[${vector.join(",")}]`;
}

// ═══════════════════════════════════════════════════════════════════════════
// INSERCIÓN DE CONTENIDO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inserta o actualiza un documento con su embedding
 * 
 * @param {Object} options
 * @param {string} options.text - Texto a vectorizar
 * @param {string} options.category - Categoría (faq, product, knowledge, etc.)
 * @param {string} options.source - Origen (config_hub, woocommerce, manual)
 * @param {Object} options.metadata - Metadata adicional
 * @param {number} options.ttlMs - TTL en milisegundos (opcional)
 */
export async function upsertEmbedding({
  text,
  category,
  source,
  metadata = {},
  ttlMs = null,
}) {
  if (!pgvectorReady) {
    logger.debug("Vector store not ready, skipping upsert");
    return null;
  }
  
  const p = ensurePool();
  if (!p || !text) return null;
  
  try {
    const contentHash = crypto
      .createHash("sha256")
      .update(normalizeForHash(text))
      .digest("hex")
      .substring(0, 16);
    
    // Generar embedding
    const embedding = await getEmbedding(text);
    if (!embedding) {
      logger.warn({ text: text.substring(0, 50) }, "Failed to generate embedding");
      return null;
    }
    
    // Calcular expiración
    const ttl = ttlMs || vectorConfig.ttl[category] || vectorConfig.ttl.knowledge;
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    
    // Upsert
    const result = await p.query(`
      INSERT INTO vector_embeddings 
        (content_hash, category, source, content_text, metadata, embedding, expires_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::vector, $7, NOW())
      ON CONFLICT (content_hash) DO UPDATE SET
        content_text = EXCLUDED.content_text,
        metadata = EXCLUDED.metadata,
        embedding = EXCLUDED.embedding,
        expires_at = EXCLUDED.expires_at,
        updated_at = NOW()
      RETURNING id
    `, [
      contentHash,
      category,
      source,
      text,
      metadata,
      formatVectorForPg(embedding),
      expiresAt,
    ]);
    
    logger.debug({
      contentHash,
      category,
      source,
      textPreview: text.substring(0, 40),
    }, "Upserted embedding");
    
    return { id: result.rows[0]?.id, hash: contentHash };
    
  } catch (error) {
    logger.error({ error: error.message, text: text?.substring(0, 50) }, "Failed to upsert embedding");
    return null;
  }
}

/**
 * Inserta múltiples documentos en batch (más eficiente)
 */
export async function upsertEmbeddingBatch(documents) {
  if (!pgvectorReady || !documents?.length) return { inserted: 0 };
  
  const p = ensurePool();
  if (!p) return { inserted: 0 };
  
  try {
    // Generar embeddings en batch
    const texts = documents.map(d => d.text);
    const embeddings = await getEmbeddingBatch(texts);
    
    if (!embeddings || embeddings.length !== documents.length) {
      logger.warn("Batch embedding generation failed or size mismatch");
      return { inserted: 0 };
    }
    
    let inserted = 0;
    
    // Insertar uno por uno (podría optimizarse con INSERT múltiple)
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i];
      const embedding = embeddings[i];
      
      if (!embedding) continue;
      
      const contentHash = crypto
        .createHash("sha256")
        .update(normalizeForHash(doc.text))
        .digest("hex")
        .substring(0, 16);
      
      const ttl = doc.ttlMs || vectorConfig.ttl[doc.category] || vectorConfig.ttl.knowledge;
      const expiresAt = new Date(Date.now() + ttl).toISOString();
      
      try {
        await p.query(`
          INSERT INTO vector_embeddings 
            (content_hash, category, source, content_text, metadata, embedding, expires_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6::vector, $7, NOW())
          ON CONFLICT (content_hash) DO UPDATE SET
            content_text = EXCLUDED.content_text,
            metadata = EXCLUDED.metadata,
            embedding = EXCLUDED.embedding,
            expires_at = EXCLUDED.expires_at,
            updated_at = NOW()
        `, [
          contentHash,
          doc.category || "knowledge",
          doc.source || "batch",
          doc.text,
          doc.metadata || {},
          formatVectorForPg(embedding),
          expiresAt,
        ]);
        
        inserted++;
      } catch (err) {
        logger.warn({ error: err.message, hash: contentHash }, "Failed to insert embedding in batch");
      }
    }
    
    logger.info({ total: documents.length, inserted }, "Batch embedding upsert completed");
    return { inserted };
    
  } catch (error) {
    logger.error({ error: error.message }, "Batch embedding upsert failed");
    return { inserted: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA SEMÁNTICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca documentos similares a una query
 * 
 * @param {string} query - Texto de búsqueda
 * @param {Object} options
 * @param {string} options.category - Filtrar por categoría (opcional)
 * @param {string} options.source - Filtrar por source (opcional)
 * @param {number} options.limit - Número máximo de resultados
 * @param {number} options.threshold - Umbral mínimo de similitud
 * @returns {Array} Resultados ordenados por similitud
 */
export async function searchSimilar(query, options = {}) {
  if (!pgvectorReady) {
    return [];
  }
  
  const p = ensurePool();
  if (!p || !query) return [];
  
  const {
    category = null,
    source = null,
    limit = vectorConfig.maxResults,
    threshold = vectorConfig.similarityThreshold,
  } = options;
  
  try {
    // Generar embedding de la query
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding) {
      logger.warn({ query: query.substring(0, 50) }, "Failed to generate query embedding");
      return [];
    }
    
    // Construir query con filtros opcionales
    let sql = `
      SELECT 
        id,
        content_hash,
        category,
        source,
        content_text,
        metadata,
        1 - (embedding <=> $1::vector) AS similarity,
        hit_count,
        created_at
      FROM vector_embeddings
      WHERE 
        (expires_at IS NULL OR expires_at > NOW())
        AND 1 - (embedding <=> $1::vector) >= $2
    `;
    
    const params = [formatVectorForPg(queryEmbedding), threshold];
    let paramIndex = 3;
    
    if (category) {
      sql += ` AND category = $${paramIndex}`;
      params.push(category);
      paramIndex++;
    }
    
    if (source) {
      sql += ` AND source = $${paramIndex}`;
      params.push(source);
      paramIndex++;
    }
    
    sql += `
      ORDER BY embedding <=> $1::vector
      LIMIT $${paramIndex}
    `;
    params.push(limit);
    
    const result = await p.query(sql, params);
    
    // Actualizar hit_count para analytics
    if (result.rows.length > 0) {
      const ids = result.rows.map(r => r.id);
      await p.query(`
        UPDATE vector_embeddings 
        SET hit_count = hit_count + 1, last_hit_at = NOW()
        WHERE id = ANY($1)
      `, [ids]);
    }
    
    logger.debug({
      query: query.substring(0, 40),
      results: result.rows.length,
      topSimilarity: result.rows[0]?.similarity,
    }, "Vector search completed");
    
    return result.rows.map(row => ({
      id: row.id,
      hash: row.content_hash,
      category: row.category,
      source: row.source,
      text: row.content_text,
      metadata: row.metadata,
      similarity: parseFloat(row.similarity),
      hitCount: row.hit_count,
    }));
    
  } catch (error) {
    logger.error({ error: error.message, query: query?.substring(0, 50) }, "Vector search failed");
    return [];
  }
}

/**
 * Encuentra el documento más similar a una query
 * Útil para matching exacto de productos, sucursales, etc.
 */
export async function findBestMatch(query, options = {}) {
  const results = await searchSimilar(query, { ...options, limit: 1 });
  return results[0] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHÉ DE RESPUESTAS SEMÁNTICO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca una respuesta cacheada semánticamente similar
 * REEMPLAZA semanticCache.get() con búsqueda vectorial
 */
export async function getCachedResponse(query, options = {}) {
  if (!pgvectorReady) {
    return { hit: false };
  }
  
  const p = ensurePool();
  if (!p || !query) return { hit: false };
  
  const {
    category = null,
    threshold = vectorConfig.similarityThreshold,
  } = options;
  
  try {
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding) {
      return { hit: false };
    }
    
    let sql = `
      SELECT 
        id,
        query_text,
        response_text,
        response_metadata,
        category,
        1 - (query_embedding <=> $1::vector) AS similarity,
        hit_count,
        created_at
      FROM vector_response_cache
      WHERE 
        (expires_at IS NULL OR expires_at > NOW())
        AND 1 - (query_embedding <=> $1::vector) >= $2
    `;
    
    const params = [formatVectorForPg(queryEmbedding), threshold];
    
    if (category) {
      sql += ` AND category = $3`;
      params.push(category);
    }
    
    sql += `
      ORDER BY query_embedding <=> $1::vector
      LIMIT 1
    `;
    
    const result = await p.query(sql, params);
    
    if (result.rows.length === 0) {
      return { hit: false };
    }
    
    const row = result.rows[0];
    
    // Actualizar stats
    await p.query(`
      UPDATE vector_response_cache 
      SET hit_count = hit_count + 1, last_hit_at = NOW()
      WHERE id = $1
    `, [row.id]);
    
    logger.debug({
      query: query.substring(0, 40),
      matchedQuery: row.query_text.substring(0, 40),
      similarity: row.similarity,
    }, "Semantic cache HIT");
    
    return {
      hit: true,
      response: row.response_text,
      metadata: row.response_metadata,
      category: row.category,
      similarity: parseFloat(row.similarity),
      matchedQuery: row.query_text,
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Semantic cache lookup failed");
    return { hit: false };
  }
}

/**
 * Guarda una respuesta en el caché semántico
 * REEMPLAZA semanticCache.set() con almacenamiento vectorial
 */
export async function setCachedResponse(query, response, options = {}) {
  if (!pgvectorReady) return null;
  
  const p = ensurePool();
  if (!p || !query || !response) return null;
  
  // No cachear respuestas de error
  if (isErrorResponse(response)) return null;
  
  const {
    category = "general",
    metadata = {},
    ttlMs = null,
  } = options;
  
  try {
    const queryHash = crypto
      .createHash("sha256")
      .update(normalizeForHash(query))
      .digest("hex")
      .substring(0, 16);
    
    const queryEmbedding = await getEmbedding(query);
    if (!queryEmbedding) {
      return null;
    }
    
    const ttl = ttlMs || vectorConfig.ttl.response;
    const expiresAt = new Date(Date.now() + ttl).toISOString();
    
    await p.query(`
      INSERT INTO vector_response_cache 
        (query_hash, query_text, query_embedding, response_text, response_metadata, category, expires_at)
      VALUES ($1, $2, $3::vector, $4, $5, $6, $7)
      ON CONFLICT (query_hash) DO UPDATE SET
        response_text = EXCLUDED.response_text,
        response_metadata = EXCLUDED.response_metadata,
        expires_at = EXCLUDED.expires_at
    `, [
      queryHash,
      query,
      formatVectorForPg(queryEmbedding),
      response,
      metadata,
      category,
      expiresAt,
    ]);
    
    logger.debug({
      queryHash,
      category,
      query: query.substring(0, 40),
    }, "Semantic cache SET");
    
    return queryHash;
    
  } catch (error) {
    logger.error({ error: error.message }, "Semantic cache set failed");
    return null;
  }
}

function isErrorResponse(response) {
  const errorIndicators = [
    "disculpa",
    "error",
    "problema",
    "no pude",
    "no puedo",
    "intenta de nuevo",
    "repite tu mensaje",
  ];
  
  const lower = (response || "").toLowerCase();
  return errorIndicators.some(i => lower.includes(i));
}

// ═══════════════════════════════════════════════════════════════════════════
// MANTENIMIENTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Limpia embeddings expirados
 */
export async function cleanupExpired() {
  if (!pgvectorReady) return { cleaned: 0 };
  
  const p = ensurePool();
  if (!p) return { cleaned: 0 };
  
  try {
    const result1 = await p.query(`
      DELETE FROM vector_embeddings 
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
    `);
    
    const result2 = await p.query(`
      DELETE FROM vector_response_cache 
      WHERE expires_at IS NOT NULL AND expires_at < NOW()
    `);
    
    const cleaned = result1.rowCount + result2.rowCount;
    
    if (cleaned > 0) {
      logger.info({ cleaned, embeddings: result1.rowCount, cache: result2.rowCount }, "Cleaned expired vectors");
    }
    
    return { cleaned };
    
  } catch (error) {
    logger.error({ error: error.message }, "Cleanup failed");
    return { cleaned: 0, error: error.message };
  }
}

/**
 * Invalida embeddings por source
 */
export async function invalidateBySource(source) {
  if (!pgvectorReady) return { invalidated: 0 };
  
  const p = ensurePool();
  if (!p) return { invalidated: 0 };
  
  try {
    const result = await p.query(`
      DELETE FROM vector_embeddings WHERE source = $1
    `, [source]);
    
    logger.info({ source, invalidated: result.rowCount }, "Invalidated embeddings by source");
    return { invalidated: result.rowCount };
    
  } catch (error) {
    logger.error({ error: error.message, source }, "Invalidation failed");
    return { invalidated: 0, error: error.message };
  }
}

/**
 * Invalida embeddings por categoría
 */
export async function invalidateByCategory(category) {
  if (!pgvectorReady) return { invalidated: 0 };
  
  const p = ensurePool();
  if (!p) return { invalidated: 0 };
  
  try {
    const result = await p.query(`
      DELETE FROM vector_embeddings WHERE category = $1
    `, [category]);
    
    logger.info({ category, invalidated: result.rowCount }, "Invalidated embeddings by category");
    return { invalidated: result.rowCount };
    
  } catch (error) {
    logger.error({ error: error.message, category }, "Invalidation failed");
    return { invalidated: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas del vector store
 */
export async function getStats() {
  if (!pgvectorReady) {
    return { ready: false, storage: "none" };
  }
  
  const p = ensurePool();
  if (!p) return { ready: false, storage: "none" };
  
  try {
    const embeddings = await p.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT category) as categories,
        COUNT(DISTINCT source) as sources,
        SUM(hit_count) as total_hits,
        AVG(hit_count) as avg_hits
      FROM vector_embeddings
      WHERE expires_at IS NULL OR expires_at > NOW()
    `);
    
    const cache = await p.query(`
      SELECT 
        COUNT(*) as total,
        SUM(hit_count) as total_hits
      FROM vector_response_cache
      WHERE expires_at IS NULL OR expires_at > NOW()
    `);
    
    const byCategory = await p.query(`
      SELECT category, COUNT(*) as count
      FROM vector_embeddings
      WHERE expires_at IS NULL OR expires_at > NOW()
      GROUP BY category
    `);
    
    return {
      ready: true,
      storage: "pgvector",
      dimensions: vectorConfig.dimensions,
      similarityThreshold: vectorConfig.similarityThreshold,
      embeddings: {
        total: parseInt(embeddings.rows[0]?.total || 0),
        categories: parseInt(embeddings.rows[0]?.categories || 0),
        sources: parseInt(embeddings.rows[0]?.sources || 0),
        totalHits: parseInt(embeddings.rows[0]?.total_hits || 0),
        avgHits: parseFloat(embeddings.rows[0]?.avg_hits || 0),
      },
      cache: {
        total: parseInt(cache.rows[0]?.total || 0),
        totalHits: parseInt(cache.rows[0]?.total_hits || 0),
      },
      byCategory: Object.fromEntries(
        byCategory.rows.map(r => [r.category, parseInt(r.count)])
      ),
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get vector store stats");
    return { ready: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

export function isReady() {
  return pgvectorReady;
}

export function getConfig() {
  return { ...vectorConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const vectorStore = {
  // Lifecycle
  init: initVectorStore,
  isReady,
  getConfig,
  getStats,
  
  // Embeddings
  upsert: upsertEmbedding,
  upsertBatch: upsertEmbeddingBatch,
  
  // Search
  search: searchSimilar,
  findBestMatch,
  
  // Semantic Cache
  getCached: getCachedResponse,
  setCached: setCachedResponse,
  
  // Maintenance
  cleanupExpired,
  invalidateBySource,
  invalidateByCategory,
};

export default vectorStore;
