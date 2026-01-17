/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTIFICATION ROUTER - Decide canal de notificación por usuario
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Determina cómo y cuándo notificar a cada usuario basado en:
 * - Preferencias del usuario (desde Google Sheets via lucaConfig)
 * - Tipo de notificación
 * - Severidad
 * - Horario (quiet hours)
 * - Canal disponible
 * 
 * ZERO-HARDCODE: Toda la configuración viene de lucaConfig.js
 */

import { logger } from "@tagers/shared";
import { getUsers, getUser as getConfigUser } from "../../config/lucaConfig.js";

/**
 * Canales de notificación disponibles
 */
export const NotificationChannels = {
  WHATSAPP: "whatsapp",
  PUSH: "push",       // PWA push notification
  EMAIL: "email",
  SMS: "sms",
  IN_APP: "in_app",   // Solo en la app
};

/**
 * Orden de severidad para comparaciones
 */
const SEVERITY_ORDER = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export class NotificationRouter {
  constructor() {
    this.usersCache = null;
    this.cacheTime = null;
  }

  /**
   * Obtiene usuarios (con cache de 5 min)
   */
  async getUsersConfig() {
    const now = Date.now();
    if (this.usersCache && this.cacheTime && (now - this.cacheTime) < 5 * 60 * 1000) {
      return this.usersCache;
    }
    
    this.usersCache = await getUsers();
    this.cacheTime = now;
    return this.usersCache;
  }

  /**
   * Determina cómo notificar sobre un evento
   */
  async route(notification) {
    const {
      type,          // alert, case, approval, briefing
      severity,      // LOW, MEDIUM, HIGH, CRITICAL
      topic,         // fraud, operations, sales, etc.
      targetUsers,   // Array de user IDs específicos, o null para todos
      branchId,      // Opcional, para filtrar por sucursal
      data,          // Datos de la notificación
    } = notification;

    const routes = [];
    const users = await this.getUsersConfig();

    // Obtener usuarios objetivo
    const usersToNotify = targetUsers 
      ? targetUsers.filter(id => users[id])
      : Object.keys(users);

    for (const userId of usersToNotify) {
      const user = users[userId];
      if (!user) continue;

      // Verificar si debe notificar a este usuario
      const decision = this.shouldNotify(user, { type, severity, topic });
      
      if (!decision.notify) {
        logger.debug({
          userId,
          reason: decision.reason,
        }, "Notification skipped for user");
        continue;
      }

      // Determinar canal(es)
      const channels = this.selectChannels(user, { type, severity });

      for (const channel of channels) {
        routes.push({
          userId,
          userName: user.name,
          channel,
          phone: user.phone,
          email: user.email,
          priority: this.getPriority(severity),
          notification: {
            type,
            severity,
            topic,
            data,
          },
        });
      }
    }

    logger.info({
      notificationType: type,
      severity,
      routesCount: routes.length,
    }, "Notification routed");

    return routes;
  }

  /**
   * Determina si debe notificar a un usuario
   */
  shouldNotify(user, { type, severity, topic }) {
    // 1. Verificar severidad mínima
    const severityLevel = SEVERITY_ORDER[severity] || 1;
    const thresholdLevel = SEVERITY_ORDER[user.severity_threshold] || 1;

    if (severityLevel < thresholdLevel) {
      // Excepción: críticos siempre pasan si critical_override está activo
      if (!(severity === "CRITICAL" && user.critical_override)) {
        return { notify: false, reason: "below_severity_threshold" };
      }
    }

    // 2. Verificar topics (si el usuario tiene filtro de topics)
    if (user.topics && user.topics.length > 0) {
      if (topic && !user.topics.includes(topic)) {
        // Excepción: críticos siempre pasan
        if (severity !== "CRITICAL") {
          return { notify: false, reason: "topic_not_subscribed" };
        }
      }
    }

    // 3. Verificar quiet hours
    if (user.quiet_hours?.enabled && !this.isQuietHoursOverride(severity, user)) {
      const now = new Date();
      const currentHour = now.getHours();
      const { start, end } = user.quiet_hours;

      // Quiet hours pueden cruzar medianoche (ej: 22 a 7)
      const inQuietHours = start > end
        ? (currentHour >= start || currentHour < end)
        : (currentHour >= start && currentHour < end);

      if (inQuietHours) {
        return { notify: false, reason: "quiet_hours" };
      }
    }

    return { notify: true };
  }

  /**
   * Determina si debe ignorar quiet hours
   */
  isQuietHoursOverride(severity, user) {
    return severity === "CRITICAL" && user.critical_override;
  }

  /**
   * Selecciona los canales a usar
   */
  selectChannels(user, { type, severity }) {
    const channels = [];

    // Para briefings, usar solo el canal preferido
    if (type === "briefing") {
      return [user.channels[0] || NotificationChannels.WHATSAPP];
    }

    // Para críticos, usar todos los canales disponibles
    if (severity === "CRITICAL") {
      return user.channels;
    }

    // Para otros, usar el canal primario
    return [user.channels[0] || NotificationChannels.IN_APP];
  }

  /**
   * Obtiene la prioridad de envío
   */
  getPriority(severity) {
    const priorities = {
      CRITICAL: 1,  // Inmediato
      HIGH: 2,      // Rápido (< 1 min)
      MEDIUM: 3,    // Normal (< 5 min)
      LOW: 4,       // Bajo (puede demorar)
    };
    return priorities[severity] || 3;
  }

  /**
   * Obtiene configuración de un usuario
   */
  async getUser(userId) {
    const users = await this.getUsersConfig();
    return users[userId] || null;
  }

  /**
   * Obtiene usuarios por rol
   */
  async getUsersByRole(role) {
    const users = await this.getUsersConfig();
    return Object.entries(users)
      .filter(([_, user]) => user.role === role)
      .map(([id, user]) => ({ id, ...user }));
  }

  /**
   * Obtiene usuarios suscritos a un topic
   */
  async getUsersByTopic(topic) {
    const users = await this.getUsersConfig();
    return Object.entries(users)
      .filter(([_, user]) => !user.topics || user.topics.includes(topic))
      .map(([id, user]) => ({ id, ...user }));
  }

  /**
   * Determina el tipo de briefing para un usuario
   */
  async getBriefingType(userId) {
    const user = await this.getUser(userId);
    return user?.briefing_type || "FULL";
  }

  /**
   * Lista todos los usuarios que deben recibir el morning briefing
   */
  async getBriefingRecipients() {
    const users = await this.getUsersConfig();
    return Object.entries(users)
      .filter(([_, user]) => user.briefing_type && user.phone)
      .map(([id, user]) => ({
        id,
        name: user.name,
        phone: user.phone,
        channel: user.channels[0],
        briefingType: user.briefing_type,
      }));
  }
}

// Export singleton
export const notificationRouter = new NotificationRouter();

export default NotificationRouter;
