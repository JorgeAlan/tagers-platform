/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MORNING BRIEFING JOB - Cron para enviar el briefing diario
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Este job se ejecuta todos los días a las 8:00 AM (hora CDMX)
 * y envía el morning briefing personalizado a cada socio.
 */

import cron from "node-cron";
import { logger } from "@tagers/shared";
import { briefingGenerator } from "../briefing/BriefingGenerator.js";
import { notificationRouter } from "../channels/notifications/NotificationRouter.js";
import { notificationQueue } from "../channels/notifications/NotificationQueue.js";

// Timezone de México
const TIMEZONE = "America/Mexico_City";

// Hora del briefing (8:00 AM)
const BRIEFING_HOUR = 8;
const BRIEFING_MINUTE = 0;

// Cron expression: 0 8 * * * = 8:00 AM todos los días
const CRON_EXPRESSION = `${BRIEFING_MINUTE} ${BRIEFING_HOUR} * * *`;

let job = null;

/**
 * Inicia el job de morning briefing
 */
export function startMorningBriefingJob() {
  if (job) {
    logger.warn("Morning briefing job already running");
    return;
  }

  job = cron.schedule(
    CRON_EXPRESSION,
    async () => {
      await runMorningBriefing();
    },
    {
      timezone: TIMEZONE,
    }
  );

  logger.info({
    cron: CRON_EXPRESSION,
    timezone: TIMEZONE,
  }, "Morning briefing job started");
}

/**
 * Detiene el job
 */
export function stopMorningBriefingJob() {
  if (job) {
    job.stop();
    job = null;
    logger.info("Morning briefing job stopped");
  }
}

/**
 * Ejecuta el morning briefing
 */
export async function runMorningBriefing() {
  const startTime = Date.now();
  logger.info("Starting morning briefing distribution");

  try {
    // Obtener destinatarios (async now)
    const recipients = await notificationRouter.getBriefingRecipients();
    
    logger.info({ recipientCount: recipients.length }, "Briefing recipients");

    const results = {
      sent: 0,
      failed: 0,
      errors: [],
    };

    // Generar y enviar briefing para cada destinatario
    for (const recipient of recipients) {
      try {
        // Generar briefing personalizado
        const briefing = await briefingGenerator.generate(
          recipient.id,
          recipient.briefingType
        );

        // Enviar por el canal preferido
        const routes = [{
          userId: recipient.id,
          userName: recipient.name,
          channel: recipient.channel,
          phone: recipient.phone,
          priority: 3, // Normal priority
          notification: {
            type: "briefing",
            data: {
              ...briefing,
              briefingType: recipient.briefingType,
            },
          },
        }];

        await notificationQueue.enqueue(routes);
        results.sent++;

        logger.info({
          userId: recipient.id,
          briefingType: recipient.briefingType,
          channel: recipient.channel,
        }, "Briefing sent");

      } catch (err) {
        results.failed++;
        results.errors.push({
          userId: recipient.id,
          error: err?.message,
        });
        
        logger.error({
          userId: recipient.id,
          err: err?.message,
        }, "Failed to send briefing");
      }

      // Pequeña pausa entre envíos
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const duration = Date.now() - startTime;
    
    logger.info({
      duration,
      sent: results.sent,
      failed: results.failed,
    }, "Morning briefing distribution completed");

    return results;

  } catch (err) {
    logger.error({ err: err?.message }, "Morning briefing job failed");
    throw err;
  }
}

/**
 * Ejecuta el briefing manualmente (para testing)
 */
export async function triggerBriefing(userId = null) {
  if (userId) {
    // Briefing para un solo usuario
    const user = await notificationRouter.getUser(userId);
    if (!user) {
      throw new Error(`User not found: ${userId}`);
    }

    const briefingType = await notificationRouter.getBriefingType(userId);
    const briefing = await briefingGenerator.generate(userId, briefingType);

    const routes = [{
      userId,
      userName: user.name,
      channel: user.channels[0],
      phone: user.phone,
      priority: 2,
      notification: {
        type: "briefing",
        data: {
          ...briefing,
          briefingType,
        },
      },
    }];

    await notificationQueue.enqueue(routes);
    
    return { userId, briefingType, status: "sent" };
  }

  // Briefing completo
  return runMorningBriefing();
}

/**
 * Obtiene el estado del job
 */
export function getJobStatus() {
  return {
    running: job !== null,
    schedule: CRON_EXPRESSION,
    timezone: TIMEZONE,
    nextRun: getNextRunTime(),
  };
}

/**
 * Calcula la próxima ejecución
 */
function getNextRunTime() {
  const now = new Date();
  const next = new Date(now);
  
  // Si ya pasó la hora de hoy, programar para mañana
  if (now.getHours() >= BRIEFING_HOUR) {
    next.setDate(next.getDate() + 1);
  }
  
  next.setHours(BRIEFING_HOUR, BRIEFING_MINUTE, 0, 0);
  
  return next.toISOString();
}

export default {
  start: startMorningBriefingJob,
  stop: stopMorningBriefingJob,
  run: runMorningBriefing,
  trigger: triggerBriefing,
  status: getJobStatus,
};
