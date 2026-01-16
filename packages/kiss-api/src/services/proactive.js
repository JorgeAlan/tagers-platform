/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PROACTIVE MESSAGING SERVICE - Mensajes automáticos y seguimiento
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Envía mensajes proactivos basados en:
 * - Carritos abandonados
 * - Seguimiento post-compra
 * - Recordatorios de pedidos
 * - Reactivación de clientes inactivos
 * - Promociones segmentadas
 * 
 * Integra con Chatwoot para envío y con Google Sheets para configuración.
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { getPool } from "../db/repo.js";
import { sendChatwootMessage } from "../integrations/chatwoot_client.js";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const proactiveConfig = {
  enabled: process.env.PROACTIVE_ENABLED !== "false",
  
  // Límites para evitar spam
  maxMessagesPerDay: parseInt(process.env.PROACTIVE_MAX_PER_DAY || "3", 10),
  minIntervalMinutes: parseInt(process.env.PROACTIVE_MIN_INTERVAL || "60", 10),
  quietHoursStart: parseInt(process.env.PROACTIVE_QUIET_START || "22", 10), // 10 PM
  quietHoursEnd: parseInt(process.env.PROACTIVE_QUIET_END || "8", 10), // 8 AM
  
  // Timeouts para triggers
  cartAbandonmentMinutes: parseInt(process.env.PROACTIVE_CART_TIMEOUT || "30", 10),
  followUpHours: parseInt(process.env.PROACTIVE_FOLLOWUP_HOURS || "24", 10),
  reactivationDays: parseInt(process.env.PROACTIVE_REACTIVATION_DAYS || "7", 10),
  
  tableName: "proactive_messages",
  scheduledTable: "proactive_scheduled",
};

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

let _initialized = false;
let _schedulerInterval = null;

