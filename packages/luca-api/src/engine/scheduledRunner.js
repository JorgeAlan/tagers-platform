/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCHEDULED RUNNER - Ejecuta detectores según su schedule
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Usa BullMQ para:
 * - Ejecutar detectores según su cron schedule
 * - Manejar retries y errores
 * - Evitar ejecuciones concurrentes del mismo detector
 */

import { Queue, Worker } from "bullmq";
import { logger, getRedisClient } from "@tagers/shared";
import { getActiveDetectors, getDetector } from "../services/registryService.js";
import { runDetector } from "./detectorRunner.js";

const QUEUE_NAME = "luca-detector-jobs";

let queue = null;
let worker = null;

/**
 * Inicializa el scheduler de detectores
 */
export async function initScheduler() {
  const redis = getRedisClient();
  
  if (!redis) {
    logger.warn("Redis not available, scheduler disabled");
    return null;
  }
  
  const connection = {
    host: redis.options?.host || "localhost",
    port: redis.options?.port || 6379,
    password: redis.options?.password,
  };
  
  // Crear queue
  queue = new Queue(QUEUE_NAME, { connection });
  
  // Crear worker
  worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { detectorId, scope, triggeredBy } = job.data;
      
      logger.info({
        jobId: job.id,
        detectorId,
        triggeredBy,
        attempt: job.attemptsMade + 1,
      }, "Processing detector job");
      
      try {
        const result = await runDetector(detectorId, scope || {});
        return result;
      } catch (error) {
        logger.error({
          jobId: job.id,
          detectorId,
          error: error?.message,
        }, "Detector job failed");
        throw error;
      }
    },
    {
      connection,
      concurrency: 3, // Máximo 3 detectores en paralelo
      limiter: {
        max: 10,
        duration: 60000, // Máximo 10 jobs por minuto
      },
    }
  );
  
  // Event handlers
  worker.on("completed", (job, result) => {
    logger.info({
      jobId: job.id,
      detectorId: job.data.detectorId,
      runId: result?.runId,
      findings: result?.findings?.length || 0,
    }, "Detector job completed");
  });
  
  worker.on("failed", (job, error) => {
    logger.error({
      jobId: job?.id,
      detectorId: job?.data?.detectorId,
      error: error?.message,
      attempts: job?.attemptsMade,
    }, "Detector job failed");
  });
  
  logger.info("Detector scheduler initialized");
  
  // Programar detectores según su schedule
  await scheduleDetectors();
  
  return { queue, worker };
}

/**
 * Programa todos los detectores activos
 */
export async function scheduleDetectors() {
  if (!queue) {
    logger.warn("Queue not initialized, cannot schedule detectors");
    return;
  }
  
  const detectors = await getActiveDetectors();
  
  for (const detector of detectors) {
    if (!detector.schedule) continue;
    
    try {
      // Remover job repetible anterior si existe
      const repeatableJobs = await queue.getRepeatableJobs();
      const existingJob = repeatableJobs.find(j => j.name === `detector-${detector.detector_id}`);
      
      if (existingJob) {
        await queue.removeRepeatableByKey(existingJob.key);
      }
      
      // Agregar nuevo job repetible
      await queue.add(
        `detector-${detector.detector_id}`,
        {
          detectorId: detector.detector_id,
          scope: {},
          triggeredBy: "scheduler",
        },
        {
          repeat: {
            pattern: detector.schedule,
          },
          attempts: 3,
          backoff: {
            type: "exponential",
            delay: 5000,
          },
          removeOnComplete: {
            count: 100, // Mantener últimos 100 completados
          },
          removeOnFail: {
            count: 50, // Mantener últimos 50 fallidos
          },
        }
      );
      
      logger.info({
        detectorId: detector.detector_id,
        schedule: detector.schedule,
      }, "Detector scheduled");
      
    } catch (error) {
      logger.error({
        detectorId: detector.detector_id,
        error: error?.message,
      }, "Failed to schedule detector");
    }
  }
  
  logger.info({ count: detectors.length }, "Detectors scheduled");
}

/**
 * Ejecuta un detector inmediatamente (fuera de schedule)
 */
export async function triggerDetector(detectorId, scope = {}, triggeredBy = "manual") {
  if (!queue) {
    // Ejecutar directamente si no hay queue
    logger.warn("Queue not available, running detector directly");
    return runDetector(detectorId, scope);
  }
  
  // Verificar que el detector existe
  const detector = await getDetector(detectorId);
  if (!detector) {
    throw new Error(`Detector not found: ${detectorId}`);
  }
  
  // Agregar job a la cola
  const job = await queue.add(
    `manual-${detectorId}-${Date.now()}`,
    {
      detectorId,
      scope,
      triggeredBy,
    },
    {
      attempts: 1,
      removeOnComplete: true,
    }
  );
  
  logger.info({
    jobId: job.id,
    detectorId,
    triggeredBy,
  }, "Detector triggered");
  
  // Esperar resultado (timeout 60s)
  const result = await job.waitUntilFinished(queue, 60000);
  
  return result;
}

/**
 * Obtiene estado de la cola
 */
export async function getQueueStatus() {
  if (!queue) {
    return { status: "disabled", reason: "Queue not initialized" };
  }
  
  const [waiting, active, completed, failed, delayed] = await Promise.all([
    queue.getWaitingCount(),
    queue.getActiveCount(),
    queue.getCompletedCount(),
    queue.getFailedCount(),
    queue.getDelayedCount(),
  ]);
  
  const repeatableJobs = await queue.getRepeatableJobs();
  
  return {
    status: "active",
    counts: { waiting, active, completed, failed, delayed },
    scheduledDetectors: repeatableJobs.map(j => ({
      name: j.name,
      pattern: j.pattern,
      next: j.next ? new Date(j.next).toISOString() : null,
    })),
  };
}

/**
 * Cierra el scheduler
 */
export async function closeScheduler() {
  if (worker) {
    await worker.close();
    logger.info("Worker closed");
  }
  
  if (queue) {
    await queue.close();
    logger.info("Queue closed");
  }
}

export default {
  initScheduler,
  scheduleDetectors,
  triggerDetector,
  getQueueStatus,
  closeScheduler,
};
