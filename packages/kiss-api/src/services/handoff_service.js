/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HANDOFF SERVICE - Transferencia bot → humano
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja la transferencia de conversaciones del bot a agentes humanos:
 * - Detección de solicitud de handoff
 * - Mensaje al cliente
 * - Nota privada para agentes con contexto
 * - Asignación a equipo correcto
 * - Cambio de status
 * 
 * @version 1.0.0
 */

import { 
  sendChatwootMessage,
  sendPrivateNote, 
  assignToTeam,
  assignToAgent,
  toggleBotHandoff,
  updateCustomAttributes,
  addLabels,
} from "../integrations/chatwoot_client.js";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mapeo branch_id → team_id en Chatwoot
 * Configurable via env: CHATWOOT_BRANCH_TO_TEAM
 * Ejemplo: {"SAN_ANGEL":1,"ANGELOPOLIS":2,"SONATA":3}
 */
function getBranchToTeamMap() {
  try {
    return JSON.parse(process.env.CHATWOOT_BRANCH_TO_TEAM || '{}');
  } catch (e) {
    logger.warn({ err: e?.message }, "Failed to parse CHATWOOT_BRANCH_TO_TEAM");
    return {};
  }
}

/**
 * Mapeo inbox_id → team_id en Chatwoot
 * Configurable via env: CHATWOOT_INBOX_TO_TEAM
 * Ejemplo: {"1":1,"2":2,"3":3}
 */
function getInboxToTeamMap() {
  try {
    return JSON.parse(process.env.CHATWOOT_INBOX_TO_TEAM || '{}');
  } catch (e) {
    logger.warn({ err: e?.message }, "Failed to parse CHATWOOT_INBOX_TO_TEAM");
    return {};
  }
}

/**
 * Obtiene el team_id basado en branch o inbox
 */
