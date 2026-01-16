/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTIC FLOW OPTIMIZED v2.0 - Una sola llamada de AI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ANTES: Analyzer (AI) → Retriever → Generator (AI) → Validator (AI) x1-3
 *        = 3-9 llamadas de AI por mensaje
 * 
 * AHORA: FastPath → CacheCheck → CannedCheck → SingleAI (si necesario)
 *        = 0-1 llamadas de AI por mensaje
 * 
 * OPTIMIZACIONES:
 * 1. Eliminado Analyzer - redundante con Dispatcher
 * 2. Eliminado Validator - prompt bien escrito = respuesta de calidad
 * 3. Short-circuit agresivo con cache y canned responses
 * 4. Prompt compacto (~1KB vs ~10KB)
 * 5. Modelo más económico (gpt-5-mini vs gpt-5.2)
 * 
 * AHORRO ESTIMADO: 95% de tokens, 98% de costos
 * 
 * @version 2.0.0 - Optimized single-call flow
 */

import { generateTaniaReply } from "../openai_client_tania.js";
import { logger } from "../utils/logger.js";
import { getConfig } from "../config-hub/sync-service.js";
import { sendChatwootMessage } from "../integrations/chatwoot_client.js";
import { vectorStore, searchSimilar } from "../vector/vectorStore.js";
import { semanticCache } from "../core/semanticCache.js";
import { traceable } from "langsmith/traceable";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Cache settings
  CACHE_SIMILARITY_THRESHOLD: parseFloat(process.env.CACHE_SIMILARITY_THRESHOLD || "0.85"),
  CANNED_SIMILARITY_THRESHOLD: parseFloat(process.env.CANNED_SIMILARITY_THRESHOLD || "0.90"),
  
  // Model settings
  USE_MINI_MODEL: process.env.USE_MINI_MODEL !== "false", // Default: true (cheaper)
  
  // History settings
  MAX_HISTORY_MESSAGES: 5, // Solo los últimos 5 mensajes, no 30
  
  // Tracing
  LANGSMITH_ENABLED: process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY,
};

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY (Simplified)
// ═══════════════════════════════════════════════════════════════════════════

const historyCache = new Map();
const HISTORY_TTL_MS = 30 * 60 * 1000; // 30 min

export function getHistory(conversationId) {
  const entry = historyCache.get(String(conversationId));
  if (!entry || Date.now() - entry.ts > HISTORY_TTL_MS) return [];
  return entry.messages.slice(-CONFIG.MAX_HISTORY_MESSAGES);
}

