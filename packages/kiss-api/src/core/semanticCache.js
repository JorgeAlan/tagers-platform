/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SEMANTIC CACHE - Caché Inteligente de Respuestas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Evita llamadas repetidas a la IA cuando preguntas similares ya fueron
 * respondidas. Usa embeddings para encontrar preguntas semánticamente
 * similares (no solo texto exacto).
 * 
 * BENEFICIOS:
 * - Ahorro de costos: Evita llamadas a OpenAI para preguntas frecuentes
 * - Velocidad: Respuesta en <100ms vs 2-5s de IA
 * - Consistencia: Mismas preguntas = mismas respuestas
 * 
 * IMPLEMENTACIÓN:
 * - Fase 1 (actual): Caché por hash exacto con TTL
 * - Fase 2 (futuro): Embeddings + vector search para similitud semántica
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const cacheConfig = {
  enabled: process.env.SEMANTIC_CACHE_ENABLED !== "false",
  
  // TTL por categoría (milisegundos)
  ttl: {
    faq: parseInt(process.env.CACHE_TTL_FAQ_MS || String(24 * 60 * 60 * 1000), 10),       // 24 horas
    general: parseInt(process.env.CACHE_TTL_GENERAL_MS || String(4 * 60 * 60 * 1000), 10), // 4 horas
    transient: parseInt(process.env.CACHE_TTL_TRANSIENT_MS || String(30 * 60 * 1000), 10), // 30 min
  },
  
  // Límites
  maxEntries: parseInt(process.env.CACHE_MAX_ENTRIES || "5000", 10),
  
  // Umbral de similitud para considerar cache hit (fase 2)
  similarityThreshold: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD || "0.92"),
};

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY CACHE STORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} CacheEntry
 * @property {string} hash - Hash de la pregunta normalizada
 * @property {string} question - Pregunta original normalizada
 * @property {string} response - Respuesta cacheada
 * @property {string} category - Categoría (faq, general, transient)
 * @property {number} createdAt - Timestamp de creación
 * @property {number} expiresAt - Timestamp de expiración
 * @property {number} hits - Número de veces que fue usada
 * @property {Object} metadata - Metadata adicional
 */

/** @type {Map<string, CacheEntry>} */
const cache = new Map();

// Stats
const stats = {
  hits: 0,
  misses: 0,
  evictions: 0,
};

// Cleanup periódico
setInterval(() => {
  cleanupExpired();
}, 5 * 60 * 1000); // cada 5 minutos

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZACIÓN DE PREGUNTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normaliza una pregunta para maximizar cache hits
 */
