/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DISPATCHER - Router de Flujos y Procesamiento
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El Dispatcher decide CÓMO procesar el mensaje después de que el Governor
 * aprobó que se debe procesar.
 * 
 * Responsabilidades:
 * - ¿Hay un flujo activo? → Continuar flujo
 * - ¿Es intent nuevo? → Clasificar y enrutar
 * - ¿Requiere IA lenta? → Enviar a queue async
 * - ¿Es conversación simple? → Respuesta directa
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { getFlow, setFlow, clearFlow, FLOWS } from "../services/flowStateService.js";
import { detectsHandoffRequest, detectsFrustration } from "../services/handoff_service.js";
import { config } from "../config.js";
import { getConfig } from "../config-hub/sync-service.js";

// ═══════════════════════════════════════════════════════════════════════════
// ROUTING TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const ROUTE_TYPES = {
  // Flujos estructurados
  FLOW_ORDER_CREATE: "flow_order_create",
  FLOW_ORDER_STATUS: "flow_order_status",
  FLOW_ORDER_MODIFY: "flow_order_modify",
  FLOW_RESERVATION: "flow_reservation",
  
  // Procesamiento especial
  HANDOFF_HUMAN: "handoff_human",
  ESCALATE_FRUSTRATION: "escalate_frustration",
  
  // IA
  AGENTIC_FLOW: "agentic_flow",        // Flow complejo con Analyze→Retrieve→Reason→Validate
  SIMPLE_REPLY: "simple_reply",         // Respuesta simple sin flujo
  DEEP_THINK: "deep_think",             // Requiere modelo lento (queue async)
  
  // Acciones directas
  GREETING: "greeting",
  FAQ: "faq",
  
  // Errores
  UNKNOWN: "unknown",
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ROUTING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// TRIVIAL RESPONSES (Fast Path - No IA needed)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene respuesta del Config Hub (canned responses) por trigger
 * @param {string} trigger - Tipo de trigger: 'greeting', 'thanks', 'farewell', 'cancel', etc.
 * @returns {string|null} Respuesta o null si no existe
 */
function getCannedResponse(trigger) {
  try {
    const hubConfig = getConfig();
    if (!hubConfig?.canned) return null;
    
    const canned = hubConfig.canned.find(c => 
      c.enabled && 
      c.trigger?.toLowerCase() === trigger.toLowerCase()
    );
    
    return canned?.response || null;
  } catch {
    return null;
  }
}

/**
 * Obtiene el saludo dinámico del Config Hub
 */
function getDynamicGreeting() {
  try {
    const hubConfig = getConfig();
    
    // Intentar canned response primero
    const cannedGreeting = getCannedResponse('greeting');
    if (cannedGreeting) return cannedGreeting;
    
    // Fallback a persona.greeting
    if (hubConfig?.persona?.greeting) {
      return hubConfig.persona.greeting;
    }
    
    // Fallback final
    return null;
  } catch {
    return null;
  }
}

/**
 * Obtiene despedida dinámica del Config Hub
 */
function getDynamicFarewell() {
  try {
    const hubConfig = getConfig();
    
    const cannedFarewell = getCannedResponse('farewell');
    if (cannedFarewell) return cannedFarewell;
    
    if (hubConfig?.persona?.farewell) {
      return hubConfig.persona.farewell;
    }
    
    return null;
  } catch {
    return null;
  }
}

/**
 * Detecta y responde a mensajes triviales sin usar IA
 * Usa datos del Config Hub cuando están disponibles
 */
