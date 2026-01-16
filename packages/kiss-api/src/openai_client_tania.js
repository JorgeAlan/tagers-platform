/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAGERS KISS API - OPENAI CLIENT TANIA v2.1 (Model Registry Integration)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cliente OpenAI con Structured Outputs + Model Registry dinámico.
 * 
 * CAMBIO CLAVE vs v2.0:
 * - Modelos ahora se leen de Google Sheet (via Model Registry)
 * - Cambiar modelo = editar Sheet, sin deploy
 * - Fallback automático a defaults si Sheet no tiene config
 * 
 * @version 2.1.0 - Model Registry Integration
 */

import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import { traceable } from "langsmith/traceable";

import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { normalizeServiceTier } from "./openai_compat.js";

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY - Configuración dinámica desde Google Sheet
// ═══════════════════════════════════════════════════════════════════════════
import { 
  getModelForSchema, 
  getModel,
  getChatParams,
  modelRegistry,
  requiresMaxCompletionTokens,  // Auto-detecta si modelo usa max_completion_tokens
  doesNotSupportCustomTemperature  // Auto-detecta si modelo no soporta temperature
} from "../config/modelRegistry.js";

// Importar esquemas Zod
import {
  ChatwootIntentSchema,
  OrderStepSchema,
  FlowControlSchema,
  SentimentSchema,
  TaniaReplySchema,
  HitlCustomerReplySchema,
  IncidentReportSchema,
  ConversationAnalysisSchema,
  ResponseValidationSchema,
  ZodSchemas
} from "./schemas/zod_schemas.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES DE MODELOS (para referencia/compatibilidad)
// ═══════════════════════════════════════════════════════════════════════════

// Estos valores ahora se leen del Model Registry, pero se mantienen
// para compatibilidad con código que los importe directamente
export const MODELS = {
  NANO: "gpt-5-nano",
  MINI: "gpt-5-mini",
  STANDARD: "gpt-5.2",
  PRO: "gpt-5.2-pro",
  LEGACY: "gpt-4.1",
};

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTE OPENAI SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

let _openai = null;
let _langsmithLogged = false;

function isLangSmithEnabled() {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY;
}

