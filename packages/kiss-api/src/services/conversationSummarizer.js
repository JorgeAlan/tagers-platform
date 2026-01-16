/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONVERSATION SUMMARIZER SERVICE - Resumen Inteligente con LLM
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Comprime conversaciones antiguas usando LLM para:
 * 1. Crear resúmenes concisos
 * 2. Extraer facts/preferencias del cliente
 * 3. Generar embeddings para búsqueda semántica
 * 
 * FLUJO:
 * 1. Identificar conversaciones con mensajes antiguos no resumidos
 * 2. Agrupar mensajes en chunks para resumir
 * 3. Llamar LLM con prompt especializado
 * 4. Guardar resumen + extraer facts
 * 5. Marcar mensajes como resumidos
 * 
 * @version 1.0.0
 */

import fs from "fs";
import path from "path";
import { Pool } from "pg";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getPoolConfig } from "../db/poolConfig.js";
import { getEmbedding } from "../vector/embeddings.js";
import { createStructuredJSON } from "../openai_client.js";
import { routeTask } from "../model_router.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const summarizerConfig = {
  // Tiempo mínimo antes de resumir (ms)
  summarizeAfterMs: parseInt(process.env.MEMORY_SUMMARIZE_AFTER_MS || String(24 * 60 * 60 * 1000), 10),
  
  // Mínimo de mensajes para crear un resumen
  minMessagesForSummary: parseInt(process.env.MEMORY_MIN_MESSAGES_SUMMARY || "10", 10),
  
  // Máximo de mensajes por resumen
  maxMessagesPerSummary: parseInt(process.env.MEMORY_MAX_MESSAGES_PER_SUMMARY || "50", 10),
  
  // Extraer facts
  extractFacts: process.env.MEMORY_EXTRACT_FACTS !== "false",
  
  // TTL para resúmenes (NULL = no expira)
  summaryTtlMs: process.env.MEMORY_SUMMARY_TTL_MS 
    ? parseInt(process.env.MEMORY_SUMMARY_TTL_MS, 10) 
    : null,
  
  // Máximo de conversaciones a procesar por ciclo
  maxConversationsPerCycle: parseInt(process.env.MEMORY_MAX_CONVERSATIONS_PER_CYCLE || "10", 10),
  
  // Intervalo entre ciclos (ms)
  cycleIntervalMs: parseInt(process.env.MEMORY_CYCLE_INTERVAL_MS || String(30 * 60 * 1000), 10), // 30 min
};

/**
 * Obtiene la configuración del modelo desde model_policy
 * @returns {Object} { model, service_tier, max_output_tokens, temperature }
 */