function getTrivialResponse(text, context = {}) {
  const t = (text || "").toLowerCase().trim();
  const { hasActiveFlow } = context;
  
  // ─────────────────────────────────────────────────────────────────────────
  // SALUDOS puros (sin contenido adicional)
  // ─────────────────────────────────────────────────────────────────────────
  if (/^(hola|hi|hey|buenos?\s*(dias?|tardes?|noches?)|que\s*tal|saludos|ola|buenas|wenas)[\s!.,?]*$/i.test(t)) {
    // Intentar obtener saludo del Config Hub
    const dynamicGreeting = getDynamicGreeting();
    
    return {
      response: dynamicGreeting || "¡Hola! 👋 Soy Tan • IA de Tagers. ¿En qué te puedo ayudar?",
      clearFlow: false,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // AGRADECIMIENTOS
  // ─────────────────────────────────────────────────────────────────────────
  if (/^(gracias|muchas\s*gracias|thanks|thx|grax|mil\s*gracias)[\s!.,]*$/i.test(t)) {
    const cannedThanks = getCannedResponse('thanks');
    
    if (cannedThanks) {
      return { response: cannedThanks, clearFlow: false };
    }
    
    // Fallback con variación
    const fallbackResponses = [
      "¡Con gusto! ¿Te ayudo con algo más? 😊",
      "¡Para eso estamos! ¿Algo más?",
      "¡De nada! ¿Necesitas algo más?",
    ];
    return {
      response: fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)],
      clearFlow: false,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // DESPEDIDAS
  // ─────────────────────────────────────────────────────────────────────────
  if (/^(adios|bye|hasta\s*luego|nos\s*vemos|chao|ciao|bye\s*bye)[\s!.,]*$/i.test(t)) {
    const dynamicFarewell = getDynamicFarewell();
    
    return {
      response: dynamicFarewell || "¡Hasta pronto! Que tengas excelente día. 👋",
      clearFlow: true,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // CANCELAR (solo si hay flujo activo)
  // ─────────────────────────────────────────────────────────────────────────
  if (hasActiveFlow && /^(cancelar|salir|no\s*quiero|olvidalo|olvídalo|dejalo|déjalo|ya\s*no)[\s!.,]*$/i.test(t)) {
    const cannedCancel = getCannedResponse('cancel');
    
    return {
      response: cannedCancel || "Entendido, cancelé el proceso. ¿Hay algo más en que te pueda ayudar?",
      clearFlow: true,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // "NO" simple sin flujo activo
  // ─────────────────────────────────────────────────────────────────────────
  if (!hasActiveFlow && /^no[\s!.,]*$/i.test(t)) {
    return {
      response: "Ok, ¿hay algo en que te pueda ayudar?",
      clearFlow: false,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // EMOJIS solos (👍, ❤️, 😊, etc.) - solo si no hay flujo activo
  // ─────────────────────────────────────────────────────────────────────────
  if (!hasActiveFlow && /^[\p{Emoji}\s]+$/u.test(t) && t.length < 10) {
    return {
      response: "😊 ¿Te ayudo con algo?",
      clearFlow: false,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // "?" solo
  // ─────────────────────────────────────────────────────────────────────────
  if (/^\?+$/.test(t)) {
    return {
      response: "¿En qué te puedo ayudar? Puedo ayudarte con pedidos, consultas de pedidos existentes, o resolver dudas sobre Tagers.",
      clearFlow: false,
    };
  }
  
  return null; // No es trivial, usar flujo normal
}

/**
 * Determina cómo procesar el mensaje
 * 
 * @param {Object} context - Contexto enriquecido del Governor
 * @returns {Object} { route: string, handler: string, priority: number, async: boolean, meta: Object }
 */
export async function route(context) {
  const { messageText, conversationId, currentFlow, hasActiveFlow } = context;
  const text = (messageText || "").trim().toLowerCase();
  
  // ─────────────────────────────────────────────────────────────────────────
  // 1. PRIORIDAD MÁXIMA: Handoff explícito
  // ─────────────────────────────────────────────────────────────────────────
  if (detectsHandoffRequest(messageText)) {
    return {
      route: ROUTE_TYPES.HANDOFF_HUMAN,
      handler: "handoff_service.initiateHandoff",
      priority: 100,
      async: false,
      meta: { reason: "explicit_request" },
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 2. PRIORIDAD ALTA: Frustración detectada
  // ─────────────────────────────────────────────────────────────────────────
  const frustration = detectsFrustration(messageText);
  if (frustration.highFrustration) {
    return {
      route: ROUTE_TYPES.ESCALATE_FRUSTRATION,
      handler: "handoff_service.handoffOnFrustration",
      priority: 90,
      async: false,
      meta: { frustrationLevel: frustration.level },
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 2.5 FAST PATH: Respuestas triviales sin IA
  // ─────────────────────────────────────────────────────────────────────────
  const trivial = getTrivialResponse(text, { hasActiveFlow, currentFlow });
  if (trivial) {
    logger.info({ 
      conversationId, 
      trivialType: trivial.clearFlow ? 'exit' : 'quick',
      hasActiveFlow,
    }, "Fast path: trivial response");
    
    return {
      route: ROUTE_TYPES.SIMPLE_REPLY,
      handler: "quick_responses.trivial",
      priority: 85,
      async: false,
      meta: { 
        response: trivial.response,
        clearFlow: trivial.clearFlow,
        // Pasar frustración media para agregar oferta de humano si aplica
        offerHuman: frustration.shouldOfferHuman && !frustration.highFrustration,
      },
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 3. FLUJO ACTIVO: Continuar donde se quedó
  // ─────────────────────────────────────────────────────────────────────────
  if (hasActiveFlow && currentFlow) {
    const flowRoute = mapFlowToRoute(currentFlow.flow);
    return {
      route: flowRoute,
      handler: `secure_flows.${currentFlow.flow.toLowerCase()}`,
      priority: 80,
      async: false,
      meta: {
        step: currentFlow.step,
        draft: currentFlow.draft,
        continueFlow: true,
      },
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 4. DETECCIÓN RÁPIDA: Saludos y FAQs
  // ─────────────────────────────────────────────────────────────────────────
  if (isGreeting(text)) {
    return {
      route: ROUTE_TYPES.GREETING,
      handler: "quick_responses.greeting",
      priority: 70,
      async: false,
      meta: {},
    };
  }
  
  const faqMatch = matchFAQ(text);
  if (faqMatch) {
    return {
      route: ROUTE_TYPES.FAQ,
      handler: "quick_responses.faq",
      priority: 70,
      async: false,
      meta: { faqKey: faqMatch },
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 5. DETECCIÓN DE INTENTS: ¿Nuevo flujo?
  // ─────────────────────────────────────────────────────────────────────────
  const intentMatch = detectIntent(text);
  
  if (intentMatch.confidence >= 0.7) {
    // Intent claro → Iniciar flujo correspondiente
    if (intentMatch.intent === "order_create") {
      return {
        route: ROUTE_TYPES.FLOW_ORDER_CREATE,
        handler: "secure_flows.order_create",
        priority: 60,
        async: false,
        meta: { newFlow: true, ...intentMatch.extracted },
      };
    }
    
    if (intentMatch.intent === "order_status") {
      return {
        route: ROUTE_TYPES.FLOW_ORDER_STATUS,
        handler: "secure_flows.order_status",
        priority: 60,
        async: false,
        meta: { newFlow: true, ...intentMatch.extracted },
      };
    }
    
    if (intentMatch.intent === "order_modify") {
      return {
        route: ROUTE_TYPES.FLOW_ORDER_MODIFY,
        handler: "secure_flows.order_modify",
        priority: 60,
        async: false,
        meta: { newFlow: true, ...intentMatch.extracted },
      };
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // 6. FALLBACK: Agentic Flow (IA decide)
  // ─────────────────────────────────────────────────────────────────────────
  return {
    route: ROUTE_TYPES.AGENTIC_FLOW,
    handler: "agentic_flow.run",
    priority: 50,
    async: false, // Puede ser true si usas modelos lentos
    meta: {
      useDeepThink: shouldUseDeepThink(text),
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENT DETECTION (Rápido, sin IA)
// ═══════════════════════════════════════════════════════════════════════════

function detectIntent(text) {
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  
  // Order Create patterns
  const orderCreatePatterns = [
    /\b(quiero|necesito|ordenar|pedir|comprar)\s+(una?\s+)?(rosca|roscas|pastel)/,
    /\b(rosca|roscas)\s+(para|de|con)/,
    /\bhacen?\s+(pedidos?|entregas?)\b/,
    /\bpara\s+(cuando|que\s+dia)\s+(tienen|hay)/,
  ];
  
  for (const pattern of orderCreatePatterns) {
    if (pattern.test(t)) {
      return { intent: "order_create", confidence: 0.8, extracted: extractOrderHints(t) };
    }
  }
  
  // Order Status patterns
  const orderStatusPatterns = [
    /\b(donde|como)\s+(va|esta|viene)\s+(mi\s+)?(pedido|orden)/,
    /\b(estado|status)\s+(de|del)\s+(mi\s+)?(pedido|orden)/,
    /\bpedido\s+(#|numero|num)?\s*\d+/,
    /\brastrear\s+(mi\s+)?(pedido|orden)/,
    /\bmi\s+pedido\b/,
  ];
  
  for (const pattern of orderStatusPatterns) {
    if (pattern.test(t)) {
      const orderId = extractOrderId(t);
      return { intent: "order_status", confidence: 0.85, extracted: { order_id: orderId } };
    }
  }
  
  // Order Modify patterns
  const orderModifyPatterns = [
    /\b(cambiar|modificar|actualizar)\s+(mi\s+)?(pedido|orden)/,
    /\b(cancelar)\s+(mi\s+)?(pedido|orden)/,
    /\b(agregar|quitar)\s+(algo|producto)/,
    /\bcambiar\s+(la\s+)?(fecha|hora|direccion|sucursal)/,
  ];
  
  for (const pattern of orderModifyPatterns) {
    if (pattern.test(t)) {
      return { intent: "order_modify", confidence: 0.8, extracted: {} };
    }
  }
  
  return { intent: "unknown", confidence: 0, extracted: {} };
}

function extractOrderHints(text) {
  const hints = {};
  
  // Producto
  if (/rosca\s+clasica/i.test(text)) hints.product_hint = "clasica";
  else if (/rosca\s+nutella/i.test(text)) hints.product_hint = "nutella";
  else if (/rosca\s+reina/i.test(text)) hints.product_hint = "reina";
  
  // Sucursal
  const branchPatterns = {
    angelopolis: /angelopolis|ange/i,
    san_angel: /san\s*angel|sanangel/i,
    sonata: /sonata/i,
    zavaleta: /zavaleta/i,
    "5_sur": /5\s*sur|cinco\s*sur/i,
  };
  
  for (const [branch, pattern] of Object.entries(branchPatterns)) {
    if (pattern.test(text)) {
      hints.branch_hint = branch;
      break;
    }
  }
  
  // Fecha
  if (/mañana/i.test(text)) hints.date_hint = "tomorrow";
  else if (/hoy/i.test(text)) hints.date_hint = "today";
  else if (/viernes/i.test(text)) hints.date_hint = "friday";
  else if (/sabado/i.test(text)) hints.date_hint = "saturday";
  else if (/domingo/i.test(text)) hints.date_hint = "sunday";
  
  return hints;
}

function extractOrderId(text) {
  const match = text.match(/(?:pedido|orden|#)\s*(\d{4,})/i);
  return match ? match[1] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK PATTERNS
// ═══════════════════════════════════════════════════════════════════════════

function isGreeting(text) {
  const greetings = [
    /^(hola|hi|hey|buenos?\s*(dias?|tardes?|noches?)|que\s*tal|saludos)[\s!.,]*$/i,
    /^(ola|buenas|wenas)[\s!.,]*$/i,
  ];
  return greetings.some(p => p.test(text.trim()));
}

function matchFAQ(text) {
  const faqs = {
    horarios: /\b(horarios?|que\s+hora|a\s+que\s+hora|cuando\s+abren|cuando\s+cierran)\b/i,
    ubicacion: /\b(donde\s+estan|ubicacion|direccion|como\s+llego|sucursales?)\b/i,
    menu: /\b(menu|carta|que\s+tienen|productos?|precios?)\b/i,
    envio: /\b(envio|domicilio|entregan|delivery|envian)\b/i,
    pago: /\b(formas?\s+de\s+pago|como\s+pago|aceptan\s+tarjeta|efectivo)\b/i,
  };
  
  for (const [key, pattern] of Object.entries(faqs)) {
    if (pattern.test(text)) return key;
  }
  return null;
}

function shouldUseDeepThink(text) {
  // Indicadores de que necesita razonamiento profundo
  const complexPatterns = [
    /\bcomparar\b/i,
    /\bexplicar?\b/i,
    /\bpor\s*que\b/i,
    /\bcomo\s+funciona\b/i,
    /\bdiferencia\s+entre\b/i,
  ];
  
  return complexPatterns.some(p => p.test(text));
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function mapFlowToRoute(flowName) {
  const mapping = {
    [FLOWS.ORDER_CREATE]: ROUTE_TYPES.FLOW_ORDER_CREATE,
    [FLOWS.ORDER_STATUS]: ROUTE_TYPES.FLOW_ORDER_STATUS,
    [FLOWS.ORDER_MODIFY]: ROUTE_TYPES.FLOW_ORDER_MODIFY,
    [FLOWS.RESERVATION]: ROUTE_TYPES.FLOW_RESERVATION,
  };
  return mapping[flowName] || ROUTE_TYPES.AGENTIC_FLOW;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const dispatcher = {
  route,
  ROUTE_TYPES,
  detectIntent,
  isGreeting,
  matchFAQ,
};

export default dispatcher;
