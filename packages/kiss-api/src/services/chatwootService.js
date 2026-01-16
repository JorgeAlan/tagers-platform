/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHATWOOT SERVICE - Comunicación con API de Chatwoot
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Responsabilidad única: Hablar con la API de Chatwoot.
 * - Enviar mensajes
 * - Obtener historial
 * - Toggle handoff
 * - Deduplicación de mensajes
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { conversationHistoryService } from "./conversationHistoryService.js";

// ═══════════════════════════════════════════════════════════════════════════
// DEDUPLICACIÓN DE MENSAJES
// ═══════════════════════════════════════════════════════════════════════════

const MESSAGE_DEDUPE_TTL_MS = 2 * 60 * 60 * 1000; // 2 horas
const processedMessageIds = new Map();

function cleanupOldMessageIds() {
  const now = Date.now();
  for (const [id, timestamp] of processedMessageIds.entries()) {
    if (now - timestamp > MESSAGE_DEDUPE_TTL_MS) {
      processedMessageIds.delete(id);
    }
  }
}

/**
 * Verifica si un mensaje ya fue procesado (evita duplicados)
 */
export function isDuplicateMessage(messageId) {
  const id = String(messageId || "").trim();
  if (!id) return false;
  
  cleanupOldMessageIds();
  
  if (processedMessageIds.has(id)) {
    return true;
  }
  
  processedMessageIds.set(id, Date.now());
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const TIMEOUT_MS = 15000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(accountId, conversationId) {
  // NOTA: Usar baseUrl, NO apiBaseUrl - corregido para Chatwoot self-hosted
  const base = (config.chatwoot.baseUrl || "https://app.chatwoot.com").replace(/\/$/, "");
  return `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
}

function buildConversationUrl(accountId, conversationId) {
  // NOTA: Usar baseUrl, NO apiBaseUrl - corregido para Chatwoot self-hosted
  const base = (config.chatwoot.baseUrl || "https://app.chatwoot.com").replace(/\/$/, "");
  return `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}`;
}

/**
 * Sanitiza contenido antes de enviar (evita caracteres problemáticos)
 */
function sanitizeContent(content) {
  if (!content) return "";
  
  return String(content)
    .replace(/\u0000/g, "") // Null bytes
    .trim()
    .slice(0, 4000); // Límite razonable
}

// ═══════════════════════════════════════════════════════════════════════════
// API METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Envía un mensaje a una conversación de Chatwoot
 */
export async function sendMessage({ accountId, conversationId, content, isPrivate = false }) {
  if (!config.chatwoot.apiAccessToken) {
    throw new Error("CHATWOOT_API_ACCESS_TOKEN not configured");
  }
  
  const effectiveAccountId = accountId || config.chatwoot.accountId;
  if (!effectiveAccountId) {
    throw new Error("Chatwoot accountId missing");
  }
  
  const safeContent = sanitizeContent(content);
  const url = buildUrl(effectiveAccountId, conversationId);
  
  logger.info({
    accountId: effectiveAccountId,
    conversationId,
    contentLength: safeContent.length,
  }, "Chatwoot: sending message");
  
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api_access_token": config.chatwoot.apiAccessToken,
    },
    body: JSON.stringify({
      content: safeContent,
      message_type: "outgoing",
      private: isPrivate,
      echo_id: `ana_${Date.now()}`,
    }),
  });
  
  const responseText = await response.text();
  let responseJson = {};
  
  try {
    responseJson = JSON.parse(responseText);
  } catch {
    // No es JSON
  }
  
  if (!response.ok) {
    logger.error({
      status: response.status,
      response: responseText.slice(0, 500),
    }, "Chatwoot send failed");
    throw new Error(`Chatwoot send failed: ${response.status}`);
  }
  
  // Guardar en historial de conversación
  try {
    conversationHistoryService.addMessage(conversationId, "assistant", safeContent);
  } catch {
    // Non-fatal
  }
  
  logger.info({
    messageId: responseJson?.id,
    conversationId,
  }, "Chatwoot: message sent");
  
  return responseJson;
}

/**
 * Obtiene mensajes de una conversación
 */
export async function fetchMessages({ accountId, conversationId, limit = 20 }) {
  if (!config.chatwoot.apiAccessToken) {
    return [];
  }
  
  const effectiveAccountId = accountId || config.chatwoot.accountId;
  if (!effectiveAccountId || !conversationId) {
    return [];
  }
  
  const url = buildUrl(effectiveAccountId, conversationId);
  
  try {
    const response = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        "api_access_token": config.chatwoot.apiAccessToken,
      },
    });
    
    if (!response.ok) {
      return [];
    }
    
    const json = await response.json();
    const messages = Array.isArray(json) ? json : (Array.isArray(json?.payload) ? json.payload : []);
    
    return messages.slice(-Math.min(200, limit));
  } catch (error) {
    logger.warn({ err: error?.message, conversationId }, "Failed to fetch Chatwoot messages");
    return [];
  }
}

/**
 * Cambia el estado de la conversación (para handoff a humano)
 */
export async function toggleStatus({ accountId, conversationId, status = "open" }) {
  if (!config.chatwoot.apiAccessToken) {
    return null;
  }
  
  const effectiveAccountId = accountId || config.chatwoot.accountId;
  if (!effectiveAccountId) {
    return null;
  }
  
  const url = buildConversationUrl(effectiveAccountId, conversationId) + "/toggle_status";
  
  try {
    const response = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({ status }),
    });
    
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      logger.warn({ status: response.status, response: text }, "Chatwoot toggle_status failed");
      return null;
    }
    
    const json = await response.json().catch(() => ({}));
    logger.info({ conversationId, newStatus: json?.status }, "Chatwoot: toggled status");
    return json;
  } catch (error) {
    logger.warn({ err: error?.message }, "Chatwoot toggle_status error");
    return null;
  }
}

/**
 * Hidrata el historial de conversación desde Chatwoot
 */
export async function hydrateConversationHistory({ accountId, conversationId }) {
  // Si ya tenemos historial, no sobrescribir
  const existing = conversationHistoryService.getHistory(conversationId);
  if (existing.length >= 2) {
    return;
  }
  
  const messages = await fetchMessages({ accountId, conversationId, limit: 50 });
  if (!messages.length) {
    return;
  }
  
  const normalized = messages
    .map(m => {
      const isIncoming = m?.message_type === 0 || m?.message_type === "incoming" || m?.sender_type === "contact";
      const role = isIncoming ? "user" : "assistant";
      const content = String(m?.content || "").replace(/<[^>]*>/g, "").trim();
      
      if (!content) return null;
      
      const timestamp = typeof m?.created_at === "number" 
        ? new Date(m.created_at * 1000).toISOString()
        : new Date().toISOString();
      
      return { role, content, timestamp };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  
  if (normalized.length) {
    conversationHistoryService.setHistory(conversationId, normalized);
    logger.info({ conversationId, count: normalized.length }, "Chatwoot history hydrated");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const chatwootService = {
  sendMessage,
  fetchMessages,
  toggleStatus,
  hydrateConversationHistory,
  isDuplicateMessage,
};

export default chatwootService;
