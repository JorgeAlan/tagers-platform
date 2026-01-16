/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONVERSATION MEMORY SERVICE - Sistema de Memoria Persistente y Resumida
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * REEMPLAZA conversationHistoryService.js con capacidades avanzadas:
 * 
 * 1. PERSISTENCIA: Guarda mensajes en PostgreSQL (sobrevive reinicios)
 * 2. RESUMEN: Comprime conversaciones antiguas usando LLM
 * 3. FACTS: Extrae y almacena preferencias/info del cliente a largo plazo
 * 4. VECTOR SEARCH: Integración con pgvector para búsqueda semántica
 * 
 * ARQUITECTURA:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                    CONVERSATION MEMORY                         │
 * ├─────────────────────────────────────────────────────────────────┤
 * │  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐   │
 * │  │  Messages   │ -> │  Summaries   │ -> │     Facts       │   │
 * │  │  (Recent)   │    │ (Compressed) │    │ (Long-term)     │   │
 * │  └─────────────┘    └──────────────┘    └─────────────────┘   │
 * │        │                   │                    │              │
 * │        └───────────────────┴────────────────────┘              │
 * │                            │                                   │
 * │                    ┌───────▼───────┐                          │
 * │                    │    pgvector   │                          │
 * │                    │  (Embeddings) │                          │
 * │                    └───────────────┘                          │
 * └─────────────────────────────────────────────────────────────────┘
 * 
 * @version 3.0.0 - Sistema de memoria inteligente
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import { Pool } from "pg";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getPoolConfig } from "../db/poolConfig.js";
import { getEmbedding } from "../vector/embeddings.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const memoryConfig = {
  // Persistencia
  enabled: process.env.CONVERSATION_MEMORY_ENABLED !== "false",
  
  // Límites de mensajes recientes (antes de resumir)
  maxRecentMessages: parseInt(process.env.MEMORY_MAX_RECENT_MESSAGES || "50", 10),
  
  // Tiempo antes de resumir (milisegundos)
  summarizeAfterMs: parseInt(process.env.MEMORY_SUMMARIZE_AFTER_MS || String(24 * 60 * 60 * 1000), 10), // 24 horas
  
  // Mínimo de mensajes para crear un resumen
  minMessagesForSummary: parseInt(process.env.MEMORY_MIN_MESSAGES_SUMMARY || "10", 10),
  
  // TTL para resúmenes (milisegundos, NULL = no expira)
  summaryTtlMs: process.env.MEMORY_SUMMARY_TTL_MS 
    ? parseInt(process.env.MEMORY_SUMMARY_TTL_MS, 10) 
    : null, // Por defecto no expiran
  
  // TTL para facts (milisegundos, NULL = no expira)
  factsTtlMs: process.env.MEMORY_FACTS_TTL_MS
    ? parseInt(process.env.MEMORY_FACTS_TTL_MS, 10)
    : null, // Por defecto no expiran
  
  // Modelo para resúmenes
  summaryModel: process.env.MEMORY_SUMMARY_MODEL || "gpt-4o-mini",
  
  // Habilitar extracción de facts
  extractFacts: process.env.MEMORY_EXTRACT_FACTS !== "false",
  
  // Máximo de facts por contacto
  maxFactsPerContact: parseInt(process.env.MEMORY_MAX_FACTS_PER_CONTACT || "50", 10),
  
  // Dimensiones de embeddings
  embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS || "1536", 10),
  
  // Umbral de similitud para búsqueda de facts
  factSimilarityThreshold: parseFloat(process.env.MEMORY_FACT_SIMILARITY || "0.75"),
};

// ═══════════════════════════════════════════════════════════════════════════
// POOL DE CONEXIONES
// ═══════════════════════════════════════════════════════════════════════════

let pool = null;
let dbReady = false;

// In-memory fallback
const memoryFallback = {
  messages: new Map(), // conversation_id -> messages[]
  summaries: new Map(), // conversation_id -> summaries[]
  facts: new Map(), // contact_id -> facts[]
};

