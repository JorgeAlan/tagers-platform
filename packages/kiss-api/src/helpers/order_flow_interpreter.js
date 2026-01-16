/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDER FLOW INTERPRETER - Reemplazo inteligente de máquina de estados
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * En lugar de asumir que cada mensaje es una respuesta al paso actual,
 * usa el LLM para interpretar qué quiso decir el cliente.
 * 
 * PRINCIPIOS:
 * 1. NUNCA asumir - siempre interpretar
 * 2. Detectar frustración en CADA mensaje
 * 3. Permitir escape en cualquier momento
 * 4. Máximo 2 reintentos por paso
 * 5. Si algo no funciona, ofrecer alternativas (no loop)
 */

import { routeTask } from "../model_router.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const MAX_RETRIES_PER_STEP = 2;
const FRUSTRATION_THRESHOLD = 0.5;  // Escalar si frustración > 0.5

// Patrones que indican que el cliente quiere escapar
const ESCAPE_PATTERNS = {
  cancel: [
    /\b(cancelar?|cancela|ya no|no quiero|olvidalo|olvídalo|dejalo|déjalo|nada|nevermind)\b/i,
    /\b(adios|adiós|bye|chao|hasta luego)\b/i,
  ],
  human: [
    /\b(humano|persona|agente|alguien|real)\b/i,
    /\b(hablar con|pasame|pásame|comunic|ayuda real)\b/i,
    /\b(gerente|manager|encargado|supervisor)\b/i,
  ],
  confused: [
    /\b(no entiendo|no entendi|que|qué|como|cómo)\b/i,
    /\b(explicame|explícame|otra vez|de nuevo|repeat)\b/i,
    /\bwhat\b/i,
  ],
  question: [
    /\b(cuando|cuándo|donde|dónde|cual|cuál|tienen|hay|puedo)\b.*\?/i,
    /\bpara cuando\b/i,
    /\bdisponib/i,
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// INTERPRETADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Interpreta el mensaje del cliente en contexto del flujo actual
 * 
 * @param {string} message - Mensaje del cliente
 * @param {Object} state - Estado actual del flujo (step, draft, retries)
 * @param {Object} options - Opciones disponibles (branches, fechas, productos)
 * @param {Array} conversationHistory - Historial reciente
 * @returns {Object} Interpretación con acción sugerida
 */
export async function interpretOrderMessage(message, state, options, conversationHistory = []) {
  const text = message.trim().toLowerCase();
  
  // ─────────────────────────────────────────────────────────────────────────
  // PASO 1: Detectar escapes (sin LLM, rápido)
  // ─────────────────────────────────────────────────────────────────────────
  
  const escapeCheck = detectEscapeIntent(text);
  if (escapeCheck.detected) {
    logger.info({ 
      escapeType: escapeCheck.type, 
      message: text.substring(0, 50) 
    }, "Order flow: escape intent detected");
    
    return {
      action: escapeCheck.type === 'cancel' ? 'CANCEL' : 
              escapeCheck.type === 'human' ? 'ESCALATE' :
              escapeCheck.type === 'question' ? 'REDIRECT_QUESTION' : 'CLARIFY',
      confidence: escapeCheck.confidence,
      escapeType: escapeCheck.type,
      originalMessage: message,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // PASO 2: Intentar match directo (sin LLM, rápido)
  // ─────────────────────────────────────────────────────────────────────────
  
  const directMatch = tryDirectMatch(text, state.step, options);
  if (directMatch.matched) {
    logger.info({ 
      step: state.step, 
      matchType: directMatch.type,
      value: directMatch.value 
    }, "Order flow: direct match found");
    
    return {
      action: 'ADVANCE',
      confidence: directMatch.confidence,
      extractedValue: directMatch.value,
      extractedField: directMatch.field,
      matchType: directMatch.type,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // PASO 3: Usar LLM para interpretar mensajes ambiguos
  // ─────────────────────────────────────────────────────────────────────────
  
  const llmInterpretation = await interpretWithLLM(message, state, options, conversationHistory);
  
  logger.info({ 
    step: state.step,
    llmAction: llmInterpretation.action,
    llmConfidence: llmInterpretation.confidence,
    frustration: llmInterpretation.frustration,
  }, "Order flow: LLM interpretation");
  
  // Si detecta frustración alta, sugerir escalación
  if (llmInterpretation.frustration > FRUSTRATION_THRESHOLD) {
    return {
      action: 'OFFER_HELP',
      confidence: llmInterpretation.confidence,
      frustration: llmInterpretation.frustration,
      originalInterpretation: llmInterpretation,
    };
  }
  
  return llmInterpretation;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECCIÓN DE ESCAPE (SIN LLM)
// ═══════════════════════════════════════════════════════════════════════════

function detectEscapeIntent(text) {
  for (const [type, patterns] of Object.entries(ESCAPE_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        // Calcular confianza basada en longitud del mensaje
        // Mensaje corto con patrón = alta confianza
        // Mensaje largo con patrón = podría ser parte de otra cosa
        const confidence = text.length < 50 ? 0.9 : 
                          text.length < 100 ? 0.7 : 0.5;
        
        return { detected: true, type, confidence };
      }
    }
  }
  
  return { detected: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCH DIRECTO (SIN LLM)
// ═══════════════════════════════════════════════════════════════════════════

function tryDirectMatch(text, step, options) {
  // Match por número (1, 2, 3...)
  const numMatch = text.match(/^(\d+)$/);
  if (numMatch) {
    const num = parseInt(numMatch[1], 10);
    
    if (step === 'ASK_BRANCH' && options?.branches) {
      if (num >= 1 && num <= options.branches.length) {
        const branch = options.branches[num - 1];
        return {
          matched: true,
          type: 'number_selection',
          field: 'branch',
          value: {
            sucursal_slug: branch.slug || branch.branch_id?.toLowerCase(),
            sucursal_nombre: branch.nombre || branch.name,
            branch_id: branch.branch_id,
          },
          confidence: 0.95,
        };
      }
    }
    
    if (step === 'ASK_DATE' && options?.fechas) {
      if (num >= 1 && num <= options.fechas.length) {
        const fecha = options.fechas[num - 1];
        return {
          matched: true,
          type: 'number_selection',
          field: 'fecha',
          value: {
            fecha_slug: fecha.slug || fecha.fecha_iso,
            fecha_text: fecha.nombre || fecha.label,
          },
          confidence: 0.95,
        };
      }
    }
    
    if (step === 'ASK_PRODUCT' && options?.products) {
      if (num >= 1 && num <= options.products.length) {
        const product = options.products[num - 1];
        return {
          matched: true,
          type: 'number_selection',
          field: 'product',
          value: {
            product_key: product.key,
            product_id: product.wc_product_id,
            product_name: product.nombre,
          },
          confidence: 0.95,
        };
      }
    }
    
    if (step === 'ASK_QTY') {
      if (num >= 1 && num <= 50) {  // Límite razonable
        return {
          matched: true,
          type: 'number_selection',
          field: 'quantity',
          value: { quantity: num },
          confidence: 0.95,
        };
      }
    }
  }
  
  // Match por nombre de sucursal
  if (step === 'ASK_BRANCH' && options?.branches) {
    const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    for (const branch of options.branches) {
      const branchName = (branch.nombre || branch.name || '').toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      const branchId = (branch.branch_id || '').toLowerCase();
      
      if (normalizedText.includes(branchName) || 
          normalizedText.includes(branchId) ||
          branchName.includes(normalizedText)) {
        return {
          matched: true,
          type: 'name_match',
          field: 'branch',
          value: {
            sucursal_slug: branch.slug || branch.branch_id?.toLowerCase(),
            sucursal_nombre: branch.nombre || branch.name,
            branch_id: branch.branch_id,
          },
          confidence: 0.85,
        };
      }
    }
  }
  
  // Match por tipo de rosca
  if (step === 'ASK_PRODUCT' && options?.products) {
    const normalizedText = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    for (const product of options.products) {
      const productName = (product.nombre || product.key || '').toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
      
      if (normalizedText.includes(productName) || productName.includes(normalizedText)) {
        return {
          matched: true,
          type: 'name_match',
          field: 'product',
          value: {
            product_key: product.key,
            product_id: product.wc_product_id,
            product_name: product.nombre,
          },
          confidence: 0.85,
        };
      }
    }
  }
  
  return { matched: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// INTERPRETACIÓN CON LLM
// ═══════════════════════════════════════════════════════════════════════════

async function interpretWithLLM(message, state, options, conversationHistory) {
  const systemPrompt = buildInterpreterPrompt(state, options);
  
  const userPrompt = `
Mensaje del cliente: "${message}"

Historial reciente:
${conversationHistory.slice(-5).map(m => `- ${m.role}: ${m.content?.substring(0, 100)}`).join('\n')}

Paso actual del flujo: ${state.step}
Datos ya recolectados: ${JSON.stringify(state.draft || {})}
Reintentos en este paso: ${state.retries?.[state.step] || 0}

Responde SOLO con JSON válido.
`.trim();

  try {
    const response = await routeTask("order_interpreter", {
      systemPrompt,
      userPrompt,
      temperature: 0.1,  // Baja para consistencia
    });
    
    const parsed = JSON.parse(response.content || '{}');
    return {
      action: parsed.action || 'UNKNOWN',
      confidence: parsed.confidence || 0.5,
      frustration: parsed.frustration || 0,
      extractedValue: parsed.extracted_value || null,
      extractedField: parsed.extracted_field || null,
      reasoning: parsed.reasoning || '',
      suggestedResponse: parsed.suggested_response || null,
    };
  } catch (error) {
    logger.error({ error: error.message }, "Order interpreter LLM failed");
    return {
      action: 'UNKNOWN',
      confidence: 0,
      frustration: 0,
    };
  }
}

function buildInterpreterPrompt(state, options) {
  return `
Eres un interpretador de mensajes para un flujo de pedido de roscas.

Tu trabajo es entender qué quiere el cliente y clasificar su mensaje.

ACCIONES POSIBLES:
- ADVANCE: El cliente respondió algo válido para el paso actual
- CANCEL: El cliente quiere cancelar/irse
- ESCALATE: El cliente quiere hablar con humano
- REDIRECT_QUESTION: El cliente está preguntando algo, no respondiendo
- CLARIFY: No está claro qué quiere, necesita aclaración
- RETRY: El cliente dio una respuesta inválida pero intenta responder
- UNKNOWN: No se puede determinar

OPCIONES DISPONIBLES:
${state.step === 'ASK_BRANCH' ? `Sucursales: ${options?.branches?.map((b,i) => `${i+1}. ${b.nombre || b.name}`).join(', ')}` : ''}
${state.step === 'ASK_DATE' ? `Fechas: ${options?.fechas?.slice(0,8).map((f,i) => `${i+1}. ${f.nombre || f.label}`).join(', ')}` : ''}
${state.step === 'ASK_PRODUCT' ? `Productos: ${options?.products?.map((p,i) => `${i+1}. ${p.nombre}`).join(', ')}` : ''}
${state.step === 'ASK_QTY' ? 'Se espera un número (cantidad de roscas)' : ''}

IMPORTANTE:
- Si el mensaje es una PREGUNTA (contiene "?", "cuando", "donde", etc.), es REDIRECT_QUESTION
- Si el mensaje expresa frustración ("ya no", "olvídalo", groserías), es CANCEL o ESCALATE
- Si el mensaje pide humano/persona/agente, es ESCALATE
- Solo usa ADVANCE si estás seguro de que el cliente respondió al paso actual

Responde en JSON:
{
  "action": "ADVANCE|CANCEL|ESCALATE|REDIRECT_QUESTION|CLARIFY|RETRY|UNKNOWN",
  "confidence": 0.0-1.0,
  "frustration": 0.0-1.0,
  "extracted_value": { ... } o null,
  "extracted_field": "branch|fecha|product|quantity" o null,
  "reasoning": "Explicación breve",
  "suggested_response": "Mensaje sugerido para el cliente" o null
}
`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// MANEJO DE ESTADO Y REINTENTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Incrementa el contador de reintentos para un paso
 * Retorna true si se excedió el límite
 */
export function incrementRetry(state, step) {
  if (!state.retries) state.retries = {};
  state.retries[step] = (state.retries[step] || 0) + 1;
  
  return state.retries[step] > MAX_RETRIES_PER_STEP;
}

/**
 * Genera mensaje de "alternativas" cuando se exceden reintentos
 */
export function generateAlternativesMessage(state) {
  const draft = state.draft || {};
  
  let msg = "Parece que estamos teniendo dificultades. ";
  
  if (draft.sucursal_nombre) {
    msg += `Tengo que quieres recoger en ${draft.sucursal_nombre}. `;
  }
  
  msg += "¿Qué prefieres hacer?\n\n";
  msg += "1. 🔄 Empezar de nuevo\n";
  msg += "2. 👤 Hablar con una persona\n";
  msg += "3. 🌐 Ir a la tienda en línea\n";
  msg += "4. ❌ Cancelar\n";
  
  return msg;
}

/**
 * Genera respuesta empática para cliente frustrado
 */
export function generateEmpatheticResponse(frustration, state) {
  const messages = [
    "Entiendo que esto puede ser frustrante. ",
    "Disculpa las complicaciones. ",
    "Lamento que no esté siendo fácil. ",
  ];
  
  let msg = messages[Math.floor(Math.random() * messages.length)];
  
  if (frustration > 0.7) {
    msg += "¿Prefieres que te comunique con alguien del equipo para ayudarte directamente?";
  } else {
    msg += "¿Te gustaría intentar de otra forma o prefieres que te ayude una persona?";
  }
  
  return msg;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  interpretOrderMessage,
  incrementRetry,
  generateAlternativesMessage,
  generateEmpatheticResponse,
  MAX_RETRIES_PER_STEP,
  FRUSTRATION_THRESHOLD,
};
