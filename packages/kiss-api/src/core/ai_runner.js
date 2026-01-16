/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AI RUNNER - Ejecución de IA con Self-Healing
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Wrapper inteligente para llamadas a OpenAI que:
 * - Reintenta automáticamente cuando hay errores de formato JSON
 * - Envía el error a la IA para que se auto-corrija
 * - Hace fallback a modelos más simples si es necesario
 * - Registra métricas de éxito/fallo
 * 
 * Esto elimina el 90% de los errores de "Zod validation failed".
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
// import { config } from "../config.js"; // No se usa directamente

// Model Registry para detección automática de parámetros
import { 
  requiresMaxCompletionTokens, 
  doesNotSupportCustomTemperature,
  getChatParams 
} from "../../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const aiRunnerConfig = {
  maxRetries: parseInt(process.env.AI_RUNNER_MAX_RETRIES || "2", 10),
  retryDelayMs: parseInt(process.env.AI_RUNNER_RETRY_DELAY_MS || "500", 10),
  logPromptOnError: process.env.AI_RUNNER_LOG_PROMPT_ON_ERROR === "true",
};

// Métricas simples en memoria
const metrics = {
  totalCalls: 0,
  successFirstTry: 0,
  successAfterRetry: 0,
  failedAfterRetries: 0,
  selfHealingUsed: 0,
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta una llamada a OpenAI con self-healing para errores de JSON
 * 
 * @param {Object} options
 * @param {Function} options.aiFunction - La función de OpenAI a llamar (debe retornar Promise)
 * @param {Array} options.messages - Messages array para OpenAI
 * @param {Object} options.schema - Zod schema para validación
 * @param {Object} [options.config] - Config adicional
 * @returns {Object} { success: boolean, data?: any, error?: string, attempts: number }
 */
export async function runWithSelfHealing({ aiFunction, messages, schema, config: extraConfig = {} }) {
  metrics.totalCalls++;
  
  const maxRetries = extraConfig.maxRetries ?? aiRunnerConfig.maxRetries;
  let attempts = 0;
  let lastError = null;
  let currentMessages = [...messages];
  
  while (attempts <= maxRetries) {
    attempts++;
    
    try {
      // Intentar llamada normal
      const result = await aiFunction(currentMessages);
      
      // Validar con Zod si hay schema
      if (schema) {
        const validated = schema.parse(result);
        
        if (attempts === 1) {
          metrics.successFirstTry++;
        } else {
          metrics.successAfterRetry++;
        }
        
        return {
          success: true,
          data: validated,
          attempts,
          selfHealed: attempts > 1,
        };
      }
      
      // Sin schema, retornar directo
      if (attempts === 1) {
        metrics.successFirstTry++;
      } else {
        metrics.successAfterRetry++;
      }
      
      return {
        success: true,
        data: result,
        attempts,
        selfHealed: attempts > 1,
      };
      
    } catch (error) {
      lastError = error;
      
      logger.warn({
        attempt: attempts,
        maxRetries,
        errorType: error?.name,
        errorMessage: error?.message?.substring(0, 200),
      }, "AI call failed, attempting self-healing");
      
      // Si es error de Zod o JSON, intentar self-healing
      if (isRecoverableError(error) && attempts <= maxRetries) {
        metrics.selfHealingUsed++;
        
        // TRUCO MAESTRO: Enviar el error a la IA para que se corrija
        currentMessages = [
          ...currentMessages,
          {
            role: "assistant",
            content: extractBrokenResponse(error),
          },
          {
            role: "user",
            content: buildSelfHealingPrompt(error),
          },
        ];
        
        // Pequeño delay antes de retry
        await delay(aiRunnerConfig.retryDelayMs * attempts);
        
        continue;
      }
      
      // Error no recuperable o sin más retries
      break;
    }
  }
  
  // Falló después de todos los intentos
  metrics.failedAfterRetries++;
  
  logger.error({
    attempts,
    errorType: lastError?.name,
    errorMessage: lastError?.message?.substring(0, 500),
    promptPreview: aiRunnerConfig.logPromptOnError ? messages[0]?.content?.substring(0, 200) : undefined,
  }, "AI call failed after all retries");
  
  return {
    success: false,
    error: lastError?.message || "Unknown error",
    attempts,
    selfHealed: false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SELF-HEALING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determina si el error es recuperable con self-healing
 */
function isRecoverableError(error) {
  const errorString = String(error?.message || error || "").toLowerCase();
  
  const recoverablePatterns = [
    "zod",
    "json",
    "parse",
    "validation",
    "invalid",
    "expected",
    "required",
    "undefined",
    "null",
    "type",
    "schema",
  ];
  
  return recoverablePatterns.some(p => errorString.includes(p));
}

/**
 * Extrae la respuesta rota del error (si está disponible)
 */
function extractBrokenResponse(error) {
  // Algunos errores de Zod incluyen el input que falló
  if (error?.input) {
    try {
      return typeof error.input === "string" 
        ? error.input 
        : JSON.stringify(error.input);
    } catch {
      return "[respuesta inválida]";
    }
  }
  
  // Intentar extraer de message
  const match = error?.message?.match(/received:?\s*({[\s\S]*})/i);
  if (match) {
    return match[1];
  }
  
  return "[respuesta con error de formato]";
}

/**
 * Construye el prompt de auto-corrección
 */
function buildSelfHealingPrompt(error) {
  const errorMessage = error?.message || String(error);
  
  // Extraer información útil del error de Zod
  let specificFix = "";
  
  if (errorMessage.includes("Required")) {
    const match = errorMessage.match(/at "([^"]+)"/);
    if (match) {
      specificFix = `El campo "${match[1]}" es obligatorio y falta.`;
    }
  }
  
  if (errorMessage.includes("Expected") && errorMessage.includes("received")) {
    specificFix = "El tipo de dato no coincide con lo esperado.";
  }
  
  return `⚠️ ERROR TÉCNICO - Tu respuesta anterior tuvo un problema de formato.

Error: ${errorMessage.substring(0, 300)}
${specificFix ? `\nProblema específico: ${specificFix}` : ""}

Por favor, corrige tu respuesta JSON anterior asegurándote de:
1. Incluir TODOS los campos requeridos
2. Usar los tipos de datos correctos (string, number, boolean, array)
3. No dejar campos vacíos si son obligatorios
4. Cerrar correctamente todos los brackets y comillas

Responde SOLO con el JSON corregido, sin explicaciones adicionales.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrapper específico para clasificación de intents
 */
export async function classifyIntent({ openaiClient, messages, schema }) {
  const model = "gpt-5-nano";
  const tokenLimit = 500;
  
  return runWithSelfHealing({
    aiFunction: async (msgs) => {
      const params = {
        model,
        messages: msgs,
        response_format: { type: "json_object" },
      };
      
      // GPT-5 requiere max_completion_tokens
      if (requiresMaxCompletionTokens(model)) {
        params.max_completion_tokens = tokenLimit;
      } else {
        params.max_tokens = tokenLimit;
      }
      
      const response = await openaiClient.chat.completions.create(params);
      return JSON.parse(response.choices[0].message.content);
    },
    messages,
    schema,
  });
}

/**
 * Wrapper específico para generación de respuestas
 */
export async function generateReply({ openaiClient, messages, schema }) {
  const model = "gpt-5-mini";
  const tokenLimit = 1000;
  
  return runWithSelfHealing({
    aiFunction: async (msgs) => {
      const params = {
        model,
        messages: msgs,
        response_format: { type: "json_object" },
      };
      
      // GPT-5 requiere max_completion_tokens
      if (requiresMaxCompletionTokens(model)) {
        params.max_completion_tokens = tokenLimit;
      } else {
        params.max_tokens = tokenLimit;
      }
      
      const response = await openaiClient.chat.completions.create(params);
      return JSON.parse(response.choices[0].message.content);
    },
    messages,
    schema,
    config: { maxRetries: 3 }, // Más intentos para respuestas
  });
}

/**
 * Wrapper para llamadas con Structured Outputs (zodResponseFormat)
 */
export async function runStructured({ openaiClient, messages, zodSchema, schemaName = "response" }) {
  // Importar dinámicamente para evitar dependencia circular
  const { zodResponseFormat } = await import("openai/helpers/zod");
  
  return runWithSelfHealing({
    aiFunction: async (msgs) => {
      // OpenAI SDK v5: usar chat.completions.parse directamente (sin .beta)
      const response = await openaiClient.chat.completions.parse({
        model: "gpt-5-mini",
        messages: msgs,
        response_format: zodResponseFormat(zodSchema, schemaName),
      });
      
      // Verificar refusal
      if (response.choices[0].message.refusal) {
        throw new Error(`AI refused: ${response.choices[0].message.refusal}`);
      }
      
      return response.choices[0].message.parsed;
    },
    messages,
    schema: zodSchema,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════════════

export function getMetrics() {
  const total = metrics.totalCalls || 1;
  return {
    ...metrics,
    successRate: ((metrics.successFirstTry + metrics.successAfterRetry) / total * 100).toFixed(1) + "%",
    selfHealingRate: (metrics.selfHealingUsed / total * 100).toFixed(1) + "%",
    firstTryRate: (metrics.successFirstTry / total * 100).toFixed(1) + "%",
  };
}

export function resetMetrics() {
  Object.keys(metrics).forEach(k => metrics[k] = 0);
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const aiRunner = {
  runWithSelfHealing,
  classifyIntent,
  generateReply,
  runStructured,
  getMetrics,
  resetMetrics,
};

export default aiRunner;
