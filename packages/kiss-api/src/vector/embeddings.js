/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EMBEDDINGS SERVICE - Generación de Vectores con OpenAI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Genera embeddings usando OpenAI text-embedding-3-small.
 * Incluye cache en memoria para evitar llamadas repetidas.
 * 
 * MODELO: text-embedding-3-small
 * - Dimensiones: 1536
 * - Costo: $0.02 / 1M tokens (muy económico)
 * - Rendimiento: Excelente para español
 * 
 * @version 1.0.0
 */

import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const embeddingConfig = {
  // Modelo de embeddings
  model: process.env.EMBEDDING_MODEL || "text-embedding-3-small",
  
  // Dimensiones (1536 para text-embedding-3-small, 3072 para large)
  dimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
  
  // Timeout para llamadas a OpenAI
  timeoutMs: parseInt(process.env.EMBEDDING_TIMEOUT_MS || "10000", 10),
  
  // Tamaño máximo de batch
  maxBatchSize: parseInt(process.env.EMBEDDING_BATCH_SIZE || "100", 10),
  
  // Cache en memoria para reducir llamadas
  cacheEnabled: process.env.EMBEDDING_CACHE_ENABLED !== "false",
  cacheTtlMs: parseInt(process.env.EMBEDDING_CACHE_TTL_MS || String(60 * 60 * 1000), 10), // 1 hora
  cacheMaxSize: parseInt(process.env.EMBEDDING_CACHE_MAX_SIZE || "1000", 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTE OPENAI
// ═══════════════════════════════════════════════════════════════════════════

let _client = null;

function getClient() {
  if (_client) return _client;
  
  // Usa la API key principal o una específica para embeddings
  const apiKey = process.env.OPENAI_EMBEDDING_API_KEY || config.openaiApiKey;
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Embeddings cannot be generated.");
  }
  
  _client = new OpenAI({
    apiKey,
    timeout: embeddingConfig.timeoutMs,
    maxRetries: 2,
  });
  
  return _client;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE EN MEMORIA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cache simple con TTL para evitar llamadas repetidas a OpenAI
 * @type {Map<string, {embedding: number[], expiresAt: number}>}
 */
const embeddingCache = new Map();

// Limpieza periódica del cache
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, value] of embeddingCache) {
    if (value.expiresAt < now) {
      embeddingCache.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug({ cleaned, remaining: embeddingCache.size }, "Cleaned embedding cache");
  }
}, 5 * 60 * 1000); // cada 5 minutos

/**
 * Genera hash para cache key
 */
function getCacheKey(text) {
  // Hash simple pero efectivo para texto
  let hash = 0;
  const str = normalizeForEmbedding(text);
  
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  
  return `emb_${hash.toString(16)}`;
}

/**
 * Obtiene embedding del cache si existe y no está expirado
 */
function getFromCache(text) {
  if (!embeddingConfig.cacheEnabled) return null;
  
  const key = getCacheKey(text);
  const cached = embeddingCache.get(key);
  
  if (!cached) return null;
  
  if (cached.expiresAt < Date.now()) {
    embeddingCache.delete(key);
    return null;
  }
  
  return cached.embedding;
}

/**
 * Guarda embedding en cache
 */
