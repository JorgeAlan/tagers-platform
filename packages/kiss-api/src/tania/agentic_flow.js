/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTIC FLOW - Tan • IA Intelligent Agent v1.2 (HOTFIX)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Sistema agéntico que analiza, razona y valida antes de responder.
 * 
 * FLUJO:
 * 1. ANALYZER (gpt-5-nano) - Analiza conversación, detecta loops/frustración
 * 2. RETRIEVER (código) - Busca datos relevantes dinámicamente
 * 3. REASONER (gpt-5.2) - Genera respuesta con contexto completo
 * 4. VALIDATOR (gpt-5-nano) - Valida antes de enviar
 * 
 * CAMBIOS v1.2 (HOTFIX):
 * - FIX: sendMessage fallback para BullMQ retries
 *   Cuando BullMQ hace retry, los callbacks JS se pierden porque no se
 *   pueden serializar en Redis. Ahora construimos sendMessage internamente
 *   usando accountId + conversationId que SÍ se serializan.
 * 
 * @version 1.2.0 - BullMQ retry fix
 */

import { createStructuredJSON, generateTaniaReply } from "../openai_client_tania.js";
import { routeTask } from "../model_router.js";
import { logger } from "../utils/logger.js";
import { getConfig, getConfigForLLM } from "../config-hub/sync-service.js";
import fs from "fs";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════
// FIX: Import sendChatwootMessage para fallback cuando callback se pierde
// ═══════════════════════════════════════════════════════════════════════════
import { sendChatwootMessage } from "../integrations/chatwoot_client.js";

// ═══════════════════════════════════════════════════════════════════════════
// PGVECTOR SEMANTIC SEARCH - Búsqueda semántica real
// ═══════════════════════════════════════════════════════════════════════════
import { vectorStore, searchSimilar } from "../vector/vectorStore.js";

// ═══════════════════════════════════════════════════════════════════════════
// LANGSMITH TRACING
// ═══════════════════════════════════════════════════════════════════════════
import { traceable } from "langsmith/traceable";

function isLangSmithEnabled() {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY;
}

/**
 * Wrapper para tracear funciones de flow
 */
function wrapWithTrace(fn, name, metadata = {}) {
  if (!isLangSmithEnabled()) {
    return fn;
  }
  return traceable(fn, {
    name,
    run_type: "chain",
    metadata: {
      service: "tagers-kiss-api",
      flow: "agentic",
      ...metadata,
    },
  });
}

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function loadPrompt(relativePath) {
  const fullPath = path.join(__dirname, "../../", relativePath);
  try {
    return fs.readFileSync(fullPath, "utf-8");
  } catch (e) {
    logger.warn({ path: fullPath }, "Could not load prompt file");
    return "";
  }
}

