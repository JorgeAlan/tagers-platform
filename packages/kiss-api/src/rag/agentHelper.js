/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RAG AGENT HELPER - Integración de RAG con el agente Tan•IA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Este módulo facilita la integración del pipeline RAG con el flujo
 * del agente conversacional. Genera contexto enriquecido para incluir
 * en los prompts del sistema.
 * 
 * Uso en agentic_flow.js:
 * ```javascript
 * import { enrichPromptWithRAG } from '../rag/agentHelper.js';
 * 
 * const context = await enrichPromptWithRAG(userMessage, {
 *   categories: ['menu', 'faq'],
 *   maxChunks: 3,
 * });
 * 
 * const systemPrompt = basePrompt + context.formattedContext;
 * ```
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { 
  searchDocuments, 
  generateRAGContext,
  getHealthStatus,
} from "./ingestPipeline.js";
import { isReady as isVectorReady } from "../vector/vectorStore.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const helperConfig = {
  enabled: process.env.RAG_AGENT_ENABLED !== "false",
  
  // Categorías con prioridad alta (siempre buscar)
  priorityCategories: ["menu", "faq", "policy"],
  
  // Umbral de similitud mínimo
  minThreshold: parseFloat(process.env.RAG_MIN_THRESHOLD || "0.65"),
  
  // Máximo de chunks a incluir en contexto
  maxChunks: parseInt(process.env.RAG_MAX_CHUNKS || "4", 10),
  
  // Máximo de caracteres de contexto
  maxContextLength: parseInt(process.env.RAG_MAX_CONTEXT_LENGTH || "4000", 10),
  
  // Cache de queries recientes (evitar búsquedas duplicadas)
  cacheEnabled: process.env.RAG_QUERY_CACHE !== "false",
  cacheTtlMs: parseInt(process.env.RAG_QUERY_CACHE_TTL || "60000", 10), // 1 minuto
};

// Cache simple en memoria
const queryCache = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// DETECCIÓN DE INTENCIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta si el mensaje requiere contexto RAG
 * Algunos mensajes no necesitan buscar documentos
 */
export function shouldUseRAG(message) {
  if (!helperConfig.enabled || !isVectorReady()) {
    return false;
  }
  
  const lower = (message || "").toLowerCase().trim();
  
  // Mensajes muy cortos o saludos simples
  if (lower.length < 5) return false;
  
  const skipPatterns = [
    /^(hola|hi|hey|buenos? d[ií]as?|buenas? (tardes?|noches?))\.?$/i,
    /^(gracias|thanks|ok|okay|vale|listo|perfecto)\.?$/i,
    /^(s[ií]|no|claro|por supuesto)\.?$/i,
    /^[👍👌🙏😊❤️]+$/,
    /^(adios|bye|hasta luego|chao)\.?$/i,
  ];
  
  if (skipPatterns.some(p => p.test(lower))) {
    return false;
  }
  
  // Mensajes que probablemente necesitan contexto
  const ragTriggers = [
    // Preguntas sobre productos/menú
    /\b(tienen|hay|venden|precio|costo|cuanto|cuesta|cual|cuáles)\b/i,
    /\b(pan|rosca|pastel|galleta|postre|cafe|café|bebida|comida)\b/i,
    /\b(ingrediente|sin gluten|vegano|vegetariano|azúcar|alergia)\b/i,
    
    // Preguntas sobre ubicación/horarios
    /\b(donde|dónde|dirección|ubicación|sucursal|horario|abierto|cerrado)\b/i,
    /\b(domicilio|entrega|envío|envio|delivery)\b/i,
    
    // Preguntas sobre pedidos
    /\b(pedido|orden|comprar|ordenar|reservar|apartar)\b/i,
    /\b(pago|tarjeta|efectivo|transferencia)\b/i,
    
    // Políticas
    /\b(politica|política|devolucion|devolución|cambio|garantía|garantia)\b/i,
    
    // Información general
    /\b(que es|qué es|como|cómo|porque|por qué|información|info)\b/i,
  ];
  
  return ragTriggers.some(p => p.test(lower));
}

