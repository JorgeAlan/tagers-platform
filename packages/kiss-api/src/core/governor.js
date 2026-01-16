/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GOVERNOR - Motor de Decisión Central
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El Governor es el "portero" del sistema. Evalúa TODAS las condiciones
 * ANTES de que el bot procese o responda. Esto separa las REGLAS DE NEGOCIO
 * del código HTTP/webhook.
 * 
 * Responsabilidades:
 * - ¿Debo responder este mensaje? (spam, duplicado, bot, agente activo)
 * - ¿En qué horario estamos? (fuera de servicio)
 * - ¿El cliente está en blacklist?
 * - ¿Es un mensaje válido para procesar?
 * 
 * IMPORTANTE: Este archivo NO llama a OpenAI ni envía mensajes.
 * Solo DECIDE si se debe procesar.
 * 
 * v1.1.0 - Rate limiting y deduplicación distribuida con Redis
 * 
 * @version 1.1.0
 */

import { logger } from "../utils/logger.js";
import { shouldBotRespond, GATING_REASONS } from "../services/agent_gating.js";
import { getFlow } from "../services/flowStateService.js";
import { config as appConfig } from "../config.js";
import { isBlocked as checkBlacklistService } from "./blacklist.js";
import { 
  checkRateLimit, 
  checkDuplicate,
  getStats as getRateLimiterStats 
} from "./distributedRateLimiter.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const governorConfig = {
  // Horario de servicio (24h format, timezone del servidor)
  serviceHours: {
    enabled: process.env.GOVERNOR_SERVICE_HOURS_ENABLED === "true",
    start: parseInt(process.env.GOVERNOR_SERVICE_HOUR_START || "7", 10),
    end: parseInt(process.env.GOVERNOR_SERVICE_HOUR_END || "22", 10),
  },
  
  // Anti-spam
  spam: {
    minMessageLength: 1,
    maxMessageLength: 4000,
  },
  
  // Rate limiting (configurado en distributedRateLimiter.js)
  rateLimit: {
    enabled: process.env.GOVERNOR_RATE_LIMIT_ENABLED !== "false",
  },
  
  // Deduplicación (configurado en distributedRateLimiter.js)
  dedupe: {
    enabled: process.env.GOVERNOR_DEDUPE_ENABLED !== "false",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// DECISION REASONS
// ═══════════════════════════════════════════════════════════════════════════

export const GOVERNOR_DECISIONS = {
  // Procesar
  PROCEED: "proceed",
  
  // No procesar
  SKIP_OUTGOING: "skip_outgoing",           // Mensaje saliente (del bot)
  SKIP_PRIVATE: "skip_private",             // Nota privada
  SKIP_AGENT_ACTIVE: "skip_agent_active",   // Agente humano activo
  SKIP_OUTSIDE_HOURS: "skip_outside_hours", // Fuera de horario
  SKIP_SPAM: "skip_spam",                   // Spam detectado
  SKIP_DUPLICATE: "skip_duplicate",         // Mensaje duplicado
  SKIP_RATE_LIMITED: "skip_rate_limited",   // Rate limit excedido
  SKIP_INVALID: "skip_invalid",             // Payload inválido
  SKIP_EMPTY: "skip_empty",                 // Mensaje vacío
  SKIP_BLACKLIST: "skip_blacklist",         // Cliente en blacklist
  SKIP_BLACKLISTED: "skip_blacklisted",     // Cliente bloqueado (alias)
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EVALUATION FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evalúa si el bot debe procesar este mensaje
 * 
 * @param {Object} payload - Payload del webhook de Chatwoot
 * @returns {Object} { shouldProcess: boolean, decision: string, context: Object }
 */
export async function evaluate(payload) {
  const startTime = Date.now();
  
  // Extraer datos del payload
  const context = extractContext(payload);
  
  // Pipeline de evaluación (orden importa)
  const checks = [
    checkValidPayload,
    checkMessageType,
    checkMessageContent,
    checkDuplicateDistributed,  // ← Ahora usa Redis
    checkRateLimitDistributed,  // ← Ahora usa Redis
    checkServiceHours,
    checkAgentActive,
    checkBlacklist,
  ];
  
  for (const check of checks) {
    const result = await check(context, payload);
    
    if (!result.pass) {
      logger.info({
        conversationId: context.conversationId,
        decision: result.decision,
        reason: result.reason,
        source: result.source, // 'redis' o 'memory'
        durationMs: Date.now() - startTime,
      }, "Governor: " + result.decision);
      
      return {
        shouldProcess: false,
        decision: result.decision,
        reason: result.reason,
        context,
      };
    }
  }
  
  // Enriquecer contexto con estado de flujo
  context.currentFlow = getFlow(context.conversationId);
  context.hasActiveFlow = context.currentFlow !== null;
  
  logger.info({
    conversationId: context.conversationId,
    decision: GOVERNOR_DECISIONS.PROCEED,
    hasActiveFlow: context.hasActiveFlow,
    flowType: context.currentFlow?.flow,
    flowStep: context.currentFlow?.step,
    durationMs: Date.now() - startTime,
  }, "Governor: PROCEED");
  
  return {
    shouldProcess: true,
    decision: GOVERNOR_DECISIONS.PROCEED,
    context,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT EXTRACTION
// ═══════════════════════════════════════════════════════════════════════════

function extractContext(payload) {
  const message = payload?.message || payload;
  const conversation = payload?.conversation || {};
  const contact = payload?.sender || conversation?.contact || {};
  const account = payload?.account || {};
  const inbox = payload?.inbox || conversation?.inbox || {};
  
  return {
    // IDs
    conversationId: conversation?.id || payload?.conversation_id,
    messageId: message?.id,
    accountId: account?.id,
    inboxId: inbox?.id,
    contactId: contact?.id,
    
    // Message
    messageText: message?.content || "",
    messageType: message?.message_type, // incoming, outgoing, activity
    isPrivate: message?.private === true,
    
    // Contact
    contactName: contact?.name || contact?.identifier,
    contactPhone: contact?.phone_number || contact?.phone,
    contactEmail: contact?.email,
    
    // Conversation state
    assigneeId: conversation?.assignee_id || conversation?.meta?.assignee?.id,
    conversationStatus: conversation?.status,
    
    // Meta
    timestamp: new Date().toISOString(),
    event: payload?.event,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INDIVIDUAL CHECKS
// ═══════════════════════════════════════════════════════════════════════════

function checkValidPayload(context) {
  if (!context.conversationId) {
    return { pass: false, decision: GOVERNOR_DECISIONS.SKIP_INVALID, reason: "No conversation ID" };
  }
  return { pass: true };
}

function checkMessageType(context) {
  // Ignorar mensajes salientes (del bot)
  if (context.messageType === "outgoing") {
    return { pass: false, decision: GOVERNOR_DECISIONS.SKIP_OUTGOING, reason: "Outgoing message" };
  }
  
  // Ignorar notas privadas
  if (context.isPrivate) {
    return { pass: false, decision: GOVERNOR_DECISIONS.SKIP_PRIVATE, reason: "Private note" };
  }
  
  // Ignorar activity messages
  if (context.messageType === "activity") {
    return { pass: false, decision: GOVERNOR_DECISIONS.SKIP_INVALID, reason: "Activity message" };
  }
  
  return { pass: true };
}

function checkMessageContent(context) {
  const text = context.messageText || "";
  
  // Mensaje vacío
  if (text.trim().length < governorConfig.spam.minMessageLength) {
    return { pass: false, decision: GOVERNOR_DECISIONS.SKIP_EMPTY, reason: "Empty message" };
  }
  
  // Mensaje muy largo (posible spam)
  if (text.length > governorConfig.spam.maxMessageLength) {
    return { pass: false, decision: GOVERNOR_DECISIONS.SKIP_SPAM, reason: "Message too long" };
  }
  
  return { pass: true };
}

/**
 * Check de duplicados usando Redis (distribuido)
 */
async function checkDuplicateDistributed(context) {
  if (!governorConfig.dedupe.enabled) return { pass: true };
  
  try {
    const result = await checkDuplicate(context.conversationId, context.messageText);
    
    if (result.isDuplicate) {
      return { 
        pass: false, 
        decision: GOVERNOR_DECISIONS.SKIP_DUPLICATE, 
        reason: "Duplicate message",
        source: result.source, // 'redis' o 'memory'
      };
    }
    
    return { pass: true, source: result.source };
  } catch (err) {
    // Si falla, dejamos pasar (fail-open)
    logger.warn({ err: err?.message }, "Dedupe check failed, allowing message");
    return { pass: true };
  }
}

/**
 * Check de rate limit usando Redis (distribuido)
 */
async function checkRateLimitDistributed(context) {
  if (!governorConfig.rateLimit.enabled) return { pass: true };
  
  try {
    const result = await checkRateLimit(context.conversationId);
    
    if (!result.allowed) {
      return { 
        pass: false, 
        decision: GOVERNOR_DECISIONS.SKIP_RATE_LIMITED, 
        reason: "Rate limit exceeded: " + result.count + "/" + result.limit + " per minute",
        source: result.source, // 'redis' o 'memory'
        remaining: result.remaining,
        resetAt: result.resetAt,
      };
    }
    
    return { pass: true, source: result.source, remaining: result.remaining };
  } catch (err) {
    // Si falla, dejamos pasar (fail-open)
    logger.warn({ err: err?.message }, "Rate limit check failed, allowing message");
    return { pass: true };
  }
}

function checkServiceHours(context) {
  if (!governorConfig.serviceHours.enabled) return { pass: true };
  
  const now = new Date();
  const hour = now.getHours();
  
  if (hour < governorConfig.serviceHours.start || hour >= governorConfig.serviceHours.end) {
    return { 
      pass: false, 
      decision: GOVERNOR_DECISIONS.SKIP_OUTSIDE_HOURS, 
      reason: "Outside service hours (" + governorConfig.serviceHours.start + ":00 - " + governorConfig.serviceHours.end + ":00)" 
    };
  }
  
  return { pass: true };
}

async function checkAgentActive(context, payload) {
  // Usar agent_gating service
  const gatingResult = await shouldBotRespond({
    accountId: context.accountId,
    conversationId: context.conversationId,
    conversation: payload?.conversation,
  });
  
  if (!gatingResult.respond) {
    return { 
      pass: false, 
      decision: GOVERNOR_DECISIONS.SKIP_AGENT_ACTIVE, 
      reason: "Agent active: " + gatingResult.reason,
      assigneeId: gatingResult.assigneeId,
    };
  }
  
  return { pass: true };
}

async function checkBlacklist(context) {
  const { contact, conversationId } = context;
  
  try {
    const result = await checkBlacklistService({
      phone: contact?.phone_number,
      email: contact?.email,
      contactId: contact?.id,
      conversationId,
    });
    
    if (result.blocked) {
      return {
        pass: false,
        decision: GOVERNOR_DECISIONS.SKIP_BLACKLISTED,
        reason: result.reason || "blacklisted",
        source: result.source,
      };
    }
  } catch (err) {
    // Si falla el check, dejamos pasar (fail-open)
    logger.warn({ err: err?.message }, "Blacklist check failed, allowing message");
  }
  
  return { pass: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS & DIAGNOSTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas del Governor y Rate Limiter
 */
export async function getGovernorStats() {
  const rateLimiterStats = await getRateLimiterStats();
  
  return {
    config: {
      serviceHoursEnabled: governorConfig.serviceHours.enabled,
      serviceHours: governorConfig.serviceHours.start + ":00 - " + governorConfig.serviceHours.end + ":00",
      rateLimitEnabled: governorConfig.rateLimit.enabled,
      dedupeEnabled: governorConfig.dedupe.enabled,
    },
    rateLimiter: rateLimiterStats,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const governor = {
  evaluate,
  getGovernorStats,
  GOVERNOR_DECISIONS,
};

export default governor;
