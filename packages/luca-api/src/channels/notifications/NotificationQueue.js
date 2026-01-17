/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTIFICATION QUEUE - Cola de Notificaciones con Rate Limiting
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja el envío de notificaciones con:
 * - Rate limiting por usuario y canal
 * - Priorización por severidad
 * - Reintentos automáticos
 * - Deduplicación
 * - Métricas de envío
 */

import { logger, getRedisClient } from "@tagers/shared";
import { whatsappClient } from "../whatsapp/WhatsAppClient.js";
import messageFormatter from "../whatsapp/messageFormatter.js";
import { Templates, buildTemplateComponents, getTemplateName } from "../whatsapp/templates.js";

/**
 * Configuración de rate limiting
 */
const RATE_LIMITS = {
  whatsapp: {
    perUser: { max: 10, windowMs: 60 * 1000 },      // 10 msgs por minuto por usuario
    perPhone: { max: 30, windowMs: 60 * 1000 },     // 30 msgs por minuto por teléfono
    global: { max: 100, windowMs: 60 * 1000 },      // 100 msgs por minuto global
  },
  push: {
    perUser: { max: 20, windowMs: 60 * 1000 },
    global: { max: 500, windowMs: 60 * 1000 },
  },
  email: {
    perUser: { max: 5, windowMs: 60 * 1000 },
    global: { max: 50, windowMs: 60 * 1000 },
  },
};

/**
 * Configuración de reintentos
 */
const RETRY_CONFIG = {
  maxRetries: 3,
  backoffMs: [1000, 5000, 15000], // 1s, 5s, 15s
};

