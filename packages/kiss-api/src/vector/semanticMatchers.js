/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SEMANTIC MATCHERS - Búsqueda Semántica con pgvector
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * REEMPLAZA el fuzzy matching de matchers.js con búsquedas semánticas reales.
 * 
 * ANTES (fuzzy matching):
 *   "pan de reyes" ❌ NO match con "rosca" (no tiene keyword exacto)
 * 
 * AHORA (semantic search):
 *   "pan de reyes" ✅ match con "rosca" (similitud semántica ~0.89)
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { searchSimilar, findBestMatch, isReady as isVectorStoreReady } from "./vectorStore.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const matcherConfig = {
  // Umbrales de similitud por tipo
  thresholds: {
    product: parseFloat(process.env.SEMANTIC_THRESHOLD_PRODUCT || "0.75"),
    branch: parseFloat(process.env.SEMANTIC_THRESHOLD_BRANCH || "0.80"),
    faq: parseFloat(process.env.SEMANTIC_THRESHOLD_FAQ || "0.78"),
    knowledge: parseFloat(process.env.SEMANTIC_THRESHOLD_KNOWLEDGE || "0.75"),
  },
  
  // Límite de resultados por búsqueda
  maxResults: parseInt(process.env.SEMANTIC_MAX_RESULTS || "3", 10),
  
  // Fallback a fuzzy matching si vector store no está disponible
  fallbackToFuzzy: process.env.SEMANTIC_FALLBACK_FUZZY !== "false",
};

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN SEMÁNTICA DE PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae producto del texto usando búsqueda semántica
 * REEMPLAZA: extractProduct() en matchers.js
 * 
 * EJEMPLOS:
 * - "quiero una rosca" → encuentra Rosca de Reyes
 * - "tienen pan de reyes" → encuentra Rosca de Reyes (sinónimo semántico)
 * - "quiero café" → encuentra productos de café
 * 
 * @param {string} text - Texto del usuario
 * @returns {Object|null} Producto encontrado o null
 */