function ensurePool() {
  if (!config.databaseUrl) return null;
  if (pool) return pool;
  
  pool = new Pool(getPoolConfig(config.databaseUrl, {
    max: parseInt(process.env.PG_MEMORY_POOL_MAX || "5", 10),
  }));
  
  pool.on("error", (err) => logger.error({ err }, "Memory service pool error"));
  
  return pool;
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa el servicio de memoria
 */
export async function initMemoryService() {
  if (!memoryConfig.enabled) {
    logger.info("Conversation memory service disabled");
    return { ok: true, storage: "disabled" };
  }
  
  const p = ensurePool();
  
  if (!p) {
    logger.warn("DATABASE_URL not set. Using in-memory storage for conversation memory.");
    return { ok: true, storage: "memory" };
  }
  
  try {
    // Verificar que las tablas existen
    const tableCheck = await p.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'conversation_messages'
      ) as messages_exists,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'conversation_summaries'
      ) as summaries_exists,
      EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'conversation_facts'
      ) as facts_exists
    `);
    
    const { messages_exists, summaries_exists, facts_exists } = tableCheck.rows[0];
    
    if (!messages_exists || !summaries_exists || !facts_exists) {
      logger.warn({
        messages_exists,
        summaries_exists,
        facts_exists,
      }, "Memory tables not found. Run migration 003_conversation_memory.sql");
      
      return { ok: false, reason: "tables_missing", storage: "memory" };
    }
    
    dbReady = true;
    
    logger.info({
      maxRecentMessages: memoryConfig.maxRecentMessages,
      summarizeAfterMs: memoryConfig.summarizeAfterMs,
      extractFacts: memoryConfig.extractFacts,
    }, "Conversation memory service initialized with PostgreSQL");
    
    return { ok: true, storage: "postgres" };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to initialize memory service");
    return { ok: false, reason: error.message, storage: "memory" };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAJES - CRUD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Agrega un mensaje al historial
 * @param {Object} options
 * @param {string} options.conversationId - ID de la conversación
 * @param {string} options.role - "user" | "assistant" | "system"
 * @param {string} options.content - Contenido del mensaje
 * @param {string} [options.contactId] - ID del contacto (opcional)
 * @param {Object} [options.metadata] - Metadata adicional
 */
export async function addMessage({
  conversationId,
  role,
  content,
  contactId = null,
  metadata = {},
}) {
  const convId = String(conversationId || "").trim();
  const msgContent = String(content || "").trim();
  
  if (!convId || !msgContent) {
    return { stored: false, reason: "invalid_input" };
  }
  
  const msgRole = ["user", "assistant", "system"].includes(role) ? role : "user";
  const timestamp = new Date().toISOString();
  
  const p = ensurePool();
  
  // Fallback en memoria
  if (!p || !dbReady) {
    const key = convId;
    const entry = memoryFallback.messages.get(key) || [];
    
    // Evitar duplicados consecutivos
    const lastMsg = entry[entry.length - 1];
    if (lastMsg && lastMsg.role === msgRole && lastMsg.content === msgContent) {
      return { stored: false, reason: "duplicate" };
    }
    
    entry.push({
      role: msgRole,
      content: msgContent,
      timestamp,
      contactId,
      metadata,
    });
    
    // Limitar tamaño
    if (entry.length > memoryConfig.maxRecentMessages * 2) {
      entry.splice(0, entry.length - memoryConfig.maxRecentMessages);
    }
    
    memoryFallback.messages.set(key, entry);
    return { stored: true, storage: "memory" };
  }
  
  // Persistir en PostgreSQL
  try {
    await p.query(`
      INSERT INTO conversation_messages 
        (conversation_id, contact_id, role, content, metadata, message_timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [convId, contactId, msgRole, msgContent, metadata, timestamp]);
    
    logger.debug({
      conversationId: convId,
      role: msgRole,
      contentPreview: msgContent.substring(0, 50),
    }, "Message stored");
    
    return { stored: true, storage: "postgres" };
    
  } catch (error) {
    logger.error({ error: error.message, conversationId: convId }, "Failed to store message");
    
    // Fallback a memoria en caso de error
    const entry = memoryFallback.messages.get(convId) || [];
    entry.push({ role: msgRole, content: msgContent, timestamp, contactId, metadata });
    memoryFallback.messages.set(convId, entry);
    
    return { stored: true, storage: "memory_fallback", error: error.message };
  }
}

/**
 * Obtiene el historial de mensajes de una conversación
 * @param {string} conversationId
 * @param {Object} [options]
 * @param {number} [options.limit] - Número máximo de mensajes
 * @param {boolean} [options.includeSystemMessages] - Incluir mensajes de sistema
 */
