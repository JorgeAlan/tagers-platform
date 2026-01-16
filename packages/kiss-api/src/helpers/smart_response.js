/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SMART RESPONSE - Respuestas inteligentes cuando hay confusión
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta frustración/confusión y genera respuestas empáticas con listas
 * claras de opciones. Detecta loops y cambia estrategia.
 */

import { logger } from "../utils/logger.js";
import { getFormattedBranches, formatBranchList } from "./branch_helper.js";

// ═══════════════════════════════════════════════════════════════════════════
// LOOP DETECTION - Contador de intentos por conversación
// ═══════════════════════════════════════════════════════════════════════════

const conversationAttempts = new Map();
const ATTEMPT_TTL_MS = 10 * 60 * 1000; // 10 minutos

/**
 * Obtiene y aumenta el contador de intentos para un step específico
 */
export function getAndIncrementAttempts(conversationId, step) {
  const key = `${conversationId}:${step}`;
  const now = Date.now();
  
  // Limpiar entradas viejas
  for (const [k, v] of conversationAttempts.entries()) {
    if (now - v.timestamp > ATTEMPT_TTL_MS) {
      conversationAttempts.delete(k);
    }
  }
  
  const current = conversationAttempts.get(key) || { count: 0, timestamp: now };
  current.count += 1;
  current.timestamp = now;
  conversationAttempts.set(key, current);
  
  return current.count;
}

/**
 * Obtiene el número de intentos recientes para un (conversationId, step)
 * sin modificar el contador.
 */
export function getAttempts(conversationId, step) {
  const key = `${conversationId}:${step}`;
  const now = Date.now();

  // Limpiar entradas viejas (mismo TTL que el contador principal)
  for (const [k, v] of conversationAttempts.entries()) {
    if (now - v.timestamp > ATTEMPT_TTL_MS) {
      conversationAttempts.delete(k);
    }
  }

  const entry = conversationAttempts.get(key);
  if (!entry) return 0;
  if (now - entry.timestamp > ATTEMPT_TTL_MS) {
    conversationAttempts.delete(key);
    return 0;
  }
  return entry.count || 0;
}

/**
 * Incrementa el número de intentos recientes para un (conversationId, step)
 * y regresa el conteo actualizado.
 */
export function incrementAttempts(conversationId, step) {
  return getAndIncrementAttempts(conversationId, step);
}

/**
 * Reinicia el contador cuando el usuario avanza
 */
export function resetAttempts(conversationId, step) {
  const key = `${conversationId}:${step}`;
  conversationAttempts.delete(key);
}

// ═══════════════════════════════════════════════════════════════════════════
// PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════════

// Patrones que indican confusión o frustración
const CONFUSION_PATTERNS = [
  /no (veo|hay|me (diste|dieron)|entiendo)/i,
  /cual(es)? (numero|opcion|lista)/i,
  /donde (esta|estan)/i,
  /pero.*no/i,
  /que.*lista/i,
  /otra vez/i,
  /ya te dije/i,
  /no me (ayud|sirv)/i,
  /(carajo|chinga|mierda|diablos)/i,
  /[!?]{2,}/,
  /[A-Z]{3,}/, // MAYUSCULAS
];

const FRUSTRATION_PATTERNS = [
  /(carajo|chinga|mierda|diablos|pinche)/i,
  /no (sirves|funciona|entiendes)/i,
  /estoy (harto|cansado|frustrado)/i,
  /que (mal|pesimo|horrible)/i,
  /[!]{2,}/,
  /ya.*varias veces/i,
];

/**
 * Detecta si el mensaje indica confusión
 */
export function detectsConfusion(message) {
  const text = String(message || "").toLowerCase();
  return CONFUSION_PATTERNS.some(p => p.test(text));
}

/**
 * Detecta si el mensaje indica frustración
 */
export function detectsFrustration(message) {
  const text = String(message || "").toLowerCase();
  return FRUSTRATION_PATTERNS.some(p => p.test(text));
}

/**
 * Detecta el nivel de frustración (0-1)
 */
