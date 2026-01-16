/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTENT EXTRACTOR - Extracción estructurada de intent + slots
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEMA QUE RESUELVE:
 * - "un" → 1 → "enero-01" (fuzzy matcher agresivo)
 * - "puedo hablar con un humano" → ESCALATE_HUMAN, NO fecha
 * - "para cuando tienes disponibilidad" → ASK_AVAILABILITY, NO fecha
 * 
 * SOLUCIÓN:
 * - Schema estricto para extracción
 * - Fechas solo en formato ISO o null
 * - LLM con structured outputs para determinismo
 */

import { logger } from "../utils/logger.js";
import KnowledgeHub from "../knowledge-hub/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA ESTRICTO PARA EXTRACCIÓN (compatible con strict mode)
// ═══════════════════════════════════════════════════════════════════════════

export const INTENT_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    intent: {
      type: "string",
      enum: [
        "ORDER_CREATE",           // Quiere hacer pedido nuevo
        "ORDER_STATUS",           // Consultar estado
        "ORDER_MODIFY",           // Cambiar fecha/sucursal (RESCHEDULE)
        "ORDER_CANCEL",           // Cancelar pedido
        "ASK_AVAILABILITY",       // Pregunta disponibilidad (NO es pedido)
        "ASK_HOURS",              // Pregunta horarios
        "ASK_LOCATION",           // Pregunta dirección
        "ASK_AMENITY",            // WiFi, estacionamiento, etc.
        "ASK_MENU",               // Menú/productos
        "ASK_PRICE",              // Precios
        "ESCALATE_HUMAN",         // Hablar con persona
        "CANCEL_FLOW",            // Cancelar proceso actual
        "GREETING",               // Saludo
        "THANKS",                 // Agradecimiento
        "CONFIRM",                // Confirmación (sí, ok, confirmo)
        "DENY",                   // Negación (no, cancelar)
        "SELECT_OPTION",          // Selección de opción (número)
        "PROVIDE_DATE",           // Proporciona fecha específica
        "PROVIDE_ORDER_ID",       // Proporciona número de pedido
        "UNCLEAR",                // No se puede determinar
      ],
      description: "Intención principal del mensaje"
    },
    
    delivery_date_iso: {
      type: ["string", "null"],
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Fecha ISO (YYYY-MM-DD) SOLO si el cliente da fecha específica. NULL si no hay fecha clara."
    },
    
    order_id: {
      type: ["integer", "null"],
      minimum: 1,
      description: "Número de pedido mencionado. NULL si no hay."
    },
    
    branch_hint: {
      type: ["string", "null"],
      // NOTA: Este enum se genera dinámicamente desde Knowledge Hub
      // En runtime, usar KnowledgeHub.getBranchEnumForSchema()
      enum: ["san_angel", "angelopolis", "sonata", "zavaleta", "5_sur", "5sur", "cdmx", "puebla", null],
      description: "Sucursal mencionada (normalizada). NULL si no hay."
    },
    
    product_hint: {
      type: ["string", "null"],
      description: "Producto mencionado (rosca, tradicional, rellena). NULL si no hay."
    },
    
    quantity: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 50,
      description: "Cantidad mencionada. NULL si no hay o es ambigua."
    },
    
    option_number: {
      type: ["integer", "null"],
      minimum: 1,
      maximum: 20,
      description: "Número de opción seleccionada (1, 2, 3...). NULL si no aplica."
    },
    
    is_question: {
      type: "boolean",
      description: "True si el mensaje es una pregunta"
    },
    
    is_confirmation: {
      type: "boolean",
      description: "True si el mensaje confirma algo (sí, ok, confirmo, dale)"
    },
    
    is_cancellation: {
      type: "boolean",
      description: "True si el mensaje cancela (no, cancelar, ya no, dejalo)"
    },
    
    wants_human: {
      type: "boolean",
      description: "True si quiere hablar con persona/humano/agente"
    },
    
    frustration_signals: {
      type: "boolean",
      description: "True si hay frustración (repetición, mayúsculas, groserías)"
    },
    
    confidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Confianza en la clasificación (0-1)"
    }
  },
  required: [
    "intent",
    "delivery_date_iso",
    "order_id",
    "branch_hint",
    "product_hint",
    "quantity",
    "option_number",
    "is_question",
    "is_confirmation",
    "is_cancellation",
    "wants_human",
    "frustration_signals",
    "confidence"
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM PROMPT PARA EXTRACCIÓN (GPT-5.2)
// ═══════════════════════════════════════════════════════════════════════════

const EXTRACTION_SYSTEM_PROMPT = `Eres un clasificador de intenciones para Tan • IA, asistente de Tagers (restaurante/panadería mexicana).

CONTEXTO: Temporada de roscas de reyes (diciembre-enero). El cliente puede estar haciendo pedido nuevo, consultando pedido existente, o pidiendo información.

TU TRABAJO: Extraer intent y datos estructurados. Responde SOLO JSON válido.

═══════════════════════════════════════════════════════════════════
REGLAS CRÍTICAS PARA FECHAS:
═══════════════════════════════════════════════════════════════════

1. SOLO extrae delivery_date_iso si el cliente da fecha ESPECÍFICA:
   - "6 de enero" → "2025-01-06" ✓
   - "mañana" → calcular fecha ISO ✓
   - "el lunes" → calcular fecha ISO ✓
   
2. NUNCA extraigas fecha de estas frases:
   - "para cuando tienes" → NULL (es PREGUNTA)
   - "cuando hay disponibilidad" → NULL (es ASK_AVAILABILITY)
   - "quiero UN pedido" → NULL ("un" es artículo, NO día 1)
   - "puedo hablar con UN humano" → NULL (ESCALATE_HUMAN)
   - "una rosca" → NULL ("una" es cantidad, NO fecha)

3. Si hay duda, delivery_date_iso = null

═══════════════════════════════════════════════════════════════════
REGLAS PARA ESCALATE_HUMAN:
═══════════════════════════════════════════════════════════════════

wants_human = true para:
- "puedo hablar con un humano"
- "quiero hablar con alguien"
- "pasame con una persona"
- "necesito ayuda de un agente"
- "quiero hablar con alguien real"

IMPORTANTE: "un humano", "una persona" → "un/una" es artículo, NO número.

═══════════════════════════════════════════════════════════════════
REGLAS PARA CONFIRMACIÓN/CANCELACIÓN:
═══════════════════════════════════════════════════════════════════

is_confirmation = true para:
- "sí", "si", "ok", "dale", "confirmo", "confirmar", "adelante", "procede"
- "confirmar cambio" (frase oficial)

is_cancellation = true para:
- "no", "cancelar", "ya no", "dejalo", "olvida", "nada", "mejor no"

═══════════════════════════════════════════════════════════════════
REGLAS PARA SELECCIÓN DE OPCIÓN:
═══════════════════════════════════════════════════════════════════

Si el mensaje es SOLO un número (1, 2, 3...):
- intent = "SELECT_OPTION"
- option_number = el número
- delivery_date_iso = null (NO interpretar como día)

═══════════════════════════════════════════════════════════════════
SUCURSALES:
═══════════════════════════════════════════════════════════════════

- "5 sur" / "cinco sur" → "5_sur"
- "angelópolis" / "angelopolis" → "angelopolis"
- "san angel" / "san ángel" / "cdmx" → "san_angel"
- "sonata" → "sonata"
- "zavaleta" → "zavaleta"

FECHA DE HOY: {{TODAY_DATE}}`;

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae intent y slots usando LLM con structured outputs
 */
export async function extractIntentAndSlots(message, context = {}, llmCall) {
  const today = new Date().toISOString().split("T")[0];
  
  // Generar sección de sucursales dinámicamente desde Knowledge Hub
  const branchesSection = KnowledgeHub.isConfigLoaded()?.branches 
    ? KnowledgeHub.getBranchesPromptSection()
    : `SUCURSALES:
- "5 sur" / "cinco sur" → "5_sur"
- "angelópolis" / "angelopolis" → "angelopolis"
- "san angel" / "san ángel" / "cdmx" → "san_angel"
- "sonata" → "sonata"
- "zavaleta" → "zavaleta"`;
  
  const systemPrompt = EXTRACTION_SYSTEM_PROMPT
    .replace("{{TODAY_DATE}}", today)
    .replace(/═══════════════════════════════════════════════════════════════════\nSUCURSALES:[\s\S]*?FECHA DE HOY:/m, 
      `═══════════════════════════════════════════════════════════════════\n${branchesSection}\n\nFECHA DE HOY:`);
  
  // Construir prompt con contexto
  let userPrompt = `Mensaje del cliente: "${message}"`;
  
  if (context.previousBotMessage) {
    userPrompt += `\n\nÚltimo mensaje de Tan • IA: "${context.previousBotMessage}"`;
  }
  
  if (context.flowStep) {
    userPrompt += `\n\nPaso actual del flujo: ${context.flowStep}`;
  }
  
  if (context.pendingOptions?.length) {
    userPrompt += `\n\nOpciones mostradas al cliente: ${context.pendingOptions.map((o, i) => `${i+1}. ${o}`).join(", ")}`;
  }
  
  try {
    const result = await llmCall({
      task: "ana_super_intent_extraction",
      systemPrompt,
      userPrompt,
      responseFormat: {
        type: "json_schema",
        json_schema: {
          name: "intent_extraction",
          strict: true,
          schema: INTENT_EXTRACTION_SCHEMA,
        },
      },
      temperature: 0.1,  // Muy baja para determinismo
    });
    
    const extracted = typeof result.content === "string" 
      ? JSON.parse(result.content) 
      : result.content;
    
    logger.info({
      message: message.substring(0, 50),
      intent: extracted.intent,
      confidence: extracted.confidence,
      hasDate: !!extracted.delivery_date_iso,
      hasOrderId: !!extracted.order_id,
      wantsHuman: extracted.wants_human,
    }, "Intent extracted via LLM");
    
    return extracted;
    
  } catch (error) {
    logger.warn({ error: error.message, message }, "LLM intent extraction failed, using fallback");
    return fallbackExtraction(message, context);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK SIN LLM (rápido, para cuando falla API)
// ═══════════════════════════════════════════════════════════════════════════

function fallbackExtraction(message, context = {}) {
  const text = normalizeText(message);
  const original = message.trim();
  
  // Base result
  const result = {
    intent: "UNCLEAR",
    delivery_date_iso: null,
    order_id: null,
    branch_hint: null,
    product_hint: null,
    quantity: null,
    option_number: null,
    is_question: original.includes("?"),
    is_confirmation: false,
    is_cancellation: false,
    wants_human: false,
    frustration_signals: false,
    confidence: 0.3,
  };
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIORIDAD 1: Detección de escalación a humano
  // ═══════════════════════════════════════════════════════════════════════
  if (/\b(humano|persona|agente|alguien|real|asesor|ejecutivo)\b/.test(text) ||
      /\b(hablar con|pasame|comunicar|necesito ayuda)\b/.test(text)) {
    result.intent = "ESCALATE_HUMAN";
    result.wants_human = true;
    result.confidence = 0.9;
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIORIDAD 2: Cancelación del flujo
  // ═══════════════════════════════════════════════════════════════════════
  if (/^(cancelar?|ya no|dejalo|olvida|nada|adios|bye|chao)$/i.test(text) ||
      /\b(ya no quiero|mejor no|olvidalo|dejalo asi)\b/.test(text)) {
    result.intent = "CANCEL_FLOW";
    result.is_cancellation = true;
    result.confidence = 0.9;
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIORIDAD 3: Confirmación
  // ═══════════════════════════════════════════════════════════════════════
  if (/^(si|sí|ok|dale|confirmo|confirmar|adelante|procede|claro|va)$/i.test(text) ||
      /confirmar\s*cambio/i.test(text)) {
    result.intent = "CONFIRM";
    result.is_confirmation = true;
    result.confidence = 0.95;
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIORIDAD 4: Negación simple
  // ═══════════════════════════════════════════════════════════════════════
  if (/^(no|nope|nel|nah|negativo)$/i.test(text)) {
    result.intent = "DENY";
    result.is_cancellation = true;
    result.confidence = 0.9;
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIORIDAD 5: Selección de opción (solo número)
  // ═══════════════════════════════════════════════════════════════════════
  if (/^\d{1,2}$/.test(text)) {
    const num = parseInt(text, 10);
    if (num >= 1 && num <= 20) {
      result.intent = "SELECT_OPTION";
      result.option_number = num;
      result.confidence = 0.9;
      return result;
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // PRIORIDAD 6: Pregunta de disponibilidad (NO es fecha)
  // ═══════════════════════════════════════════════════════════════════════
  if (/\b(cuando|cuándo|disponib|tienen|hay|horario|abren)\b/.test(text) && result.is_question) {
    result.intent = "ASK_AVAILABILITY";
    result.confidence = 0.7;
    return result;
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // EXTRACCIONES ADICIONALES (no afectan intent)
  // ═══════════════════════════════════════════════════════════════════════
  
  // Extraer sucursal
  result.branch_hint = extractBranchHint(text);
  
  // Extraer producto
  result.product_hint = extractProductHint(text);
  
  // Extraer order_id (solo si es claramente un número de pedido)
  const orderMatch = text.match(/(?:pedido|orden|order|#)\s*(\d{4,8})/i);
  if (orderMatch) {
    result.order_id = parseInt(orderMatch[1], 10);
    result.intent = "ORDER_STATUS";
    result.confidence = 0.7;
  }
  
  // Detectar frustración
  if (text.length > 50 && text === text.toUpperCase()) {
    result.frustration_signals = true;
  }
  
  return result;
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractBranchHint(text) {
  // Usar Knowledge Hub dinámico
  const result = KnowledgeHub.extractBranchHint(text);
  if (result) return result;
  
  // Fallback mínimo si Knowledge Hub no está inicializado
  const t = normalizeText(text);
  if (/5\s*sur|cinco\s*sur/i.test(t)) return "5_sur";
  if (/angel[oó]polis/i.test(t)) return "angelopolis";
  if (/san\s*[aá]ngel/i.test(t)) return "san_angel";
  if (/\bcdmx\b/i.test(t)) return "san_angel";
  if (/sonata/i.test(t)) return "sonata";
  if (/zavaleta/i.test(t)) return "zavaleta";
  return null;
}

function extractProductHint(text) {
  // Usar Knowledge Hub dinámico
  const result = KnowledgeHub.extractProductHint(text);
  if (result) return result;
  
  // Fallback mínimo si Knowledge Hub no está inicializado
  const t = normalizeText(text);
  if (/tradicional|clasica/i.test(t)) return "tradicional";
  if (/rellena/i.test(t)) return "rellena";
  if (/nutella|chocolate/i.test(t)) return "nutella";
  if (/lotus|biscoff|galleta/i.test(t)) return "lotus";
  if (/rosca/i.test(t)) return "rosca";
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ¿Es un intent que modifica datos?
 */
export function isWriteIntent(intent) {
  return ["ORDER_CREATE", "ORDER_MODIFY", "ORDER_CANCEL"].includes(intent);
}

/**
 * ¿Requiere escalación inmediata?
 */
export function requiresEscalation(extracted) {
  return extracted.intent === "ESCALATE_HUMAN" || extracted.wants_human === true;
}

/**
 * ¿El usuario quiere salir del flujo?
 */
export function wantsToExit(extracted) {
  return extracted.intent === "CANCEL_FLOW" || extracted.is_cancellation === true;
}

/**
 * ¿Es una confirmación?
 */
export function isConfirmation(extracted) {
  return extracted.intent === "CONFIRM" || extracted.is_confirmation === true;
}

/**
 * ¿Es una selección de opción?
 */
export function isOptionSelection(extracted) {
  return extracted.intent === "SELECT_OPTION" && extracted.option_number !== null;
}

/**
 * Mensaje de preamble según intent (para transparencia con el usuario)
 */
export function getPreambleMessage(intent) {
  const preambles = {
    ORDER_CREATE: "Voy a ayudarte con tu pedido...",
    ORDER_MODIFY: "Déjame verificar la disponibilidad para ese cambio...",
    ORDER_STATUS: "Consultando el estado de tu pedido...",
    ORDER_CANCEL: "Voy a revisar si tu pedido puede cancelarse...",
    ASK_AVAILABILITY: "Revisando disponibilidad...",
    ESCALATE_HUMAN: "Te comunico con alguien del equipo...",
  };
  
  return preambles[intent] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  INTENT_EXTRACTION_SCHEMA,
  extractIntentAndSlots,
  isWriteIntent,
  requiresEscalation,
  wantsToExit,
  isConfirmation,
  isOptionSelection,
  getPreambleMessage,
};