function getModelConfig() {
  const taskConfig = routeTask("conversation_summary");
  return {
    model: taskConfig.model || "gpt-5-mini",
    service_tier: taskConfig.service_tier || "flex",
    max_output_tokens: taskConfig.max_output_tokens || 1500,
    temperature: taskConfig.temperature ?? 0.3,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

const __dirname = path.dirname(new URL(import.meta.url).pathname);

let SUMMARIZER_PROMPT = null;

function loadSummarizerPrompt() {
  if (SUMMARIZER_PROMPT) return SUMMARIZER_PROMPT;
  
  try {
    const promptPath = path.join(__dirname, "../../prompts/conversation_summarizer_system.md");
    SUMMARIZER_PROMPT = fs.readFileSync(promptPath, "utf-8");
    return SUMMARIZER_PROMPT;
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to load summarizer prompt, using default");
    return getDefaultPrompt();
  }
}

function getDefaultPrompt() {
  return `Eres un experto en comprimir conversaciones de servicio al cliente.

Analiza la conversación y genera:
1. Un resumen conciso (máx 200 palabras) preservando contexto importante
2. Extrae facts/preferencias del cliente para memoria a largo plazo

Incluye: intención del cliente, productos mencionados, fechas relevantes, resolución.
Omite: saludos genéricos, confirmaciones simples, repeticiones.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// POOL DE CONEXIONES
// ═══════════════════════════════════════════════════════════════════════════

let pool = null;

function ensurePool() {
  if (!config.databaseUrl) return null;
  if (pool) return pool;
  
  pool = new Pool(getPoolConfig(config.databaseUrl, {
    max: parseInt(process.env.PG_SUMMARIZER_POOL_MAX || "3", 10),
  }));
  
  pool.on("error", (err) => logger.error({ err }, "Summarizer pool error"));
  
  return pool;
}

// ═══════════════════════════════════════════════════════════════════════════
// IDENTIFICACIÓN DE CONVERSACIONES A RESUMIR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encuentra conversaciones que necesitan ser resumidas
 */
async function findConversationsToSummarize() {
  const p = ensurePool();
  if (!p) return [];
  
  try {
    const cutoffTime = new Date(Date.now() - summarizerConfig.summarizeAfterMs).toISOString();
    
    const result = await p.query(`
      SELECT 
        conversation_id,
        contact_id,
        COUNT(*) as message_count,
        MIN(message_timestamp) as oldest_message,
        MAX(message_timestamp) as newest_message
      FROM conversation_messages
      WHERE summarized = FALSE
        AND message_timestamp < $1
      GROUP BY conversation_id, contact_id
      HAVING COUNT(*) >= $2
      ORDER BY MIN(message_timestamp) ASC
      LIMIT $3
    `, [cutoffTime, summarizerConfig.minMessagesForSummary, summarizerConfig.maxConversationsPerCycle]);
    
    logger.debug({
      found: result.rows.length,
      cutoffTime,
      minMessages: summarizerConfig.minMessagesForSummary,
    }, "Found conversations to summarize");
    
    return result.rows;
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to find conversations to summarize");
    return [];
  }
}

/**
 * Obtiene mensajes a resumir de una conversación
 */
async function getMessagesToSummarize(conversationId) {
  const p = ensurePool();
  if (!p) return [];
  
  try {
    const cutoffTime = new Date(Date.now() - summarizerConfig.summarizeAfterMs).toISOString();
    
    const result = await p.query(`
      SELECT 
        id,
        role,
        content,
        message_timestamp,
        metadata
      FROM conversation_messages
      WHERE conversation_id = $1
        AND summarized = FALSE
        AND message_timestamp < $2
      ORDER BY message_timestamp ASC
      LIMIT $3
    `, [conversationId, cutoffTime, summarizerConfig.maxMessagesPerSummary]);
    
    return result.rows;
    
  } catch (error) {
    logger.error({ error: error.message, conversationId }, "Failed to get messages to summarize");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE RESÚMENES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un resumen de conversación usando LLM
 * @param {Array} messages - Mensajes a resumir
 * @param {string} conversationId - Para metadata
 */
async function generateSummary(messages, conversationId) {
  if (!messages || messages.length === 0) {
    return null;
  }
  
  try {
    // Formatear conversación para el LLM
    const conversationText = messages
      .map(m => `[${m.message_timestamp}] ${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    
    const prompt = loadSummarizerPrompt();
    
    // Obtener configuración del modelo desde model_policy
    const modelConfig = getModelConfig();
    
    const result = await createStructuredJSON({
      model: modelConfig.model,
      service_tier: modelConfig.service_tier,
      instructions: prompt,
      inputObject: {
        conversation_id: conversationId,
        message_count: messages.length,
        date_range: {
          start: messages[0].message_timestamp,
          end: messages[messages.length - 1].message_timestamp,
        },
        conversation: conversationText,
      },
      schemaKey: "conversation_summary",
      schemaName: "conversation_summary",
      temperature: modelConfig.temperature,
      max_output_tokens: modelConfig.max_output_tokens,
      metadata: {
        task: "conversation_summary",
        conversation_id: conversationId,
      },
    });
    
    logger.debug({
      conversationId,
      messageCount: messages.length,
      summaryLength: result.parsed?.summary?.length,
      factsExtracted: result.parsed?.extracted_facts?.length || 0,
    }, "Summary generated");
    
    return result.parsed;
    
  } catch (error) {
    logger.error({
      error: error.message,
      conversationId,
      messageCount: messages.length,
    }, "Failed to generate summary");
    
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALMACENAMIENTO DE RESÚMENES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guarda un resumen y marca los mensajes como resumidos
 */
async function saveSummary({ conversationId, contactId, summary, messages }) {
  const p = ensurePool();
  if (!p || !summary || !messages?.length) return null;
  
  try {
    // Generar embedding del resumen
    const embedding = await getEmbedding(summary.summary);
    const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;
    
    // Calcular TTL si está configurado
    const expiresAt = summarizerConfig.summaryTtlMs 
      ? new Date(Date.now() + summarizerConfig.summaryTtlMs).toISOString()
      : null;
    
    // Calcular tokens estimados (aprox 4 chars = 1 token)
    const estimatedTokens = Math.ceil(summary.summary.length / 4);
    
    // Insertar resumen
    const insertResult = await p.query(`
      INSERT INTO conversation_summaries 
        (conversation_id, contact_id, summary_text, messages_start_at, messages_end_at,
         message_count, estimated_tokens, summary_embedding, metadata, expires_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::vector, $9, $10)
      RETURNING id
    `, [
      conversationId,
      contactId,
      summary.summary,
      messages[0].message_timestamp,
      messages[messages.length - 1].message_timestamp,
      messages.length,
      estimatedTokens,
      embeddingStr,
      {
        primary_intent: summary.primary_intent,
        resolution_status: summary.resolution_status,
        sentiment: summary.sentiment,
        products_mentioned: summary.products_mentioned || [],
        model_used: summarizerConfig.model,
      },
      expiresAt,
    ]);
    
    const summaryId = insertResult.rows[0].id;
    
    // Marcar mensajes como resumidos
    const messageIds = messages.map(m => m.id);
    await p.query(`
      UPDATE conversation_messages
      SET summarized = TRUE, summary_id = $1
      WHERE id = ANY($2)
    `, [summaryId, messageIds]);
    
    logger.info({
      conversationId,
      summaryId,
      messagesSummarized: messages.length,
      hasEmbedding: !!embedding,
    }, "Summary saved successfully");
    
    return summaryId;
    
  } catch (error) {
    logger.error({
      error: error.message,
      conversationId,
    }, "Failed to save summary");
    
    return null;
  }
}

/**
 * Guarda facts extraídos de un resumen
 */
async function saveExtractedFacts({ contactId, conversationId, facts }) {
  if (!contactId || !facts || facts.length === 0) {
    return { saved: 0 };
  }
  
  const p = ensurePool();
  if (!p) return { saved: 0 };
  
  let saved = 0;
  
  for (const fact of facts) {
    try {
      // Generar embedding del fact
      const factText = `${fact.fact_type}: ${fact.fact_key} = ${fact.fact_value}`;
      const embedding = await getEmbedding(factText);
      const embeddingStr = embedding ? `[${embedding.join(",")}]` : null;
      
      await p.query(`
        INSERT INTO conversation_facts 
          (contact_id, source_conversation_id, fact_type, fact_key, fact_value, 
           fact_embedding, confidence)
        VALUES ($1, $2, $3, $4, $5, $6::vector, $7)
        ON CONFLICT (contact_id, fact_type, fact_key) 
        DO UPDATE SET 
          fact_value = EXCLUDED.fact_value,
          fact_embedding = EXCLUDED.fact_embedding,
          confidence = GREATEST(conversation_facts.confidence, EXCLUDED.confidence),
          last_confirmed_at = NOW(),
          is_stale = FALSE
      `, [
        contactId,
        conversationId,
        fact.fact_type,
        fact.fact_key,
        fact.fact_value,
        embeddingStr,
        fact.confidence || 0.8,
      ]);
      
      saved++;
      
    } catch (error) {
      logger.warn({
        error: error.message,
        contactId,
        factKey: fact.fact_key,
      }, "Failed to save extracted fact");
    }
  }
  
  if (saved > 0) {
    logger.debug({
      contactId,
      conversationId,
      factsSaved: saved,
      factsTotal: facts.length,
    }, "Extracted facts saved");
  }
  
  return { saved };
}

// ═══════════════════════════════════════════════════════════════════════════
// CICLO DE RESUMEN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta un ciclo de resumen
 * Procesa conversaciones que necesitan ser resumidas
 */
export async function runSummarizationCycle() {
  const p = ensurePool();
  if (!p) {
    logger.debug("Database not available, skipping summarization cycle");
    return { processed: 0, reason: "no_database" };
  }
  
  const startTime = Date.now();
  let processed = 0;
  let summarized = 0;
  let factsExtracted = 0;
  
  try {
    // 1. Encontrar conversaciones a resumir
    const conversations = await findConversationsToSummarize();
    
    if (conversations.length === 0) {
      logger.debug("No conversations need summarization");
      return { processed: 0, reason: "no_pending" };
    }
    
    // 2. Procesar cada conversación
    for (const conv of conversations) {
      try {
        // Obtener mensajes
        const messages = await getMessagesToSummarize(conv.conversation_id);
        
        if (messages.length < summarizerConfig.minMessagesForSummary) {
          continue;
        }
        
        // Generar resumen
        const summary = await generateSummary(messages, conv.conversation_id);
        
        if (!summary) {
          logger.warn({ conversationId: conv.conversation_id }, "Failed to generate summary, skipping");
          continue;
        }
        
        // Guardar resumen
        const summaryId = await saveSummary({
          conversationId: conv.conversation_id,
          contactId: conv.contact_id,
          summary,
          messages,
        });
        
        if (summaryId) {
          summarized++;
          
          // Guardar facts extraídos
          if (summarizerConfig.extractFacts && summary.extracted_facts?.length > 0 && conv.contact_id) {
            const factResult = await saveExtractedFacts({
              contactId: conv.contact_id,
              conversationId: conv.conversation_id,
              facts: summary.extracted_facts,
            });
            factsExtracted += factResult.saved;
          }
        }
        
        processed++;
        
      } catch (error) {
        logger.error({
          error: error.message,
          conversationId: conv.conversation_id,
        }, "Error processing conversation for summarization");
      }
    }
    
    const elapsedMs = Date.now() - startTime;
    
    logger.info({
      processed,
      summarized,
      factsExtracted,
      elapsedMs,
    }, "Summarization cycle completed");
    
    return {
      processed,
      summarized,
      factsExtracted,
      elapsedMs,
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Summarization cycle failed");
    return { processed, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════

let schedulerInterval = null;

/**
 * Inicia el scheduler de resumen automático
 */
export function startSummarizationScheduler() {
  if (schedulerInterval) {
    logger.warn("Summarization scheduler already running");
    return;
  }
  
  logger.info({
    intervalMs: summarizerConfig.cycleIntervalMs,
  }, "Starting summarization scheduler");
  
  // Ejecutar inmediatamente y luego en intervalos
  runSummarizationCycle();
  
  schedulerInterval = setInterval(() => {
    runSummarizationCycle();
  }, summarizerConfig.cycleIntervalMs);
}

/**
 * Detiene el scheduler
 */
export function stopSummarizationScheduler() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
    logger.info("Summarization scheduler stopped");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MANTENIMIENTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Limpia mensajes antiguos ya resumidos
 */
export async function cleanupOldMessages(olderThanDays = 30) {
  const p = ensurePool();
  if (!p) return { deleted: 0 };
  
  try {
    const result = await p.query(`
      SELECT * FROM cleanup_old_summarized_messages($1)
    `, [olderThanDays]);
    
    const stats = result.rows[0];
    
    logger.info({
      olderThanDays,
      ...stats,
    }, "Cleanup completed");
    
    return stats;
    
  } catch (error) {
    logger.error({ error: error.message }, "Cleanup failed");
    return { deleted: 0, error: error.message };
  }
}

/**
 * Obtiene estadísticas del summarizer
 */
export async function getSummarizerStats() {
  const p = ensurePool();
  if (!p) return { status: "no_database" };
  
  try {
    const pendingResult = await p.query(`
      SELECT COUNT(DISTINCT conversation_id) as pending_conversations,
             COUNT(*) as pending_messages
      FROM conversation_messages
      WHERE summarized = FALSE
        AND message_timestamp < NOW() - ($1 || ' milliseconds')::interval
    `, [summarizerConfig.summarizeAfterMs]);
    
    const summariesResult = await p.query(`
      SELECT COUNT(*) as total_summaries,
             SUM(message_count) as total_summarized_messages,
             AVG(estimated_tokens) as avg_tokens_per_summary
      FROM conversation_summaries
    `);
    
    return {
      status: "ok",
      scheduler: schedulerInterval ? "running" : "stopped",
      config: {
        summarizeAfterMs: summarizerConfig.summarizeAfterMs,
        minMessagesForSummary: summarizerConfig.minMessagesForSummary,
        cycleIntervalMs: summarizerConfig.cycleIntervalMs,
      },
      pending: {
        conversations: parseInt(pendingResult.rows[0]?.pending_conversations || 0),
        messages: parseInt(pendingResult.rows[0]?.pending_messages || 0),
      },
      totals: {
        summaries: parseInt(summariesResult.rows[0]?.total_summaries || 0),
        summarizedMessages: parseInt(summariesResult.rows[0]?.total_summarized_messages || 0),
        avgTokensPerSummary: parseFloat(summariesResult.rows[0]?.avg_tokens_per_summary || 0),
      },
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get summarizer stats");
    return { status: "error", error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const conversationSummarizer = {
  // Manual execution
  runCycle: runSummarizationCycle,
  
  // Scheduler
  start: startSummarizationScheduler,
  stop: stopSummarizationScheduler,
  
  // Maintenance
  cleanup: cleanupOldMessages,
  getStats: getSummarizerStats,
  
  // Individual operations
  generateSummary,
  findConversationsToSummarize,
};

export default conversationSummarizer;
