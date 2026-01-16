/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHATWOOT WEBHOOK - Arquitectura Asíncrona con BullMQ
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ARQUITECTURA "SORDO Y MUDO":
 * El webhook SOLO recibe y encola. No toma decisiones de negocio.
 * 
 * 1. Recibe HTTP → Valida firma
 * 2. Responde 200 OK en <50ms
 * 3. Pasa a Governor (filtros rápidos)
 * 4. Si pasa → Encola en BullMQ
 * 5. Worker procesa asincrónicamente
 * 
 * BENEFICIOS:
 * - Nunca timeout de Chatwoot
 * - Soporta modelos lentos (Deep Think)
 * - Cola persistente (Redis)
 * - Procesamiento paralelo
 * - Reintentos automáticos
 * 
 * @version 3.2.0 - Fix bot message detection
 */

import express from "express";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// LANGSMITH TRACING
// ═══════════════════════════════════════════════════════════════════════════
import { traceable } from "langsmith/traceable";

function isLangSmithEnabled() {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY;
}

function wrapWithTrace(fn, name, metadata = {}) {
  if (!isLangSmithEnabled()) return fn;
  return traceable(fn, {
    name,
    run_type: "chain",
    metadata: { service: "tagers-kiss-api", component: "chatwoot-webhook-v3", ...metadata },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// OPENTELEMETRY DISTRIBUTED TRACING
// ═══════════════════════════════════════════════════════════════════════════
import {
  withSpan,
  extractTraceContext,
  getTraceId,
  // Metrics - Counters (use .add())
  messageReceived,
  messageSkipped,
  cacheHit,
  cacheMiss,
  // Metrics - Histograms (use .record())
  webhookLatency,
  governorLatency,
  dispatcherLatency,
} from "../telemetry/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// CORE ARCHITECTURE IMPORTS
// ═══════════════════════════════════════════════════════════════════════════
import { governor, GOVERNOR_DECISIONS } from "../core/governor.js";
import { dispatcher } from "../core/dispatcher.js";
import { aiQueue } from "../core/queue.js";
import { semanticCache } from "../core/semanticCache.js";

// ═══════════════════════════════════════════════════════════════════════════
// SERVICES
// ═══════════════════════════════════════════════════════════════════════════
import { 
  sendChatwootMessage,
  fetchChatwootMessages,
} from "../integrations/chatwoot_client.js";

import { 
  hydrateFromDb as hydrateFlowFromDb,
} from "../services/flowStateService.js";

import { 
  getConversationHistory, 
  setConversationHistory, 
  addToConversationHistory,
} from "../tania/agentic_flow_selector.js";

// ═══════════════════════════════════════════════════════════════════════════
// BOT NAME PATTERNS - Para detectar mensajes del propio bot
// ═══════════════════════════════════════════════════════════════════════════
const BOT_NAME_PATTERNS = [
  /tan\s*[•·.]\s*ia/i,    // "Tan • IA", "Tan·IA", "Tan.IA"
  /^tan\s*ia$/i,          // "TanIA", "Tan IA"
  /^tania$/i,             // "Tania"
  /^ana\s*bot$/i,         // "Ana Bot"
];

function isBotName(name) {
  if (!name) return false;
  const n = String(name).trim();
  return BOT_NAME_PATTERNS.some(pattern => pattern.test(n));
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function extractChatwoot(body) {
  const event = body?.event || body?.type || body?.event_name || null;
  
  let message = null;
  if (body?.message) {
    message = body.message;
  } else if (body?.data?.message) {
    message = body.data.message;
  } else if (body?.payload?.message) {
    message = body.payload.message;
  } else if (body?.content !== undefined && body?.id) {
    message = body;
  }
  
  const conversation = body?.conversation || body?.data?.conversation || body?.payload?.conversation || null;
  const account = body?.account || body?.data?.account || null;
  const inbox = body?.inbox || body?.data?.inbox || null;
  const contact = message?.sender || message?.contact || conversation?.meta?.sender || null;
  
  return { event, message, conversation, account, inbox, contact, raw: body };
}

/**
 * Determina si un mensaje es entrante de un contacto (cliente)
 * MEJORADO: Detecta message_type numérico (0=incoming, 1=outgoing)
 */
function isIncomingFromContact(message) {
  if (!message) return false;
  
  const mt = message?.message_type ?? message?.direction ?? "";
  
  // message_type puede ser número (0=incoming, 1=outgoing) o string
  if (mt === 1 || mt === "outgoing" || String(mt).toLowerCase() === "outgoing") {
    return false;
  }
  
  const senderType = message?.sender_type || message?.sender?.type || "";
  const senderTypeLower = String(senderType).toLowerCase();
  
  // Si es de un agente, bot, o user (en contexto de Chatwoot, "user" = agente interno)
  if (senderType && senderTypeLower !== "contact") {
    return false;
  }
  
  return true;
}

/**
 * Verifica si el mensaje es del propio bot
 * Detecta por: echo_id, sender name, o sender type
 */
function isOwnBotMessage(message) {
  if (!message) return false;
  
  // 1. Verificar echo_id (más confiable si está presente)
  const echoId = message?.echo_id || "";
  if (echoId.startsWith("tania_") || echoId.startsWith("ana_")) {
    return true;
  }
  
  // 2. Verificar nombre del sender
  const senderName = message?.sender?.name || "";
  if (isBotName(senderName)) {
    return true;
  }
  
  // 3. Verificar si es AgentBot
  const senderType = message?.sender_type || message?.sender?.type || "";
  if (String(senderType).toLowerCase() === "agentbot" || 
      String(senderType).toLowerCase() === "agent_bot") {
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEDUPE - Servicio distribuido con Redis
// ═══════════════════════════════════════════════════════════════════════════
import { isDuplicate as checkDuplicate, getStats as getDedupeStats } from "../core/deduplication.js";

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN AUTH - Protección de endpoints administrativos
// ═══════════════════════════════════════════════════════════════════════════
import { adminAuthMiddleware } from "../middleware/adminAuth.js";

// ═══════════════════════════════════════════════════════════════════════════
// WHISPER - Transcripción de notas de voz
// ═══════════════════════════════════════════════════════════════════════════
import { 
  transcribeFromUrl, 
  isTranscribableAttachment, 
  isWhisperEnabled 
} from "../services/whisper.js";

// ═══════════════════════════════════════════════════════════════════════════
// HYDRATION
// ═══════════════════════════════════════════════════════════════════════════
async function hydrateConversationHistoryFromChatwoot({ accountId, conversationId }) {
  if (!config.chatwoot.apiAccessToken) return;
  if (!accountId || !conversationId) return;
  
  const existing = getConversationHistory(conversationId);
  if (Array.isArray(existing) && existing.length >= 2) return;
  
  const msgs = await fetchChatwootMessages({ accountId, conversationId, limit: 50 });
  if (!Array.isArray(msgs) || msgs.length === 0) return;
  
  const normalized = msgs
    .map(m => {
      const mt = m?.message_type;
      const senderType = m?.sender_type;
      const isIncoming = (mt === 0 || mt === "incoming" || senderType === "contact");
      const role = isIncoming ? "user" : "assistant";
      const content = String(m?.content || "").replace(/<[^>]*>/g, "").trim();
      if (!content) return null;
      const tsMs = typeof m?.created_at === "number" ? (m.created_at * 1000) : Date.now();
      return { role, content, timestamp: new Date(tsMs).toISOString(), __tsMs: tsMs };
    })
    .filter(Boolean)
    .sort((a, b) => (a.__tsMs || 0) - (b.__tsMs || 0))
    .map(({ __tsMs, ...rest }) => rest);
  
  if (normalized.length) {
    setConversationHistory(conversationId, normalized);
    logger.info({ conversationId, hydratedMessages: normalized.length }, "Chatwoot history hydrated");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════════════
export const chatwootRouter = express.Router();

/**
 * WEBHOOK PRINCIPAL - Sordo y Mudo
 * Solo recibe, valida, y encola. No procesa.
 */
chatwootRouter.post("/webhook", async (req, res) => {
  const startTime = Date.now();
  
  // ─────────────────────────────────────────────────────────────────────────
  // 1. VALIDACIÓN DE AUTENTICACIÓN
  // ─────────────────────────────────────────────────────────────────────────
  if (!config.chatwoot.enabled) {
    return res.status(404).json({ ok: false, error: "CHATWOOT_DISABLED" });
  }
  
  if (config.chatwoot.webhookToken) {
    const qToken = String(req.query.token || "");
    const hToken = String(req.headers["x-tagers-chatwoot-token"] || "");
    const token = qToken || hToken;
    if (token !== config.chatwoot.webhookToken) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 2. RESPUESTA INMEDIATA (< 50ms)
  // ─────────────────────────────────────────────────────────────────────────
  res.json({ ok: true, received_at: new Date().toISOString() });
  
  // ─────────────────────────────────────────────────────────────────────────
  // 3. PROCESAMIENTO ASÍNCRONO (Fire and Forget)
  // ─────────────────────────────────────────────────────────────────────────
  processWebhookAsync(req.body, startTime).catch(err => {
    logger.error({ err: err?.message }, "Webhook async processing failed");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ASYNC PROCESSING PIPELINE
// ═══════════════════════════════════════════════════════════════════════════

async function processWebhookAsync(body, startTime) {
  const { event, message, conversation, account, inbox, contact } = extractChatwoot(body);
  
  // Log inicial
  logger.info({
    event,
    hasMessage: !!message,
    messageType: message?.message_type,
    senderType: message?.sender_type,
    senderName: message?.sender?.name,
    echoId: message?.echo_id,
    durationToHere: Date.now() - startTime,
  }, "Webhook received");
  
  // ─────────────────────────────────────────────────────────────────────────
  // FILTRO ULTRA-RÁPIDO: Ignorar mensajes del propio bot
  // Esto DEBE ser lo primero para evitar loops infinitos
  // ─────────────────────────────────────────────────────────────────────────
  if (isOwnBotMessage(message)) {
    logger.debug({ 
      conversationId: conversation?.id,
      echoId: message?.echo_id,
      senderName: message?.sender?.name,
    }, "Ignoring own bot message");
    return;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FILTROS RÁPIDOS (Sin IA)
  // ─────────────────────────────────────────────────────────────────────────
  
  // Solo eventos de mensaje
  const ev = String(event || "").toLowerCase();
  if (ev && !ev.includes("message")) {
    logger.debug({ event: ev }, "Ignoring non-message event");
    return;
  }
  
  if (!message || !conversation) {
    logger.debug("Missing message or conversation");
    return;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // DETECTAR MENSAJE DE AGENTE HUMANO (para ceder control)
  // ─────────────────────────────────────────────────────────────────────────
  if (!isIncomingFromContact(message)) {
    // Es mensaje saliente o de agente
    const senderType = message?.sender_type || message?.sender?.type || "";
    const senderName = message?.sender?.name || "";
    
    // Si es de un User (agente humano), marcar como manejado por humano
    if (senderType === "User" || senderType === "user") {
      const accountId = account?.id || config.chatwoot.accountId;
      const conversationId = conversation?.id;
      
      logger.info({ 
        conversationId, 
        agentName: senderName,
        senderType,
      }, "Agent message detected - marking conversation for human handling");
      
      // Actualizar custom_attributes para indicar que un humano está activo
      try {
        const { updateCustomAttributes } = await import("../integrations/chatwoot_client.js");
        await updateCustomAttributes({
          accountId,
          conversationId,
          customAttributes: {
            last_agent_reply_at: new Date().toISOString(),
            bot_active: false,
          },
        });
      } catch (e) {
        logger.debug({ err: e?.message }, "Failed to update custom attributes (non-fatal)");
      }
    }
    
    logger.debug({ senderType, senderName }, "Ignoring non-contact message");
    return;
  }
  
  let messageText = String(message?.content || "").replace(/<[^>]*>/g, '').trim();
  
  // ─────────────────────────────────────────────────────────────────────────
  // WHISPER: Transcribir notas de voz
  // ─────────────────────────────────────────────────────────────────────────
  const attachments = message?.attachments || [];
  const audioAttachment = attachments.find(att => isTranscribableAttachment(att));
  
  if (audioAttachment && isWhisperEnabled()) {
    const audioUrl = audioAttachment.data_url || audioAttachment.url;
    
    if (audioUrl) {
      logger.info({ conversationId: conversation?.id, audioUrl: audioUrl?.substring(0, 80) }, "Transcribing voice note");
      
      // Preparar headers de autenticación para Chatwoot
      const authHeaders = config.chatwoot.apiAccessToken 
        ? { "api_access_token": config.chatwoot.apiAccessToken }
        : {};
      
      const transcription = await transcribeFromUrl(audioUrl, { headers: authHeaders });
      
      if (transcription?.text) {
        // Usar texto transcrito como mensaje
        messageText = transcription.text;
        logger.info({ 
          conversationId: conversation?.id, 
          originalText: message?.content?.substring(0, 50),
          transcribed: messageText.substring(0, 100),
        }, "Voice note transcribed");
      } else {
        // Si falla transcripción, informar al usuario
        if (!messageText) {
          messageText = "[Audio recibido - no se pudo transcribir]";
        }
      }
    }
  }
  
  if (!messageText) return;
  
  const conversationId = conversation?.id;
  if (!conversationId) return;
  
  const messageId = message?.id || body?.id;
  if (await checkDuplicate(messageId)) {
    logger.debug({ conversationId, messageId }, "Duplicate message ignored");
    return;
  }
  
  const accountId = account?.id || config.chatwoot.accountId;
  const inboxId = inbox?.id || conversation?.inbox_id;
  const inboxName = inbox?.name || "";
  
  // ─────────────────────────────────────────────────────────────────────────
  // SEMANTIC CACHE CHECK (Respuesta instantánea si hay hit)
  // ─────────────────────────────────────────────────────────────────────────
  const cacheResult = semanticCache.get(messageText);
  
  if (cacheResult.hit) {
    logger.info({
      conversationId,
      cacheHit: true,
      category: cacheResult.category,
      responseTime: Date.now() - startTime,
    }, "Responding from semantic cache");
    
    await sendChatwootMessage({
      accountId,
      conversationId,
      content: cacheResult.response,
    });
    return;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // HYDRATION (En paralelo para no bloquear)
  // ─────────────────────────────────────────────────────────────────────────
  await Promise.all([
    hydrateConversationHistoryFromChatwoot({ accountId, conversationId }).catch(() => null),
    hydrateFlowFromDb(conversationId).catch(() => null),
  ]);
  
  // Agregar mensaje actual al historial
  try {
    const existing = getConversationHistory(conversationId);
    const last = existing?.length ? existing[existing.length - 1] : null;
    if (!(last && last.role === "user" && last.content === messageText)) {
      addToConversationHistory(conversationId, "user", messageText);
    }
  } catch (_e) {}
  
  // ─────────────────────────────────────────────────────────────────────────
  // GOVERNOR: ¿Debo procesar?
  // ─────────────────────────────────────────────────────────────────────────
  const governorResult = await governor.evaluate(body);
  
  if (!governorResult.shouldProcess) {
    logger.info({
      conversationId,
      decision: governorResult.decision,
      reason: governorResult.reason,
      durationMs: Date.now() - startTime,
    }, "Governor: SKIP");
    return;
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // DISPATCHER: ¿Cómo proceso?
  // ─────────────────────────────────────────────────────────────────────────
  const routing = await dispatcher.route(governorResult.context);
  
  logger.info({
    conversationId,
    route: routing.route,
    handler: routing.handler,
    hasActiveFlow: governorResult.context.hasActiveFlow,
    durationMs: Date.now() - startTime,
  }, "Dispatcher: routed");
  
  // ─────────────────────────────────────────────────────────────────────────
  // ENQUEUE: Mandar a cola para procesamiento async
  // ─────────────────────────────────────────────────────────────────────────
  
  // Extract trace context for propagation to worker
  const traceContext = extractTraceContext();
  
  const jobId = await aiQueue.add("process_message", {
    conversationId,
    accountId,
    inboxId,
    inboxName,
    messageText,
    contact: {
      id: contact?.id,
      name: contact?.name || contact?.identifier,
      phone: contact?.phone_number,
      email: contact?.email,
    },
    governorContext: governorResult.context,
    routing,
    timestamp: new Date().toISOString(),
    originalBody: body,
    // OpenTelemetry: Propagate trace context to worker
    _traceContext: traceContext,
    _webhookStartTime: startTime,
  }, {
    // Prioridad basada en tipo de routing
    priority: routing.priority || 50,
  });
  
  logger.info({
    conversationId,
    jobId,
    route: routing.route,
    totalDurationMs: Date.now() - startTime,
  }, "Message enqueued for processing");
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE MONITOREO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Health check
 */
chatwootRouter.get("/health", async (req, res) => {
  const queueStats = await aiQueue.getStats();
  const cacheStats = semanticCache.getStats();
  
  res.json({
    status: "healthy",
    version: "3.2.0-bot-detection-fix",
    timestamp: new Date().toISOString(),
    queue: queueStats,
    cache: cacheStats,
  });
});

/**
 * Estadísticas detalladas
 */
chatwootRouter.get("/stats", async (req, res) => {
  const queueStats = await aiQueue.getStats();
  const cacheStats = semanticCache.getStats();
  const dedupeStats = await getDedupeStats();
  
  res.json({
    queue: queueStats,
    cache: cacheStats,
    dedupe: dedupeStats,
  });
});

/**
 * Limpiar caché (admin)
 */
chatwootRouter.post("/cache/clear", adminAuthMiddleware, async (req, res) => {
  const cleared = semanticCache.clear();
  res.json({ ok: true, cleared });
});

/**
 * Pausar cola (emergencias)
 */
chatwootRouter.post("/queue/pause", adminAuthMiddleware, async (req, res) => {
  await aiQueue.pause();
  res.json({ ok: true, action: "paused" });
});

/**
 * Reanudar cola
 */
chatwootRouter.post("/queue/resume", adminAuthMiddleware, async (req, res) => {
  await aiQueue.resume();
  res.json({ ok: true, action: "resumed" });
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default chatwootRouter;
