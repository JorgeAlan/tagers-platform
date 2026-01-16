/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUEUE - Cola de Mensajes con BullMQ + Redis + DLQ
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Reemplaza la cola in-memory por una cola persistente que:
 * - Sobrevive reinicios del servidor
 * - Permite procesamiento distribuido (múltiples workers)
 * - Tiene reintentos automáticos con backoff
 * - Provee métricas y observabilidad
 * - Mueve jobs fallidos a Dead Letter Queue (DLQ)
 * 
 * PATRÓN: Fire-and-forget desde webhook → Cola → Worker procesa
 * 
 * v1.1.0 - Dead Letter Queue integration
 * 
 * @version 1.1.0
 */

import { Queue, QueueEvents, Worker } from "bullmq";
import Redis from "ioredis";
import { logger } from "../utils/logger.js";
import { moveToDeadLetter, initDLQ, getDLQStats, closeDLQ } from "./dlqProcessor.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const QUEUE_NAME = process.env.QUEUE_NAME || "tania-messages";

// Configuración de reintentos
const MAX_RETRIES = parseInt(process.env.QUEUE_MAX_RETRIES || "3", 10);
const RETRY_DELAY_MS = parseInt(process.env.QUEUE_RETRY_DELAY_MS || "1000", 10);

// Parse REDIS_URL para BullMQ connection
function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379", 10),
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      maxRetriesPerRequest: null, // Required by BullMQ
    };
  } catch (err) {
    logger.warn({ err: err?.message }, "Failed to parse REDIS_URL, using defaults");
    return {
      host: "localhost",
      port: 6379,
      password: undefined,
      maxRetriesPerRequest: null,
    };
  }
}