export async function extractProductSemantic(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  
  // Verificar si vector store está disponible
  if (!isVectorStoreReady()) {
    logger.debug("Vector store not ready, skipping semantic product extraction");
    return null;
  }
  
  try {
    const results = await searchSimilar(text, {
      category: "product",
      threshold: matcherConfig.thresholds.product,
      limit: matcherConfig.maxResults,
    });
    
    if (!results.length) {
      logger.debug({ text: text.substring(0, 40) }, "No semantic product match found");
      return null;
    }
    
    const bestMatch = results[0];
    
    // Extraer metadata del producto
    const product = {
      woo_id: bestMatch.metadata?.woo_id || null,
      sku: bestMatch.metadata?.sku || null,
      name: bestMatch.metadata?.name || bestMatch.text,
      price: bestMatch.metadata?.price || null,
      confidence: bestMatch.similarity,
      source: "semantic",
      matched_text: bestMatch.text.substring(0, 50),
      needs_clarification: results.length > 1 && results[1].similarity > 0.8,
      alternatives: results.slice(1).map(r => ({
        name: r.metadata?.name || r.text,
        similarity: r.similarity,
      })),
    };
    
    logger.debug({
      query: text.substring(0, 40),
      match: product.name,
      similarity: product.confidence,
    }, "Semantic product match found");
    
    return product;
    
  } catch (error) {
    logger.error({ error: error.message, text: text.substring(0, 40) }, "Semantic product extraction failed");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN SEMÁNTICA DE SUCURSALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae sucursal del texto usando búsqueda semántica
 * REEMPLAZA: extractBranch() en matchers.js
 * 
 * EJEMPLOS:
 * - "recoger en 5 sur" → Sucursal Cinco Sur
 * - "la que está en angelópolis" → Sucursal Angelópolis
 * - "en cdmx" → Sucursal San Ángel CDMX
 * 
 * @param {string} text - Texto del usuario
 * @returns {Object|null} Sucursal encontrada o null
 */
export async function extractBranchSemantic(text) {
  if (!text || typeof text !== "string") {
    return null;
  }
  
  if (!isVectorStoreReady()) {
    logger.debug("Vector store not ready, skipping semantic branch extraction");
    return null;
  }
  
  try {
    const results = await searchSimilar(text, {
      category: "branch",
      threshold: matcherConfig.thresholds.branch,
      limit: 2,
    });
    
    if (!results.length) {
      logger.debug({ text: text.substring(0, 40) }, "No semantic branch match found");
      return null;
    }
    
    const bestMatch = results[0];
    
    const branch = {
      branch_id: bestMatch.metadata?.branch_id || null,
      name: bestMatch.metadata?.name || bestMatch.text,
      short_name: bestMatch.metadata?.short_name || null,
      address: bestMatch.metadata?.address || null,
      city: bestMatch.metadata?.city || null,
      confidence: bestMatch.similarity,
      source: "semantic",
    };
    
    logger.debug({
      query: text.substring(0, 40),
      match: branch.name,
      similarity: branch.confidence,
    }, "Semantic branch match found");
    
    return branch;
    
  } catch (error) {
    logger.error({ error: error.message }, "Semantic branch extraction failed");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA DE FAQs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca FAQs relevantes semánticamente
 * 
 * EJEMPLOS:
 * - "¿a qué hora cierran?" → FAQ de horarios
 * - "¿hacen envíos?" → FAQ de delivery
 * - "¿aceptan tarjeta?" → FAQ de métodos de pago
 * 
 * @param {string} query - Pregunta del usuario
 * @returns {Object|null} FAQ más relevante
 */
export async function findFAQSemantic(query) {
  if (!query || !isVectorStoreReady()) {
    return null;
  }
  
  try {
    const result = await findBestMatch(query, {
      category: "faq",
      threshold: matcherConfig.thresholds.faq,
    });
    
    if (!result) {
      return null;
    }
    
    return {
      question: result.metadata?.question || query,
      answer: result.metadata?.answer || result.text,
      similarity: result.similarity,
      source: "semantic",
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Semantic FAQ search failed");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA DE CONOCIMIENTO BASE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca conocimiento contextual relevante
 * 
 * @param {string} query - Query de búsqueda
 * @param {Object} options - Opciones de filtrado
 * @returns {Array} Fragmentos de conocimiento relevantes
 */
export async function findKnowledgeSemantic(query, options = {}) {
  if (!query || !isVectorStoreReady()) {
    return [];
  }
  
  const { branchId = null, maxResults = 3 } = options;
  
  try {
    const results = await searchSimilar(query, {
      category: "knowledge",
      threshold: matcherConfig.thresholds.knowledge,
      limit: maxResults,
    });
    
    // Filtrar por branch si se especifica
    const filtered = branchId
      ? results.filter(r => 
          r.metadata?.branch_id === "ALL" || 
          r.metadata?.branch_id === branchId
        )
      : results;
    
    return filtered.map(r => ({
      content: r.text,
      key: r.metadata?.key,
      scope: r.metadata?.scope,
      priority: r.metadata?.priority,
      similarity: r.similarity,
    }));
    
  } catch (error) {
    logger.error({ error: error.message }, "Semantic knowledge search failed");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER HÍBRIDO (SEMÁNTICO + FUZZY)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae producto con fallback a fuzzy matching
 * Usa búsqueda semántica primero, luego fuzzy si falla
 * 
 * @param {string} text - Texto del usuario
 * @param {Function} fuzzyExtractor - Función de fallback (extractProduct de matchers.js)
 * @returns {Object|null} Producto encontrado
 */
export async function extractProductHybrid(text, fuzzyExtractor = null) {
  // Intentar semántico primero
  const semanticResult = await extractProductSemantic(text);
  
  if (semanticResult) {
    return semanticResult;
  }
  
  // Fallback a fuzzy si está habilitado y hay función
  if (matcherConfig.fallbackToFuzzy && fuzzyExtractor) {
    logger.debug("Falling back to fuzzy product matching");
    const fuzzyResult = fuzzyExtractor(text);
    
    if (fuzzyResult) {
      return {
        ...fuzzyResult,
        source: "fuzzy_fallback",
      };
    }
  }
  
  return null;
}

/**
 * Extrae sucursal con fallback a fuzzy matching
 */
export async function extractBranchHybrid(text, fuzzyExtractor = null) {
  const semanticResult = await extractBranchSemantic(text);
  
  if (semanticResult) {
    return semanticResult;
  }
  
  if (matcherConfig.fallbackToFuzzy && fuzzyExtractor) {
    logger.debug("Falling back to fuzzy branch matching");
    const fuzzyResult = fuzzyExtractor(text);
    
    if (fuzzyResult) {
      return {
        ...fuzzyResult,
        source: "fuzzy_fallback",
      };
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA GENERAL MULTICONCEPTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Búsqueda semántica general que encuentra cualquier tipo de contenido
 * Útil para queries ambiguas
 * 
 * @param {string} query - Query del usuario
 * @param {Object} options
 * @returns {Array} Resultados ordenados por similitud
 */
export async function searchGeneral(query, options = {}) {
  if (!query || !isVectorStoreReady()) {
    return [];
  }
  
  const {
    threshold = 0.75,
    maxResults = 5,
    categories = null, // Array de categorías a buscar, o null para todas
  } = options;
  
  try {
    // Si no hay filtro de categorías, buscar en todas
    if (!categories) {
      return await searchSimilar(query, { threshold, limit: maxResults });
    }
    
    // Buscar en múltiples categorías y combinar resultados
    const allResults = [];
    
    for (const category of categories) {
      const results = await searchSimilar(query, {
        category,
        threshold,
        limit: Math.ceil(maxResults / categories.length) + 1,
      });
      allResults.push(...results);
    }
    
    // Ordenar por similitud y limitar
    return allResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);
    
  } catch (error) {
    logger.error({ error: error.message }, "General semantic search failed");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO PARA LLM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene contexto relevante para enriquecer el prompt del LLM
 * 
 * @param {string} query - Mensaje del usuario
 * @param {Object} options
 * @returns {string} Contexto formateado para el prompt
 */
export async function getContextForLLM(query, options = {}) {
  if (!query || !isVectorStoreReady()) {
    return "";
  }
  
  const {
    maxChunks = 3,
    categories = ["faq", "knowledge", "product"],
  } = options;
  
  try {
    const results = await searchGeneral(query, {
      threshold: 0.72,
      maxResults: maxChunks,
      categories,
    });
    
    if (!results.length) {
      return "";
    }
    
    const contextParts = results.map((r, i) => {
      const label = r.category.toUpperCase();
      return `[${label} ${i + 1}] ${r.text}`;
    });
    
    return `\n\n<RELEVANT_CONTEXT>\n${contextParts.join("\n\n")}\n</RELEVANT_CONTEXT>\n`;
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get context for LLM");
    return "";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

export function getMatcherConfig() {
  return { ...matcherConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const semanticMatchers = {
  // Extractores principales
  extractProduct: extractProductSemantic,
  extractBranch: extractBranchSemantic,
  
  // Híbridos con fallback
  extractProductHybrid,
  extractBranchHybrid,
  
  // Búsquedas
  findFAQ: findFAQSemantic,
  findKnowledge: findKnowledgeSemantic,
  searchGeneral,
  
  // Para LLM
  getContextForLLM,
  
  // Config
  getConfig: getMatcherConfig,
};

export default semanticMatchers;