/**
 * Detecta categorías relevantes basado en el mensaje
 */
export function detectRelevantCategories(message) {
  const lower = (message || "").toLowerCase();
  const categories = new Set();
  
  // Patrones por categoría
  const categoryPatterns = {
    menu: [
      /\b(menu|menú|carta|producto|precio|costo|pan|rosca|pastel|galleta|postre|cafe|café|bebida)\b/i,
      /\b(tienen|hay|venden|cuanto|cuesta)\b/i,
    ],
    faq: [
      /\b(pregunta|duda|como|cómo|que es|qué es|porque|por qué)\b/i,
      /\b(horario|ubicación|sucursal|dirección|donde|dónde)\b/i,
    ],
    policy: [
      /\b(politica|política|terminos|términos|condicion|devolución|devolucion|cambio|garantía)\b/i,
      /\b(envío|envio|domicilio|entrega|cancelar)\b/i,
    ],
    recipe: [
      /\b(receta|ingrediente|preparación|preparacion|hacer|cocinar)\b/i,
      /\b(sin gluten|vegano|vegetariano|alergia|alergeno)\b/i,
    ],
    training: [
      /\b(capacitación|capacitacion|entrenamiento|procedimiento|proceso)\b/i,
    ],
    promo: [
      /\b(promoción|promocion|descuento|oferta|especial|2x1)\b/i,
    ],
  };
  
  for (const [category, patterns] of Object.entries(categoryPatterns)) {
    if (patterns.some(p => p.test(lower))) {
      categories.add(category);
    }
  }
  
  // Si no detectamos ninguna, usar las de prioridad
  if (categories.size === 0) {
    return helperConfig.priorityCategories;
  }
  
  return Array.from(categories);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE CONTEXTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enriquece el prompt del agente con contexto RAG
 * 
 * @param {string} userMessage - Mensaje del usuario
 * @param {Object} options
 * @param {string[]} [options.categories] - Categorías a buscar
 * @param {number} [options.maxChunks] - Máximo de chunks
 * @param {number} [options.threshold] - Umbral de similitud
 * @param {boolean} [options.forceSearch] - Forzar búsqueda aunque no parezca necesaria
 * @returns {Promise<RAGContextResult>}
 */
export async function enrichPromptWithRAG(userMessage, options = {}) {
  const startTime = Date.now();
  
  // Verificar si RAG está disponible
  if (!helperConfig.enabled || !isVectorReady()) {
    return {
      hasContext: false,
      reason: "rag_disabled",
    };
  }
  
  // Verificar si necesita RAG
  if (!options.forceSearch && !shouldUseRAG(userMessage)) {
    return {
      hasContext: false,
      reason: "not_needed",
    };
  }
  
  // Check cache
  const cacheKey = userMessage.toLowerCase().trim();
  if (helperConfig.cacheEnabled && queryCache.has(cacheKey)) {
    const cached = queryCache.get(cacheKey);
    if (Date.now() - cached.timestamp < helperConfig.cacheTtlMs) {
      logger.debug({ cacheHit: true }, "RAG cache hit");
      return { ...cached.result, cached: true };
    }
    queryCache.delete(cacheKey);
  }
  
  try {
    // Detectar categorías relevantes
    const categories = options.categories || detectRelevantCategories(userMessage);
    const maxChunks = options.maxChunks || helperConfig.maxChunks;
    const threshold = options.threshold || helperConfig.minThreshold;
    
    // Buscar en cada categoría
    let allResults = [];
    
    for (const category of categories) {
      const { results } = await searchDocuments(userMessage, {
        category,
        limit: Math.ceil(maxChunks / categories.length) + 1,
        threshold,
      });
      allResults.push(...results);
    }
    
    // Ordenar por score y limitar
    allResults.sort((a, b) => b.score - a.score);
    allResults = allResults.slice(0, maxChunks);
    
    if (!allResults.length) {
      const result = {
        hasContext: false,
        reason: "no_matches",
        duration_ms: Date.now() - startTime,
      };
      
      return result;
    }
    
    // Formatear contexto
    const formattedContext = formatContextForPrompt(allResults);
    
    // Verificar longitud
    const truncated = formattedContext.length > helperConfig.maxContextLength;
    const finalContext = truncated 
      ? formattedContext.substring(0, helperConfig.maxContextLength) + "\n\n[... contexto truncado]"
      : formattedContext;
    
    const result = {
      hasContext: true,
      formattedContext: finalContext,
      sources: allResults.map(r => ({
        title: r.metadata?.documentTitle || r.source,
        category: r.category,
        score: r.score,
      })),
      stats: {
        chunksFound: allResults.length,
        categories: [...new Set(allResults.map(r => r.category))],
        avgScore: allResults.reduce((sum, r) => sum + r.score, 0) / allResults.length,
        truncated,
      },
      duration_ms: Date.now() - startTime,
    };
    
    // Guardar en cache
    if (helperConfig.cacheEnabled) {
      queryCache.set(cacheKey, {
        result,
        timestamp: Date.now(),
      });
      
      // Limpiar cache viejo
      if (queryCache.size > 100) {
        const now = Date.now();
        for (const [key, value] of queryCache.entries()) {
          if (now - value.timestamp > helperConfig.cacheTtlMs) {
            queryCache.delete(key);
          }
        }
      }
    }
    
    logger.debug({
      query: userMessage.substring(0, 50),
      chunksFound: allResults.length,
      duration_ms: result.duration_ms,
    }, "RAG context generated");
    
    return result;
    
  } catch (error) {
    logger.error({ err: error.message }, "RAG enrichment failed");
    return {
      hasContext: false,
      reason: "error",
      error: error.message,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Formatea los resultados para incluir en el prompt del sistema
 */
function formatContextForPrompt(results) {
  if (!results?.length) return "";
  
  const lines = [
    "",
    "═══════════════════════════════════════════════════════════",
    "INFORMACIÓN DE REFERENCIA (Base de conocimientos Tagers):",
    "═══════════════════════════════════════════════════════════",
    "",
  ];
  
  for (const result of results) {
    const source = result.metadata?.documentTitle || result.source || "Documento";
    const category = result.category || "general";
    
    lines.push(`📄 [${category.toUpperCase()}] ${source}:`);
    lines.push(result.text);
    lines.push("");
  }
  
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("Usa esta información para responder de forma precisa.");
  lines.push("Si la respuesta no está en el contexto, responde con tu conocimiento general.");
  lines.push("═══════════════════════════════════════════════════════════");
  lines.push("");
  
  return lines.join("\n");
}

/**
 * Genera instrucción de sistema con RAG incorporado
 */
export async function generateSystemPromptWithRAG(basePrompt, userMessage, options = {}) {
  const ragContext = await enrichPromptWithRAG(userMessage, options);
  
  if (!ragContext.hasContext) {
    return {
      systemPrompt: basePrompt,
      ragUsed: false,
      reason: ragContext.reason,
    };
  }
  
  return {
    systemPrompt: basePrompt + ragContext.formattedContext,
    ragUsed: true,
    sources: ragContext.sources,
    stats: ragContext.stats,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estado del helper
 */
export function getHelperStatus() {
  return {
    enabled: helperConfig.enabled,
    vectorReady: isVectorReady(),
    cacheSize: queryCache.size,
    config: {
      minThreshold: helperConfig.minThreshold,
      maxChunks: helperConfig.maxChunks,
      maxContextLength: helperConfig.maxContextLength,
    },
  };
}

/**
 * Limpia cache de queries
 */
export function clearQueryCache() {
  const size = queryCache.size;
  queryCache.clear();
  return { cleared: size };
}

/**
 * Obtiene configuración
 */
export function getHelperConfig() {
  return { ...helperConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const ragAgentHelper = {
  // Main functions
  enrichPrompt: enrichPromptWithRAG,
  generateSystemPrompt: generateSystemPromptWithRAG,
  
  // Detection
  shouldUseRAG,
  detectCategories: detectRelevantCategories,
  
  // Utils
  getStatus: getHelperStatus,
  clearCache: clearQueryCache,
  getConfig: getHelperConfig,
};

export default ragAgentHelper;