const queueConfig = {
  connection: parseRedisUrl(REDIS_URL),
  defaultJobOptions: {
    attempts: MAX_RETRIES,
    backoff: {
      type: "exponential",
      delay: RETRY_DELAY_MS,
    },
    removeOnComplete: {
      age: 3600, // 1 hora
      count: 1000,
    },
    removeOnFail: false, // ⚠️ No eliminar automáticamente - manejar con DLQ
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// REDIS CONNECTION
// ═══════════════════════════════════════════════════════════════════════════

let redisConnection = null;
let isRedisAvailable = false;

/**
 * Inicializa conexión a Redis con fallback graceful
 */
async function initRedis() {
  if (redisConnection) return redisConnection;
  
  try {
    redisConnection = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryDelayOnFailover: 100,
      lazyConnect: true,
    });
    
    await redisConnection.ping();
    isRedisAvailable = true;
    logger.info({ url: REDIS_URL }, "Redis connected");
    
    redisConnection.on("error", (err) => {
      logger.warn({ err: err?.message }, "Redis connection error");
      isRedisAvailable = false;
    });
    
    redisConnection.on("reconnecting", () => {
      logger.info("Redis reconnecting...");
    });
    
    // Inicializar DLQ cuando Redis está disponible
    await initDLQ();
    
    return redisConnection;
  } catch (err) {
    logger.warn({ err: err?.message }, "Redis unavailable - using in-memory fallback");
    isRedisAvailable = false;
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BULLMQ QUEUE
// ═══════════════════════════════════════════════════════════════════════════

let bullmqQueue = null;
let queueEvents = null;

/**
 * Obtiene o crea la cola BullMQ
 */
async function getQueue() {
  if (bullmqQueue) return bullmqQueue;
  
  await initRedis();
  
  if (!isRedisAvailable) {
    logger.warn("Redis not available - queue operations will use fallback");
    return null;
  }
  
  bullmqQueue = new Queue(QUEUE_NAME, {
    connection: queueConfig.connection,
    defaultJobOptions: queueConfig.defaultJobOptions,
  });
  
  // Eventos de la cola
  queueEvents = new QueueEvents(QUEUE_NAME, {
    connection: queueConfig.connection,
  });
  
  queueEvents.on("completed", ({ jobId }) => {
    logger.debug({ jobId }, "Job completed");
  });
  
  queueEvents.on("failed", ({ jobId, failedReason }) => {
    logger.warn({ jobId, reason: failedReason }, "Job failed");
  });
  
  queueEvents.on("stalled", ({ jobId }) => {
    logger.warn({ jobId }, "Job stalled - will retry");
  });
  
  return bullmqQueue;
}

// ═══════════════════════════════════════════════════════════════════════════
// IN-MEMORY FALLBACK CON P-QUEUE (cuando Redis no está disponible)
// ═══════════════════════════════════════════════════════════════════════════

import { localQueue } from './resilience/localQueue.js';

let fallbackHandler = null;

async function processFallbackJob(job) {
  if (!fallbackHandler) {
    logger.warn({ jobId: job.id }, "No fallback handler registered");
    return;
  }
  
  try {
    await fallbackHandler(job);
  } catch (err) {
    logger.error({ err: err?.message, jobId: job.id }, "Fallback job failed");
    throw err;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} MessageJob
 * @property {string} conversationId
 * @property {string} accountId
 * @property {string} inboxId
 * @property {string} messageText
 * @property {Object} contact
 * @property {Object} governorContext
 * @property {Object} routing
 * @property {string} timestamp
 */

/**
 * Encola un mensaje para procesamiento asíncrono
 * 
 * @param {string} jobName - Nombre del tipo de job
 * @param {MessageJob} data - Datos del mensaje
 * @param {Object} options - Opciones adicionales de BullMQ
 * @returns {Promise<string>} Job ID
 */
export async function add(jobName, data, options = {}) {
  const jobId = `${jobName}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const jobData = {
    ...data,
    id: jobId,
    createdAt: Date.now(),
  };
  
  // Intentar usar BullMQ
  const queue = await getQueue();
  
  if (queue) {
    try {
      const job = await queue.add(jobName, jobData, {
        jobId,
        ...options,
      });
      
      logger.info({
        jobId,
        jobName,
        conversationId: data.conversationId,
      }, "Job added to BullMQ queue");
      
      return job.id;
    } catch (err) {
      logger.warn({ err: err?.message }, "BullMQ add failed - using p-queue fallback");
    }
  }
  
  // Fallback a p-queue (control de concurrencia local)
  const jobWrapper = { name: jobName, data: jobData, id: jobId };
  
  logger.info({
    jobId,
    jobName,
    conversationId: data.conversationId,
    fallback: 'p-queue',
    queuePending: localQueue.getStats().pending,
  }, "Job added to p-queue fallback");
  
  // Usar p-queue para control de concurrencia
  localQueue.add(
    () => processFallbackJob(jobWrapper),
    { name: `${jobName}:${jobId}` }
  ).catch(err => {
    logger.error({ err: err?.message, jobId }, "p-queue job failed");
  });
  
  return jobId;
}

/**
 * Registra un handler para procesar jobs (usado por el Worker)
 * Incluye integración con Dead Letter Queue
 * 
 * @param {Function} handler - async (job) => void
 * @param {Object} workerOptions - Opciones del worker
 * @returns {Worker|null} Worker instance o null si Redis no disponible
 */
export async function registerWorker(handler, workerOptions = {}) {
  // Siempre registrar fallback handler
  fallbackHandler = async (job) => {
    await handler({ data: job.data, id: job.id, name: job.name });
  };
  
  await initRedis();
  
  if (!isRedisAvailable) {
    logger.info("Using in-memory fallback worker");
    return null;
  }
  
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      logger.info({
        jobId: job.id,
        jobName: job.name,
        conversationId: job.data?.conversationId,
        attempt: job.attemptsMade + 1,
        maxAttempts: MAX_RETRIES,
      }, "Processing job");
      
      return await handler(job);
    },
    {
      connection: queueConfig.connection,
      concurrency: parseInt(process.env.WORKER_CONCURRENCY || "3", 10),
      ...workerOptions,
    }
  );
  
  worker.on("completed", (job) => {
    logger.info({
      jobId: job.id,
      conversationId: job.data?.conversationId,
      duration: Date.now() - job.data?.createdAt,
    }, "Job completed successfully");
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DLQ INTEGRATION - Mover jobs fallidos definitivamente a la DLQ
  // ═══════════════════════════════════════════════════════════════════════════
  worker.on("failed", async (job, err) => {
    const isLastAttempt = job?.attemptsMade >= MAX_RETRIES;
    
    logger.error({
      jobId: job?.id,
      conversationId: job?.data?.conversationId,
      err: err?.message,
      attempts: job?.attemptsMade,
      maxAttempts: MAX_RETRIES,
      isLastAttempt,
    }, isLastAttempt ? "Job failed permanently - moving to DLQ" : "Job failed - will retry");
    
    // Si es el último intento, mover a DLQ
    if (isLastAttempt && job) {
      await moveToDeadLetter(job, err, {
        workerHost: process.env.HOSTNAME || "unknown",
        queueName: QUEUE_NAME,
      });
    }
  });
  
  worker.on("error", (err) => {
    logger.error({ err: err?.message }, "Worker error");
  });
  
  logger.info({
    queue: QUEUE_NAME,
    concurrency: workerOptions.concurrency || 3,
    maxRetries: MAX_RETRIES,
    dlqEnabled: true,
  }, "BullMQ worker started with DLQ support");
  
  return worker;
}

/**
 * Obtiene estadísticas de la cola incluyendo DLQ
 */
export async function getStats() {
  const queue = await getQueue();
  const pqueueStats = localQueue.getStats();
  const dlqStats = await getDLQStats();
  
  if (!queue) {
    return {
      redis: false,
      fallback: 'p-queue',
      fallbackPending: pqueueStats.pending,
      fallbackActive: pqueueStats.active,
      fallbackSuccessRate: pqueueStats.successRate,
      dlq: dlqStats,
    };
  }
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  
  return {
    redis: true,
    waiting,
    active,
    completed,
    failed,
    delayed,
    fallback: 'p-queue',
    fallbackPending: pqueueStats.pending,
    dlq: dlqStats,
  };
}

/**
 * Pausa la cola
 */
export async function pause() {
  const queue = await getQueue();
  if (queue) await queue.pause();
}

/**
 * Reanuda la cola
 */
export async function resume() {
  const queue = await getQueue();
  if (queue) await queue.resume();
}

/**
 * Limpia la cola (para emergencias/testing)
 */
export async function obliterate() {
  const queue = await getQueue();
  if (queue) await queue.obliterate({ force: true });
}

/**
 * Cierra conexiones gracefully (incluyendo DLQ)
 */
export async function close() {
  if (bullmqQueue) await bullmqQueue.close();
  if (queueEvents) await queueEvents.close();
  if (redisConnection) await redisConnection.quit();
  
  // Cerrar DLQ
  await closeDLQ();
  
  bullmqQueue = null;
  queueEvents = null;
  redisConnection = null;
  isRedisAvailable = false;
}

/**
 * Verifica si Redis está disponible
 */
export function isAvailable() {
  return isRedisAvailable;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const aiQueue = {
  add,
  registerWorker,
  getStats,
  pause,
  resume,
  obliterate,
  close,
  isAvailable,
};

export default aiQueue;
