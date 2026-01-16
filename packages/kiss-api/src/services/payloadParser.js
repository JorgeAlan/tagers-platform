/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYLOAD PARSER - Extracción robusta de webhooks Chatwoot
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Chatwoot envía webhooks en diferentes formatos dependiendo del tipo:
 * - Global webhooks: mensaje en root del body
 * - Agent Bot webhooks: mensaje en body.message
 * - Data webhooks: mensaje en body.data.message
 * 
 * Este módulo normaliza todos los formatos a una estructura común.
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { config } from "../config.js";

/**
 * @typedef {Object} WebhookPayload
 * @property {string|null} event - Tipo de evento (message_created, etc.)
 * @property {string|null} messageId - ID único del mensaje
 * @property {string|null} messageText - Contenido del mensaje (sin HTML)
 * @property {string|null} conversationId - ID de la conversación
 * @property {string|null} accountId - ID de la cuenta Chatwoot
 * @property {string|null} inboxId - ID del inbox
 * @property {string|null} inboxName - Nombre del inbox
 * @property {Object|null} contact - Datos del contacto
 * @property {boolean} isOutgoing - true si es mensaje saliente
 * @property {boolean} isPrivate - true si es nota privada
 * @property {Object} raw - Payload original
 */

/**
 * Extrae y normaliza los datos de un webhook de Chatwoot
 * @param {Object} body - Body del webhook
 * @returns {WebhookPayload}
 */
export function extractWebhookPayload(body) {
  const raw = body || {};
  
  // Extraer evento
  const event = raw.event || raw.type || raw.event_name || null;
  
  // Extraer mensaje (múltiples formatos)
  const message = extractMessage(raw);
  
  // Extraer conversación
  const conversation = raw.conversation || raw.data?.conversation || raw.payload?.conversation || null;
  
  // Extraer cuenta
  const account = raw.account || raw.data?.account || null;
  
  // Extraer inbox
  const inbox = raw.inbox || raw.data?.inbox || null;
  
  // Extraer contacto
  const contact = message?.sender || message?.contact || conversation?.meta?.sender || null;
  
  // Normalizar IDs
  const messageId = message?.id ? String(message.id) : null;
  const conversationId = conversation?.id || conversation?.conversation_id 
    ? String(conversation.id || conversation.conversation_id) 
    : null;
  const accountId = account?.id || conversation?.account_id || config.chatwoot?.accountId 
    ? String(account?.id || conversation?.account_id || config.chatwoot?.accountId)
    : null;
  const inboxId = inbox?.id ? String(inbox.id) : null;
  const inboxName = inbox?.name || null;
  
  // Extraer y limpiar texto del mensaje
  const messageText = extractMessageText(message);
  
  // Determinar tipo de mensaje
  const isOutgoing = isOutgoingMessage(message);
  const isPrivate = message?.private === true;
  
  return {
    event,
    messageId,
    messageText,
    conversationId,
    accountId,
    inboxId,
    inboxName,
    contact,
    isOutgoing,
    isPrivate,
    raw,
  };
}

/**
 * Extrae el objeto mensaje del body (múltiples formatos de Chatwoot)
 */
function extractMessage(body) {
  // Agent Bot style
  if (body?.message) {
    return body.message;
  }
  
  // Data wrapper style
  if (body?.data?.message) {
    return body.data.message;
  }
  
  // Payload wrapper style
  if (body?.payload?.message) {
    return body.payload.message;
  }
  
  // Global webhook style - el body ES el mensaje
  if (body?.content !== undefined && body?.id) {
    return body;
  }
  
  return null;
}

/**
 * Extrae y limpia el texto del mensaje
 */
function extractMessageText(message) {
  if (!message) return null;
  
  const raw = message.content || message.text || "";
  
  // Remover tags HTML
  const cleaned = String(raw).replace(/<[^>]*>/g, "").trim();
  
  return cleaned || null;
}

/**
 * Determina si el mensaje es saliente (del bot/agente)
 */
function isOutgoingMessage(message) {
  if (!message) return false;
  
  const messageType = message.message_type || message.direction || "";
  
  // message_type puede ser número (0=incoming, 1=outgoing) o string
  if (messageType === 1 || messageType === "outgoing") {
    return true;
  }
  
  if (String(messageType).toLowerCase() === "outgoing") {
    return true;
  }
  
  return false;
}

/**
 * Valida si es un mensaje entrante válido que debemos procesar
 * @param {WebhookPayload} payload
 * @returns {boolean}
 */
export function isValidIncomingMessage(payload) {
  // Debe tener texto
  if (!payload.messageText) {
    return false;
  }
  
  // Debe tener conversación
  if (!payload.conversationId) {
    return false;
  }
  
  // No procesar mensajes salientes
  if (payload.isOutgoing) {
    return false;
  }
  
  // No procesar notas privadas
  if (payload.isPrivate) {
    return false;
  }
  
  // Verificar que el sender es un contacto (no agente/bot)
  const senderType = payload.contact?.type || payload.raw?.message?.sender_type || "";
  if (senderType && String(senderType).toLowerCase() !== "contact") {
    return false;
  }
  
  // Eventos válidos
  const validEvents = ["message_created", "message.created", null]; // null = no event field
  if (payload.event && !validEvents.includes(payload.event)) {
    return false;
  }
  
  return true;
}

/**
 * Extrae hint de sucursal del nombre del inbox
 * Ej: "WhatsApp - Sonata" → { branch_id: "SONATA" }
 */
export function extractBranchHintFromInbox(inboxName) {
  if (!inboxName) return null;
  
  const normalized = String(inboxName).toLowerCase();
  
  const branchPatterns = [
    { pattern: /sonata/i, branch_id: "SONATA" },
    { pattern: /angel[oó]polis/i, branch_id: "ANGELOPOLIS" },
    { pattern: /san\s*[aá]ngel/i, branch_id: "SAN_ANGEL" },
    { pattern: /zavaleta/i, branch_id: "ZAVALETA" },
    { pattern: /5\s*sur|cinco\s*sur/i, branch_id: "5_SUR" },
  ];
  
  for (const { pattern, branch_id } of branchPatterns) {
    if (pattern.test(normalized)) {
      return { branch_id };
    }
  }
  
  return null;
}

export default {
  extractWebhookPayload,
  isValidIncomingMessage,
  extractBranchHintFromInbox,
};
