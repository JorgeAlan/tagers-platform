/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ROUTING SERVICE - Decide quién recibe qué
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Basado en:
 * - Preferencias de usuario (severity_min, channels, quiet_hours)
 * - Tipo de alerta/caso
 * - Sucursal (watchlists)
 * - Hora del día (quiet hours)
 */

import { logger, query } from "@tagers/shared";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const SEVERITY_LEVELS = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

const CHANNELS = {
  TOWER: "tower",       // In-app notification
  WHATSAPP: "whatsapp", // WhatsApp message
  EMAIL: "email",       // Email
  SMS: "sms",          // SMS for critical
};

// Quiet hours por defecto (México City timezone)
const DEFAULT_QUIET_HOURS = {
  start: 22, // 10 PM
  end: 7,    // 7 AM
  timezone: "America/Mexico_City",
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene la hora actual en timezone México
 */
function getCurrentHourMexico() {
  const now = new Date();
  const mexicoTime = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    hour12: false,
    timeZone: "America/Mexico_City",
  }).format(now);
  return parseInt(mexicoTime);
}

/**
 * Verifica si estamos en quiet hours
 */
function isQuietHours(quietHoursConfig = DEFAULT_QUIET_HOURS) {
  const currentHour = getCurrentHourMexico();
  const { start, end } = quietHoursConfig;
  
  // Si start > end, las quiet hours cruzan medianoche
  if (start > end) {
    return currentHour >= start || currentHour < end;
  }
  
  return currentHour >= start && currentHour < end;
}

/**
 * Compara severidades
 */
function severityMeetsThreshold(alertSeverity, minSeverity) {
  const alertLevel = SEVERITY_LEVELS[alertSeverity] || 0;
  const minLevel = SEVERITY_LEVELS[minSeverity] || 0;
  return alertLevel >= minLevel;
}

// ═══════════════════════════════════════════════════════════════════════════
// USER PREFERENCES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene preferencias de notificación de un usuario
 */
async function getUserNotificationPrefs(userId) {
  const result = await query(`
    SELECT user_id, name, role, notification_prefs, watchlists
    FROM tower_users
    WHERE user_id = $1 AND active = true
  `, [userId]);
  
  if (result.rowCount === 0) {
    return null;
  }
  
  return result.rows[0];
}

/**
 * Obtiene todos los usuarios que deben recibir alertas
 */