export class NotificationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.metrics = {
      sent: 0,
      failed: 0,
      rateLimited: 0,
      deduplicated: 0,
    };
    this.recentNotifications = new Map(); // Para deduplicación
  }

  /**
   * Agrega notificaciones a la cola
   */
  async enqueue(routes) {
    for (const route of routes) {
      // Deduplicar
      const dedupeKey = this.getDedupeKey(route);
      if (this.isRecentDuplicate(dedupeKey)) {
        this.metrics.deduplicated++;
        logger.debug({ dedupeKey }, "Notification deduplicated");
        continue;
      }

      // Agregar a la cola con prioridad
      this.queue.push({
        ...route,
        id: `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        enqueuedAt: new Date().toISOString(),
        retries: 0,
        dedupeKey,
      });

      // Marcar como reciente para deduplicación
      this.markAsRecent(dedupeKey);
    }

    // Ordenar por prioridad
    this.queue.sort((a, b) => a.priority - b.priority);

    // Procesar si no está en proceso
    if (!this.processing) {
      this.processQueue();
    }

    logger.info({ 
      added: routes.length, 
      queueSize: this.queue.length 
    }, "Notifications enqueued");
  }

  /**
   * Procesa la cola de notificaciones
   */
  async processQueue() {
    if (this.processing || this.queue.length === 0) return;

    this.processing = true;

    while (this.queue.length > 0) {
      const notification = this.queue.shift();

      try {
        // Verificar rate limit
        const rateLimitOk = await this.checkRateLimit(notification);
        if (!rateLimitOk) {
          // Re-encolar con delay si hay rate limit
          this.metrics.rateLimited++;
          if (notification.retries < RETRY_CONFIG.maxRetries) {
            notification.retries++;
            setTimeout(() => {
              this.queue.push(notification);
              this.processQueue();
            }, RETRY_CONFIG.backoffMs[notification.retries - 1]);
          }
          continue;
        }

        // Enviar según el canal
        const result = await this.send(notification);

        if (result.success) {
          this.metrics.sent++;
          await this.incrementRateLimit(notification);
          
          logger.info({
            channel: notification.channel,
            userId: notification.userId,
            type: notification.notification.type,
          }, "Notification sent");
        } else {
          // Reintentar si es posible
          if (notification.retries < RETRY_CONFIG.maxRetries && result.retryable) {
            notification.retries++;
            notification.lastError = result.error;
            
            setTimeout(() => {
              this.queue.push(notification);
              this.processQueue();
            }, RETRY_CONFIG.backoffMs[notification.retries - 1]);
          } else {
            this.metrics.failed++;
            logger.error({
              channel: notification.channel,
              userId: notification.userId,
              error: result.error,
            }, "Notification failed permanently");
          }
        }

        // Pequeña pausa entre envíos
        await this.delay(100);

      } catch (err) {
        logger.error({ 
          err: err?.message,
          notificationId: notification.id,
        }, "Error processing notification");
        this.metrics.failed++;
      }
    }

    this.processing = false;
  }

  /**
   * Envía una notificación según su canal
   */
  async send(notification) {
    const { channel, phone, email, notification: notif } = notification;

    switch (channel) {
      case "whatsapp":
        return this.sendWhatsApp(notification);
      case "push":
        return this.sendPush(notification);
      case "email":
        return this.sendEmail(notification);
      default:
        return { success: false, error: "Unknown channel" };
    }
  }

  /**
   * Envía notificación por WhatsApp
   */
  async sendWhatsApp(notification) {
    const { phone, userName, notification: notif } = notification;
    const { type, severity, data } = notif;

    try {
      let result;

      switch (type) {
        case "alert":
          // Usar template de alerta según severidad
          const alertTemplate = severity === "CRITICAL" ? "ALERT_CRITICAL" 
            : severity === "HIGH" ? "ALERT_HIGH" 
            : "ALERT_INFO";
          
          const alertText = await messageFormatter.formatAlert(data);
          result = await whatsappClient.sendText(phone, alertText);
          break;

        case "briefing":
          const briefingText = data.briefingType === "HEADLINES"
            ? messageFormatter.formatHeadlines(data, userName)
            : messageFormatter.formatBriefing(data, userName);
          
          result = await whatsappClient.sendText(phone, briefingText);
          break;

        case "approval":
          const approvalText = messageFormatter.formatApprovalRequest(data.action, data.case);
          result = await whatsappClient.sendButtons(phone, approvalText, [
            { id: `approve_${data.action.action_id}`, title: "✅ Aprobar" },
            { id: `reject_${data.action.action_id}`, title: "❌ Rechazar" },
          ]);
          break;

        case "case":
          const caseText = await messageFormatter.formatCase(data);
          result = await whatsappClient.sendText(phone, caseText);
          break;

        case "fraud":
          const fraudText = `🔍 *Posible Fraude Detectado*\n\n${data.title}\n\n${data.description}\n\nConfianza: ${Math.round(data.confidence * 100)}%`;
          result = await whatsappClient.sendButtons(phone, fraudText, [
            { id: `view_${data.case_id}`, title: "Ver expediente" },
            { id: `ack_${data.alert_id}`, title: "Atendido" },
          ]);
          break;

        default:
          // Texto genérico
          const genericText = data.message || data.text || JSON.stringify(data);
          result = await whatsappClient.sendText(phone, genericText);
      }

      return {
        success: result?.success || false,
        messageId: result?.messageId,
        error: result?.error,
        retryable: result?.error?.includes("rate") || result?.error?.includes("timeout"),
      };

    } catch (err) {
      return {
        success: false,
        error: err?.message,
        retryable: true,
      };
    }
  }

  /**
   * Envía notificación push (PWA)
   */
  async sendPush(notification) {
    // Por ahora solo loguear - la implementación real requiere web-push
    logger.info({
      userId: notification.userId,
      type: notification.notification.type,
    }, "Push notification would be sent");

    // TODO: Implementar con web-push cuando tengamos service worker
    return { success: true, mock: true };
  }

  /**
   * Envía notificación por email
   */
  async sendEmail(notification) {
    // Por ahora solo loguear - la implementación real requiere SMTP
    logger.info({
      email: notification.email,
      type: notification.notification.type,
    }, "Email notification would be sent");

    // TODO: Implementar con nodemailer o servicio de email
    return { success: true, mock: true };
  }

  /**
   * Verifica rate limit
   */
  async checkRateLimit(notification) {
    const redis = getRedisClient();
    if (!redis) return true; // Sin Redis, permitir todo

    const limits = RATE_LIMITS[notification.channel];
    if (!limits) return true;

    try {
      // Verificar límite por usuario
      const userKey = `ratelimit:${notification.channel}:user:${notification.userId}`;
      const userCount = await redis.get(userKey);
      if (parseInt(userCount || 0) >= limits.perUser.max) {
        return false;
      }

      // Verificar límite global
      const globalKey = `ratelimit:${notification.channel}:global`;
      const globalCount = await redis.get(globalKey);
      if (parseInt(globalCount || 0) >= limits.global.max) {
        return false;
      }

      return true;
    } catch (err) {
      logger.warn({ err: err?.message }, "Rate limit check failed, allowing");
      return true;
    }
  }

  /**
   * Incrementa contadores de rate limit
   */
  async incrementRateLimit(notification) {
    const redis = getRedisClient();
    if (!redis) return;

    const limits = RATE_LIMITS[notification.channel];
    if (!limits) return;

    try {
      const userKey = `ratelimit:${notification.channel}:user:${notification.userId}`;
      const globalKey = `ratelimit:${notification.channel}:global`;

      await redis.multi()
        .incr(userKey)
        .expire(userKey, Math.ceil(limits.perUser.windowMs / 1000))
        .incr(globalKey)
        .expire(globalKey, Math.ceil(limits.global.windowMs / 1000))
        .exec();
    } catch (err) {
      logger.warn({ err: err?.message }, "Rate limit increment failed");
    }
  }

  /**
   * Genera key para deduplicación
   */
  getDedupeKey(route) {
    const { userId, channel, notification } = route;
    const { type, data } = notification;
    
    // Usar un identificador único del contenido
    const contentId = data?.alert_id || data?.case_id || data?.action_id || "";
    return `${userId}:${channel}:${type}:${contentId}`;
  }

  /**
   * Verifica si es un duplicado reciente
   */
  isRecentDuplicate(key) {
    const lastSent = this.recentNotifications.get(key);
    if (!lastSent) return false;
    
    // 5 minutos de ventana de deduplicación
    return (Date.now() - lastSent) < 5 * 60 * 1000;
  }

  /**
   * Marca notificación como enviada recientemente
   */
  markAsRecent(key) {
    this.recentNotifications.set(key, Date.now());
    
    // Limpiar entradas antiguas cada cierto tiempo
    if (this.recentNotifications.size > 1000) {
      const cutoff = Date.now() - 10 * 60 * 1000;
      for (const [k, v] of this.recentNotifications) {
        if (v < cutoff) this.recentNotifications.delete(k);
      }
    }
  }

  /**
   * Helper para delay
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Obtiene métricas actuales
   */
  getMetrics() {
    return {
      ...this.metrics,
      queueSize: this.queue.length,
      processing: this.processing,
    };
  }

  /**
   * Limpia la cola
   */
  clear() {
    this.queue = [];
  }
}

// Export singleton
export const notificationQueue = new NotificationQueue();

export default NotificationQueue;