function getTeamId({ branchId, inboxId }) {
  const branchMap = getBranchToTeamMap();
  const inboxMap = getInboxToTeamMap();
  
  // Primero intentar por branch
  if (branchId && branchMap[branchId]) {
    return branchMap[branchId];
  }
  
  // Fallback a inbox
  if (inboxId && inboxMap[String(inboxId)]) {
    return inboxMap[String(inboxId)];
  }
  
  // Default team (si existe)
  return branchMap["DEFAULT"] || inboxMap["DEFAULT"] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDOFF REASONS & MESSAGES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Razones de handoff soportadas
 */
export const HANDOFF_REASONS = {
  EXPLICIT_REQUEST: "explicit_request",      // Cliente pidió humano
  HIGH_FRUSTRATION: "high_frustration",      // Frustración detectada
  REPEATED_ERRORS: "repeated_errors",        // Bot falló varias veces
  SENSITIVE_TOPIC: "sensitive_topic",        // Tema delicado
  COMPLEX_ORDER: "complex_order",            // Pedido complejo
  PAYMENT_ISSUE: "payment_issue",            // Problema de pago
  COMPLAINT: "complaint",                    // Queja/reclamo
  TIMEOUT: "timeout",                        // Sin respuesta del bot
  ESCALATION: "escalation",                  // Escalamiento manual
  UNKNOWN: "unknown",
};

/**
 * Mensajes para el cliente según razón
 */
function getCustomerHandoffMessage(reason) {
  const messages = {
    [HANDOFF_REASONS.EXPLICIT_REQUEST]: 
      "¡Claro! Te comunico con un agente. En un momento te atienden. 🙌",
    
    [HANDOFF_REASONS.HIGH_FRUSTRATION]: 
      "Lamento la experiencia. Te paso con alguien del equipo para atenderte mejor.",
    
    [HANDOFF_REASONS.REPEATED_ERRORS]: 
      "Parece que no te estoy entendiendo bien. Deja te paso con un compañero que te ayude.",
    
    [HANDOFF_REASONS.SENSITIVE_TOPIC]: 
      "Para este tema te atenderá directamente alguien del equipo.",
    
    [HANDOFF_REASONS.COMPLEX_ORDER]: 
      "Este pedido requiere atención especial. Te paso con el equipo.",
    
    [HANDOFF_REASONS.PAYMENT_ISSUE]: 
      "Para temas de pago te conecto con un agente que te pueda ayudar mejor.",
    
    [HANDOFF_REASONS.COMPLAINT]: 
      "Lamento escuchar eso. Te comunico con alguien del equipo para resolver esto.",
    
    [HANDOFF_REASONS.TIMEOUT]: 
      "Disculpa la demora. Te conecto con un agente para atenderte más rápido.",
    
    [HANDOFF_REASONS.ESCALATION]: 
      "Te comunico con un supervisor. En breve te atienden.",
    
    [HANDOFF_REASONS.UNKNOWN]: 
      "Te comunico con un agente. En breve te atienden.",
  };
  
  return messages[reason] || messages[HANDOFF_REASONS.UNKNOWN];
}

/**
 * Traduce razón para nota interna
 */
function translateReasonForAgent(reason) {
  const translations = {
    [HANDOFF_REASONS.EXPLICIT_REQUEST]: "Cliente pidió hablar con humano",
    [HANDOFF_REASONS.HIGH_FRUSTRATION]: "Frustración detectada en conversación",
    [HANDOFF_REASONS.REPEATED_ERRORS]: "Bot no logró resolver después de varios intentos",
    [HANDOFF_REASONS.SENSITIVE_TOPIC]: "Tema sensible requiere atención humana",
    [HANDOFF_REASONS.COMPLEX_ORDER]: "Pedido complejo fuera de flujo estándar",
    [HANDOFF_REASONS.PAYMENT_ISSUE]: "Problema relacionado con pago",
    [HANDOFF_REASONS.COMPLAINT]: "Queja o reclamo del cliente",
    [HANDOFF_REASONS.TIMEOUT]: "Timeout de respuesta del bot",
    [HANDOFF_REASONS.ESCALATION]: "Escalamiento manual solicitado",
    [HANDOFF_REASONS.UNKNOWN]: "Transferencia automática",
  };
  
  return translations[reason] || reason;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta si el cliente quiere hablar con humano
 */
export function detectsHandoffRequest(text) {
  if (!text) return false;
  
  const t = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");  // Remover acentos
  
  const patterns = [
    // Solicitud directa de humano
    /\b(humano|persona|agente|asesor|ejecutivo|operador|alguien\s+real)\b/,
    
    // Quiero/necesito hablar con
    /\b(quiero|necesito|puedo)\s+(hablar\s+)?(con\s+)?(un\s+)?(humano|persona|agente|alguien)\b/,
    
    // Pásame/comunícame
    /\b(pasame|paseme|comunicame|comunicarme|conectame|conectarme)\s+(con)?\b/,
    
    // Hablar con alguien
    /\bhablar\s+(con\s+)?(alguien|una?\s+persona|humano)\b/,
    
    // No quiero bot
    /\bno\s+(quiero|me\s+gusta)\s+(el\s+)?(bot|robot|maquina|ia|ai)\b/,
    
    // Eres un robot?
    /\b(eres|es)\s+(un\s+)?(robot|bot|maquina|ia|ai)\b/,
  ];
  
  return patterns.some(p => p.test(t));
}

/**
 * Detecta frustración en el mensaje
 */
export function detectsFrustration(text) {
  if (!text) return { frustrated: false, level: 0 };
  
  const t = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  let level = 0;
  
  // Indicadores de frustración
  const frustrationPatterns = [
    { pattern: /\b(molesto|enojado|frustrado|harto|cansado)\b/, weight: 2 },
    { pattern: /\b(no\s+sirve|no\s+funciona|no\s+entiendes?)\b/, weight: 2 },
    { pattern: /\b(pesimo|horrible|terrible|malo|peor)\b/, weight: 2 },
    { pattern: /\b(ya\s+te\s+dije|te\s+lo\s+repito|otra\s+vez)\b/, weight: 1 },
    { pattern: /\b(nunca|siempre|jamas)\b/, weight: 1 },
    { pattern: /[!]{2,}/, weight: 1 },  // Múltiples exclamaciones
    { pattern: /[?]{2,}/, weight: 1 },  // Múltiples interrogaciones
    { pattern: /\b(wtf|omg|dios\s+mio)\b/, weight: 1 },
  ];
  
  for (const { pattern, weight } of frustrationPatterns) {
    if (pattern.test(t)) {
      level += weight;
    }
  }
  
  // Mayúsculas sostenidas (gritar)
  const words = text.split(/\s+/);
  const upperWords = words.filter(w => w.length > 2 && w === w.toUpperCase());
  if (upperWords.length >= 2) {
    level += 2;
  }
  
  return {
    frustrated: level >= 2,           // Más sensible (antes: 3)
    level,
    highFrustration: level >= 3,      // Escalar antes (antes: 5)
    shouldOfferHuman: level >= 2,     // NUEVO: ofrecer sin forzar
  };
}

/**
 * Detecta si es un tema sensible que requiere humano
 */
export function detectsSensitiveTopic(text) {
  if (!text) return false;
  
  const t = String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  
  const patterns = [
    // Quejas formales
    /\b(queja|reclamacion|demanda|abogado|legal)\b/,
    
    // Reembolsos
    /\b(reembolso|devolucion|devolver\s+dinero|cobro\s+indebido)\b/,
    
    // Problemas graves
    /\b(intoxicacion|enferm|alergico|hospital|doctor|medico)\b/,
    
    // Corporativo
    /\b(prensa|medios|periodista|redes\s+sociales|viral)\b/,
  ];
  
  return patterns.some(p => p.test(t));
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN HANDOFF FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicia handoff de bot a humano
 * 
 * @param {Object} options
 * @param {string} options.accountId - Chatwoot account ID
 * @param {string} options.conversationId - Conversation ID
 * @param {string} options.inboxId - Inbox ID (para determinar team)
 * @param {string} options.branchId - Branch ID (para determinar team)
 * @param {string} options.reason - Razón del handoff (de HANDOFF_REASONS)
 * @param {string} options.customerSummary - Resumen para el agente
 * @param {Object} options.contact - Info del contacto
 * @param {Object} options.orderContext - Contexto de pedido si aplica
 * @param {boolean} options.skipCustomerMessage - No enviar mensaje al cliente
 */
export async function initiateHandoff({
  accountId,
  conversationId,
  inboxId,
  branchId,
  reason = HANDOFF_REASONS.UNKNOWN,
  customerSummary,
  contact,
  orderContext,
  skipCustomerMessage = false,
}) {
  logger.info({ 
    conversationId, 
    reason, 
    branchId, 
    inboxId,
    hasContact: !!contact,
    hasOrderContext: !!orderContext,
  }, "Initiating handoff to human agent");
  
  const results = {
    success: false,
    customerMessageSent: false,
    privateNoteSent: false,
    teamAssigned: false,
    statusChanged: false,
    teamId: null,
    error: null,
  };
  
  try {
    // 1. Determinar equipo destino
    const teamId = getTeamId({ branchId, inboxId });
    results.teamId = teamId;
    
    // 2. Mensaje al cliente
    if (!skipCustomerMessage) {
      const customerMessage = getCustomerHandoffMessage(reason);
      try {
        await sendChatwootMessage({ 
          accountId, 
          conversationId, 
          content: customerMessage,
          touchAfter: true,
        });
        results.customerMessageSent = true;
      } catch (e) {
        logger.warn({ err: e?.message, conversationId }, "Failed to send customer handoff message");
      }
    }
    
    // 3. Nota privada para agentes con contexto
    const agentNote = formatAgentHandoffNote({ 
      reason, 
      customerSummary, 
      contact,
      orderContext,
      branchId,
    });
    
    try {
      await sendPrivateNote({ accountId, conversationId, content: agentNote });
      results.privateNoteSent = true;
    } catch (e) {
      logger.warn({ err: e?.message, conversationId }, "Failed to send private note");
    }
    
    // 4. Asignar a equipo si tenemos uno
    if (teamId) {
      try {
        await assignToTeam({ accountId, conversationId, teamId });
        results.teamAssigned = true;
        logger.info({ conversationId, teamId }, "Assigned to team");
      } catch (e) {
        logger.warn({ err: e?.message, conversationId, teamId }, "Failed to assign to team");
      }
    }
    
    // 5. Agregar labels para tracking
    try {
      await addLabels({ 
        accountId, 
        conversationId, 
        labels: ["bot-handoff", `reason-${reason}`],
      });
    } catch (e) {
      // Non-fatal
    }
    
    // 6. Actualizar custom attributes
    try {
      await updateCustomAttributes({
        accountId,
        conversationId,
        customAttributes: {
          handoff_reason: reason,
          handoff_at: new Date().toISOString(),
          bot_active: false,
        },
      });
    } catch (e) {
      // Non-fatal
    }
    
    // 7. Cambiar status a "open" para que aparezca en cola
    try {
      await toggleBotHandoff({ accountId, conversationId, status: "open" });
      results.statusChanged = true;
    } catch (e) {
      logger.warn({ err: e?.message, conversationId }, "Failed to toggle status");
    }
    
    results.success = results.customerMessageSent || results.privateNoteSent;
    
    logger.info({ 
      conversationId, 
      reason,
      teamId,
      results,
    }, "Handoff completed");
    
    return results;
    
  } catch (error) {
    logger.error({ err: error?.message, conversationId, reason }, "Handoff failed");
    results.error = error?.message;
    return results;
  }
}

/**
 * Formatea la nota privada para agentes
 */
function formatAgentHandoffNote({ reason, customerSummary, contact, orderContext, branchId }) {
  const lines = [];
  
  // Header
  lines.push("🤖 **[Tan • IA] HANDOFF A AGENTE**");
  lines.push("");
  
  // Razón
  lines.push(`**Razón:** ${translateReasonForAgent(reason)}`);
  lines.push("");
  
  // Info del cliente
  if (contact) {
    const contactName = contact.name || contact.identifier || "Cliente";
    const contactPhone = contact.phone_number || contact.phone || "";
    const contactEmail = contact.email || "";
    
    lines.push("**Cliente:**");
    lines.push(`  • Nombre: ${contactName}`);
    if (contactPhone) lines.push(`  • Teléfono: ${contactPhone}`);
    if (contactEmail) lines.push(`  • Email: ${contactEmail}`);
    lines.push("");
  }
  
  // Contexto de pedido
  if (orderContext) {
    lines.push("**Contexto de pedido:**");
    if (orderContext.order_id) lines.push(`  • Pedido: #${orderContext.order_id}`);
    if (orderContext.product) lines.push(`  • Producto: ${orderContext.product}`);
    if (orderContext.branch) lines.push(`  • Sucursal: ${orderContext.branch}`);
    if (orderContext.date) lines.push(`  • Fecha: ${orderContext.date}`);
    lines.push("");
  }
  
  // Sucursal
  if (branchId) {
    lines.push(`**Sucursal:** ${branchId}`);
    lines.push("");
  }
  
  // Resumen
  if (customerSummary) {
    lines.push("**Resumen de la conversación:**");
    lines.push(customerSummary);
    lines.push("");
  }
  
  // Footer
  lines.push("---");
  lines.push("_Transferido automáticamente por Tan • IA_");
  
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK HANDOFF HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handoff rápido cuando cliente pide humano
 */
export async function handoffOnExplicitRequest({ accountId, conversationId, inboxId, branchId, contact }) {
  return initiateHandoff({
    accountId,
    conversationId,
    inboxId,
    branchId,
    reason: HANDOFF_REASONS.EXPLICIT_REQUEST,
    contact,
  });
}

/**
 * Handoff por frustración
 */
export async function handoffOnFrustration({ accountId, conversationId, inboxId, branchId, contact, customerSummary }) {
  return initiateHandoff({
    accountId,
    conversationId,
    inboxId,
    branchId,
    reason: HANDOFF_REASONS.HIGH_FRUSTRATION,
    contact,
    customerSummary,
  });
}

/**
 * Handoff por errores repetidos del bot
 */
export async function handoffOnRepeatedErrors({ accountId, conversationId, inboxId, branchId, contact, errorCount }) {
  return initiateHandoff({
    accountId,
    conversationId,
    inboxId,
    branchId,
    reason: HANDOFF_REASONS.REPEATED_ERRORS,
    contact,
    customerSummary: `El bot no logró resolver después de ${errorCount} intentos.`,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Main function
  initiateHandoff,
  
  // Detection
  detectsHandoffRequest,
  detectsFrustration,
  detectsSensitiveTopic,
  
  // Quick helpers
  handoffOnExplicitRequest,
  handoffOnFrustration,
  handoffOnRepeatedErrors,
  
  // Constants
  HANDOFF_REASONS,
};