function getOpenAIClient() {
  if (_openai) return _openai;
  
  _openai = new OpenAI({
    apiKey: config.openaiApiKeyTania || config.openaiApiKey,
    timeout: config.openaiTimeoutMs || 30000,
    maxRetries: config.openaiMaxRetries || 2,
  });
  
  if (!_langsmithLogged) {
    _langsmithLogged = true;
    if (isLangSmithEnabled()) {
      logger.info({
        msg: "LangSmith tracing enabled - Tania + Model Registry",
        project: process.env.LANGCHAIN_PROJECT || "default",
      });
    }
  }
  
  return _openai;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TEMPERATURE = 0;

// Mapeo de schemaKey a Zod Schema
const SCHEMA_MAP = {
  chatwoot_intent: ChatwootIntentSchema,
  order_step_classifier: OrderStepSchema,
  flow_control_classifier: FlowControlSchema,
  sentiment_result: SentimentSchema,
  tania_reply: TaniaReplySchema,
  hitl_customer_reply: HitlCustomerReplySchema,
  incident_report: IncidentReportSchema,
  conversation_analysis: ConversationAnalysisSchema,
  response_validation: ResponseValidationSchema,
};

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: createStructuredJSON (con Model Registry)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta una llamada a OpenAI con Structured Outputs nativos (Zod).
 * 
 * NUEVO: Si no se especifica modelo, se obtiene del Model Registry
 * basado en el schemaKey. Esto permite cambiar modelos desde Google Sheet.
 * 
 * @param {Object} params
 * @param {string} [params.model] - Modelo a usar (opcional, se obtiene del Registry)
 * @param {string} [params.service_tier] - Tier de servicio (auto/default/flex)
 * @param {string} params.instructions - System prompt
 * @param {Object} params.inputObject - Datos de entrada
 * @param {string} params.schemaKey - Clave del esquema en SCHEMA_MAP
 * @param {string} [params.schemaName] - Nombre para el formato de respuesta
 * @param {number} [params.temperature] - Temperatura (opcional, se obtiene del Registry)
 * @param {number} [params.max_tokens] - Tokens máximos (opcional, se obtiene del Registry)
 * @param {Object} [params.metadata] - Metadata para logging
 * @returns {Promise<{parsed: Object, raw: string, usage: Object}>}
 */
export async function createStructuredJSON({
  model,
  service_tier = "auto",
  instructions,
  inputObject,
  schemaKey,
  schemaName,
  temperature,
  max_tokens,
  metadata = {},
}) {
  const openai = getOpenAIClient();
  
  // Obtener esquema Zod
  const zodSchema = SCHEMA_MAP[schemaKey];
  if (!zodSchema) {
    throw new Error(`Unknown schemaKey: ${schemaKey}. Available: ${Object.keys(SCHEMA_MAP).join(", ")}`);
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // NUEVO: Obtener configuración del Model Registry
  // ═══════════════════════════════════════════════════════════════════════
  const registryConfig = getModelForSchema(schemaKey);
  
  // Usar parámetros explícitos o del Registry
  const effectiveModel = model || registryConfig.model;
  const effectiveTemperature = temperature ?? registryConfig.temperature ?? DEFAULT_TEMPERATURE;
  const effectiveMaxTokens = max_tokens ?? registryConfig.max_tokens ?? 800;
  const effectiveSchemaName = schemaName || schemaKey;
  
  // Construir mensajes
  const messages = [
    { role: "system", content: instructions },
    { role: "user", content: JSON.stringify(inputObject) }
  ];
  
  // ═══════════════════════════════════════════════════════════════════════
  // Función interna: llamada real a OpenAI
  // ═══════════════════════════════════════════════════════════════════════
  async function _doOpenAICall() {
    // Construir parámetros base
    const callParams = {
      model: effectiveModel,
      messages,
      response_format: zodResponseFormat(zodSchema, effectiveSchemaName),
    };
    
    // Algunos modelos no soportan temperature personalizada (gpt-5-nano, o1, o3)
    if (!doesNotSupportCustomTemperature(effectiveModel)) {
      callParams.temperature = effectiveTemperature;
    }
    
    // GPT-5, o1, o3 requieren max_completion_tokens en lugar de max_tokens
    if (requiresMaxCompletionTokens(effectiveModel)) {
      callParams.max_completion_tokens = effectiveMaxTokens;
    } else {
      callParams.max_tokens = effectiveMaxTokens;
    }
    
    // OpenAI SDK v5: usar chat.completions.parse directamente (sin .beta)
    const completion = await openai.chat.completions.parse(callParams);
    
    const choice = completion.choices[0];
    const message = choice?.message;
    
    // Manejar refusals
    if (message?.refusal) {
      logger.warn({ 
        schemaKey, 
        model: effectiveModel,
        refusal: message.refusal,
        metadata 
      }, "OpenAI refused to generate structured output");
      
      throw new Error(`Model refusal: ${message.refusal}`);
    }
    
    const parsed = message?.parsed;
    if (!parsed) {
      throw new Error("No parsed result in response");
    }
    
    return {
      parsed,
      raw: JSON.stringify(parsed),
      usage: completion.usage,
      model: completion.model,
      finish_reason: choice?.finish_reason,
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // Wrapper con traceable si LangSmith está habilitado
  // ═══════════════════════════════════════════════════════════════════════
  const callOnce = isLangSmithEnabled()
    ? traceable(_doOpenAICall, {
        name: `tania_${schemaKey}`,
        run_type: "llm",
        metadata: {
          ...metadata,
          model: effectiveModel,
          schemaKey,
          temperature: effectiveTemperature,
          source: registryConfig.source || "default",
        },
      })
    : _doOpenAICall;
  
  try {
    const result = await callOnce();
    
    logger.debug({
      schemaKey,
      model: result.model,
      configSource: registryConfig.source,
      tokens_in: result.usage?.prompt_tokens,
      tokens_out: result.usage?.completion_tokens,
      finish_reason: result.finish_reason,
    }, "Structured output completed");
    
    return result;
    
  } catch (error) {
    logger.error({
      err: error?.message || String(error),
      schemaKey,
      model: effectiveModel,
      metadata,
    }, "createStructuredJSON failed");
    
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES ESPECÍFICAS POR TAREA (ahora usan Registry automáticamente)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clasifica la intención del mensaje de Chatwoot
 * Modelo: desde Registry (default: gpt-5-nano)
 */
export async function classifyChatwootIntent({
  instructions,
  inputObject,
  model,  // Opcional - se obtiene del Registry si no se pasa
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "chatwoot_intent",
    schemaName: "chatwoot_intent",
    metadata: { task: "chatwoot_intent", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Clasifica el paso del flujo de pedido
 * Modelo: desde Registry (default: gpt-5-nano)
 */
export async function classifyOrderStep({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "order_step_classifier",
    schemaName: "order_step_classifier",
    metadata: { task: "order_step_classifier", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Detecta cambios de flujo o solicitudes de handoff
 * Modelo: desde Registry (default: gpt-5-nano)
 */
export async function classifyFlowControl({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "flow_control_classifier",
    schemaName: "flow_control_classifier",
    metadata: { task: "flow_control_classifier", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Analiza el sentimiento del mensaje
 * Modelo: desde Registry (default: gpt-5-nano)
 */
export async function analyzeSentiment({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "sentiment_result",
    schemaName: "sentiment_result",
    metadata: { task: "sentiment_analysis", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Genera respuesta de Tania al cliente
 * Modelo: desde Registry (default: gpt-5-mini)
 */
export async function generateTaniaReply({
  instructions,
  inputObject,
  model,
  temperature,  // Opcional - se obtiene del Registry si no se pasa
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "tania_reply",
    schemaName: "tania_reply",
    temperature,
    max_tokens: 1200,
    metadata: { task: "tania_reply", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Genera respuesta HITL asistida
 * Modelo: desde Registry (default: gpt-5-mini)
 */
export async function generateHitlReply({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "hitl_customer_reply",
    schemaName: "hitl_customer_reply",
    max_tokens: 1200,
    metadata: { task: "hitl_reply", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Genera reporte de incidente
 * Modelo: desde Registry (default: gpt-5-mini)
 */
export async function generateIncidentReport({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "incident_report",
    schemaName: "incident_report",
    metadata: { task: "incident_report", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Valida la calidad de una respuesta antes de enviar
 * Modelo: desde Registry (default: gpt-5-nano)
 */
export async function validateResponse({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "response_validation",
    schemaName: "response_validation",
    metadata: { task: "response_validation", ...metadata },
  });
  
  return result.parsed;
}

/**
 * Analiza conversación completa
 * Modelo: desde Registry (default: gpt-5-nano)
 */
export async function analyzeConversation({
  instructions,
  inputObject,
  model,
  metadata = {},
}) {
  const result = await createStructuredJSON({
    model,
    instructions,
    inputObject,
    schemaKey: "conversation_analysis",
    schemaName: "conversation_analysis",
    metadata: { task: "conversation_analysis", ...metadata },
  });
  
  return result.parsed;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDAD: Fallback seguro para errores
// ═══════════════════════════════════════════════════════════════════════════

export function getFallbackForSchema(schemaKey) {
  const fallbacks = {
    chatwoot_intent: {
      intent: "OTHER",
      branch_id: null,
      branch_confidence: 0,
      query_category: "other",
      needs_clarification: false,
      clarification_question: null,
      customer_wait_message: "Un momento por favor.",
      staff_prompt: null,
      customer_direct_answer: null,
      reservation_link: null,
      adhoc_object_description: null,
      order_context: null,
      lead_context: null,
    },
    order_step_classifier: {
      intent: "unknown",
      confirm_answer: "unknown",
      change_target: null,
      selection_number: null,
      product_text: null,
      branch_text: null,
      date_text: null,
      quantity: null,
      confidence: 0,
      notes: "Fallback due to error",
    },
    flow_control_classifier: {
      action: "continue",
      target_flow: null,
      confidence: 0,
      reasoning: "Fallback due to error",
    },
    sentiment_result: {
      sentiment: "NEUTRAL",
      confidence: 0,
      signals: [],
      recommended_action: "NORMAL",
      notes: "Fallback due to error",
    },
    tania_reply: {
      customer_message: "Disculpa, tuve un problema técnico. ¿Podrías repetir tu pregunta?",
      confidence: 0,
      used_promo: false,
      recommended_branches: [],
    },
    hitl_customer_reply: {
      reply_text: "Un agente te atenderá en breve.",
      sentiment_detected: "neutral",
      needs_escalation: true,
      suggested_actions: ["Revisar manualmente"],
      confidence: 0,
    },
    incident_report: {
      incident_type: "other",
      severity: "low",
      summary: "Error en generación de reporte",
      affected_branch: null,
      customer_impact: "Desconocido",
      recommended_resolution: "Revisar manualmente",
      requires_followup: true,
    },
    conversation_analysis: {
      conversation_summary: "Error en análisis",
      customer_intents: [],
      resolution_status: "unresolved",
      customer_satisfaction_estimate: "neutral",
      key_topics: [],
      improvement_suggestions: [],
    },
    response_validation: {
      quality_checks: {
        answers_question: false,
        includes_required_info: false,
        appropriate_tone: true,
        not_repetitive: true,
        clear_next_step: false,
      },
      issues_found: [],
      verdict: "needs_revision",
      revision_instructions: "Revisar manualmente debido a error",
      confidence: 0,
    },
  };
  
  return fallbacks[schemaKey] || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDAD: Obtener modelo recomendado (ahora desde Registry)
// ═══════════════════════════════════════════════════════════════════════════

export function getRecommendedModel(schemaKey) {
  const config = getModelForSchema(schemaKey);
  return config.model;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIONES
// ═══════════════════════════════════════════════════════════════════════════

export {
  getOpenAIClient,
  isLangSmithEnabled,
  SCHEMA_MAP,
  ZodSchemas,
  modelRegistry,  // Exportar registry para acceso directo
};

export default createStructuredJSON;
