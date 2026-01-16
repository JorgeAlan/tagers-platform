/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AI WORKER - Procesador Asíncrono de Mensajes
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Este worker procesa mensajes desde la cola BullMQ. Permite:
 * - Modelos de IA lentos (Deep Think) sin timeout de webhook
 * - Procesamiento paralelo de múltiples conversaciones
 * - Reintentos automáticos con backoff exponencial
 * - Typing indicator mientras procesa
 * 
 * CAMBIOS v1.1.0:
 * - Añadido Conversation Lock para evitar procesamiento paralelo de la misma conversación
 * - Añadida hidratación del historial desde Chatwoot antes de procesar
 * 
 * @version 1.1.0
 */

import { aiQueue } from "../core/queue.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION LOCK - Evita procesamiento paralelo de la misma conversación
// ═══════════════════════════════════════════════════════════════════════════
import { withLock, extendLock } from "../core/conversationLock.js";

// ═══════════════════════════════════════════════════════════════════════════
// OPENTELEMETRY DISTRIBUTED TRACING
// ═══════════════════════════════════════════════════════════════════════════
import {
  withWorkerTraceContext,
  addSpanAttributes,
  // Metrics - Counters (use .add())
  messageProcessed,
  messageErrored,
  // Metrics - Histograms (use .record())
  queueWaitTime,
  workerProcessingTime,
  e2eLatency,
} from "../telemetry/index.js";

// Import FAQ desde quick_responses (usa Config Hub)
import { getFAQAnswer } from "../services/quick_responses.js";

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS - Handlers de Flujos
// ═══════════════════════════════════════════════════════════════════════════

import { 
  sendChatwootMessage, 
  touchConversation,
  fetchChatwootMessages,
} from "../integrations/chatwoot_client.js";

import { dispatcher, ROUTE_TYPES } from "../core/dispatcher.js";

import {
  createSecureOrderCreateState,
  makeSecureOrderCreateHandlers,
  createOrderStatusState,
  makeOrderStatusHandlers,
} from "../tania/secure_flows/index.js";

import {
  createSecureOrderModifyState,
  makeSecureOrderModifyHandlers,
} from "../ana_super/order_modify_secure_flow.js";

import { 
  setFlow, 
  clearFlow, 
  getFlow,
  hydrateFromDb as hydrateFlowFromDb,
} from "../services/flowStateService.js";

import { 
  initiateHandoff, 
  handoffOnFrustration,
  HANDOFF_REASONS,
} from "../services/handoff_service.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION HISTORY - Para hidratación
// ═══════════════════════════════════════════════════════════════════════════
import { 
  getConversationHistory, 
  setConversationHistory, 
  addToConversationHistory,
} from "../tania/agentic_flow_selector.js";

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS ENGINE - Análisis de conversaciones (fire-and-forget)
// ═══════════════════════════════════════════════════════════════════════════
import InsightsEngine from "../insights/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS - Tracking de eventos y conversiones
// ═══════════════════════════════════════════════════════════════════════════
import { analyticsService } from "../services/analytics.js";

// ═══════════════════════════════════════════════════════════════════════════
// MULTILANG - Soporte multi-idioma para turistas
// ═══════════════════════════════════════════════════════════════════════════
import { multilangService } from "../services/multilang.js";