function normalizeQuestion(text) {
  return (text || "")
    .toLowerCase()
    .trim()
    // Quitar acentos
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Quitar signos de puntuación
    .replace(/[¿¡?!.,;:'"()\[\]{}]/g, "")
    // Normalizar espacios
    .replace(/\s+/g, " ")
    // Quitar palabras vacías comunes
    .replace(/\b(el|la|los|las|un|una|unos|unas|de|del|en|a|por|para|con|y|o|que|es|son)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Genera hash de la pregunta normalizada
 */
function hashQuestion(normalizedQuestion) {
  return crypto
    .createHash("sha256")
    .update(normalizedQuestion)
    .digest("hex")
    .substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════════════════
// CATEGORIZACIÓN DE PREGUNTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta la categoría de una pregunta para determinar TTL
 */
function categorizeQuestion(text) {
  const t = normalizeQuestion(text);
  
  // FAQs - cachear por mucho tiempo
  const faqPatterns = [
    /\b(horario|hora|abren|cierran)\b/,
    /\b(ubicacion|direccion|donde|sucursal)\b/,
    /\b(menu|carta|producto|precio)\b/,
    /\b(envio|domicilio|delivery)\b/,
    /\b(pago|tarjeta|efectivo|transferencia)\b/,
    /\b(telefono|contacto|whatsapp)\b/,
  ];
  
  if (faqPatterns.some(p => p.test(t))) {
    return "faq";
  }
  
  // Transient - poco tiempo
  const transientPatterns = [
    /\b(hoy|ahora|ahorita|momento)\b/,
    /\b(disponible|hay|tienen)\b/,
    /\b(mi pedido|mi orden)\b/,
  ];
  
  if (transientPatterns.some(p => p.test(t))) {
    return "transient";
  }
  
  return "general";
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca en caché una respuesta para la pregunta
 * 
 * @param {string} question - Pregunta del usuario
 * @returns {Object|null} { hit: boolean, response?: string, metadata?: Object }
 */
export function get(question) {
  if (!cacheConfig.enabled) {
    return { hit: false };
  }
  
  const normalized = normalizeQuestion(question);
  const hash = hashQuestion(normalized);
  
  const entry = cache.get(hash);
  
  if (!entry) {
    stats.misses++;
    return { hit: false };
  }
  
  // Verificar expiración
  if (Date.now() > entry.expiresAt) {
    cache.delete(hash);
    stats.misses++;
    return { hit: false };
  }
  
  // Cache hit!
  entry.hits++;
  stats.hits++;
  
  logger.debug({
    question: question.substring(0, 50),
    hash,
    category: entry.category,
    hits: entry.hits,
  }, "Semantic cache HIT");
  
  return {
    hit: true,
    response: entry.response,
    metadata: entry.metadata,
    category: entry.category,
    cacheAge: Date.now() - entry.createdAt,
  };
}

/**
 * Guarda una respuesta en caché
 * 
 * @param {string} question - Pregunta original
 * @param {string} response - Respuesta a cachear
 * @param {Object} options - Opciones adicionales
 * @param {string} options.category - Categoría (faq, general, transient)
 * @param {Object} options.metadata - Metadata adicional
 * @returns {string} Hash de la entrada
 */
export function set(question, response, options = {}) {
  if (!cacheConfig.enabled) return null;
  if (!question || !response) return null;
  
  // Evitar cachear respuestas de error
  if (isErrorResponse(response)) return null;
  
  const normalized = normalizeQuestion(question);
  const hash = hashQuestion(normalized);
  
  // Detectar categoría si no se especifica
  const category = options.category || categorizeQuestion(question);
  const ttl = cacheConfig.ttl[category] || cacheConfig.ttl.general;
  
  const entry = {
    hash,
    question: normalized,
    response,
    category,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttl,
    hits: 0,
    metadata: options.metadata || {},
  };
  
  // Verificar límite de entradas
  if (cache.size >= cacheConfig.maxEntries) {
    evictOldest();
  }
  
  cache.set(hash, entry);
  
  logger.debug({
    question: question.substring(0, 50),
    hash,
    category,
    ttlMs: ttl,
  }, "Semantic cache SET");
  
  return hash;
}

/**
 * Invalida una entrada específica
 */
export function invalidate(question) {
  const normalized = normalizeQuestion(question);
  const hash = hashQuestion(normalized);
  return cache.delete(hash);
}

/**
 * Invalida entradas por patrón
 */
export function invalidatePattern(pattern) {
  let count = 0;
  const regex = new RegExp(pattern, "i");
  
  for (const [hash, entry] of cache) {
    if (regex.test(entry.question)) {
      cache.delete(hash);
      count++;
    }
  }
  
  logger.info({ pattern, invalidated: count }, "Cache invalidated by pattern");
  return count;
}

/**
 * Invalida todas las entradas de una categoría
 */
export function invalidateCategory(category) {
  let count = 0;
  
  for (const [hash, entry] of cache) {
    if (entry.category === category) {
      cache.delete(hash);
      count++;
    }
  }
  
  logger.info({ category, invalidated: count }, "Cache invalidated by category");
  return count;
}

/**
 * Limpia todo el caché
 */
export function clear() {
  const size = cache.size;
  cache.clear();
  logger.info({ cleared: size }, "Semantic cache cleared");
  return size;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

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

function cleanupExpired() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [hash, entry] of cache) {
    if (now > entry.expiresAt) {
      cache.delete(hash);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug({ cleaned }, "Cleaned expired cache entries");
  }
}

function evictOldest() {
  // Encontrar las entradas más antiguas y con menos hits
  const entries = Array.from(cache.entries())
    .map(([hash, entry]) => ({ hash, score: entry.hits / (Date.now() - entry.createdAt) }))
    .sort((a, b) => a.score - b.score);
  
  // Eliminar el 10% más bajo
  const toEvict = Math.max(1, Math.floor(entries.length * 0.1));
  
  for (let i = 0; i < toEvict; i++) {
    cache.delete(entries[i].hash);
    stats.evictions++;
  }
  
  logger.debug({ evicted: toEvict }, "Evicted low-value cache entries");
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS & MONITORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas del caché
 */
export function getStats() {
  const hitRate = stats.hits + stats.misses > 0
    ? (stats.hits / (stats.hits + stats.misses) * 100).toFixed(2)
    : 0;
  
  // Distribución por categoría
  const byCategory = {};
  for (const entry of cache.values()) {
    byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;
  }
  
  return {
    enabled: cacheConfig.enabled,
    entries: cache.size,
    maxEntries: cacheConfig.maxEntries,
    hits: stats.hits,
    misses: stats.misses,
    evictions: stats.evictions,
    hitRate: `${hitRate}%`,
    byCategory,
    config: {
      ttlFaq: cacheConfig.ttl.faq,
      ttlGeneral: cacheConfig.ttl.general,
      ttlTransient: cacheConfig.ttl.transient,
    },
  };
}

/**
 * Resetea estadísticas
 */
export function resetStats() {
  stats.hits = 0;
  stats.misses = 0;
  stats.evictions = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// WARMING (Pre-cargar respuestas comunes)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pre-carga respuestas frecuentes
 */
export function warmup(entries) {
  if (!Array.isArray(entries)) return 0;
  
  let loaded = 0;
  
  for (const { question, response, category } of entries) {
    if (question && response) {
      set(question, response, { category: category || "faq" });
      loaded++;
    }
  }
  
  logger.info({ loaded }, "Semantic cache warmed up");
  return loaded;
}

/**
 * Warmup desde Config Hub (sin datos hardcodeados)
 * Llamar después de que el Config Hub esté sincronizado
 */
export async function warmupFromConfigHub() {
  try {
    // Import dinámico para evitar dependencia circular
    const { getConfig } = await import("../config-hub/sync-service.js");
    const config = getConfig();
    
    if (!config) {
      logger.warn("Config Hub not ready for cache warmup");
      return 0;
    }
    
    const entries = [];
    
    // Generar FAQs de horarios desde branches + branch_hours
    if (config.branches && config.branch_hours) {
      const enabledBranches = config.branches.filter(b => b.enabled);
      if (enabledBranches.length > 0) {
        let horariosResponse = "📍 **Horarios:**\n";
        for (const branch of enabledBranches) {
          const hours = config.branch_hours.find(h => 
            h.branch_id === branch.branch_id && h.enabled
          );
          if (hours) {
            horariosResponse += `• ${branch.short_name || branch.name}: ${hours.open || '?'} - ${hours.close || '?'}\n`;
          }
        }
        entries.push({
          question: "¿A qué hora abren?",
          response: horariosResponse.trim(),
          category: "faq",
        });
        entries.push({
          question: "¿Cuáles son sus horarios?",
          response: horariosResponse.trim(),
          category: "faq",
        });
      }
    }
    
    // Generar FAQs de ubicaciones desde branches
    if (config.branches) {
      const enabledBranches = config.branches.filter(b => b.enabled);
      if (enabledBranches.length > 0) {
        let ubicacionResponse = "📍 **Sucursales:**\n";
        for (const branch of enabledBranches) {
          ubicacionResponse += `• ${branch.short_name || branch.name}`;
          if (branch.address) ubicacionResponse += ` - ${branch.address}`;
          ubicacionResponse += "\n";
        }
        entries.push({
          question: "¿Dónde están ubicados?",
          response: ubicacionResponse.trim(),
          category: "faq",
        });
        entries.push({
          question: "¿Cuáles son sus sucursales?",
          response: ubicacionResponse.trim(),
          category: "faq",
        });
      }
    }
    
    // Agregar FAQs del Config Hub
    if (config.faq) {
      const enabledFaqs = config.faq.filter(f => f.enabled);
      for (const faq of enabledFaqs) {
        entries.push({
          question: faq.question,
          response: faq.answer,
          category: "faq",
        });
      }
    }
    
    if (entries.length > 0) {
      const loaded = warmup(entries);
      logger.info({ loaded, source: "config_hub" }, "Semantic cache warmed from Config Hub");
      return loaded;
    }
    
    return 0;
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to warmup from Config Hub");
    return 0;
  }
}

// NO auto-warmup con datos hardcodeados
// El warmup se hace desde server.js después de sincronizar Config Hub

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const semanticCache = {
  get,
  set,
  invalidate,
  invalidatePattern,
  invalidateCategory,
  clear,
  getStats,
  resetStats,
  warmup,
  warmupFromConfigHub,
  normalizeQuestion,
  categorizeQuestion,
};

export default semanticCache;