export function getFrustrationLevel(message) {
  const text = String(message || "").toLowerCase();
  let level = 0;
  
  if (detectsFrustration(text)) level += 0.4;
  if (detectsConfusion(text)) level += 0.2;
  if (/[!]{2,}/.test(text)) level += 0.1;
  if (/[A-Z]{5,}/.test(message)) level += 0.2;
  if (/(carajo|chinga|mierda)/i.test(text)) level += 0.3;
  
  return Math.min(level, 1.0);
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPUESTAS VARIADAS POR INTENTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera respuesta para ASK_BRANCH según el intento
 */
function getBranchResponseByAttempt(attemptNumber, frustrationLevel) {
  const { branches } = getFormattedBranches();
  const branchList = formatBranchList(branches);
  
  // Intento 1: Respuesta estándar con disculpa si hay frustración
  if (attemptNumber === 1) {
    const apology = frustrationLevel > 0.3 ? "¡Disculpa! " : "";
    return {
      message: `${apology}Aquí están nuestras sucursales:\n\n${branchList}\n\n¿En cuál te gustaría recoger? Puedes responder con el número o el nombre.`,
      should_escalate: false
    };
  }
  
  // Intento 2: Cambio de enfoque - preguntar diferente
  if (attemptNumber === 2) {
    return {
      message: `Entiendo que puede ser confuso. Déjame preguntarte de otra forma:\n\n¿Estás en CDMX o en Puebla?\n\n• Si estás en CDMX → tenemos San Ángel\n• Si estás en Puebla → tenemos Angelópolis, Sonata, Zavaleta y 5 Sur\n\nSolo dime la ciudad o el nombre de la sucursal más cercana a ti.`,
      should_escalate: false
    };
  }
  
  // Intento 3: Simplificar aún más
  if (attemptNumber === 3) {
    return {
      message: `¡Perdón por la confusión! Hagamos esto más simple:\n\n¿En qué ciudad estás?\n1. Ciudad de México\n2. Puebla\n\nSolo responde "1" o "2" y te ayudo desde ahí.`,
      should_escalate: false
    };
  }
  
  // Intento 4+: Escalar a humano
  return {
    message: `Parece que estamos teniendo dificultades para comunicarnos. 😅\n\nTe voy a conectar con un agente humano que te ayudará mejor. Dame un momento por favor.`,
    should_escalate: true
  };
}

/**
 * Genera respuesta para ASK_PRODUCT según el intento
 */
function getProductResponseByAttempt(attemptNumber, availableOptions, frustrationLevel) {
  const productList = availableOptions?.map((p, i) => `${i+1}. ${p.nombre || p.key}`).join("\n") || "1. Rosca tradicional\n2. Rosca de chocolate";
  
  if (attemptNumber === 1) {
    const apology = frustrationLevel > 0.3 ? "¡Disculpa! " : "";
    return {
      message: `${apology}Estas son nuestras opciones de roscas:\n\n${productList}\n\n¿Cuál te gustaría?`,
      should_escalate: false
    };
  }
  
  if (attemptNumber === 2) {
    return {
      message: `Déjame preguntarte diferente: ¿Prefieres una rosca tradicional o de algún sabor especial como chocolate?\n\nSolo dime qué sabor te gustaría.`,
      should_escalate: false
    };
  }
  
  if (attemptNumber >= 3) {
    return {
      message: `Te conecto con un agente para ayudarte mejor con tu pedido. Un momento.`,
      should_escalate: true
    };
  }
  
  return { message: productList, should_escalate: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera respuesta inteligente según el contexto y número de intento
 */
export async function generateSmartResponse({
  conversationId,
  customerMessage,
  context, // "ASK_BRANCH", "ASK_PRODUCT", etc
  availableOptions,
  previousBotMessage,
  frustrationLevel = 0
}) {
  // Obtener número de intento
  const attemptNumber = getAndIncrementAttempts(conversationId, context);
  
  logger.info({
    conversationId,
    context,
    attemptNumber,
    frustrationLevel
  }, "Smart response generating with attempt tracking");
  
  // Si la frustración es muy alta, escalar directamente
  if (frustrationLevel > 0.8) {
    return {
      message: `¡Mil disculpas por la confusión! Te paso con un agente para ayudarte mejor. Un momento por favor.`,
      should_escalate: true
    };
  }
  
  // Generar respuesta según contexto y número de intento
  if (context === "ASK_BRANCH") {
    return getBranchResponseByAttempt(attemptNumber, frustrationLevel);
  }
  
  if (context === "ASK_PRODUCT") {
    return getProductResponseByAttempt(attemptNumber, availableOptions, frustrationLevel);
  }
  
  // Fallback genérico
  if (attemptNumber >= 3) {
    return {
      message: `Parece que necesitas ayuda adicional. Te conecto con un agente humano.`,
      should_escalate: true
    };
  }
  
  return {
    message: `¿Me ayudas a entender qué necesitas? Estoy aquí para ayudarte.`,
    should_escalate: false
  };
}

/**
 * Decide si usar respuesta inteligente o hardcodeada
 */
export async function getOrderFlowErrorResponse({
  conversationId,
  customerMessage,
  context,
  availableOptions,
  previousBotMessage
}) {
  const frustration = getFrustrationLevel(customerMessage);
  const isConfused = detectsConfusion(customerMessage);
  
  // Siempre usar respuesta inteligente con tracking de intentos
  logger.info({ 
    conversationId,
    frustration, 
    isConfused, 
    context 
  }, "Using smart response with loop detection");
  
  return generateSmartResponse({
    conversationId,
    customerMessage,
    context,
    availableOptions,
    previousBotMessage,
    frustrationLevel: frustration
  });
}

export default {
  detectsConfusion,
  detectsFrustration,
  getFrustrationLevel,
  generateSmartResponse,
  getOrderFlowErrorResponse,
  getAndIncrementAttempts,
  getAttempts,
  incrementAttempts,
  resetAttempts
};