async function ensureTables() {
  if (_initialized) return;
  
  const pool = getPool();
  if (!pool) return;
  
  try {
    // Tabla de mensajes enviados (historial)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${proactiveConfig.tableName} (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        contact_id TEXT,
        message_type TEXT NOT NULL,
        message_content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        sent_at TIMESTAMPTZ DEFAULT NOW(),
        delivered BOOLEAN DEFAULT FALSE,
        opened BOOLEAN DEFAULT FALSE,
        responded BOOLEAN DEFAULT FALSE
      )
    `);
    
    // Tabla de mensajes programados
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${proactiveConfig.scheduledTable} (
        id SERIAL PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        contact_id TEXT,
        message_type TEXT NOT NULL,
        message_content TEXT NOT NULL,
        metadata JSONB DEFAULT '{}',
        scheduled_for TIMESTAMPTZ NOT NULL,
        status TEXT DEFAULT 'pending', -- 'pending', 'sent', 'cancelled'
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_proactive_conversation 
      ON ${proactiveConfig.tableName}(conversation_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_proactive_scheduled_time 
      ON ${proactiveConfig.scheduledTable}(scheduled_for) 
      WHERE status = 'pending'
    `);
    
    _initialized = true;
    logger.info("[PROACTIVE] Tables initialized");
    
  } catch (error) {
    logger.error({ err: error.message }, "[PROACTIVE] Failed to initialize tables");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIÓN DE LÍMITES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene la hora actual en Mexico City
 * @returns {number} Hora (0-23) en timezone America/Mexico_City
 */
function getMexicoCityHour() {
  const now = new Date();
  // Obtener hora en Mexico City timezone
  const mexicoTime = now.toLocaleString("en-US", {
    timeZone: process.env.PROACTIVE_TIMEZONE || "America/Mexico_City",
    hour: "numeric",
    hour12: false,
  });
  return parseInt(mexicoTime, 10);
}

/**
 * Verifica si estamos en horario silencioso (quiet hours)
 * Usa timezone de Mexico City para evitar enviar mensajes a horas incorrectas
 */
function isQuietHours() {
  const hour = getMexicoCityHour();
  
  if (proactiveConfig.quietHoursStart > proactiveConfig.quietHoursEnd) {
    // Cruza medianoche (ej: 22-8)
    return hour >= proactiveConfig.quietHoursStart || hour < proactiveConfig.quietHoursEnd;
  }
  
  return hour >= proactiveConfig.quietHoursStart && hour < proactiveConfig.quietHoursEnd;
}

/**
 * Verifica si podemos enviar mensaje a una conversación
 */
async function canSendMessage(conversationId) {
  if (!proactiveConfig.enabled) return false;
  if (isQuietHours()) return false;
  
  const pool = getPool();
  if (!pool) return false;
  
  try {
    // Verificar mensajes enviados hoy
    const todayCount = await pool.query(`
      SELECT COUNT(*) as count 
      FROM ${proactiveConfig.tableName}
      WHERE conversation_id = $1
      AND sent_at > NOW() - INTERVAL '24 hours'
    `, [conversationId]);
    
    if (parseInt(todayCount.rows[0].count) >= proactiveConfig.maxMessagesPerDay) {
      return false;
    }
    
    // Verificar último mensaje
    const lastMessage = await pool.query(`
      SELECT sent_at 
      FROM ${proactiveConfig.tableName}
      WHERE conversation_id = $1
      ORDER BY sent_at DESC
      LIMIT 1
    `, [conversationId]);
    
    if (lastMessage.rows.length > 0) {
      const lastSent = new Date(lastMessage.rows[0].sent_at);
      const minInterval = proactiveConfig.minIntervalMinutes * 60 * 1000;
      
      if (Date.now() - lastSent.getTime() < minInterval) {
        return false;
      }
    }
    
    return true;
    
  } catch (error) {
    logger.error({ err: error.message }, "[PROACTIVE] Failed to check limits");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ENVÍO DE MENSAJES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envía un mensaje proactivo
 */
async function sendProactiveMessage({
  conversationId,
  contactId,
  messageType,
  content,
  metadata = {},
}) {
  await ensureTables();
  
  // Verificar límites
  const canSend = await canSendMessage(conversationId);
  if (!canSend) {
    logger.debug({ conversationId, messageType }, "[PROACTIVE] Message blocked by limits");
    return { sent: false, reason: "limits" };
  }
  
  try {
    // Enviar por Chatwoot
    const result = await sendChatwootMessage({
      accountId: config.chatwoot?.accountId,
      conversationId: parseInt(conversationId),
      content,
      private: false,
    });
    
    if (!result?.id) {
      return { sent: false, reason: "chatwoot_error" };
    }
    
    // Registrar en historial
    const pool = getPool();
    if (pool) {
      await pool.query(`
        INSERT INTO ${proactiveConfig.tableName}
        (conversation_id, contact_id, message_type, message_content, metadata, delivered)
        VALUES ($1, $2, $3, $4, $5, TRUE)
      `, [conversationId, contactId, messageType, content, JSON.stringify(metadata)]);
    }
    
    logger.info({
      conversationId,
      messageType,
      contentPreview: content.substring(0, 50),
    }, "[PROACTIVE] Message sent");
    
    return { sent: true, messageId: result.id };
    
  } catch (error) {
    logger.error({ err: error.message, conversationId }, "[PROACTIVE] Failed to send");
    return { sent: false, reason: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAJES PREDEFINIDOS
// ═══════════════════════════════════════════════════════════════════════════

const messageTemplates = {
  // Carrito abandonado
  cart_abandoned: (data) => `👋 ¡Hola${data.name ? ` ${data.name}` : ""}! 

Notamos que no completaste tu pedido. ¿Necesitas ayuda con algo?

${data.items ? `Tu carrito tiene: ${data.items}` : ""}

Estamos aquí para ayudarte 🥐`,

  // Seguimiento post-compra
  post_purchase: (data) => `¡Hola${data.name ? ` ${data.name}` : ""}! 🎉

Esperamos que hayas disfrutado tu pedido de Tagers.

¿Qué te pareció? Tu opinión nos ayuda a mejorar.

¡Gracias por tu preferencia! 💛`,

  // Recordatorio de pedido
  order_reminder: (data) => `📅 Recordatorio: Tu pedido #${data.orderId} está listo para recoger en ${data.branch || "nuestra sucursal"}.

⏰ Horario de hoy: ${data.hours || "Consulta en nuestra página"}

¡Te esperamos! 🥐`,

  // Reactivación
  reactivation: (data) => `👋 ¡Hola${data.name ? ` ${data.name}` : ""}!

¡Te extrañamos en Tagers! Ha pasado un tiempo desde tu última visita.

${data.promo ? `🎁 ${data.promo}` : "¿Antojo de algo rico?"}

Escríbenos y te ayudamos con tu pedido 😊

_Responde STOP si no deseas recibir estos mensajes._`,

  // Promoción
  promotion: (data) => `🎉 ${data.title || "¡Tenemos algo especial para ti!"}

${data.description || ""}

${data.validUntil ? `⏰ Válido hasta: ${data.validUntil}` : ""}
${data.code ? `🏷️ Código: ${data.code}` : ""}

¡Te esperamos! 🥐

_Responde STOP si no deseas recibir promociones._`,

  // Confirmación de pago pendiente
  payment_pending: (data) => `💳 Tu pedido #${data.orderId} está casi listo.

Solo falta confirmar tu pago para procesarlo.

${data.paymentLink ? `👉 Paga aquí: ${data.paymentLink}` : ""}

¿Necesitas ayuda? Estamos para servirte.`,

  // === NUEVO: CSAT (Customer Satisfaction) ===
  csat: (data) => `¡Hola${data.name ? ` ${data.name}` : ""}! 👋

¿Cómo estuvo tu experiencia con tu pedido${data.orderId ? ` #${data.orderId}` : ""}?

⭐⭐⭐⭐⭐ Excelente (responde 5)
⭐⭐⭐⭐ Bueno (responde 4)
⭐⭐⭐ Regular (responde 3)
⭐⭐ Malo (responde 2)
⭐ Muy malo (responde 1)

Tu opinión nos ayuda a mejorar 💛

_Responde STOP si no deseas recibir estos mensajes._`,

  // Pago confirmado (para trigger desde webhook)
  payment_confirmed: (data) => `✅ ¡Pago recibido!

Tu pedido **#${data.orderId}** está confirmado.

${data.amount ? `💰 Monto: $${parseFloat(data.amount).toLocaleString('es-MX')} MXN` : ''}

${data.pickupDate ? `📅 Fecha de recolección: ${data.pickupDate}` : ''}
${data.branch ? `📍 Sucursal: ${data.branch}` : ''}

¡Gracias por tu preferencia! 🥐`,
};

/**
 * Genera mensaje desde template
 */
export function generateMessage(templateId, data = {}) {
  const template = messageTemplates[templateId];
  if (!template) {
    logger.warn({ templateId }, "[PROACTIVE] Template not found");
    return null;
  }
  
  return template(data);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRIGGERS AUTOMÁTICOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Trigger: Carrito abandonado
 * Llamar cuando detectamos que el usuario dejó de responder durante un flujo de pedido
 */
export async function triggerCartAbandoned(conversationId, contactId, cartData = {}) {
  const content = generateMessage("cart_abandoned", {
    name: cartData.customerName,
    items: cartData.items?.map(i => i.name).join(", "),
  });
  
  if (!content) return { sent: false, reason: "no_template" };
  
  // Programar para enviar después del timeout
  return scheduleMessage({
    conversationId,
    contactId,
    messageType: "cart_abandoned",
    content,
    delayMinutes: proactiveConfig.cartAbandonmentMinutes,
    metadata: cartData,
  });
}

/**
 * Trigger: Post-compra
 * Llamar después de completar una compra
 */
export async function triggerPostPurchase(conversationId, contactId, orderData = {}) {
  const content = generateMessage("post_purchase", {
    name: orderData.customerName,
    orderId: orderData.orderId,
  });
  
  if (!content) return { sent: false, reason: "no_template" };
  
  return scheduleMessage({
    conversationId,
    contactId,
    messageType: "post_purchase",
    content,
    delayMinutes: proactiveConfig.followUpHours * 60,
    metadata: orderData,
  });
}

/**
 * Trigger: Recordatorio de recogida
 */
export async function triggerOrderReminder(conversationId, contactId, orderData = {}) {
  const content = generateMessage("order_reminder", {
    orderId: orderData.orderId,
    branch: orderData.branchName,
    hours: orderData.pickupHours,
  });
  
  if (!content) return { sent: false, reason: "no_template" };
  
  // Enviar inmediatamente o programar
  if (orderData.scheduledFor) {
    return scheduleMessage({
      conversationId,
      contactId,
      messageType: "order_reminder",
      content,
      scheduledFor: new Date(orderData.scheduledFor),
      metadata: orderData,
    });
  }
  
  return sendProactiveMessage({
    conversationId,
    contactId,
    messageType: "order_reminder",
    content,
    metadata: orderData,
  });
}

/**
 * Trigger: Pago pendiente
 */
export async function triggerPaymentPending(conversationId, contactId, paymentData = {}) {
  const content = generateMessage("payment_pending", {
    orderId: paymentData.orderId,
    paymentLink: paymentData.paymentLink,
  });
  
  if (!content) return { sent: false, reason: "no_template" };
  
  return sendProactiveMessage({
    conversationId,
    contactId,
    messageType: "payment_pending",
    content,
    metadata: paymentData,
  });
}

/**
 * Trigger: CSAT (Customer Satisfaction Survey)
 * Llamar después de una compra completada, típicamente 24h después de pickup
 */
export async function triggerCSAT(conversationId, contactId, orderData = {}) {
  // Verificar si el usuario ha optado por no recibir mensajes
  const optedOut = await isOptedOut(contactId);
  if (optedOut) {
    logger.debug({ contactId, conversationId }, "[PROACTIVE] CSAT skipped - user opted out");
    return { sent: false, reason: "opted_out" };
  }
  
  const content = generateMessage("csat", {
    name: orderData.customerName,
    orderId: orderData.orderId,
  });
  
  if (!content) return { sent: false, reason: "no_template" };
  
  // Configurar delay para CSAT (default 24h después de pickup)
  const csatDelayHours = parseInt(process.env.PROACTIVE_CSAT_DELAY_HOURS || "24", 10);
  const csatEnabled = process.env.PROACTIVE_CSAT_ENABLED !== "false";
  
  if (!csatEnabled) {
    logger.debug({ conversationId }, "[PROACTIVE] CSAT disabled");
    return { sent: false, reason: "csat_disabled" };
  }
  
  // Si hay fecha de pickup, programar CSAT para después
  if (orderData.pickupDate) {
    const pickupTime = new Date(orderData.pickupDate);
    const csatTime = new Date(pickupTime.getTime() + csatDelayHours * 60 * 60 * 1000);
    
    return scheduleMessage({
      conversationId,
      contactId,
      messageType: "csat",
      content,
      scheduledFor: csatTime,
      metadata: orderData,
    });
  }
  
  // Si no hay fecha de pickup, programar para csatDelayHours desde ahora
  return scheduleMessage({
    conversationId,
    contactId,
    messageType: "csat",
    content,
    delayMinutes: csatDelayHours * 60,
    metadata: orderData,
  });
}

/**
 * Verifica si un contacto ha optado por no recibir mensajes proactivos
 */
export async function isOptedOut(contactId) {
  if (!contactId) return false;
  
  const pool = getPool();
  if (!pool) return false;
  
  try {
    const result = await pool.query(`
      SELECT 1 FROM proactive_optouts
      WHERE contact_id = $1
      LIMIT 1
    `, [contactId]);
    
    return result.rows.length > 0;
    
  } catch (error) {
    // Si la tabla no existe, asumir que no hay opt-outs
    if (error.code === '42P01') return false;
    logger.debug({ err: error.message }, "[PROACTIVE] Error checking opt-out");
    return false;
  }
}

/**
 * Registra que un contacto ha optado por no recibir mensajes
 * Llamar cuando el usuario responde "STOP"
 */
export async function registerOptOut(contactId, conversationId = null, phone = null, reason = null) {
  if (!contactId) return false;
  
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      INSERT INTO proactive_optouts (contact_id, conversation_id, phone, reason)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (contact_id) DO UPDATE SET
        opted_out_at = NOW(),
        reason = COALESCE(EXCLUDED.reason, proactive_optouts.reason)
    `, [contactId, conversationId, phone, reason]);
    
    logger.info({ contactId, reason }, "[PROACTIVE] User opted out of messages");
    return true;
    
  } catch (error) {
    if (error.code === '42P01') {
      logger.warn("[PROACTIVE] proactive_optouts table not found - run migration 004");
      return false;
    }
    logger.error({ err: error.message }, "[PROACTIVE] Failed to register opt-out");
    return false;
  }
}

/**
 * Remueve el opt-out de un contacto (para re-suscribirse)
 */
export async function removeOptOut(contactId) {
  if (!contactId) return false;
  
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      DELETE FROM proactive_optouts WHERE contact_id = $1
    `, [contactId]);
    
    logger.info({ contactId }, "[PROACTIVE] User opt-out removed");
    return true;
    
  } catch (error) {
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROGRAMACIÓN DE MENSAJES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Programa un mensaje para enviar después
 */
async function scheduleMessage({
  conversationId,
  contactId,
  messageType,
  content,
  delayMinutes = null,
  scheduledFor = null,
  metadata = {},
}) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return { scheduled: false, reason: "no_db" };
  
  const sendTime = scheduledFor || new Date(Date.now() + delayMinutes * 60 * 1000);
  
  try {
    const result = await pool.query(`
      INSERT INTO ${proactiveConfig.scheduledTable}
      (conversation_id, contact_id, message_type, message_content, metadata, scheduled_for)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `, [conversationId, contactId, messageType, content, JSON.stringify(metadata), sendTime]);
    
    logger.info({
      id: result.rows[0].id,
      conversationId,
      messageType,
      scheduledFor: sendTime,
    }, "[PROACTIVE] Message scheduled");
    
    return { scheduled: true, id: result.rows[0].id, scheduledFor: sendTime };
    
  } catch (error) {
    logger.error({ err: error.message }, "[PROACTIVE] Failed to schedule");
    return { scheduled: false, reason: error.message };
  }
}

/**
 * Cancela mensajes programados para una conversación
 */
export async function cancelScheduledMessages(conversationId, messageType = null) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return false;
  
  try {
    let query = `
      UPDATE ${proactiveConfig.scheduledTable}
      SET status = 'cancelled'
      WHERE conversation_id = $1 AND status = 'pending'
    `;
    const params = [conversationId];
    
    if (messageType) {
      query += ` AND message_type = $2`;
      params.push(messageType);
    }
    
    const result = await pool.query(query, params);
    
    logger.info({
      conversationId,
      messageType,
      cancelled: result.rowCount,
    }, "[PROACTIVE] Scheduled messages cancelled");
    
    return true;
    
  } catch (error) {
    logger.error({ err: error.message }, "[PROACTIVE] Failed to cancel");
    return false;
  }
}

/**
 * Procesa mensajes programados que están listos
 */
async function processScheduledMessages() {
  await ensureTables();
  const pool = getPool();
  if (!pool) return;
  
  try {
    // Obtener mensajes listos para enviar
    const pending = await pool.query(`
      SELECT * FROM ${proactiveConfig.scheduledTable}
      WHERE status = 'pending'
      AND scheduled_for <= NOW()
      ORDER BY scheduled_for ASC
      LIMIT 10
    `);
    
    for (const msg of pending.rows) {
      // Marcar como procesando
      await pool.query(`
        UPDATE ${proactiveConfig.scheduledTable}
        SET status = 'sent'
        WHERE id = $1
      `, [msg.id]);
      
      // Enviar
      await sendProactiveMessage({
        conversationId: msg.conversation_id,
        contactId: msg.contact_id,
        messageType: msg.message_type,
        content: msg.message_content,
        metadata: msg.metadata,
      });
    }
    
  } catch (error) {
    logger.error({ err: error.message }, "[PROACTIVE] Failed to process scheduled");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicia el scheduler que procesa mensajes programados
 */
export function startScheduler(intervalMs = 60000) {
  if (_schedulerInterval) return;
  
  _schedulerInterval = setInterval(processScheduledMessages, intervalMs);
  logger.info({ intervalMs }, "[PROACTIVE] Scheduler started");
}

/**
 * Detiene el scheduler
 */
export function stopScheduler() {
  if (_schedulerInterval) {
    clearInterval(_schedulerInterval);
    _schedulerInterval = null;
    logger.info("[PROACTIVE] Scheduler stopped");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si proactive messaging está habilitado
 */
export function isEnabled() {
  return proactiveConfig.enabled;
}

/**
 * Obtiene configuración
 */
export function getConfig() {
  return {
    enabled: proactiveConfig.enabled,
    maxMessagesPerDay: proactiveConfig.maxMessagesPerDay,
    minIntervalMinutes: proactiveConfig.minIntervalMinutes,
    quietHours: {
      start: proactiveConfig.quietHoursStart,
      end: proactiveConfig.quietHoursEnd,
    },
    cartAbandonmentMinutes: proactiveConfig.cartAbandonmentMinutes,
    followUpHours: proactiveConfig.followUpHours,
  };
}

/**
 * Obtiene historial de mensajes enviados a una conversación
 */
export async function getMessageHistory(conversationId, limit = 10) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return [];
  
  try {
    const result = await pool.query(`
      SELECT * FROM ${proactiveConfig.tableName}
      WHERE conversation_id = $1
      ORDER BY sent_at DESC
      LIMIT $2
    `, [conversationId, limit]);
    
    return result.rows;
    
  } catch (error) {
    logger.error({ err: error.message }, "[PROACTIVE] Failed to get history");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const proactiveService = {
  // Core
  sendProactiveMessage,
  scheduleMessage,
  cancelScheduledMessages,
  generateMessage,
  
  // Triggers
  triggerCartAbandoned,
  triggerPostPurchase,
  triggerOrderReminder,
  triggerPaymentPending,
  triggerCSAT, // NUEVO
  
  // Opt-out management
  isOptedOut, // NUEVO
  registerOptOut, // NUEVO
  removeOptOut, // NUEVO
  
  // Scheduler
  startScheduler,
  stopScheduler,
  
  // Utils
  isEnabled,
  getConfig,
  getMessageHistory,
  canSendMessage,
  isQuietHours,
  getMexicoCityHour, // NUEVO - útil para testing
};

export default proactiveService;
