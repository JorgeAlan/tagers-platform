/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTIC FLOW - Respuestas generales con IA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja todas las consultas que no son flujos estructurados:
 * - Preguntas sobre amenidades
 * - Información turística
 * - Horarios y ubicaciones
 * - Preguntas generales
 * 
 * Usa el modelo de generación para responder.
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { logger } from "../utils/logger.js";
import { conversationHistoryService } from "../services/conversationHistoryService.js";
import { generateTaniaReply } from "../openai_client_tania.js";

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

async function handle(ctx, intent) {
  const { conversationId, messageText, branchHint } = ctx;
  
  logger.info({
    conversationId,
    intent: intent?.intent,
    queryCategory: intent?.query_category,
  }, "AgenticFlow: handling");
  
  const history = conversationHistoryService.getHistoryForLLM(conversationId, 15);
  
  const instructions = buildSystemPrompt(intent, branchHint);
  
  try {
    const result = await generateTaniaReply({
      instructions,
      inputObject: {
        customer_query: messageText,
        conversation_history: history,
        intent: intent?.intent,
        query_category: intent?.query_category,
        branch_hint: branchHint?.branch_id,
        context: {
          // TODO: Cargar datos dinámicos
          branches: getDefaultBranches(),
          products: getDefaultProducts(),
          amenities: getDefaultAmenities(),
        },
      },
    });
    
    if (result?.customer_message) {
      return { message: result.customer_message };
    }
  } catch (error) {
    logger.error({ err: error?.message, conversationId }, "Agentic reply generation failed");
  }
  
  // Fallback
  return {
    message: "Disculpa, no pude procesar tu pregunta. ¿Puedes darme más detalles o reformularla?",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DE PROMPT
// ═══════════════════════════════════════════════════════════════════════════

function buildSystemPrompt(intent, branchHint) {
  return `Eres Ana, asistente virtual de Tagers café. Eres amigable, profesional y concisa.

REGLAS:
- Responde de forma natural y conversacional
- No uses listas a menos que sea necesario
- Máximo 2-3 oraciones por respuesta
- Si no sabes algo, di que verificarás y ofrecerás ayuda
- Si mencionan una sucursal específica, enfócate en esa

INFORMACIÓN SOBRE TAGERS:
- Cafeterías en CDMX (San Ángel) y Puebla (Angelópolis, Sonata, Zavaleta, 5 Sur)
- Famosos por las Roscas de Reyes (temporada: diciembre-enero)
- Todas las sucursales tienen WiFi, estacionamiento, y aceptan mascotas en terraza
- Horario general: 7am-10pm

INTENT DETECTADO: ${intent?.intent || "GENERAL"}
CATEGORÍA: ${intent?.query_category || "other"}
${branchHint?.branch_id ? `SUCURSAL DEL INBOX: ${branchHint.branch_id}` : ""}

Genera una respuesta útil y amigable.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// DATOS POR DEFECTO (TODO: Cargar de Config Hub)
// ═══════════════════════════════════════════════════════════════════════════

function getDefaultBranches() {
  return [
    { branch_id: "SAN_ANGEL", name: "San Ángel", city: "CDMX" },
    { branch_id: "ANGELOPOLIS", name: "Angelópolis", city: "Puebla" },
    { branch_id: "SONATA", name: "Sonata", city: "Puebla" },
    { branch_id: "ZAVALETA", name: "Zavaleta", city: "Puebla" },
    { branch_id: "5_SUR", name: "5 Sur", city: "Puebla" },
  ];
}

function getDefaultProducts() {
  return [
    { key: "clasica", name: "Rosca Clásica" },
    { key: "nutella", name: "Rosca de Nutella" },
    { key: "lotus", name: "Rosca Lotus" },
    { key: "dulce_de_leche", name: "Rosca Dulce de Leche" },
    { key: "explosion", name: "Rosca Explosión" },
    { key: "reina", name: "Rosca Reina" },
  ];
}

function getDefaultAmenities() {
  return {
    wifi: { available: true, network: "Tagers_Guest" },
    parking: { available: true, free: true },
    pet_friendly: { available: true, area: "terraza" },
    kids_area: { available: ["SONATA", "SAN_ANGEL"] },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const agenticFlow = { handle };
export default agenticFlow;