async function getNotifiableUsers() {
  const result = await query(`
    SELECT user_id, name, role, notification_prefs, watchlists
    FROM tower_users
    WHERE active = true
      AND notification_prefs IS NOT NULL
  `);
  
  return result.rows;
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTING LOGIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Decide qué usuarios deben recibir una alerta y por qué canal
 */
export async function routeAlert(alert) {
  const notifications = [];
  const users = await getNotifiableUsers();
  
  for (const user of users) {
    const prefs = user.notification_prefs || {};
    const watchlists = user.watchlists || {};
    
    // 1. Verificar severity threshold
    const minSeverity = prefs.severity_min || "MEDIUM";
    if (!severityMeetsThreshold(alert.severity, minSeverity)) {
      continue;
    }
    
    // 2. Verificar watchlist de sucursales (si aplica)
    if (alert.branch_id && watchlists.branches) {
      const watchedBranches = watchlists.branches || [];
      if (watchedBranches.length > 0 && !watchedBranches.includes(alert.branch_id)) {
        // Usuario tiene watchlist pero esta sucursal no está
        // Solo continuar si es HIGH o CRITICAL
        if (!["HIGH", "CRITICAL"].includes(alert.severity)) {
          continue;
        }
      }
    }
    
    // 3. Determinar canales según hora y severidad
    const channels = prefs.channels || ["tower"];
    const userQuietHours = prefs.quiet_hours || DEFAULT_QUIET_HOURS;
    const inQuietHours = isQuietHours(userQuietHours);
    
    const selectedChannels = [];
    
    for (const channel of channels) {
      // En quiet hours, solo enviar por canales si es CRITICAL
      if (inQuietHours && alert.severity !== "CRITICAL") {
        // Solo agregar tower (in-app), no interrumpir
        if (channel === CHANNELS.TOWER) {
          selectedChannels.push(channel);
        }
        continue;
      }
      
      // CRITICAL siempre va por todos los canales
      if (alert.severity === "CRITICAL") {
        selectedChannels.push(channel);
        continue;
      }
      
      // HIGH va por tower y whatsapp
      if (alert.severity === "HIGH") {
        if ([CHANNELS.TOWER, CHANNELS.WHATSAPP].includes(channel)) {
          selectedChannels.push(channel);
        }
        continue;
      }
      
      // MEDIUM y LOW solo tower
      if (channel === CHANNELS.TOWER) {
        selectedChannels.push(channel);
      }
    }
    
    if (selectedChannels.length > 0) {
      notifications.push({
        user_id: user.user_id,
        user_name: user.name,
        channels: selectedChannels,
        sent_at: new Date().toISOString(),
        alert_id: alert.alert_id,
        reason: buildReason(alert, user, selectedChannels),
      });
    }
  }
  
  // Enviar notificaciones reales
  for (const notification of notifications) {
    await sendNotifications(notification, alert);
  }
  
  logger.info({
    alertId: alert.alert_id,
    notificationCount: notifications.length,
    recipients: notifications.map(n => n.user_id),
  }, "Alert routed");
  
  return notifications;
}

/**
 * Decide qué usuarios deben recibir una actualización de caso
 */
export async function routeCase(caseData, event) {
  const notifications = [];
  const users = await getNotifiableUsers();
  
  for (const user of users) {
    const prefs = user.notification_prefs || {};
    
    // Casos siempre van a usuarios con rol owner o audit
    if (!["owner", "audit", "ops"].includes(user.role)) {
      continue;
    }
    
    // Verificar severity
    const minSeverity = prefs.severity_min || "HIGH";
    if (!severityMeetsThreshold(caseData.severity, minSeverity)) {
      continue;
    }
    
    const channels = prefs.channels || ["tower"];
    
    notifications.push({
      user_id: user.user_id,
      user_name: user.name,
      channels,
      sent_at: new Date().toISOString(),
      case_id: caseData.case_id,
      event,
    });
  }
  
  // Enviar notificaciones
  for (const notification of notifications) {
    await sendCaseNotifications(notification, caseData, event);
  }
  
  return notifications;
}

/**
 * Verifica si es momento de enviar (respeta quiet hours)
 */
export function checkQuietHours(userId = null) {
  // TODO: Si userId, obtener sus quiet hours personalizadas
  return {
    isQuietHours: isQuietHours(),
    currentHour: getCurrentHourMexico(),
    quietHoursConfig: DEFAULT_QUIET_HOURS,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICACIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envía notificaciones por los canales seleccionados
 */
async function sendNotifications(notification, alert) {
  for (const channel of notification.channels) {
    try {
      switch (channel) {
        case CHANNELS.TOWER:
          // In-app notification - se maneja via API polling o WebSocket
          logger.debug({ 
            userId: notification.user_id, 
            alertId: alert.alert_id 
          }, "Tower notification queued");
          break;
          
        case CHANNELS.WHATSAPP:
          await sendWhatsAppAlert(notification.user_id, alert);
          break;
          
        case CHANNELS.EMAIL:
          await sendEmailAlert(notification.user_id, alert);
          break;
          
        case CHANNELS.SMS:
          await sendSmsAlert(notification.user_id, alert);
          break;
      }
    } catch (err) {
      logger.error({
        channel,
        userId: notification.user_id,
        alertId: alert.alert_id,
        err: err?.message,
      }, "Failed to send notification");
    }
  }
}

/**
 * Envía notificaciones de caso
 */
async function sendCaseNotifications(notification, caseData, event) {
  for (const channel of notification.channels) {
    try {
      switch (channel) {
        case CHANNELS.TOWER:
          logger.debug({ 
            userId: notification.user_id, 
            caseId: caseData.case_id,
            event,
          }, "Tower case notification queued");
          break;
          
        case CHANNELS.WHATSAPP:
          await sendWhatsAppCase(notification.user_id, caseData, event);
          break;
          
        default:
          break;
      }
    } catch (err) {
      logger.error({
        channel,
        userId: notification.user_id,
        caseId: caseData.case_id,
        err: err?.message,
      }, "Failed to send case notification");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CHANNEL IMPLEMENTATIONS (Stubs - implementar según necesidad)
// ═══════════════════════════════════════════════════════════════════════════

async function sendWhatsAppAlert(userId, alert) {
  // TODO: Integrar con API de WhatsApp (Meta Business API o Twilio)
  logger.info({ userId, alertId: alert.alert_id }, "WhatsApp alert sent (stub)");
}

async function sendWhatsAppCase(userId, caseData, event) {
  logger.info({ userId, caseId: caseData.case_id, event }, "WhatsApp case notification sent (stub)");
}

async function sendEmailAlert(userId, alert) {
  // TODO: Integrar con servicio de email
  logger.info({ userId, alertId: alert.alert_id }, "Email alert sent (stub)");
}

async function sendSmsAlert(userId, alert) {
  // TODO: Integrar con Twilio SMS
  logger.info({ userId, alertId: alert.alert_id }, "SMS alert sent (stub)");
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function buildReason(alert, user, channels) {
  const reasons = [];
  
  reasons.push(`Severity ${alert.severity} meets threshold`);
  
  if (channels.includes(CHANNELS.WHATSAPP)) {
    reasons.push("WhatsApp enabled in preferences");
  }
  
  return reasons.join("; ");
}

export default {
  routeAlert,
  routeCase,
  checkQuietHours,
  isQuietHours,
  CHANNELS,
  SEVERITY_LEVELS,
};