function sanitizeWhatsappMentions(text, { customerMessage, escalateToHuman } = {}) {
  if (!text || typeof text !== "string") return text;

  const userWantsWhatsapp = /\bwhats?app\b/i.test(customerMessage || "");

  // Si el cliente lo pidió o estamos escalando a humano, lo dejamos.
  if (userWantsWhatsapp || escalateToHuman) return text;

  if (!/\bwhats?app\b/i.test(text)) return text;

  // Eliminar líneas que mencionan WhatsApp (evita "por WhatsApp" como salida por defecto).
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((line) => !/\bwhats?app\b/i.test(line));

  // Si quitamos todo accidentalmente, regresamos el original.
  const cleaned = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned.length ? cleaned : text;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY (In-Memory Cache)
// ═══════════════════════════════════════════════════════════════════════════

const conversationHistoryCache = new Map();
const MAX_HISTORY_SIZE = 30;
const HISTORY_TTL_MS = 60 * 60 * 1000; // 1 hour

export function getConversationHistory(conversationId) {
  const entry = conversationHistoryCache.get(String(conversationId));
  if (!entry) return [];
  
  // Check TTL
  if (Date.now() - entry.updatedAt > HISTORY_TTL_MS) {
    conversationHistoryCache.delete(String(conversationId));
    return [];
  }
  
  return entry.messages || [];
}

export function setConversationHistory(conversationId, messages) {
  conversationHistoryCache.set(String(conversationId), {
    messages: Array.isArray(messages) ? messages.slice(-MAX_HISTORY_SIZE) : [],
    updatedAt: Date.now(),
  });
}

export function addToConversationHistory(conversationId, role, content) {
  const existing = getConversationHistory(conversationId);
  const newMessage = { role, content, timestamp: Date.now() };
  
  const updated = [...existing, newMessage].slice(-MAX_HISTORY_SIZE);
  setConversationHistory(conversationId, updated);
  
  return updated;
}

// Track failed responses to avoid repeating
const failedResponses = new Map();

export function markResponseAsFailed(conversationId, response, reason) {
  const key = String(conversationId);
  const existing = failedResponses.get(key) || [];
  existing.push({ response: response?.substring(0, 100), reason, at: Date.now() });
  failedResponses.set(key, existing.slice(-5)); // Keep last 5
}

/**
 * Get memory stats for admin dashboard
 */
export function getMemoryStats() {
  return {
    conversationHistorySize: conversationHistoryCache.size,
    failedResponsesSize: failedResponses.size,
    maxHistorySize: MAX_HISTORY_SIZE,
    historyTtlMs: HISTORY_TTL_MS,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 1: ANALYZER
// ═══════════════════════════════════════════════════════════════════════════

export async function analyzeConversation({ conversationId, messageText, history }) {
  const analyzerPrompt = `Analiza esta conversación de servicio al cliente para Tagers (panadería/café).

Determina:
1. Intención principal del cliente
2. Nivel de frustración (0-5)
3. Si hay un loop de conversación (repitiendo lo mismo)
4. Estrategia de respuesta recomendada
5. Datos que necesitamos buscar

Historial:
${JSON.stringify(history?.slice(-10) || [], null, 2)}

Mensaje actual: "${messageText}"

Responde en JSON con: intent, frustration_level, is_loop, response_strategy, data_needs`;

  try {
    const result = await createStructuredJSON({
      instructions: analyzerPrompt,
      inputObject: { message: messageText, history_length: history?.length || 0 },
      schemaKey: "conversation_analysis",
      metadata: { task: "analyzer", conversationId },
    });
    
    logger.debug({ conversationId, analysis: result?.parsed }, "Conversation analyzed");
    return result?.parsed || {};
  } catch (err) {
    logger.warn({ err: err.message, conversationId }, "Analyzer failed, using defaults");
    return {
      intent: "unknown",
      frustration_level: 0,
      is_loop: false,
      response_strategy: { approach: "helpful", escalate_to_human: false },
      data_needs: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 2: RETRIEVER
// ═══════════════════════════════════════════════════════════════════════════

export async function retrieveRelevantData({ conversationId, messageText, analysis, externalData }) {
  const retrieved = {
    canned_responses: [],
    faq_matches: [],
    branch_info: null,
    product_info: null,
    promo_info: null,
    semantic_matches: [],
  };

  try {
    // Get config from hub
    const hubConfig = getConfig();
    
    // Search canned responses (semantic search via pgvector)
    if (vectorStore?.isReady?.()) {
      const semanticResults = await searchSimilar(messageText, {
        limit: 5,
        threshold: 0.5,
        categories: ["canned", "faq", "knowledge"],
      });
      
      if (semanticResults?.length > 0) {
        retrieved.semantic_matches = semanticResults;
        
        // Separate by category
        for (const match of semanticResults) {
          if (match.category === "canned") {
            retrieved.canned_responses.push(match);
          } else if (match.category === "faq") {
            retrieved.faq_matches.push(match);
          }
        }
      }
    }
    
    // Add branch info if needed
    if (analysis?.data_needs?.includes("branches") || /sucursal|ubicaci[oó]n|direcci[oó]n/i.test(messageText)) {
      retrieved.branch_info = hubConfig?.branches || externalData?.branches || [];
    }
    
    // Add product info if needed
    if (analysis?.data_needs?.includes("products") || /rosca|producto|precio/i.test(messageText)) {
      retrieved.product_info = hubConfig?.products || externalData?.products || [];
    }
    
    // Add promo info if needed
    if (analysis?.data_needs?.includes("promos") || /promoci[oó]n|descuento|oferta/i.test(messageText)) {
      retrieved.promo_info = hubConfig?.promos || externalData?.promos || [];
    }
    
  } catch (err) {
    logger.warn({ err: err.message, conversationId }, "Retriever error");
  }
  
  logger.debug({
    conversationId,
    cannedCount: retrieved.canned_responses.length,
    faqCount: retrieved.faq_matches.length,
    semanticCount: retrieved.semantic_matches.length,
  }, "Data retrieved");
  
  return retrieved;
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 4: VALIDATOR
// ═══════════════════════════════════════════════════════════════════════════

export async function validateResponse({ conversationId, customerMessage, analysis, proposedResponse }) {
  // ═══════════════════════════════════════════════════════════════════════
  // QUICK WIN: Skip validator (ahorra 1 llamada AI por mensaje)
  // ═══════════════════════════════════════════════════════════════════════
  if (process.env.SKIP_RESPONSE_VALIDATOR === "true") {
    logger.debug({ conversationId }, "Validator skipped (SKIP_RESPONSE_VALIDATOR=true)");
    return { verdict: "approve", confidence: 0.8, issues_found: [], skipped: true };
  }

  const validatorPrompt = `Valida esta respuesta antes de enviarla al cliente.

Mensaje del cliente: "${customerMessage}"
Análisis: ${JSON.stringify(analysis || {})}
Respuesta propuesta: "${proposedResponse}"

Verifica:
1. ¿Es apropiada y profesional?
2. ¿Responde la pregunta del cliente?
3. ¿Tiene información incorrecta o inventada?
4. ¿Es demasiado larga o confusa?
5. ¿Menciona competidores o información sensible?

Responde con: verdict (approve/reject/needs_revision), confidence (0-1), issues_found, revision_instructions`;

  try {
    const result = await createStructuredJSON({
      instructions: validatorPrompt,
      inputObject: { response_length: proposedResponse?.length || 0 },
      schemaKey: "response_validation",
      metadata: { task: "validator", conversationId },
    });
    
    return result?.parsed || { verdict: "approve", confidence: 0.5, issues_found: [] };
  } catch (err) {
    logger.warn({ err: err.message, conversationId }, "Validator failed, auto-approving");
    return { verdict: "approve", confidence: 0.3, issues_found: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STEP 3: RESPONSE GENERATOR (Default)
// ═══════════════════════════════════════════════════════════════════════════

async function defaultGenerateResponse({ conversationId, messageText, analysis, retrievedData, revisionInstructions }) {
  // Build enriched input
  const history = getConversationHistory(conversationId);
  
  // QUICK WIN: Historial configurable (default: 5 para ahorrar tokens)
  const MAX_HISTORY = parseInt(process.env.MAX_CONVERSATION_HISTORY || "5", 10);
  
  const enrichedInput = {
    conversation_history: history.slice(-MAX_HISTORY).map(m => ({
      role: m.role === "user" ? "cliente" : "ana",
      content: m.content,
    })),
    current_query: messageText,
    analysis_summary: {
      intent: analysis?.intent,
      frustration: analysis?.frustration_level,
      is_loop: analysis?.is_loop,
    },
    available_data: {
      canned_responses: retrievedData?.canned_responses?.slice(0, 3) || [],
      faq_matches: retrievedData?.faq_matches?.slice(0, 3) || [],
      branches: retrievedData?.branch_info?.slice(0, 5) || [],
      products: retrievedData?.product_info?.slice(0, 5) || [],
      promos: retrievedData?.promo_info?.slice(0, 3) || [],
    },
  };
  
  // Get dynamic prompt from config
  let basePrompt = "";
  try {
    const configForLLM = getConfigForLLM();
    basePrompt = configForLLM?.system_prompt || "";
  } catch (e) {
    // Fallback
  }
  
  if (!basePrompt) {
    basePrompt = `Eres Ana, asistente virtual de Tagers café y panadería.
Responde de forma concisa y útil.`;
  }
  
  // Build enhanced prompt
  let enhancedPrompt = "";
  
  if (retrievedData?.canned_responses?.length > 0) {
    enhancedPrompt += "\n\nRespuestas sugeridas que puedes adaptar:\n";
    for (const canned of retrievedData.canned_responses.slice(0, 2)) {
      enhancedPrompt += `- ${canned.content?.substring(0, 200) || canned.text?.substring(0, 200)}\n`;
    }
  }
  
  if (analysis?.is_loop) {
    enhancedPrompt += "\n\n⚠️ NOTA: El cliente parece estar repitiendo su pregunta. Ofrece una respuesta diferente o pregunta qué información específica necesita.";
  }
  
  if (analysis?.frustration_level >= 3) {
    enhancedPrompt += "\n\n⚠️ NOTA: El cliente muestra frustración. Sé especialmente empático y ofrece ayuda directa.";
  }
  
  const fullPrompt = `${basePrompt}\n\n${enhancedPrompt}${revisionInstructions ? `\n\n**INSTRUCCIONES DE REVISIÓN:**\n${revisionInstructions}` : ""}`;
  
  const input = {
    ...enrichedInput,
    current_message: enrichedInput.conversation_history?.slice(-1)?.[0]?.content || messageText,
  };
  
  try {
    const result = await generateTaniaReply({
      instructions: fullPrompt,
      inputObject: input,
      metadata: { task: "tania_reply", conversationId },
    });
    
    return result;
  } catch (err) {
    logger.error({ err: err.message, conversationId }, "defaultGenerateResponse failed");
    // Fallback response
    return {
      customer_message: "Disculpa, tuve un problema técnico. ¿Podrías repetir tu pregunta?",
      confidence: 0.3,
      used_promo: false,
      recommended_branches: [],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN AGENTIC FLOW
// ═══════════════════════════════════════════════════════════════════════════

async function _runAgenticFlowInternal({
  conversationId,
  messageText,
  externalData = {},
  generateResponse,
  sendMessage,
  accountId,
}) {
  const responseGenerator = typeof generateResponse === "function" 
    ? generateResponse 
    : defaultGenerateResponse;
  
  // QUICK WIN: Revisiones configurables (default: 0 para ahorrar tokens)
  const MAX_REVISIONS = parseInt(process.env.MAX_RESPONSE_REVISIONS || "0", 10);
  
  // Save customer message to history (dedupe)
  {
    const existing = getConversationHistory(conversationId);
    const last = existing?.length ? existing[existing.length - 1] : null;
    if (!(last && last.role === "user" && last.content === messageText)) {
      addToConversationHistory(conversationId, "user", messageText);
    }
  }
  
  // STEP 1: Analyze
  logger.info({ conversationId }, "Agentic flow: Starting analysis");
  const history = getConversationHistory(conversationId);
  const analysis = await analyzeConversation({ conversationId, messageText, history });
  
  // STEP 2: Retrieve
  logger.info({ conversationId }, "Agentic flow: Retrieving data");
  const retrievedData = await retrieveRelevantData({
    conversationId,
    messageText,
    analysis,
    externalData,
  });
  
  // Log canned match if found
  if (retrievedData?.canned_responses?.length > 0) {
    const topCanned = retrievedData.canned_responses[0];
    logger.info({
      msgPreview: messageText?.substring(0, 50),
      cannedFound: retrievedData.canned_responses.length,
      topScore: topCanned?.score || topCanned?.similarity,
      source: "pgvector",
    }, "CANNED matched (pgvector/fuzzy)");
    
    logger.info({ cannedCount: retrievedData.canned_responses.length }, "CANNED added to prompt");
  }
  
  // STEP 3 & 4: Generate and Validate (with revision loop)
  let response = null;
  let revisionCount = 0;
  
  while (revisionCount <= MAX_REVISIONS) {
    logger.info({ conversationId, revision: revisionCount }, "Agentic flow: Generating response");
    
    response = await responseGenerator({
      conversationId,
      messageText,
      analysis,
      retrievedData,
      revisionInstructions: response?.revisionInstructions || null,
    });
    
    if (!response || !response.customer_message) {
      logger.error({ conversationId }, "Response generation failed");
      break;
    }
    
    // STEP 4: Validate
    logger.info({ conversationId }, "Agentic flow: Validating response");
    const validation = await validateResponse({
      conversationId,
      customerMessage: messageText,
      analysis,
      proposedResponse: response.customer_message,
    });
    
    logger.info({
      conversationId,
      verdict: validation.verdict,
      confidence: validation.confidence,
      issuesCount: validation.issues_found?.length || 0,
    }, "Response validated");
    
    if (validation.verdict === "approve") {
      logger.info({ conversationId, confidence: validation.confidence }, "Agentic flow: Response approved");
      
      // Sanitize WhatsApp mentions
      response.customer_message = sanitizeWhatsappMentions(response.customer_message, {
        customerMessage: messageText,
        escalateToHuman: Boolean(analysis?.response_strategy?.escalate_to_human),
      });
      break;
    }
    
    if (validation.verdict === "reject") {
      logger.warn({ conversationId, issues: validation.issues_found }, "Agentic flow: Response rejected");
      markResponseAsFailed(conversationId, response.customer_message, "rejected by validator");
      response = null;
      break;
    }
    
    // needs_revision
    logger.info({ 
      conversationId, 
      instructions: validation.revision_instructions,
    }, "Agentic flow: Revision needed");
    
    response.revisionInstructions = validation.revision_instructions;
    revisionCount++;
  }
  
  // Save response to history and send
  if (response?.customer_message) {
    const existing = getConversationHistory(conversationId);
    const last = existing?.length ? existing[existing.length - 1] : null;
    if (!(last && last.role === "assistant" && last.content === response.customer_message)) {
      addToConversationHistory(conversationId, "assistant", response.customer_message);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX: Construir sendMessage internamente si no se pasó como callback
    // Esto resuelve el problema de retries en BullMQ donde los callbacks
    // no sobreviven la serialización a Redis
    // ═══════════════════════════════════════════════════════════════════════
    
    let effectiveSendMessage = sendMessage;
    
    // Si no hay callback pero tenemos accountId, construir uno
    if (typeof sendMessage !== "function" && accountId && conversationId) {
      logger.debug({ conversationId }, "Agentic flow: Building sendMessage internally (callback lost in retry)");
      effectiveSendMessage = async (content) => {
        return sendChatwootMessage({
          accountId,
          conversationId,
          content,
        });
      };
    }
    
    // Intentar enviar mensaje
    if (typeof effectiveSendMessage === "function") {
      try {
        await effectiveSendMessage(response.customer_message);
        logger.info({ 
          conversationId, 
          contentLength: response.customer_message.length,
          method: typeof sendMessage === "function" ? "callback" : "internal",
        }, "Agentic flow: Message sent");
      } catch (sendErr) {
        logger.error({ 
          err: sendErr.message, 
          conversationId,
          method: typeof sendMessage === "function" ? "callback" : "internal",
        }, "Agentic flow: Failed to send message");
        
        // NO re-lanzar - el mensaje se generó correctamente,
        // solo falló el envío. Evita retry infinito de BullMQ.
      }
    } else {
      // Solo pasa si no hay accountId
      logger.warn({ 
        conversationId, 
        hasAccountId: !!accountId,
        hasSendMessage: typeof sendMessage === "function",
      }, "Agentic flow: Cannot send message - no callback and no accountId");
    }
  }
  
  return {
    response,
    analysis,
    retrievedData,
    wasRevised: revisionCount > 0,
  };
}

/**
 * EXPORTED: runAgenticFlow con LangSmith tracing
 */
export async function runAgenticFlow(params) {
  const { conversationId } = params;
  
  const traced = wrapWithTrace(
    _runAgenticFlowInternal,
    "agentic-flow/tania",
    {
      conversation_id: String(conversationId),
      task: "agentic_flow",
    }
  );
  
  return traced(params);
}

export default {
  runAgenticFlow,
  analyzeConversation,
  retrieveRelevantData,
  validateResponse,
  addToConversationHistory,
  setConversationHistory,
  getConversationHistory,
  markResponseAsFailed,
  getMemoryStats,
};
