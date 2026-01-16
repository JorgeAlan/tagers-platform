/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENT GATING - Verificación de agente antes de responder
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Determina si el bot debe responder o ceder al agente humano.
 * Evita que el bot interfiera cuando un agente está manejando la conversación.
 * 
 * CÓMO USAR EN chatwoot.js:
 * 
 * 1. Agregar import al inicio:
 *    import { shouldBotRespond } from "../services/agent_gating.js";
 * 
 * 2. En processChatwootEvent(), después de extraer datos y antes de procesar:
 * 
 *    const { respond, reason } = await shouldBotRespond({ 
 *      accountId, 
 *      conversationId, 
 *      conversation 
 *    });
 *    
 *    if (!respond) {
 *      logger.info({ conversationId, reason }, "Bot deferring to human agent");
 *      return;
 *    }
 * 
 * @version 1.0.0
 */

import { getConversation } from "../integrations/chatwoot_client.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Minutos sin actividad de agente antes de que bot retome
 * Configurable via env: BOT_AGENT_TIMEOUT_MINUTES
 */
function getAgentTimeoutMinutes() {
  return parseInt(process.env.BOT_AGENT_TIMEOUT_MINUTES || "5", 10);
}

/**
 * Si está habilitada la verificación de agente
 * Configurable via env: BOT_AGENT_GATING_ENABLED
 */