export async function getMessages(conversationId, options = {}) {
  const convId = String(conversationId || "").trim();
  if (!convId) return [];
  
  const limit = options.limit || memoryConfig.maxRecentMessages;
  const includeSystem = options.includeSystemMessages !== false;
  
  const p = ensurePool();
  
  // Fallback en memoria
  if (!p || !dbReady) {
    const entry = memoryFallback.messages.get(convId) || [];
    return entry
      .filter(m => includeSystem || m.role !== "system")
      .slice(-limit)
      .map(({ role, content, timestamp }) => ({ role, content, timestamp }));
  }
  
  try {
    const roleFilter = includeSystem ? "" : "AND role != 'system'";
    
    const result = await p.query(`
      SELECT role, content, message_timestamp as timestamp
      FROM conversation_messages
      WHERE conversation_id = $1
        AND summarized = FALSE
        ${roleFilter}
      ORDER BY message_timestamp DESC
      LIMIT $2
    `, [convId, limit]);
    
    // Retornar en orden cronológico
    return result.rows.reverse();
    
  } catch (error) {
    logger.error({ error: error.message, conversationId: convId }, "Failed to get messages");
    
    // Fallback
    const entry = memoryFallback.messages.get(convId) || [];
    return entry.slice(-limit).map(({ role, content, timestamp }) => ({ role, content, timestamp }));
  }
}

/**
 * Obtiene el historial formateado para el LLM
 * Incluye: mensajes recientes + resumen de contexto anterior + facts relevantes
 * 
 * @param {string} conversationId
 * @param {Object} [options]
 * @param {number} [options.maxMessages] - Mensajes recientes a incluir
 * @param {string} [options.contactId] - Para incluir facts del contacto
 * @param {string} [options.currentQuery] - Query actual para búsqueda semántica de facts
 */
export async function getContextForLLM(conversationId, options = {}) {
  const convId = String(conversationId || "").trim();
  if (!convId) return { messages: [], context: null };
  
  const maxMessages = options.maxMessages || 20;
  const contactId = options.contactId;
  const currentQuery = options.currentQuery;
  
  const p = ensurePool();
  
  // Fallback simple en memoria
  if (!p || !dbReady) {
    const entry = memoryFallback.messages.get(convId) || [];
    return {
      messages: entry.slice(-maxMessages).map(({ role, content }) => ({ role, content })),
      context: null,
      source: "memory",
    };
  }
  
  try {
    // 1. Obtener mensajes recientes (no resumidos)
    const messagesResult = await p.query(`
      SELECT role, content
      FROM conversation_messages
      WHERE conversation_id = $1
        AND summarized = FALSE
      ORDER BY message_timestamp DESC
      LIMIT $2
    `, [convId, maxMessages]);
    
    const messages = messagesResult.rows.reverse();
    
    // 2. Obtener resúmenes anteriores
    const summariesResult = await p.query(`
      SELECT summary_text, messages_start_at, messages_end_at
      FROM conversation_summaries
      WHERE conversation_id = $1
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC
      LIMIT 3
    `, [convId]);
    
    let contextParts = [];
    
    if (summariesResult.rows.length > 0) {
      const summaryTexts = summariesResult.rows.map(r => r.summary_text);
      contextParts.push(`[CONTEXTO DE CONVERSACIONES ANTERIORES]\n${summaryTexts.join("\n\n")}`);
    }
    
    // 3. Obtener facts del contacto si se proporciona
    if (contactId) {
      const facts = await getRelevantFacts(contactId, currentQuery);
      
      if (facts.length > 0) {
        const factsText = facts.map(f => `- ${f.fact_type}/${f.fact_key}: ${f.fact_value}`).join("\n");
        contextParts.push(`[INFORMACIÓN DEL CLIENTE]\n${factsText}`);
      }
    }
    
    return {
      messages,
      context: contextParts.length > 0 ? contextParts.join("\n\n") : null,
      source: "postgres",
      stats: {
        recentMessages: messages.length,
        summaries: summariesResult.rows.length,
        hasFacts: contextParts.length > 1,
      },
    };
    
  } catch (error) {
    logger.error({ error: error.message, conversationId: convId }, "Failed to get context for LLM");
    
    // Fallback
    const entry = memoryFallback.messages.get(convId) || [];
    return {
      messages: entry.slice(-maxMessages).map(({ role, content }) => ({ role, content })),
      context: null,
      source: "memory_fallback",
    };
  }
}