export function addToHistory(conversationId, role, content) {
  const key = String(conversationId);
  const entry = historyCache.get(key) || { messages: [], ts: Date.now() };
  entry.messages.push({ role, content });
  entry.messages = entry.messages.slice(-CONFIG.MAX_HISTORY_MESSAGES);
  entry.ts = Date.now();
  historyCache.set(key, entry);
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: SEMANTIC CACHE CHECK (No AI)
// ═══════════════════════════════════════════════════════════════════════════

async function checkSemanticCache(messageText) {
  try {
    const result = semanticCache.get(messageText);
    if (result.hit) {
      logger.info({ 
        question: messageText.substring(0, 50),
        cacheAge: result.cacheAge,
      }, "✅ CACHE HIT - No AI needed");
      return { found: true, response: result.response, source: "semantic_cache" };
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Cache check failed");
  }
  return { found: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: CANNED RESPONSE CHECK (No AI)
// ═══════════════════════════════════════════════════════════════════════════

async function checkCannedResponses(messageText) {
  if (!vectorStore?.isReady?.()) return { found: false };
  
  try {
    const results = await searchSimilar(messageText, {
      limit: 1,
      threshold: CONFIG.CANNED_SIMILARITY_THRESHOLD,
      categories: ["canned", "faq"],
    });
    
    if (results?.length > 0 && results[0].similarity >= CONFIG.CANNED_SIMILARITY_THRESHOLD) {
      const match = results[0];
      logger.info({ 
        question: messageText.substring(0, 50),
        similarity: match.similarity,
        trigger: match.trigger || match.question,
      }, "✅ CANNED MATCH - No AI needed");
      return { 
        found: true, 
        response: match.response || match.answer, 
        source: "canned_response",
        similarity: match.similarity,
      };
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Canned check failed");
  }
  return { found: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: SINGLE AI CALL (Only if needed)
// ═══════════════════════════════════════════════════════════════════════════

const COMPACT_PROMPT = `Eres Tan • IA de Tagers (café/panadería México).

REGLAS:
1. Responde SOLO lo que preguntan
2. Si la info está en CONTEXTO, úsala. Si no, admítelo
3. 2-3 líneas máximo
4. Español mexicano, cálido
5. Si necesitas un dato (sucursal/fecha), pregunta UNA sola vez

CONTEXTO DISPONIBLE:
{context}

HISTORIAL RECIENTE:
{history}

Responde en JSON: {"customer_message": "...", "confidence": 0-1}`;

async function generateSingleAIResponse({ conversationId, messageText, context, history }) {
  // Build minimal context
  const contextStr = context ? JSON.stringify(context, null, 1) : "Sin contexto específico";
  const historyStr = history?.length > 0 
    ? history.map(h => `${h.role}: ${h.content}`).join("\n")
    : "Sin historial";
  
  const prompt = COMPACT_PROMPT
    .replace("{context}", contextStr.substring(0, 2000)) // Limit context size
    .replace("{history}", historyStr.substring(0, 1000)); // Limit history size
  
  try {
    const result = await generateTaniaReply({
      instructions: prompt,
      inputObject: { 
        message: messageText,
        conversation_id: conversationId,
      },
      // El modelo se obtiene del registry, pero podemos forzar mini si está configurado
      model: CONFIG.USE_MINI_MODEL ? "gpt-5-mini" : undefined,
      metadata: { 
        task: "tania_optimized", 
        conversationId,
        optimized: true,
      },
    });
    
    logger.info({ 
      conversationId,
      confidence: result.confidence,
      responseLength: result.customer_message?.length,
    }, "✅ AI Response generated (optimized)");
    
    return result;
  } catch (err) {
    logger.error({ err: err.message, conversationId }, "AI generation failed");
    return {
      customer_message: "Disculpa, tuve un problema. ¿Podrías repetir tu pregunta?",
      confidence: 0.3,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: GET MINIMAL CONTEXT (No AI)
// ═══════════════════════════════════════════════════════════════════════════

async function getMinimalContext(messageText) {
  const context = {};
  
  try {
    // Get Config Hub data (already in memory)
    const hubConfig = getConfig();
    
    // Only include relevant data based on keywords
    const t = messageText.toLowerCase();
    
    // Branches (if asking about locations)
    if (/sucursal|ubicaci|donde|direcci/i.test(t) && hubConfig?.branches) {
      context.branches = hubConfig.branches
        .filter(b => b.enabled)
        .map(b => ({ name: b.short_name || b.name, address: b.address }));
    }
    
    // Hours (if asking about hours)
    if (/hora|abren|cierran|horario/i.test(t) && hubConfig?.branch_hours) {
      context.hours = hubConfig.branch_hours
        .filter(h => h.enabled)
        .map(h => ({ branch: h.branch_id, open: h.open, close: h.close }));
    }
    
    // WiFi/Amenities (if asking about amenities)
    if (/wifi|estaciona|pet|mascota|niño|kids/i.test(t) && hubConfig?.amenities) {
      context.amenities = hubConfig.amenities.filter(a => a.enabled);
    }
    
    // Products (if asking about products/menu)
    if (/rosca|producto|menu|precio/i.test(t) && hubConfig?.products) {
      context.products = hubConfig.products
        .filter(p => p.enabled && p.available)
        .map(p => ({ name: p.name, price: p.price }));
    }
    
    // Semantic search for additional context (if pgvector ready)
    if (vectorStore?.isReady?.()) {
      const semanticResults = await searchSimilar(messageText, {
        limit: 2,
        threshold: 0.6,
        categories: ["knowledge", "faq"],
      });
      
      if (semanticResults?.length > 0) {
        context.relevant_info = semanticResults.map(r => r.content || r.answer);
      }
    }
  } catch (e) {
    logger.debug({ err: e.message }, "Context retrieval failed");
  }
  
  return context;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN OPTIMIZED FLOW
// ═══════════════════════════════════════════════════════════════════════════

async function _runOptimizedFlow({
  conversationId,
  accountId,
  messageText,
  sendMessage,
}) {
  const startTime = Date.now();
  
  // Add user message to history
  addToHistory(conversationId, "user", messageText);
  
  let response = null;
  let source = "unknown";
  let aiCalls = 0;
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1: Check semantic cache (0 AI calls)
  // ─────────────────────────────────────────────────────────────────────────
  const cacheResult = await checkSemanticCache(messageText);
  if (cacheResult.found) {
    response = cacheResult.response;
    source = "cache";
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2: Check canned responses (0 AI calls)
  // ─────────────────────────────────────────────────────────────────────────
  if (!response) {
    const cannedResult = await checkCannedResponses(messageText);
    if (cannedResult.found) {
      response = cannedResult.response;
      source = "canned";
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3: Generate AI response (1 AI call)
  // ─────────────────────────────────────────────────────────────────────────
  if (!response) {
    const history = getHistory(conversationId);
    const context = await getMinimalContext(messageText);
    
    const aiResult = await generateSingleAIResponse({
      conversationId,
      messageText,
      context,
      history,
    });
    
    response = aiResult.customer_message;
    source = "ai";
    aiCalls = 1;
    
    // Cache successful response
    if (aiResult.confidence > 0.5) {
      semanticCache.set(messageText, response, { 
        category: "general",
        metadata: { conversationId, confidence: aiResult.confidence },
      });
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // STEP 4: Send response
  // ─────────────────────────────────────────────────────────────────────────
  if (response) {
    addToHistory(conversationId, "assistant", response);
    
    // Build sendMessage if not provided
    const effectiveSend = typeof sendMessage === "function" 
      ? sendMessage 
      : (content) => sendChatwootMessage({ accountId, conversationId, content });
    
    try {
      await effectiveSend(response);
    } catch (sendErr) {
      logger.error({ err: sendErr.message, conversationId }, "Send failed");
    }
  }
  
  // Log metrics
  const duration = Date.now() - startTime;
  logger.info({
    conversationId,
    source,
    aiCalls,
    durationMs: duration,
    responseLength: response?.length || 0,
  }, `⚡ Optimized flow complete (${aiCalls} AI calls)`);
  
  return { response, source, aiCalls, durationMs: duration };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTED FUNCTION (with optional tracing)
// ═══════════════════════════════════════════════════════════════════════════

export async function runOptimizedFlow(params) {
  if (CONFIG.LANGSMITH_ENABLED) {
    const traced = traceable(_runOptimizedFlow, {
      name: "agentic-flow-optimized",
      run_type: "chain",
      metadata: {
        conversation_id: String(params.conversationId),
        optimized: true,
      },
    });
    return traced(params);
  }
  return _runOptimizedFlow(params);
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

export function getOptimizedFlowStats() {
  const cacheStats = semanticCache.getStats();
  return {
    optimization: "enabled",
    maxHistoryMessages: CONFIG.MAX_HISTORY_MESSAGES,
    useMiniModel: CONFIG.USE_MINI_MODEL,
    cacheSimilarityThreshold: CONFIG.CACHE_SIMILARITY_THRESHOLD,
    cannedSimilarityThreshold: CONFIG.CANNED_SIMILARITY_THRESHOLD,
    cache: cacheStats,
    historyConversations: historyCache.size,
  };
}

export default {
  runOptimizedFlow,
  getOptimizedFlowStats,
  addToHistory,
  getHistory,
};
