/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPENAI HELPER v2.0 - Smart Call Wrapper with Auto-Learning
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Wrapper inteligente para llamadas a OpenAI que:
 * 1. Detecta errores de parámetros no soportados
 * 2. Aprende automáticamente (via modelRegistry)
 * 3. Reintenta con parámetros corregidos
 * 4. Extrae JSON de cualquier respuesta
 * 
 * UBICACIÓN: /app/src/utils/openaiHelper.js
 * 
 * @version 2.0.0
 * @author Tagers AI System
 */

import { logger } from "./logger.js";
import { 
  getChatParams, 
  supportsJsonMode, 
  learnFromError 
} from "../../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// SMART CALL - Llamada inteligente con retry y aprendizaje
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta una llamada a OpenAI con retry inteligente.
 * Si falla por parámetros no soportados, aprende y reintenta.
 * 
 * @param {OpenAI} client - Cliente OpenAI
 * @param {object} params - Parámetros para chat.completions.create
 * @param {object} options - Opciones adicionales
 * @param {number} options.maxRetries - Máximo de reintentos (default: 2)
 * @param {string} options.role - Rol para reconstruir params si es necesario
 * @returns {Promise<object>} Respuesta de OpenAI
 */
export async function smartCall(client, params, options = {}) {
  const { maxRetries = 2, role = null } = options;
  
  let currentParams = { ...params };
  let lastError = null;
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      const response = await client.chat.completions.create(currentParams);
      
      // Log éxito si hubo reintentos
      if (attempt > 1) {
        logger.info({ 
          model: currentParams.model, 
          attempt,
          role,
        }, "✅ OpenAI call succeeded after retry");
      }
      
      return response;
      
    } catch (error) {
      lastError = error;
      const errorMsg = error.message || String(error);
      
      // Intentar aprender del error
      const learned = learnFromError(currentParams.model, errorMsg);
      
      if (learned && attempt <= maxRetries) {
        // Reconstruir parámetros con el nuevo conocimiento
        if (role) {
          // Usar getChatParams que ahora tiene el conocimiento actualizado
          const newBaseParams = getChatParams(role);
          currentParams = {
            ...newBaseParams,
            messages: params.messages,
          };
          
          // Re-agregar response_format si el modelo lo soporta
          if (params.response_format && supportsJsonMode(currentParams.model)) {
            currentParams.response_format = params.response_format;
          }
        } else {
          // Sin rol, intentar quitar el parámetro problemático manualmente
          currentParams = rebuildParamsFromError(currentParams, errorMsg);
        }
        
        logger.warn({
          model: currentParams.model,
          attempt,
          nextAttempt: attempt + 1,
          learned: true,
        }, "🔄 Retrying OpenAI call with learned params");
        
        continue;
      }
      
      // No aprendimos nada o ya no quedan reintentos
      break;
    }
  }
  
  // Todos los intentos fallaron
  throw lastError;
}

/**
 * Reconstruye parámetros quitando el que causó el error.
 * Se usa cuando no hay rol disponible para getChatParams.
 */
function rebuildParamsFromError(params, errorMsg) {
  const newParams = { ...params };
  
  if (/temperature/i.test(errorMsg)) {
    delete newParams.temperature;
  }
  
  if (/response_format|json/i.test(errorMsg)) {
    delete newParams.response_format;
  }
  
  if (/max_tokens.*not supported|use.*max_completion_tokens/i.test(errorMsg)) {
    if (newParams.max_tokens) {
      newParams.max_completion_tokens = newParams.max_tokens;
      delete newParams.max_tokens;
    }
  }
  
  if (/max_completion_tokens.*not supported/i.test(errorMsg)) {
    if (newParams.max_completion_tokens) {
      newParams.max_tokens = newParams.max_completion_tokens;
      delete newParams.max_completion_tokens;
    }
  }
  
  return newParams;
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON EXTRACTION - Extracción robusta de JSON
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae JSON de cualquier texto, incluso si viene envuelto en markdown.
 * Funciona con o sin json_mode habilitado.
 * 
 * @param {string} text - Texto que contiene JSON
 * @returns {object} JSON parseado
 * @throws {Error} Si no puede extraer JSON válido
 */
export function extractJson(text) {
  if (!text || typeof text !== "string") {
    throw new Error("extractJson: empty or invalid input");
  }
  
  const trimmed = text.trim();
  
  // 1. Intentar parse directo (caso ideal: json_mode activo)
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    // Continuar con otros métodos
  }
  
  // 2. Extraer de bloques de código markdown
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1].trim());
    } catch (e) {
      // Continuar
    }
  }
  
  // 3. Buscar objeto JSON en el texto
  const jsonObjectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    try {
      return JSON.parse(jsonObjectMatch[0]);
    } catch (e) {
      // Intentar reparaciones comunes
      const repaired = repairJson(jsonObjectMatch[0]);
      try {
        return JSON.parse(repaired);
      } catch (e2) {
        // Continuar
      }
    }
  }
  
  // 4. Buscar array JSON en el texto
  const jsonArrayMatch = trimmed.match(/\[[\s\S]*\]/);
  if (jsonArrayMatch) {
    try {
      return JSON.parse(jsonArrayMatch[0]);
    } catch (e) {
      // Continuar
    }
  }
  
  // No se pudo extraer JSON
  throw new Error(`extractJson: cannot extract valid JSON from: ${trimmed.substring(0, 100)}...`);
}

/**
 * Intenta reparar JSON malformado común.
 */
function repairJson(jsonStr) {
  let repaired = jsonStr;
  
  // Quitar trailing commas antes de } o ]
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");
  
  // Convertir single quotes a double quotes (cuidado con apostrofes)
  // Solo si no hay double quotes (indica que usaron single quotes para todo)
  if (!repaired.includes('"') && repaired.includes("'")) {
    repaired = repaired.replace(/'/g, '"');
  }
  
  // Agregar quotes a keys sin quotes (ej: {key: "value"} → {"key": "value"})
  repaired = repaired.replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
  
  return repaired;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae el contenido de texto de una respuesta de OpenAI.
 */
export function getResponseContent(response) {
  return response?.choices?.[0]?.message?.content || "";
}

/**
 * Verifica si una respuesta tiene contenido válido.
 */
export function hasValidContent(response) {
  const content = getResponseContent(response);
  return content && content.trim().length > 0;
}

/**
 * Extrae JSON directamente de una respuesta de OpenAI.
 */
export function extractJsonFromResponse(response) {
  const content = getResponseContent(response);
  return extractJson(content);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const openaiHelper = {
  smartCall,
  extractJson,
  extractJsonFromResponse,
  getResponseContent,
  hasValidContent,
};

export default openaiHelper;
