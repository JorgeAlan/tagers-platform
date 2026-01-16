/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONVERSATION HISTORY SERVICE - Historial de mensajes en memoria
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Mantiene el historial de conversación en memoria para contexto del LLM.
 * TTL configurable para evitar consumo excesivo de memoria.
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const HISTORY_TTL_MS = 24 * 60 * 60 * 1000; // 24 horas
const MAX_MESSAGES_PER_CONVERSATION = 100;

// ═══════════════════════════════════════════════════════════════════════════
// STORE
// ═══════════════════════════════════════════════════════════════════════════

const historyStore = new Map();

/**
 * @typedef {Object} HistoryEntry
 * @property {Array<{role: string, content: string, timestamp: string}>} messages
 * @property {number} updatedAt - Timestamp de última actualización
 */

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

function cleanupExpiredEntries() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [conversationId, entry] of historyStore.entries()) {
    if (now - entry.updatedAt > HISTORY_TTL_MS) {
      historyStore.delete(conversationId);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug({ cleaned }, "Conversation history cleanup");
  }
}

// Cleanup periódico cada 10 minutos
setInterval(cleanupExpiredEntries, 10 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene el historial de una conversación
 * @param {string} conversationId
 * @returns {Array<{role: string, content: string, timestamp: string}>}
 */
export function getHistory(conversationId) {
  const key = String(conversationId);
  const entry = historyStore.get(key);
  
  if (!entry) {
    return [];
  }
  
  // Verificar TTL
  if (Date.now() - entry.updatedAt > HISTORY_TTL_MS) {
    historyStore.delete(key);
    return [];
  }
  
  return entry.messages || [];
}

/**
 * Establece el historial completo de una conversación
 * @param {string} conversationId
 * @param {Array<{role: string, content: string, timestamp?: string}>} messages
 */
export function setHistory(conversationId, messages) {
  const key = String(conversationId);
  
  const normalizedMessages = (messages || []).slice(-MAX_MESSAGES_PER_CONVERSATION).map(m => ({
    role: m.role || "user",
    content: String(m.content || ""),
    timestamp: m.timestamp || new Date().toISOString(),
  }));
  
  historyStore.set(key, {
    messages: normalizedMessages,
    updatedAt: Date.now(),
  });
}

/**
 * Agrega un mensaje al historial
 * @param {string} conversationId
 * @param {string} role - "user" | "assistant"
 * @param {string} content
 */
export function addMessage(conversationId, role, content) {
  const key = String(conversationId);
  const entry = historyStore.get(key) || { messages: [], updatedAt: Date.now() };
  
  const newMessage = {
    role,
    content: String(content || ""),
    timestamp: new Date().toISOString(),
  };
  
  // Evitar duplicados consecutivos
  const lastMessage = entry.messages[entry.messages.length - 1];
  if (lastMessage && lastMessage.role === role && lastMessage.content === content) {
    return; // Ya existe
  }
  
  entry.messages.push(newMessage);
  
  // Limitar tamaño
  if (entry.messages.length > MAX_MESSAGES_PER_CONVERSATION) {
    entry.messages = entry.messages.slice(-MAX_MESSAGES_PER_CONVERSATION);
  }
  
  entry.updatedAt = Date.now();
  historyStore.set(key, entry);
}

/**
 * Limpia el historial de una conversación
 * @param {string} conversationId
 */
export function clearHistory(conversationId) {
  const key = String(conversationId);
  historyStore.delete(key);
}

/**
 * Obtiene los últimos N mensajes formateados para el LLM
 * @param {string} conversationId
 * @param {number} limit
 * @returns {Array<{role: string, content: string}>}
 */
export function getHistoryForLLM(conversationId, limit = 20) {
  const history = getHistory(conversationId);
  
  return history
    .slice(-limit)
    .map(({ role, content }) => ({ role, content }));
}

/**
 * Estadísticas del store (para debugging)
 */
export function getStats() {
  return {
    totalConversations: historyStore.size,
    totalMessages: Array.from(historyStore.values()).reduce((sum, e) => sum + e.messages.length, 0),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const conversationHistoryService = {
  getHistory,
  setHistory,
  addMessage,
  clearHistory,
  getHistoryForLLM,
  getStats,
};

export default conversationHistoryService;