import { runAgenticFlow } from "../tania/agentic_flow_selector.js";
import { matchBranchFromText } from "../hitl/branch_registry.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const workerConfig = {
  typingEnabled: process.env.WORKER_TYPING_ENABLED !== "false",
  typingIntervalMs: parseInt(process.env.WORKER_TYPING_INTERVAL_MS || "3000", 10),
  processingTimeoutMs: parseInt(process.env.WORKER_PROCESSING_TIMEOUT_MS || "45000", 10),
  // Lock config
  lockWaitTimeoutMs: parseInt(process.env.WORKER_LOCK_WAIT_MS || "15000", 10),
  lockTtlMs: parseInt(process.env.WORKER_LOCK_TTL_MS || "60000", 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// FLOW HANDLERS (Reutilizados de chatwoot.js)
// ═══════════════════════════════════════════════════════════════════════════

const _orderCreateRaw = makeSecureOrderCreateHandlers({
  setFlow,
  clearFlow,
  sendChatwootMessage: sendMessageWithHistory,
  hitlEnabled: !!config.hitl?.enabled,
});

// Crear aliases compatibles
const __orderCreateHandlers = {
  start: _orderCreateRaw.advanceSecureOrderCreateFlow,
  handleMessage: _orderCreateRaw.handleSecureOrderCreateFlow,
  ..._orderCreateRaw,
};

const _orderStatusRaw = makeOrderStatusHandlers({
  setFlow,
  clearFlow,
  sendChatwootMessage: sendMessageWithHistory,
  hitlEnabled: !!config.hitl?.enabled,
});

const __orderStatusHandlers = {
  start: _orderStatusRaw.advanceOrderStatusFlow,
  handleMessage: _orderStatusRaw.handleOrderStatusFlow,
  ..._orderStatusRaw,
};

const _orderModifyRaw = makeSecureOrderModifyHandlers({
  setFlow,
  clearFlow,
  sendChatwootMessage: sendMessageWithHistory,
  hitlEnabled: !!config.hitl?.enabled,
});

const __orderModifyHandlers = {
  start: _orderModifyRaw.advanceOrderModifySecureFlow,
  handleMessage: _orderModifyRaw.handleOrderModifySecureFlow,
  ..._orderModifyRaw,
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER - Send message with history sync
// ═══════════════════════════════════════════════════════════════════════════

async function sendMessageWithHistory({ accountId, conversationId, content }) {
  const resp = await sendChatwootMessage({ accountId, conversationId, content });
  
  // Sync to conversation history (best effort)
  try {
    const text = String(content || "").trim();
    if (text) {
      const existing = getConversationHistory(conversationId);
      const last = existing?.length ? existing[existing.length - 1] : null;
      if (!(last && last.role === "assistant" && last.content === text)) {
        addToConversationHistory(conversationId, "assistant", text);
      }
    }
  } catch (_e) {
    // Non-fatal
  }
  
  return resp;
}

// ═══════════════════════════════════════════════════════════════════════════
// HYDRATION - Cargar historial desde Chatwoot
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hidrata el historial de conversación desde Chatwoot
 * CRÍTICO: Debe ejecutarse ANTES de procesar cualquier mensaje
 */
async function hydrateConversationHistoryFromChatwoot({ accountId, conversationId }) {
  try {
    const messages = await fetchChatwootMessages({ accountId, conversationId, limit: 30 });
    
    if (!messages || messages.length === 0) {
      logger.debug({ conversationId }, "No messages to hydrate from Chatwoot");
      return;
    }
    
    // Convertir mensajes de Chatwoot a formato de historial
    const history = messages
      .filter(m => m.content && m.message_type !== "activity")
      .map(m => ({
        role: m.message_type === "incoming" ? "user" : "assistant",
        content: m.content,
        timestamp: m.created_at || new Date().toISOString(),
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    if (history.length > 0) {
      setConversationHistory(conversationId, history);
      logger.debug({ 
        conversationId, 
        messageCount: history.length,
        lastMessage: history[history.length - 1]?.content?.substring(0, 50),
      }, "Hydrated conversation history from Chatwoot");
    }
  } catch (err) {
    logger.warn({ err: err?.message, conversationId }, "Failed to hydrate history from Chatwoot");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN JOB PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Procesa un job de mensaje con contexto de traza distribuido
 * 
 * IMPORTANTE: Usa Conversation Lock para evitar procesamiento paralelo
 * de la misma conversación, lo cual causaría respuestas duplicadas
 * o fuera de contexto.
 * 
 * @param {Object} job - BullMQ Job
 * @param {Object} job.data - Datos del mensaje
 */
async function processMessageJob(job) {
  const { data, id: jobId } = job;
  const { conversationId, accountId } = data;
  
  // Calculate queue wait time (from webhook enqueue to worker pickup)
  const waitTimeMs = data._webhookStartTime 
    ? Date.now() - data._webhookStartTime 
    : 0;
  
  if (waitTimeMs > 0) {
    queueWaitTime.record(waitTimeMs);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSATION LOCK - Garantiza procesamiento secuencial por conversación
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    return await withLock(conversationId, async () => {
      return await processMessageWithLock(job);
    }, {
      wait: true,
      waitTimeoutMs: workerConfig.lockWaitTimeoutMs,
      ttlMs: workerConfig.lockTtlMs,
      ownerId: jobId,
    });
  } catch (err) {
    if (err.message?.includes("Could not acquire lock")) {
      logger.warn({ 
        conversationId, 
        jobId,
        waited: workerConfig.lockWaitTimeoutMs,
      }, "Worker: Lock acquisition timeout - skipping to avoid duplicate");
      
      // No es un error fatal, simplemente otro worker ya está procesando
      return { skipped: true, reason: "lock_timeout" };
    }
    throw err;
  }
}

/**
 * Procesamiento interno con lock ya adquirido
 */
async function processMessageWithLock(job) {
  const { data, id: jobId } = job;
  
  // Wrap processing in trace context from webhook
  return withWorkerTraceContext(job, async (span) => {
    const startTime = Date.now();
    
    const {
      conversationId,
      accountId,
      inboxId,
      messageText,
      contact,
      governorContext,
      routing,
      inboxName,
    } = data;
    
    // Add span attributes
    addSpanAttributes({
      "tagers.conversation_id": conversationId,
      "tagers.job_id": jobId,
      "tagers.route": routing?.route,
      "tagers.handler": routing?.handler,
      "tagers.inbox": inboxName,
    });
    
    logger.info({
      jobId,
      conversationId,
      route: routing?.route,
    }, "Worker: Processing message (with lock)");
    
    // ─────────────────────────────────────────────────────────────────────────
    // HYDRATION - Cargar historial y estado ANTES de procesar
    // CRÍTICO: Esto asegura que tengamos el contexto completo
    // ─────────────────────────────────────────────────────────────────────────
    await Promise.all([
      hydrateConversationHistoryFromChatwoot({ accountId, conversationId }).catch(err => {
        logger.warn({ err: err?.message, conversationId }, "History hydration failed");
      }),
      hydrateFlowFromDb(conversationId).catch(err => {
        logger.warn({ err: err?.message, conversationId }, "Flow hydration failed");
      }),
    ]);
    
    // Agregar mensaje actual al historial (después de hidratar)
    try {
      const existing = getConversationHistory(conversationId);
      const last = existing?.length ? existing[existing.length - 1] : null;
      if (!(last && last.role === "user" && last.content === messageText)) {
        addToConversationHistory(conversationId, "user", messageText);
      }
    } catch (_e) {
      // Non-fatal
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // MULTILANG - Detectar idioma del mensaje (fire and forget)
    // ─────────────────────────────────────────────────────────────────────────
    multilangService.detectLanguage(messageText, conversationId).catch(() => {});
    
    // ─────────────────────────────────────────────────────────────────────────
    // INSIGHTS ENGINE - Fire and forget (no bloquea procesamiento)
    // ─────────────────────────────────────────────────────────────────────────
    // FIXED: Precedencia de operadores corregida con paréntesis
    const insightsChannel = governorContext?.channelType || (
      inboxName?.toLowerCase()?.includes("whatsapp") ? "whatsapp" : 
      inboxName?.toLowerCase()?.includes("instagram") ? "instagram" : 
      inboxName?.toLowerCase()?.includes("facebook") ? "facebook" : "web"
    );
    
    InsightsEngine.processMessage({
      message: messageText,
      conversationId,
      messageId: data.messageId || jobId,
      contactId: contact?.id || contact?.phone_number,
      channel: insightsChannel,
      branchId: governorContext?.branchId,
      branchName: governorContext?.branchName,
      direction: "incoming",
    }).catch(err => {
      logger.warn({ err: err.message }, "Insights processing failed (non-fatal)");
    });
    
    // ─────────────────────────────────────────────────────────────────────────
    // TYPING INDICATOR (mantiene al usuario informado mientras procesa)
    // ─────────────────────────────────────────────────────────────────────────
    let typingInterval = null;
    
    if (workerConfig.typingEnabled && accountId && conversationId) {
      // Touch inmediato
      await touchConversation({ accountId, conversationId }).catch(() => null);
      
      // Mantener typing cada X segundos
      typingInterval = setInterval(async () => {
        await touchConversation({ accountId, conversationId }).catch(() => null);
      }, workerConfig.typingIntervalMs);
    }
    
    try {
      // ─────────────────────────────────────────────────────────────────────────
      // TIMEOUT DE PROCESAMIENTO
      // ─────────────────────────────────────────────────────────────────────────
      
      // Obtener flow actualizado (después de hidratación)
      const currentFlow = governorContext?.currentFlow || getFlow(conversationId);
      
      await Promise.race([
        executeHandler(routing, {
          conversationId,
          accountId,
          inboxId,
          messageText,
          contact,
          inboxName,
          currentFlow,
          ...governorContext,
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error("Processing timeout")), workerConfig.processingTimeoutMs)
        ),
      ]);
      
      // Extender lock si tardamos mucho (para evitar que expire)
      if (Date.now() - startTime > 20000) {
        await extendLock(conversationId, jobId, 30000).catch(() => {});
      }
      
      // Record success metrics
      const processingTime = Date.now() - startTime;
      messageProcessed.add(1);
      workerProcessingTime.record(processingTime);
      
      // Record end-to-end latency (from webhook to response)
      if (data._webhookStartTime) {
        e2eLatency.record(Date.now() - data._webhookStartTime);
      }
      
      logger.info({
        jobId,
        conversationId,
        route: routing?.route,
        durationMs: processingTime,
      }, "Worker: Message processed successfully");
      
    } catch (error) {
      // Record error metrics
      messageErrored.add(1);
      throw error;
    } finally {
      // Siempre limpiar typing
      if (typingInterval) {
        clearInterval(typingInterval);
      }
    }
  }); // End of withWorkerTraceContext
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER EXECUTION (Copiado y adaptado de chatwoot.js)
// ═══════════════════════════════════════════════════════════════════════════

async function executeHandler(routing, context) {
  const { 
    conversationId, 
    accountId, 
    inboxId, 
    messageText, 
    contact,
    currentFlow,
    inboxName,
  } = context;
  
  // Detectar canal
  const channel = inboxName?.toLowerCase()?.includes("whatsapp") ? "whatsapp" : 
                  inboxName?.toLowerCase()?.includes("instagram") ? "instagram" : 
                  inboxName?.toLowerCase()?.includes("facebook") ? "facebook" : "web";
  
  switch (routing.route) {
    // ── HANDOFF ──
    case ROUTE_TYPES.HANDOFF_HUMAN:
      // Track handoff
      analyticsService.trackHandoffRequested(conversationId, "explicit_request").catch(() => {});
      
      await initiateHandoff({
        accountId,
        conversationId,
        inboxId,
        reason: HANDOFF_REASONS.EXPLICIT_REQUEST,
        contact,
      });
      break;
    
    case ROUTE_TYPES.ESCALATE_FRUSTRATION:
      // Track handoff por frustración
      analyticsService.trackHandoffRequested(conversationId, `frustration_${routing.meta?.frustrationLevel}`).catch(() => {});
      
      await handoffOnFrustration({
        accountId,
        conversationId,
        inboxId,
        contact,
        customerSummary: `Frustración nivel ${routing.meta?.frustrationLevel}`,
      });
      break;
    
    // ── ORDER CREATE ──
    case ROUTE_TYPES.FLOW_ORDER_CREATE:
      if (routing.meta?.continueFlow && currentFlow) {
        // Track step del flujo
        analyticsService.trackOrderFlowStep(conversationId, currentFlow.step, {
          product: currentFlow.draft?.product_name,
          branch: currentFlow.draft?.branch_name,
        }).catch(() => {});
        
        await __orderCreateHandlers.handleMessage({
          state: currentFlow,
          messageText,
          conversationId,
          accountId,
          contact,
        });
      } else {
        // Track inicio de flujo
        analyticsService.trackOrderFlowStarted(conversationId, channel).catch(() => {});
        
        const newState = createSecureOrderCreateState({
          draft: {
            product_hint: routing.meta?.product_hint,
            branch_hint: routing.meta?.branch_hint,
            date_hint: routing.meta?.date_hint,
          },
        });
        setFlow(conversationId, newState);
        await __orderCreateHandlers.start({
          state: newState,
          conversationId,
          accountId,
          contact,
          messageText,
        });
      }
      break;
    
    // ── ORDER STATUS ──
    case ROUTE_TYPES.FLOW_ORDER_STATUS:
      if (routing.meta?.continueFlow && currentFlow) {
        await __orderStatusHandlers.handleMessage({
          state: currentFlow,
          messageText,
          conversationId,
          accountId,
          contact,
        });
      } else {
        const newState = createOrderStatusState({
          draft: { order_id: routing.meta?.order_id },
        });
        setFlow(conversationId, newState);
        await __orderStatusHandlers.start({
          state: newState,
          conversationId,
          accountId,
          contact,
          messageText,
        });
      }
      break;
    
    // ── ORDER MODIFY ──
    case ROUTE_TYPES.FLOW_ORDER_MODIFY:
      if (routing.meta?.continueFlow && currentFlow) {
        await __orderModifyHandlers.handleMessage({
          state: currentFlow,
          messageText,
          conversationId,
          accountId,
          contact,
        });
      } else {
        const newState = createSecureOrderModifyState();
        setFlow(conversationId, newState);
        await __orderModifyHandlers.start({
          state: newState,
          conversationId,
          accountId,
          contact,
          messageText,
        });
      }
      break;
    
    // ── GREETING ──
    case ROUTE_TYPES.GREETING:
      // Track nueva conversación
      analyticsService.trackConversationStarted(conversationId, channel, contact?.id).catch(() => {});
      
      // Usar saludo localizado
      const greeting = multilangService.getLocalizedGreeting(conversationId);
      
      await sendMessageWithHistory({
        accountId,
        conversationId,
        content: greeting,
      });
      break;
    
    // ── SIMPLE REPLY (Fast Path - No AI) ──
    case ROUTE_TYPES.SIMPLE_REPLY:
      {
        const { response, clearFlow: shouldClearFlow, offerHuman } = routing.meta || {};
        
        if (response) {
          // Agregar oferta de humano si hay frustración media
          let finalResponse = response;
          if (offerHuman) {
            finalResponse += "\n\n_Si prefieres, puedo conectarte con un agente. Solo escríbeme \"quiero hablar con alguien\"._";
          }
          
          await sendMessageWithHistory({ accountId, conversationId, content: finalResponse });
        }
        
        // Limpiar flujo si es despedida/cancelación
        if (shouldClearFlow) {
          // Track abandono si había un flujo activo
          if (currentFlow?.type === "ORDER_CREATE") {
            analyticsService.trackOrderFlowAbandoned(conversationId, currentFlow.step, {
              product: currentFlow.draft?.product_name,
              reason: "user_cancelled",
            }).catch(() => {});
          }
          clearFlow(conversationId);
        }
        
        logger.debug({ conversationId, response: response?.substring(0, 50) }, "Fast path: trivial response sent");
      }
      break;
    
    // ── FAQ ──
    case ROUTE_TYPES.FAQ:
      const faqAnswer = getFAQAnswer(routing.meta?.faqKey);
      if (faqAnswer) {
        await sendMessageWithHistory({ accountId, conversationId, content: faqAnswer });
      } else {
        await executeAgenticFlow(context);
      }
      break;
    
    // ── AGENTIC FLOW (Default) ──
    case ROUTE_TYPES.AGENTIC_FLOW:
    default:
      await executeAgenticFlow(context);
      break;
  }
}

async function executeAgenticFlow(context) {
  const { conversationId, accountId, messageText, contact, inboxId, inboxName } = context;
  const branchHint = matchBranchFromText(inboxName || "") || matchBranchFromText(messageText);
  
  try {
    await runAgenticFlow({
      conversationId,
      accountId,
      messageText,
      contact,
      branchHint,
      inboxId,
      inboxName,
      sendMessage: (content) => sendMessageWithHistory({ accountId, conversationId, content }),
    });
  } catch (e) {
    // Track error de AI
    analyticsService.trackError(conversationId, "ai", e?.message).catch(() => {});
    
    logger.error({ err: e?.message, conversationId }, "Worker: Agentic flow failed");
    
    // Usar mensaje de error localizado
    const errorMessage = multilangService.getLocalizedError(conversationId);
    
    await sendMessageWithHistory({
      accountId,
      conversationId,
      content: errorMessage,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FAQ ANSWERS - Usando quick_responses.js (Config Hub)
// getFAQAnswer importado desde ../services/quick_responses.js

// ═══════════════════════════════════════════════════════════════════════════
// WORKER STARTUP
// ═══════════════════════════════════════════════════════════════════════════

let worker = null;

/**
 * Inicia el worker para procesar mensajes
 * Puede correrse embebido en server.js o como proceso separado
 */
export async function startWorker() {
  if (worker) {
    logger.warn("Worker already running");
    return worker;
  }
  
  logger.info("Starting AI Worker with Conversation Lock...");
  
  worker = await aiQueue.registerWorker(processMessageJob, {
    concurrency: parseInt(process.env.WORKER_CONCURRENCY || "3", 10),
  });
  
  if (worker) {
    logger.info({
      concurrency: process.env.WORKER_CONCURRENCY || "3",
      mode: "BullMQ",
      lockEnabled: true,
      lockWaitMs: workerConfig.lockWaitTimeoutMs,
      lockTtlMs: workerConfig.lockTtlMs,
    }, "AI Worker started (BullMQ mode with Conversation Lock)");
  } else {
    logger.info({
      mode: "in-memory",
      lockEnabled: true,
    }, "AI Worker started (in-memory fallback mode with Conversation Lock)");
  }
  
  return worker;
}

/**
 * Detiene el worker gracefully
 */
export async function stopWorker() {
  if (worker) {
    await worker.close();
    worker = null;
    logger.info("AI Worker stopped");
  }
}

/**
 * Obtiene estadísticas del worker
 */
export async function getWorkerStats() {
  return await aiQueue.getStats();
}

// ═══════════════════════════════════════════════════════════════════════════
// STANDALONE MODE
// ═══════════════════════════════════════════════════════════════════════════

// Si se ejecuta directamente: node src/workers/aiWorker.js
const isMainModule = process.argv[1]?.includes("aiWorker.js");

if (isMainModule) {
  logger.info("Starting AI Worker in standalone mode...");
  
  // Graceful shutdown
  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received - shutting down worker...");
    await stopWorker();
    await aiQueue.close();
    process.exit(0);
  });
  
  process.on("SIGINT", async () => {
    logger.info("SIGINT received - shutting down worker...");
    await stopWorker();
    await aiQueue.close();
    process.exit(0);
  });
  
  startWorker().catch((err) => {
    logger.error({ err: err?.message }, "Failed to start worker");
    process.exit(1);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  startWorker,
  stopWorker,
  getWorkerStats,
  processMessageJob,
};
