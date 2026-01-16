/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DLQ PROCESSOR - Procesador de Cola de Mensajes Muertos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja mensajes que fallaron después de todos los reintentos.
 * 
 * Funcionalidades:
 * - Almacena jobs fallidos para inspección manual
 * - Permite reintentar jobs manualmente
 * - Notifica a ops cuando hay jobs en la DLQ
 * - Provee APIs para gestionar la DLQ
 * 
 * @version 1.0.0
 */

import { Queue, QueueEvents, Worker } from "bullmq";
import { logger } from "../utils/logger.js";
import { getRedisClient, isRedisAvailable } from "./redis.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
const DLQ_NAME = process.env.DLQ_NAME || "tania-dlq";
const MAIN_QUEUE_NAME = process.env.QUEUE_NAME || "tania-messages";

// Alertas
const DLQ_ALERT_THRESHOLD = parseInt(process.env.DLQ_ALERT_THRESHOLD || "10", 10);
const DLQ_CHECK_INTERVAL_MS = parseInt(process.env.DLQ_CHECK_INTERVAL_MS || "300000", 10); // 5 min

// Parse REDIS_URL para BullMQ
function parseRedisUrl(url) {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parseInt(parsed.port || "6379", 10),
      password: parsed.password || undefined,
      username: parsed.username || undefined,
      maxRetriesPerRequest: null,
    };
  } catch (err) {
    return {
      host: "localhost",
      port: 6379,
      maxRetriesPerRequest: null,
    };
  }
}

const connection = parseRedisUrl(REDIS_URL);

// ═══════════════════════════════════════════════════════════════════════════
// DLQ QUEUE
// ═══════════════════════════════════════════════════════════════════════════

let dlqQueue = null;
let dlqEvents = null;
let alertCheckInterval = null;

/**
 * Inicializa la Dead Letter Queue
 */
export async function initDLQ() {
  if (dlqQueue) return dlqQueue;
  
  if (!isRedisAvailable()) {
    logger.warn("Redis not available - DLQ disabled");
    return null;
  }
  
  dlqQueue = new Queue(DLQ_NAME, {
    connection,
    defaultJobOptions: {
      // Los jobs en DLQ no se reintentan automáticamente
      attempts: 1,
      removeOnComplete: false,
      removeOnFail: false, // Mantener para inspección
    },
  });
  
  dlqEvents = new QueueEvents(DLQ_NAME, { connection });
  
  // Escuchar eventos
  dlqEvents.on("added", ({ jobId }) => {
    logger.warn({ jobId, queue: DLQ_NAME }, "Job added to Dead Letter Queue");
  });
  
  // Iniciar monitoreo de alertas
  startAlertMonitoring();
  
  logger.info({ queue: DLQ_NAME }, "Dead Letter Queue initialized");
  
  return dlqQueue;
}

// ═══════════════════════════════════════════════════════════════════════════
// DLQ OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mueve un job fallido a la DLQ
 * 
 * @param {Object} failedJob - Job que falló
 * @param {Error} error - Error que causó el fallo
 * @param {Object} metadata - Metadata adicional
 */
export async function moveToDeadLetter(failedJob, error, metadata = {}) {
  const queue = await initDLQ();
  if (!queue) {
    logger.error({ jobId: failedJob?.id }, "Cannot move to DLQ - queue not available");
    return null;
  }
  
  const dlqJobData = {
    // Datos originales del job
    originalJobId: failedJob.id,
    originalJobName: failedJob.name,
    originalData: failedJob.data,
    originalQueue: MAIN_QUEUE_NAME,
    
    // Info del fallo
    failedAt: new Date().toISOString(),
    failureReason: error?.message || "Unknown error",
    failureStack: error?.stack,
    attemptsMade: failedJob.attemptsMade,
    
    // Metadata
    ...metadata,
  };
  
  try {
    const dlqJob = await queue.add("failed-message", dlqJobData, {
      jobId: `dlq_${failedJob.id}_${Date.now()}`,
    });
    
    logger.warn({
      originalJobId: failedJob.id,
      dlqJobId: dlqJob.id,
      conversationId: failedJob.data?.conversationId,
      error: error?.message,
    }, "Job moved to Dead Letter Queue");
    
    return dlqJob;
  } catch (err) {
    logger.error({ err: err?.message, jobId: failedJob.id }, "Failed to move job to DLQ");
    return null;
  }
}

