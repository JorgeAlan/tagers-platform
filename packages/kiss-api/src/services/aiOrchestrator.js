/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AI ORCHESTRATOR - Cerebro que decide qué flujo usar
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Responsabilidad: Recibir mensajes y decidir:
 * 1. Si hay un flujo activo → delegar al handler del flujo
 * 2. Si no hay flujo → clasificar intent y decidir
 * 3. Manejar cambios de flujo, cancelaciones, handoffs
 * 
 * NO sabe de HTTP, NO sabe de Chatwoot API directamente.
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { logger } from "../utils/logger.js";
import { flowStateService, FLOWS } from "./flowStateService.js";
import { conversationHistoryService } from "./conversationHistoryService.js";
import { chatwootService } from "./chatwootService.js";
import { extractBranchHintFromInbox } from "./payloadParser.js";
import KnowledgeHub from "../knowledge-hub/index.js";

// Importar clasificadores (del cliente SOTA)
import {
  classifyChatwootIntent,
  classifyFlowControl,
  classifyOrderStep,
} from "../openai_client_tania.js";

// Importar handlers de flujos
import { orderCreateFlow } from "../flows/orderCreateFlow.js";
import { orderStatusFlow } from "../flows/orderStatusFlow.js";
import { orderModifyFlow } from "../flows/orderModifyFlow.js";
import { agenticFlow } from "../flows/agenticFlow.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const GREETING_PATTERNS = /^(hola|hi|hello|buenos?\s*(d[ií]as?|tardes?|noches?)|qu[eé]\s*tal|hey|saludos|buenas)[\s!?.]*$/i;

// ═══════════════════════════════════════════════════════════════════════════
// PROCESO PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Procesa un mensaje entrante y devuelve la respuesta
 * 
 * @param {Object} params
 * @param {string} params.conversationId
 * @param {string} params.accountId
 * @param {string} params.inboxId
 * @param {string} params.inboxName
 * @param {string} params.messageText
 * @param {Object} params.contact
 * @returns {Promise<{message: string}|null>}
 */
export async function process({
  conversationId,
  accountId,
  inboxId,
  inboxName,
  messageText,
  contact,
}) {
  const ctx = {
    conversationId,
    accountId,
    inboxId,
    inboxName,
    messageText,
    contact,
    branchHint: extractBranchHintFromInbox(inboxName),
  };
  
  logger.info({
    conversationId,
    messageLength: messageText?.length,
    inboxName,
  }, "Orchestrator: processing message");
  
  // Guardar mensaje del usuario en historial
  conversationHistoryService.addMessage(conversationId, "user", messageText);
  
  // Hidratar estado si es necesario
  await flowStateService.hydrateFromDb(conversationId);
  await chatwootService.hydrateConversationHistory({ accountId, conversationId });
  
  // 1. Verificar si es un saludo simple
  if (isGreeting(messageText)) {
    return {
      message: KnowledgeHub.getCannedMessage('greeting', {
        agent_name: KnowledgeHub.getAgentName(),
        brand_name: KnowledgeHub.getBrandName()
      }),
    };
  }
  
  // 2. Verificar si hay un flujo activo
  const activeFlow = flowStateService.getFlow(conversationId);
  
  if (activeFlow) {
    return await handleActiveFlow(ctx, activeFlow);
  }
  
  // 3. No hay flujo activo → clasificar intent
  return await handleNewMessage(ctx);
}

// ═══════════════════════════════════════════════════════════════════════════
// MANEJO DE FLUJO ACTIVO
// ═══════════════════════════════════════════════════════════════════════════