function isAgentGatingEnabled() {
  const val = process.env.BOT_AGENT_GATING_ENABLED;
  if (val === undefined) return true; // Enabled by default
  return val === "true" || val === "1";
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE REASONS
// ═══════════════════════════════════════════════════════════════════════════

export const GATING_REASONS = {
  // Bot DEBE responder
  NO_ASSIGNEE: "no_assignee",           // No hay agente asignado
  GATING_DISABLED: "gating_disabled",   // Verificación deshabilitada
  CONV_FETCH_FAILED: "conv_fetch_failed", // No se pudo obtener info
  AGENT_NEVER_ACTIVE: "agent_never_active", // Agente nunca ha interactuado
  AGENT_TIMEOUT: "agent_timeout",       // Agente no responde en X minutos
  BOT_CONVERSATION: "bot_conversation", // Conversación marcada como bot
  
  // Bot NO debe responder
  AGENT_ACTIVE: "agent_active",         // Agente está activo
  AGENT_RECENT: "agent_recent",         // Agente respondió recientemente
  HUMAN_HANDLING: "human_handling",     // Marcado como manejo humano
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si el bot debe responder o ceder al agente humano
 * 
 * @param {Object} options
 * @param {string} options.accountId - Chatwoot account ID
 * @param {string} options.conversationId - Conversation ID
 * @param {Object} options.conversation - Payload de conversación del webhook
 * @returns {Object} { respond: boolean, reason: string, assigneeId?: number }
 */
export async function shouldBotRespond({ accountId, conversationId, conversation }) {
  // Si la verificación está deshabilitada, siempre responder
  if (!isAgentGatingEnabled()) {
    return { respond: true, reason: GATING_REASONS.GATING_DISABLED };
  }
  
  // Extraer assignee del payload del webhook
  const assigneeId = conversation?.assignee_id || 
                     conversation?.meta?.assignee?.id || 
                     conversation?.assignee?.id ||
                     null;
  
  // Verificar custom_attributes para ver si está marcado como bot o humano
  const customAttrs = conversation?.custom_attributes || {};
  
  if (customAttrs.bot_active === true) {
    return { respond: true, reason: GATING_REASONS.BOT_CONVERSATION };
  }
  
  if (customAttrs.human_handling === true) {
    return { 
      respond: false, 
      reason: GATING_REASONS.HUMAN_HANDLING, 
      assigneeId 
    };
  }
  
  // Verificar si un agente respondió recientemente (via custom_attributes)
  // Esto funciona incluso sin assignee - si un agente respondió, el bot cede
  if (customAttrs.last_agent_reply_at) {
    const lastReply = new Date(customAttrs.last_agent_reply_at).getTime();
    const now = Date.now();
    const minutesSince = (now - lastReply) / 60000;
    const timeoutMinutes = getAgentTimeoutMinutes();
    
    if (minutesSince < timeoutMinutes) {
      logger.info({ 
        conversationId, 
        minutesSinceAgentReply: minutesSince.toFixed(1),
        timeoutMinutes,
      }, "Agent replied recently, bot will NOT respond");
      
      return { 
        respond: false, 
        reason: GATING_REASONS.AGENT_RECENT, 
        minutesSinceAgent: minutesSince,
      };
    }
  }
  
  // Si no hay agente asignado y no hay respuesta reciente de agente, bot responde
  if (!assigneeId) {
    return { respond: true, reason: GATING_REASONS.NO_ASSIGNEE };
  }
  
  // Obtener info actualizada de la conversación
  const convInfo = await getConversation({ accountId, conversationId });
  
  if (!convInfo) {
    // No pudimos verificar, mejor responder para no dejar al cliente sin respuesta
    logger.warn({ conversationId, assigneeId }, "Could not fetch conversation, bot will respond");
    return { respond: true, reason: GATING_REASONS.CONV_FETCH_FAILED };
  }
  
  // Verificar última actividad del agente
  const agentLastSeen = getAgentLastActivity(convInfo);
  
  if (!agentLastSeen) {
    // Agente asignado pero nunca ha interactuado
    return { 
      respond: true, 
      reason: GATING_REASONS.AGENT_NEVER_ACTIVE,
      assigneeId,
    };
  }
  
  // Calcular tiempo desde última actividad
  const now = Date.now();
  const lastSeenMs = new Date(agentLastSeen).getTime();
  const minutesSince = (now - lastSeenMs) / 60000;
  const timeoutMinutes = getAgentTimeoutMinutes();
  
  if (minutesSince > timeoutMinutes) {
    logger.info({ 
      conversationId, 
      assigneeId, 
      minutesSinceAgent: minutesSince.toFixed(1),
      timeoutMinutes,
    }, "Agent timeout exceeded, bot will respond");
    
    return { 
      respond: true, 
      reason: GATING_REASONS.AGENT_TIMEOUT,
      assigneeId,
      minutesSinceAgent: minutesSince,
    };
  }
  
  // Agente activo recientemente → no interferir
  logger.info({ 
    conversationId, 
    assigneeId, 
    minutesSinceAgent: minutesSince.toFixed(1),
    assigneeName: convInfo?.assignee?.name,
  }, "Agent recently active, bot will NOT respond");
  
  return { 
    respond: false, 
    reason: GATING_REASONS.AGENT_ACTIVE, 
    assigneeId,
    assigneeName: convInfo?.assignee?.name,
    minutesSinceAgent: minutesSince,
  };
}

/**
 * Extrae la última actividad del agente de la info de conversación
 */
function getAgentLastActivity(convInfo) {
  // Intentar diferentes campos que Chatwoot puede usar
  return convInfo?.agent_last_seen_at || 
         convInfo?.assignee?.last_activity_at ||
         convInfo?.last_activity_at ||
         convInfo?.messages?.[0]?.created_at || // Último mensaje
         null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si un agente específico está activo
 */
export async function isAgentActive({ accountId, conversationId, agentId }) {
  const result = await shouldBotRespond({ 
    accountId, 
    conversationId, 
    conversation: { assignee_id: agentId } 
  });
  
  return !result.respond;
}

/**
 * Obtiene info del agente asignado
 */
export async function getAssignedAgent({ accountId, conversationId }) {
  const convInfo = await getConversation({ accountId, conversationId });
  
  if (!convInfo?.assignee) {
    return null;
  }
  
  return {
    id: convInfo.assignee.id,
    name: convInfo.assignee.name,
    email: convInfo.assignee.email,
    available: convInfo.assignee.availability_status === "online",
    lastActivity: getAgentLastActivity(convInfo),
  };
}

/**
 * Fuerza que el bot tome el control (útil para testing o override manual)
 */
export function forceBotResponse() {
  return { respond: true, reason: "forced" };
}

/**
 * Fuerza que el bot NO responda (útil para testing o override manual)
 */
export function forceAgentResponse(assigneeId) {
  return { respond: false, reason: "forced", assigneeId };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  shouldBotRespond,
  isAgentActive,
  getAssignedAgent,
  forceBotResponse,
  forceAgentResponse,
  GATING_REASONS,
};