/**
 * Reintenta un job de la DLQ moviéndolo de vuelta a la cola principal
 * 
 * @param {string} dlqJobId - ID del job en la DLQ
 * @returns {Object} Resultado del reintento
 */
export async function retryFromDLQ(dlqJobId) {
  const queue = await initDLQ();
  if (!queue) {
    return { success: false, error: "DLQ not available" };
  }
  
  try {
    const dlqJob = await queue.getJob(dlqJobId);
    if (!dlqJob) {
      return { success: false, error: "Job not found in DLQ" };
    }
    
    // Obtener la cola principal
    const mainQueue = new Queue(MAIN_QUEUE_NAME, { connection });
    
    // Agregar el job original de vuelta a la cola principal
    const retriedJob = await mainQueue.add(
      dlqJob.data.originalJobName,
      dlqJob.data.originalData,
      {
        jobId: `retry_${dlqJob.data.originalJobId}_${Date.now()}`,
        attempts: 3, // Dar otra oportunidad con reintentos
        backoff: { type: "exponential", delay: 2000 },
      }
    );
    
    // Marcar el job DLQ como completado
    await dlqJob.remove();
    
    logger.info({
      dlqJobId,
      newJobId: retriedJob.id,
      conversationId: dlqJob.data.originalData?.conversationId,
    }, "Job retried from DLQ");
    
    await mainQueue.close();
    
    return { 
      success: true, 
      newJobId: retriedJob.id,
      originalJobId: dlqJob.data.originalJobId,
    };
  } catch (err) {
    logger.error({ err: err?.message, dlqJobId }, "Failed to retry job from DLQ");
    return { success: false, error: err?.message };
  }
}

/**
 * Obtiene todos los jobs en la DLQ
 * 
 * @param {Object} options - Opciones de paginación
 * @returns {Array} Lista de jobs
 */
export async function getDLQJobs(options = {}) {
  const queue = await initDLQ();
  if (!queue) {
    return { jobs: [], total: 0 };
  }
  
  const { start = 0, end = 50 } = options;
  
  try {
    const jobs = await queue.getJobs(["waiting", "active", "delayed"], start, end);
    const total = await queue.getJobCounts();
    
    return {
      jobs: jobs.map(job => ({
        id: job.id,
        originalJobId: job.data.originalJobId,
        conversationId: job.data.originalData?.conversationId,
        failedAt: job.data.failedAt,
        failureReason: job.data.failureReason,
        attemptsMade: job.data.attemptsMade,
        data: job.data.originalData,
      })),
      total: total.waiting + total.active + total.delayed,
      counts: total,
    };
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get DLQ jobs");
    return { jobs: [], total: 0, error: err?.message };
  }
}

/**
 * Elimina un job de la DLQ (descartarlo permanentemente)
 * 
 * @param {string} dlqJobId - ID del job en la DLQ
 */
export async function discardFromDLQ(dlqJobId) {
  const queue = await initDLQ();
  if (!queue) {
    return { success: false, error: "DLQ not available" };
  }
  
  try {
    const job = await queue.getJob(dlqJobId);
    if (!job) {
      return { success: false, error: "Job not found" };
    }
    
    await job.remove();
    
    logger.info({ dlqJobId }, "Job discarded from DLQ");
    
    return { success: true };
  } catch (err) {
    logger.error({ err: err?.message, dlqJobId }, "Failed to discard job from DLQ");
    return { success: false, error: err?.message };
  }
}

/**
 * Reintenta todos los jobs en la DLQ
 */