async function handleActiveFlow(ctx, activeFlow) {
  const { conversationId, messageText } = ctx;
  
  // Verificar si el usuario quiere cambiar de flujo
  const flowControlResult = await checkFlowControl(ctx, activeFlow);
  
  if (flowControlResult?.handled) {
    return flowControlResult.response;
  }
  
  // Delegar al handler del flujo activo
  switch (activeFlow.flow) {
    case FLOWS.ORDER_CREATE:
      return await orderCreateFlow.handle(ctx, activeFlow);
    
    case FLOWS.ORDER_STATUS:
      return await orderStatusFlow.handle(ctx, activeFlow);
    
    case FLOWS.ORDER_MODIFY:
      return await orderModifyFlow.handle(ctx, activeFlow);
    
    case FLOWS.LEAD:
      // TODO: Implementar leadFlow
      flowStateService.clearFlow(conversationId);
      return { message: "Gracias por tu interés. Un ejecutivo se pondrá en contacto contigo pronto." };
    
    default:
      logger.warn({ flow: activeFlow.flow, conversationId }, "Unknown flow type");
      flowStateService.clearFlow(conversationId);
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTROL DE FLUJO (cambios, cancelaciones, handoff)
// ═══════════════════════════════════════════════════════════════════════════

async function checkFlowControl(ctx, activeFlow) {
  const { conversationId, messageText, accountId } = ctx;
  
  // Bypass para mensajes claramente dentro del dominio del flujo actual
  if (shouldBypassFlowControl(messageText, activeFlow)) {
    return { handled: false };
  }
  
  try {
    const instructions = `Detecta si el usuario quiere cambiar de flujo, cancelar, o hablar con un humano.
El usuario está en el flujo: ${activeFlow.flow}, paso: ${activeFlow.step}`;
    
    const result = await classifyFlowControl({
      instructions,
      inputObject: {
        active_flow: activeFlow,
        message_text: messageText,
      },
    });
    
    const { action, target_flow, confidence } = result;
    
    // Handoff a humano
    if (action === "handoff_human" && confidence >= 0.7) {
      flowStateService.clearFlow(conversationId);
      await chatwootService.toggleStatus({ accountId, conversationId, status: "open" });
      return {
        handled: true,
        response: { message: "Claro. Te comunico con un asesor para ayudarte." },
      };
    }
    
    // Cancelar flujo
    if (action === "cancel_flow" && confidence >= 0.7) {
      flowStateService.clearFlow(conversationId);
      return {
        handled: true,
        response: { message: "Listo, lo dejamos aquí. ¿Te ayudo con algo más?" },
      };
    }
    
    // Cambiar de flujo
    if (action === "switch_flow" && target_flow && target_flow !== activeFlow.flow && confidence >= 0.65) {
      logger.info({ conversationId, from: activeFlow.flow, to: target_flow }, "Switching flow");
      flowStateService.clearFlow(conversationId);
      
      // Iniciar nuevo flujo
      if ([FLOWS.ORDER_CREATE, FLOWS.ORDER_STATUS, FLOWS.ORDER_MODIFY].includes(target_flow)) {
        const newState = flowStateService.createOrderCreateInitialState();
        newState.flow = target_flow;
        flowStateService.setFlow(conversationId, newState);
        
        const ack = getFlowSwitchAck(activeFlow.flow, target_flow);
        return {
          handled: true,
          response: { message: ack },
        };
      }
    }
  } catch (error) {
    logger.warn({ err: error?.message, conversationId }, "Flow control check failed");
  }
  
  return { handled: false };
}

function shouldBypassFlowControl(messageText, activeFlow) {
  const normalized = messageText.toLowerCase();
  
  // Palabras que indican que el usuario sigue en el flujo de pedido
  const orderDomainWords = /\b(rosca|roscas|reyes|sabor|nutella|lotus|dulce|sucursal|fecha|hoy|mañana|pedido|cantidad|si|sí|no|la\s+\d|opción|confirmar)\b/;
  
  // Palabras que indican cambio de tema explícito
  const topicSwitchWords = /\b(cambio de tema|otra cosa|olvida|olvidalo|cancelar|cancela|ya no|humano|persona|agente)\b/;
  
  if (activeFlow.flow === FLOWS.ORDER_CREATE && orderDomainWords.test(normalized) && !topicSwitchWords.test(normalized)) {
    return true;
  }
  
  return false;
}

function getFlowSwitchAck(fromFlow, toFlow) {
  switch (toFlow) {
    case FLOWS.ORDER_CREATE:
      return "Entendido. Entonces hacemos un pedido nuevo.";
    case FLOWS.ORDER_MODIFY:
      return "Claro. Te ayudo a cambiar tu pedido.";
    case FLOWS.ORDER_STATUS:
      return "Perfecto. Revisamos el estatus de tu pedido.";
    default:
      return "Entendido, cambio de tema.";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MANEJO DE MENSAJE NUEVO (sin flujo activo)
// ═══════════════════════════════════════════════════════════════════════════

async function handleNewMessage(ctx) {
  const { conversationId, messageText, accountId } = ctx;
  
  // Verificar si el usuario pide un humano sin flujo activo
  const humanRequest = await checkHumanRequestWithoutFlow(ctx);
  if (humanRequest?.handled) {
    return humanRequest.response;
  }
  
  // Clasificar intent
  const intent = await classifyIntent(ctx);
  
  logger.info({
    conversationId,
    intent: intent?.intent,
    needsClarification: intent?.needs_clarification,
  }, "Intent classified");
  
  // Si necesita clarificación, pedirla
  if (intent?.needs_clarification && intent?.clarification_question) {
    return { message: intent.clarification_question };
  }
  
  // Si hay respuesta directa, devolverla
  if (intent?.customer_direct_answer) {
    return { message: intent.customer_direct_answer };
  }
  
  // Routing por intent
  switch (intent?.intent) {
    case "ORDER_CREATE":
    case "ORDER_STATUS":
    case "ORDER_MODIFY":
      return await startOrderFlow(ctx, intent);
    
    case "CAREERS":
      return {
        message: "¡Qué gusto que te interesa trabajar con nosotros! Puedes ver las vacantes disponibles aquí: https://tagers2.buk.mx/trabaja-con-nosotros",
      };
    
    case "RESERVATION_LINK":
      return {
        message: intent.reservation_link
          ? `Puedes reservar aquí: ${intent.reservation_link}`
          : "Puedes hacer tu reservación en OpenTable. ¿En qué sucursal te gustaría reservar?",
      };
    
    case "SENTIMENT_CRISIS":
      // Escalar a humano
      await chatwootService.toggleStatus({ accountId, conversationId, status: "open" });
      return {
        message: "Entiendo tu frustración y lo lamento mucho. Te comunico con un gerente para atenderte personalmente.",
      };
    
    default:
      // Flujo agéntico para todo lo demás
      return await agenticFlow.handle(ctx, intent);
  }
}

async function checkHumanRequestWithoutFlow(ctx) {
  const { conversationId, messageText, accountId } = ctx;
  const normalized = messageText.toLowerCase();
  
  const humanPatterns = /\b(humano|persona|agente|asesor|ejecutivo|hablar con|pásame)\b/;
  
  if (humanPatterns.test(normalized)) {
    await chatwootService.toggleStatus({ accountId, conversationId, status: "open" });
    return {
      handled: true,
      response: { message: "Perfecto. Te paso con un asesor por aquí mismo. En un momento te atienden." },
    };
  }
  
  return { handled: false };
}

async function classifyIntent(ctx) {
  const { messageText, conversationId, inboxName, branchHint } = ctx;
  
  const history = conversationHistoryService.getHistoryForLLM(conversationId, 10);
  
  // Cargar prompt del router
  const instructions = getRouterInstructions();
  
  try {
    return await classifyChatwootIntent({
      instructions,
      inputObject: {
        message_text: messageText,
        conversation_id: conversationId,
        inbox_name: inboxName,
        branch_hint: branchHint?.branch_id || null,
        conversation_history: history.map(m => ({
          role: m.role === "user" ? "cliente" : "ana",
          content: m.content,
        })),
      },
    });
  } catch (error) {
    logger.error({ err: error?.message, conversationId }, "Intent classification failed");
    return { intent: "OTHER", needs_clarification: false };
  }
}

async function startOrderFlow(ctx, intent) {
  const { conversationId } = ctx;
  
  const initialState = flowStateService.createOrderCreateInitialState();
  initialState.flow = intent.intent; // ORDER_CREATE, ORDER_STATUS, etc.
  
  if (intent.order_context) {
    initialState.draft = {
      ...initialState.draft,
      ...intent.order_context,
    };
  }
  
  flowStateService.setFlow(conversationId, initialState);
  
  // Delegar al handler
  switch (intent.intent) {
    case FLOWS.ORDER_CREATE:
      return await orderCreateFlow.handle(ctx, initialState);
    case FLOWS.ORDER_STATUS:
      return await orderStatusFlow.handle(ctx, initialState);
    case FLOWS.ORDER_MODIFY:
      return await orderModifyFlow.handle(ctx, initialState);
    default:
      return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function isGreeting(text) {
  return GREETING_PATTERNS.test(String(text || "").trim());
}

function getRouterInstructions() {
  // Simplificado - en producción cargar desde archivo
  return `Eres un router de intención para Tagers café.

Clasifica la intención del mensaje del cliente:
- PHYSICAL_CHECK: preguntas sobre estado en tiempo real
- ORDER_CREATE: quiere hacer un pedido de rosca
- ORDER_STATUS: pregunta por estado de un pedido existente
- RESERVATION_LINK: quiere reservar mesa
- GENERAL_INFO: saludos, preguntas generales
- CAREERS: empleo/vacantes
- SENTIMENT_CRISIS: queja urgente
- OTHER: todo lo demás

Si falta información crítica, marca needs_clarification=true.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const aiOrchestrator = {
  process,
};

export default aiOrchestrator;