/**
 * Limpia el historial de una conversación
 */
export async function clearMessages(conversationId) {
  const convId = String(conversationId || "").trim();
  if (!convId) return { cleared: false };
  
  // Limpiar fallback en memoria
  memoryFallback.messages.delete(convId);
  
  const p = ensurePool();
  if (!p || !dbReady) {
    return { cleared: true, storage: "memory" };
  }
  
  try {
    await p.query(`
      DELETE FROM conversation_messages WHERE conversation_id = $1
    `, [convId]);
    
    return { cleared: true, storage: "postgres" };
    
  } catch (error) {
    logger.error({ error: error.message, conversationId: convId }, "Failed to clear messages");
    return { cleared: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FACTS - Memoria a largo plazo
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guarda un fact del cliente
 * @param {Object} fact
 * @param {string} fact.contactId - ID del contacto
 * @param {string} fact.conversationId - ID de conversación origen
 * @param {string} fact.factType - Tipo de fact
 * @param {string} fact.factKey - Identificador del fact
 * @param {string} fact.factValue - Valor del fact
 * @param {number} [fact.confidence] - Confianza (0-1)
 */
export async function saveFact(fact) {
  const { contactId, conversationId, factType, factKey, factValue, confidence = 0.8 } = fact;
  
  if (!contactId || !factKey || !factValue) {
    return { saved: false, reason: "invalid_input" };
  }
  
  const p = ensurePool();
  
  // Fallback en memoria
  if (!p || !dbReady) {
    const key = contactId;
    const entry = memoryFallback.facts.get(key) || [];
    
    // Upsert
    const existingIdx = entry.findIndex(f => f.factType === factType && f.factKey === factKey);
    const newFact = { contactId, conversationId, factType, factKey, factValue, confidence };
    
    if (existingIdx >= 0) {
      entry[existingIdx] = newFact;
    } else {
      entry.push(newFact);
    }
    
    // Limitar tamaño
    if (entry.length > memoryConfig.maxFactsPerContact) {
      entry.splice(0, entry.length - memoryConfig.maxFactsPerContact);
    }
    
    memoryFallback.facts.set(key, entry);
    return { saved: true, storage: "memory" };
  }
  
  try {
    // Generar embedding del fact
    const factText = `${factType}: ${factKey} = ${factValue}`;
    const embedding = await getEmbedding(factText);
    const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;
    
    // Calcular TTL si está configurado
    const expiresAt = memoryConfig.factsTtlMs 
      ? new Date(Date.now() + memoryConfig.factsTtlMs).toISOString()
      : null;
    
    await p.query(`
      INSERT INTO conversation_facts 
        (contact_id, source_conversation_id, fact_type, fact_key, fact_value, 
         fact_embedding, confidence, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6::vector, $7, $8)
      ON CONFLICT (contact_id, fact_type, fact_key) 
      DO UPDATE SET 
        fact_value = EXCLUDED.fact_value,
        fact_embedding = EXCLUDED.fact_embedding,
        confidence = GREATEST(conversation_facts.confidence, EXCLUDED.confidence),
        last_confirmed_at = NOW(),
        is_stale = FALSE,
        source_conversation_id = EXCLUDED.source_conversation_id
    `, [contactId, conversationId, factType, factKey, factValue, embeddingStr, confidence, expiresAt]);
    
    logger.debug({
      contactId,
      factType,
      factKey,
      hasEmbedding: !!embedding,
    }, "Fact saved");
    
    return { saved: true, storage: "postgres" };
    
  } catch (error) {
    logger.error({ error: error.message, contactId, factKey }, "Failed to save fact");
    return { saved: false, error: error.message };
  }
}

/**
 * Obtiene facts de un contacto, opcionalmente filtrados por query semántica
 * @param {string} contactId
 * @param {string} [query] - Query para búsqueda semántica
 * @param {number} [limit]
 */
export async function getRelevantFacts(contactId, query = null, limit = 10) {
  if (!contactId) return [];
  
  const p = ensurePool();
  
  // Fallback en memoria
  if (!p || !dbReady) {
    const entry = memoryFallback.facts.get(contactId) || [];
    return entry.slice(0, limit);
  }
  
  try {
    // Si hay query, hacer búsqueda semántica
    if (query) {
      const queryEmbedding = await getEmbedding(query);
      
      if (queryEmbedding) {
        const result = await p.query(`
          SELECT 
            fact_type, fact_key, fact_value, confidence,
            1 - (fact_embedding <=> $3::vector) as similarity
          FROM conversation_facts
          WHERE contact_id = $1
            AND is_stale = FALSE
            AND (expires_at IS NULL OR expires_at > NOW())
            AND fact_embedding IS NOT NULL
            AND 1 - (fact_embedding <=> $3::vector) >= $4
          ORDER BY similarity DESC
          LIMIT $2
        `, [contactId, limit, `[${queryEmbedding.join(",")}]`, memoryConfig.factSimilarityThreshold]);
        
        return result.rows;
      }
    }
    
    // Sin query, obtener facts más recientes por confianza
    const result = await p.query(`
      SELECT fact_type, fact_key, fact_value, confidence
      FROM conversation_facts
      WHERE contact_id = $1
        AND is_stale = FALSE
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY confidence DESC, last_confirmed_at DESC
      LIMIT $2
    `, [contactId, limit]);
    
    return result.rows;
    
  } catch (error) {
    logger.error({ error: error.message, contactId }, "Failed to get facts");
    return [];
  }
}

/**
 * Marca facts como potencialmente desactualizados
 */
export async function markFactsStale(contactId, factKeys = null) {
  const p = ensurePool();
  if (!p || !dbReady) return { updated: 0 };
  
  try {
    let result;
    
    if (factKeys && factKeys.length > 0) {
      result = await p.query(`
        UPDATE conversation_facts
        SET is_stale = TRUE
        WHERE contact_id = $1 AND fact_key = ANY($2)
      `, [contactId, factKeys]);
    } else {
      result = await p.query(`
        UPDATE conversation_facts
        SET is_stale = TRUE
        WHERE contact_id = $1
      `, [contactId]);
    }
    
    return { updated: result.rowCount };
    
  } catch (error) {
    logger.error({ error: error.message, contactId }, "Failed to mark facts stale");
    return { updated: 0, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPATIBILIDAD - API del servicio anterior
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Alias de getMessages para compatibilidad
 */
export function getHistory(conversationId) {
  return getMessages(conversationId);
}

/**
 * Alias de addMessage para compatibilidad
 */
export function addMessageLegacy(conversationId, role, content) {
  return addMessage({ conversationId, role, content });
}

/**
 * Alias de clearMessages para compatibilidad
 */
export function clearHistory(conversationId) {
  return clearMessages(conversationId);
}

/**
 * Alias de getContextForLLM para compatibilidad
 */
export async function getHistoryForLLM(conversationId, limit = 20) {
  const result = await getContextForLLM(conversationId, { maxMessages: limit });
  return result.messages;
}

/**
 * Obtiene estadísticas del servicio
 */
export async function getStats() {
  const p = ensurePool();
  
  if (!p || !dbReady) {
    let totalMessages = 0;
    let totalFacts = 0;
    
    for (const entry of memoryFallback.messages.values()) {
      totalMessages += entry.length;
    }
    for (const entry of memoryFallback.facts.values()) {
      totalFacts += entry.length;
    }
    
    return {
      storage: "memory",
      conversations: memoryFallback.messages.size,
      totalMessages,
      contacts: memoryFallback.facts.size,
      totalFacts,
      summaries: 0,
    };
  }
  
  try {
    const result = await p.query(`SELECT * FROM conversation_memory_stats`);
    
    return {
      storage: "postgres",
      ...result.rows[0],
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get memory stats");
    return { storage: "postgres", error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const conversationMemoryService = {
  // Lifecycle
  init: initMemoryService,
  getStats,
  
  // Messages
  addMessage,
  getMessages,
  clearMessages,
  getContextForLLM,
  
  // Facts
  saveFact,
  getRelevantFacts,
  markFactsStale,
  
  // Compatibilidad con API anterior
  getHistory,
  setHistory: (id, msgs) => {
    // Migrar mensajes existentes
    clearMessages(id).then(() => {
      msgs.forEach(m => addMessage({ conversationId: id, ...m }));
    });
  },
  addMessage: addMessageLegacy,
  clearHistory,
  getHistoryForLLM,
};

export default conversationMemoryService;