export async function retryAllFromDLQ() {
  const { jobs, total } = await getDLQJobs({ start: 0, end: 1000 });
  
  const results = {
    total,
    succeeded: 0,
    failed: 0,
    errors: [],
  };
  
  for (const job of jobs) {
    const result = await retryFromDLQ(job.id);
    if (result.success) {
      results.succeeded++;
    } else {
      results.failed++;
      results.errors.push({ jobId: job.id, error: result.error });
    }
  }
  
  logger.info(results, "Bulk retry from DLQ completed");
  
  return results;
}

/**
 * Limpia la DLQ (elimina todos los jobs)
 */
export async function clearDLQ() {
  const queue = await initDLQ();
  if (!queue) {
    return { success: false, error: "DLQ not available" };
  }
  
  try {
    await queue.obliterate({ force: true });
    logger.warn("DLQ cleared");
    return { success: true };
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to clear DLQ");
    return { success: false, error: err?.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALERT MONITORING
// ═══════════════════════════════════════════════════════════════════════════

let lastAlertSent = 0;

async function checkDLQAlerts() {
  const queue = await initDLQ();
  if (!queue) return;
  
  try {
    const counts = await queue.getJobCounts();
    const totalJobs = counts.waiting + counts.active + counts.delayed;
    
    if (totalJobs >= DLQ_ALERT_THRESHOLD) {
      const now = Date.now();
      // Solo alertar cada 30 minutos
      if (now - lastAlertSent > 30 * 60 * 1000) {
        lastAlertSent = now;
        
        logger.error({
          dlqCount: totalJobs,
          threshold: DLQ_ALERT_THRESHOLD,
        }, "⚠️ DLQ ALERT: Dead Letter Queue has exceeded threshold!");
        
        // Aquí puedes agregar notificación a Slack/Email/etc.
        // await notifyOps({ ... });
      }
    }
  } catch (err) {
    logger.warn({ err: err?.message }, "DLQ alert check failed");
  }
}

function startAlertMonitoring() {
  if (alertCheckInterval) return;
  
  alertCheckInterval = setInterval(checkDLQAlerts, DLQ_CHECK_INTERVAL_MS);
  
  // Check inicial
  checkDLQAlerts();
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de la DLQ
 */
export async function getDLQStats() {
  const queue = await initDLQ();
  if (!queue) {
    return { available: false };
  }
  
  try {
    const counts = await queue.getJobCounts();
    const jobs = await queue.getJobs(["waiting"], 0, 10);
    
    // Agrupar por razón de fallo
    const failureReasons = {};
    for (const job of jobs) {
      const reason = job.data?.failureReason || "Unknown";
      failureReasons[reason] = (failureReasons[reason] || 0) + 1;
    }
    
    return {
      available: true,
      counts: {
        waiting: counts.waiting,
        active: counts.active,
        delayed: counts.delayed,
        total: counts.waiting + counts.active + counts.delayed,
      },
      recentFailureReasons: failureReasons,
      alertThreshold: DLQ_ALERT_THRESHOLD,
      isAboveThreshold: counts.waiting >= DLQ_ALERT_THRESHOLD,
    };
  } catch (err) {
    return { available: false, error: err?.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cierra conexiones gracefully
 */
export async function closeDLQ() {
  if (alertCheckInterval) {
    clearInterval(alertCheckInterval);
    alertCheckInterval = null;
  }
  
  if (dlqEvents) {
    await dlqEvents.close();
    dlqEvents = null;
  }
  
  if (dlqQueue) {
    await dlqQueue.close();
    dlqQueue = null;
  }
  
  logger.info("DLQ connections closed");
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const dlqProcessor = {
  initDLQ,
  moveToDeadLetter,
  retryFromDLQ,
  getDLQJobs,
  discardFromDLQ,
  retryAllFromDLQ,
  clearDLQ,
  getDLQStats,
  closeDLQ,
};

export default dlqProcessor;
