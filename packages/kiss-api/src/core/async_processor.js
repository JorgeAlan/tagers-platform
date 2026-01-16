/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ASYNC PROCESSOR - Procesamiento en Background
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Permite responder 200 OK inmediatamente al webhook y procesar
 * el mensaje en background. Esto evita:
 * - Timeouts de Chatwoot (10s)
 * - Bloqueos cuando se usan modelos lentos (Deep Think)
 * - Pérdida de mensajes por errores de procesamiento
 * 
 * Arquitectura:
 * 1. Webhook recibe mensaje → 200 OK en <50ms
 * 2. Mensaje se encola
 * 3. Worker procesa mensaje
 * 4. Resultado se envía a Chatwoot
 * 
 * Para producción con alto volumen, reemplazar por Redis + BullMQ.
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { sendChatwootMessage, touchConversation } from "../integrations/chatwoot_client.js";
import { config as appConfig } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const processorConfig = {
  // Procesamiento
  maxConcurrent: parseInt(process.env.ASYNC_MAX_CONCURRENT || "5", 10),
  maxRetries: parseInt(process.env.ASYNC_MAX_RETRIES || "2", 10),
  retryDelayMs: parseInt(process.env.ASYNC_RETRY_DELAY_MS || "1000", 10),
  
  // Typing indicator
  typingEnabled: process.env.ASYNC_TYPING_ENABLED !== "false",
  typingIntervalMs: parseInt(process.env.ASYNC_TYPING_INTERVAL_MS || "3000", 10),
  
  // Timeouts
  processingTimeoutMs: parseInt(process.env.ASYNC_PROCESSING_TIMEOUT_MS || "30000", 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE (In-Memory - Para producción usar Redis + BullMQ)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} QueueItem
 * @property {string} id - Unique job ID
 * @property {Object} context - Governor context
 * @property {Object} routing - Dispatcher routing decision
 * @property {Function} handler - Function to execute
 * @property {number} attempts - Current attempt count
 * @property {string} status - pending, processing, completed, failed
 * @property {number} createdAt - Timestamp
 */

const queue = [];
const processing = new Map(); // id -> QueueItem
const completed = new Map();  // id -> result (TTL: 5 min)
let isProcessing = false;

// ═══════════════════════════════════════════════════════════════════════════
// ENQUEUE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encola un trabajo para procesamiento async
 * 
 * @param {Object} options
 * @param {Object} options.context - Governor context
 * @param {Object} options.routing - Dispatcher routing decision
 * @param {Function} options.handler - Async function to execute
 * @returns {string} Job ID
 */
export function enqueue({ context, routing, handler }) {
  const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const item = {
    id,
    context,
    routing,
    handler,
    attempts: 0,
    status: "pending",
    createdAt: Date.now(),
  };
  
  queue.push(item);
  
  logger.info({
    jobId: id,
    conversationId: context.conversationId,
    route: routing.route,
    queueLength: queue.length,
  }, "Job enqueued");
  
  // Iniciar procesamiento si no está corriendo
  if (!isProcessing) {
    processQueue();
  }
  
  return id;
}

/**
 * Procesa un mensaje de forma síncrona pero sin bloquear el webhook
 * Útil para casos donde quieres fire-and-forget
 */
export function processAsync({ context, routing, handler }) {
  // Fire and forget
  setImmediate(async () => {
    try {
      await executeWithTyping({ context, routing, handler });
    } catch (error) {
      logger.error({
        err: error?.message,
        conversationId: context.conversationId,
        route: routing.route,
      }, "Async processing failed");
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE PROCESSOR
// ═══════════════════════════════════════════════════════════════════════════

async function processQueue() {
  if (isProcessing) return;
  isProcessing = true;
  
  while (queue.length > 0 && processing.size < processorConfig.maxConcurrent) {
    const item = queue.shift();
    if (!item) continue;
    
    item.status = "processing";
    processing.set(item.id, item);
    
    // Procesar en paralelo
    processItem(item).catch(err => {
      logger.error({ err: err?.message, jobId: item.id }, "Queue item processing error");
    });
  }
  
  isProcessing = false;
  
  // Si quedan items, programar siguiente ciclo
  if (queue.length > 0) {
    setImmediate(() => processQueue());
  }
}

async function processItem(item) {
  const startTime = Date.now();
  
  try {
    item.attempts++;
    
    logger.info({
      jobId: item.id,
      conversationId: item.context.conversationId,
      attempt: item.attempts,
    }, "Processing queue item");
    
    // Ejecutar con typing indicator
    const result = await executeWithTyping(item);
    
    // Marcar como completado
    item.status = "completed";
    completed.set(item.id, {
      result,
      completedAt: Date.now(),
      duration: Date.now() - startTime,
    });
    
    logger.info({
      jobId: item.id,
      conversationId: item.context.conversationId,
      durationMs: Date.now() - startTime,
    }, "Queue item completed");
    
  } catch (error) {
    logger.warn({
      jobId: item.id,
      conversationId: item.context.conversationId,
      attempt: item.attempts,
      err: error?.message,
    }, "Queue item failed");
    
    // Retry si no excedimos límite
    if (item.attempts < processorConfig.maxRetries) {
      item.status = "pending";
      
      // Re-encolar con delay
      setTimeout(() => {
        queue.push(item);
        processQueue();
      }, processorConfig.retryDelayMs * item.attempts);
      
    } else {
      item.status = "failed";
      completed.set(item.id, {
        error: error?.message,
        failedAt: Date.now(),
        duration: Date.now() - startTime,
      });
      
      // Notificar fallo al cliente
      await notifyFailure(item.context, error);
    }
  } finally {
    processing.delete(item.id);
  }
  
  // Limpiar completed después de 5 min
  setTimeout(() => {
    completed.delete(item.id);
  }, 5 * 60 * 1000);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXECUTION WITH TYPING
// ═══════════════════════════════════════════════════════════════════════════

async function executeWithTyping({ context, routing, handler }) {
  const { conversationId, accountId } = context;
  
  // Iniciar typing indicator
  let typingInterval = null;
  
  if (processorConfig.typingEnabled) {
    // Touch inmediato para mostrar actividad
    await touchConversation({ accountId, conversationId }).catch(() => null);
    
    // Mantener typing cada X segundos
    typingInterval = setInterval(async () => {
      await touchConversation({ accountId, conversationId }).catch(() => null);
    }, processorConfig.typingIntervalMs);
  }
  
  try {
    // Timeout de procesamiento
    const result = await Promise.race([
      handler(context, routing),
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Processing timeout")), processorConfig.processingTimeoutMs)
      ),
    ]);
    
    return result;
    
  } finally {
    // Detener typing
    if (typingInterval) {
      clearInterval(typingInterval);
    }
  }
}

async function notifyFailure(context, error) {
  const { conversationId, accountId } = context;
  
  try {
    await sendChatwootMessage({
      accountId,
      conversationId,
      content: "Disculpa, tuve un problema técnico. ¿Podrías repetir tu mensaje? 🙏",
    });
  } catch (e) {
    logger.error({ err: e?.message, conversationId }, "Failed to notify user of error");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS & MONITORING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene el estado de un job
 */
export function getJobStatus(jobId) {
  // Check completed
  const completedItem = completed.get(jobId);
  if (completedItem) {
    return { status: completedItem.error ? "failed" : "completed", ...completedItem };
  }
  
  // Check processing
  const processingItem = processing.get(jobId);
  if (processingItem) {
    return { status: "processing", attempts: processingItem.attempts };
  }
  
  // Check queue
  const queueItem = queue.find(i => i.id === jobId);
  if (queueItem) {
    return { status: "pending", position: queue.indexOf(queueItem) + 1 };
  }
  
  return { status: "not_found" };
}

/**
 * Obtiene estadísticas de la cola
 */
export function getStats() {
  return {
    pending: queue.length,
    processing: processing.size,
    completed: completed.size,
    config: {
      maxConcurrent: processorConfig.maxConcurrent,
      maxRetries: processorConfig.maxRetries,
    },
  };
}

/**
 * Limpia la cola (para testing o emergencias)
 */
export function clearQueue() {
  const cleared = queue.length;
  queue.length = 0;
  return cleared;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const asyncProcessor = {
  enqueue,
  processAsync,
  getJobStatus,
  getStats,
  clearQueue,
};

export default asyncProcessor;