function setInCache(text, embedding) {
  if (!embeddingConfig.cacheEnabled || !embedding) return;
  
  // Eviction si el cache está lleno
  if (embeddingCache.size >= embeddingConfig.cacheMaxSize) {
    // Eliminar el 10% más antiguo
    const entries = Array.from(embeddingCache.entries())
      .sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    
    const toDelete = Math.ceil(entries.length * 0.1);
    for (let i = 0; i < toDelete; i++) {
      embeddingCache.delete(entries[i][0]);
    }
  }
  
  const key = getCacheKey(text);
  embeddingCache.set(key, {
    embedding,
    expiresAt: Date.now() + embeddingConfig.cacheTtlMs,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normaliza texto para embedding
 * Menos agresivo que para hash - preserva semántica
 */
function normalizeForEmbedding(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    // Normalizar espacios múltiples
    .replace(/\s+/g, " ")
    // Limitar longitud (embeddings tienen límite de tokens)
    .substring(0, 8000);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE EMBEDDINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera embedding para un texto
 * 
 * @param {string} text - Texto a vectorizar
 * @returns {Promise<number[]|null>} Vector de dimensiones configuradas
 */
export async function getEmbedding(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  
  const normalized = normalizeForEmbedding(text);
  if (!normalized) {
    return null;
  }
  
  // Verificar cache primero
  const cached = getFromCache(normalized);
  if (cached) {
    logger.debug({ textPreview: normalized.substring(0, 30) }, "Embedding cache hit");
    return cached;
  }
  
  try {
    const client = getClient();
    
    const response = await client.embeddings.create({
      model: embeddingConfig.model,
      input: normalized,
      dimensions: embeddingConfig.dimensions,
    });
    
    const embedding = response.data[0]?.embedding;
    
    if (!embedding || !Array.isArray(embedding)) {
      logger.warn({ response }, "Invalid embedding response");
      return null;
    }
    
    // Guardar en cache
    setInCache(normalized, embedding);
    
    logger.debug({
      textPreview: normalized.substring(0, 30),
      dimensions: embedding.length,
      usage: response.usage,
    }, "Generated embedding");
    
    return embedding;
    
  } catch (error) {
    logger.error({
      error: error.message,
      textPreview: normalized.substring(0, 30),
    }, "Failed to generate embedding");
    
    return null;
  }
}

/**
 * Genera embeddings para múltiples textos en batch
 * Más eficiente que llamadas individuales
 * 
 * @param {string[]} texts - Array de textos a vectorizar
 * @returns {Promise<(number[]|null)[]>} Array de embeddings (null si falla alguno)
 */
export async function getEmbeddingBatch(texts) {
  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    return [];
  }
  
  // Normalizar y filtrar textos vacíos, mantener índices originales
  const normalized = texts.map((t, i) => ({
    index: i,
    text: normalizeForEmbedding(t || ""),
  }));
  
  // Verificar cache para cada texto
  const results = new Array(texts.length).fill(null);
  const toGenerate = [];
  
  for (const item of normalized) {
    if (!item.text) continue;
    
    const cached = getFromCache(item.text);
    if (cached) {
      results[item.index] = cached;
    } else {
      toGenerate.push(item);
    }
  }
  
  // Si todo estaba en cache, retornar
  if (toGenerate.length === 0) {
    logger.debug({ total: texts.length, cached: texts.length }, "All embeddings from cache");
    return results;
  }
  
  try {
    const client = getClient();
    
    // Dividir en batches si es necesario
    const batches = [];
    for (let i = 0; i < toGenerate.length; i += embeddingConfig.maxBatchSize) {
      batches.push(toGenerate.slice(i, i + embeddingConfig.maxBatchSize));
    }
    
    for (const batch of batches) {
      const batchTexts = batch.map(item => item.text);
      
      const response = await client.embeddings.create({
        model: embeddingConfig.model,
        input: batchTexts,
        dimensions: embeddingConfig.dimensions,
      });
      
      // Mapear respuestas a índices originales
      for (let i = 0; i < response.data.length; i++) {
        const embedding = response.data[i]?.embedding;
        const originalIndex = batch[i].index;
        
        if (embedding && Array.isArray(embedding)) {
          results[originalIndex] = embedding;
          setInCache(batch[i].text, embedding);
        }
      }
      
      logger.debug({
        batchSize: batch.length,
        usage: response.usage,
      }, "Generated batch embeddings");
    }
    
    const generated = toGenerate.length;
    const cached = texts.length - generated;
    
    logger.info({
      total: texts.length,
      generated,
      cached,
      batches: batches.length,
    }, "Batch embedding complete");
    
    return results;
    
  } catch (error) {
    logger.error({
      error: error.message,
      toGenerate: toGenerate.length,
    }, "Failed to generate batch embeddings");
    
    return results;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SIMILITUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula similitud coseno entre dos vectores
 * @param {number[]} a - Primer vector
 * @param {number[]} b - Segundo vector
 * @returns {number} Similitud entre 0 y 1
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) {
    return 0;
  }
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
  
  if (magnitude === 0) return 0;
  
  return dotProduct / magnitude;
}

/**
 * Encuentra el embedding más similar a una query entre una lista
 * Útil para matching local sin base de datos
 * 
 * @param {number[]} queryEmbedding - Embedding de la query
 * @param {Array<{embedding: number[], data: any}>} candidates - Candidatos
 * @param {number} threshold - Umbral mínimo de similitud
 * @returns {Object|null} Mejor match o null
 */
export function findMostSimilar(queryEmbedding, candidates, threshold = 0.75) {
  if (!queryEmbedding || !candidates?.length) {
    return null;
  }
  
  let bestMatch = null;
  let bestSimilarity = threshold;
  
  for (const candidate of candidates) {
    if (!candidate.embedding) continue;
    
    const similarity = cosineSimilarity(queryEmbedding, candidate.embedding);
    
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestMatch = {
        ...candidate.data,
        similarity,
      };
    }
  }
  
  return bestMatch;
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

export function getCacheStats() {
  return {
    enabled: embeddingConfig.cacheEnabled,
    size: embeddingCache.size,
    maxSize: embeddingConfig.cacheMaxSize,
    ttlMs: embeddingConfig.cacheTtlMs,
  };
}

export function clearCache() {
  const size = embeddingCache.size;
  embeddingCache.clear();
  logger.info({ cleared: size }, "Embedding cache cleared");
  return size;
}

export function getEmbeddingConfig() {
  return { ...embeddingConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const embeddings = {
  get: getEmbedding,
  getBatch: getEmbeddingBatch,
  cosineSimilarity,
  findMostSimilar,
  getCacheStats,
  clearCache,
  getConfig: getEmbeddingConfig,
};

export default embeddings;
