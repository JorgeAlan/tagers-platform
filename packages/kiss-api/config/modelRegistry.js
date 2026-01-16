/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODEL REGISTRY v4.0 - Self-Learning AI Model Discovery System
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Sistema que APRENDE y DESCUBRE automáticamente cualquier modelo:
 * 
 * 🧠 AUTO-DISCOVERY:
 *    - Detecta modelo nuevo → Ejecuta probe automático
 *    - Prueba temperatura, json_mode, max_tokens
 *    - Almacena conocimiento para uso futuro
 * 
 * 📚 APRENDIZAJE CONTINUO:
 *    - Aprende de TODOS los errores de OpenAI
 *    - Ajusta tokens dinámicamente
 *    - Rate limiting con backoff exponencial
 * 
 * 💾 PERSISTENCIA:
 *    - Guarda conocimiento en DB (PostgreSQL)
 *    - Sobrevive restarts del servidor
 *    - Sincroniza entre instancias
 * 
 * FILOSOFÍA: Modelo nuevo? Lo pruebo, aprendo, y me adapto automáticamente.
 * 
 * @version 4.0.0
 * @author Tagers AI System
 */

import { logger } from "../src/utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE BASE - Memoria de capacidades de modelos
// ═══════════════════════════════════════════════════════════════════════════

const modelKnowledge = new Map();

const BOOTSTRAP_KNOWLEDGE = {
  // GPT-5 Family (2025+) - gpt-5-mini tiene problemas con json_mode en práctica
  "gpt-5-nano":  { supports_temperature: false, supports_json_mode: false, uses_max_completion_tokens: true },
  "gpt-5-mini":  { supports_temperature: false, supports_json_mode: false, uses_max_completion_tokens: true },
  "gpt-5-turbo": { supports_temperature: true,  supports_json_mode: true,  uses_max_completion_tokens: true },
  "gpt-5":       { supports_temperature: true,  supports_json_mode: true,  uses_max_completion_tokens: true },
  "gpt-4o":      { supports_temperature: true,  supports_json_mode: true,  uses_max_completion_tokens: false },
  "gpt-4o-mini": { supports_temperature: true,  supports_json_mode: true,  uses_max_completion_tokens: false },
  "gpt-4-turbo": { supports_temperature: true,  supports_json_mode: true,  uses_max_completion_tokens: false },
  "gpt-4":       { supports_temperature: true,  supports_json_mode: true,  uses_max_completion_tokens: false },
  "o1":          { supports_temperature: false, supports_json_mode: false, uses_max_completion_tokens: true },
  "o1-mini":     { supports_temperature: false, supports_json_mode: false, uses_max_completion_tokens: true },
  "o1-preview":  { supports_temperature: false, supports_json_mode: false, uses_max_completion_tokens: true },
  "o3-mini":     { supports_temperature: false, supports_json_mode: false, uses_max_completion_tokens: true },
};

for (const [model, caps] of Object.entries(BOOTSTRAP_KNOWLEDGE)) {
  modelKnowledge.set(model, { ...caps, source: "bootstrap", learned_at: null });
}

function getKnowledge(model) {
  if (!model) return getDefaultKnowledge();
  if (modelKnowledge.has(model)) return modelKnowledge.get(model);
  for (const [knownModel, knowledge] of modelKnowledge.entries()) {
    if (model.startsWith(knownModel)) return knowledge;
  }
  const optimistic = getDefaultKnowledge();
  modelKnowledge.set(model, optimistic);
  return optimistic;
}

function getDefaultKnowledge() {
  return {
    supports_temperature: true,
    supports_json_mode: true,
    uses_max_completion_tokens: false,
    source: "default_optimistic",
    learned_at: null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ADAPTIVE STATE - Estado dinámico que se ajusta en runtime
// ═══════════════════════════════════════════════════════════════════════════

const adaptiveState = {
  tokenMultipliers: new Map(),
  rateLimitUntil: 0,
  consecutiveRateLimits: 0,
  callDelay: 100,
  lastCallTime: 0,
  errorCounts: { empty_response: 0, rate_limit: 0, token_truncated: 0, server_error: 0, timeout: 0 },
};

export function getTokenMultiplier(role) {
  return adaptiveState.tokenMultipliers.get(role) || 1.0;
}

export function increaseTokens(role, currentTokens) {
  const currentMult = adaptiveState.tokenMultipliers.get(role) || 1.0;
  const newMult = Math.min(currentMult * 1.5, 4.0);
  adaptiveState.tokenMultipliers.set(role, newMult);
  const newTokens = Math.ceil(currentTokens * 1.5);
  logger.info({ role, oldMult: currentMult, newMult, suggestedTokens: newTokens }, "🔧 Auto-increased tokens");
  return newTokens;
}

export function getRecommendedDelay() {
  const now = Date.now();
  if (now < adaptiveState.rateLimitUntil) return adaptiveState.rateLimitUntil - now;
  const timeSinceLastCall = now - adaptiveState.lastCallTime;
  return Math.max(0, adaptiveState.callDelay - timeSinceLastCall);
}

export function recordCall() {
  adaptiveState.lastCallTime = Date.now();
}

export async function applyDelay() {
  const delay = getRecommendedDelay();
  if (delay > 0) await new Promise(r => setTimeout(r, delay));
  recordCall();
}

// ═══════════════════════════════════════════════════════════════════════════
// SISTEMA DE APRENDIZAJE AUTOMÁTICO EXPANDIDO
// ═══════════════════════════════════════════════════════════════════════════

const ERROR_PATTERNS = [
  { pattern: /temperature.*does not support|only.*default.*temperature.*1.*supported|temperature.*not.*supported/i, capability: "supports_temperature", newValue: false, action: "update_capability", description: "Model doesn't support custom temperature" },
  { pattern: /json_object.*not supported|response_format.*not support|json.*mode.*not.*available/i, capability: "supports_json_mode", newValue: false, action: "update_capability", description: "Model doesn't support JSON mode" },
  { pattern: /max_tokens.*not supported|use.*max_completion_tokens|max_tokens.*parameter.*deprecated/i, capability: "uses_max_completion_tokens", newValue: true, action: "update_capability", description: "Model requires max_completion_tokens" },
  { pattern: /max_completion_tokens.*not supported|unknown.*parameter.*max_completion_tokens/i, capability: "uses_max_completion_tokens", newValue: false, action: "update_capability", description: "Model requires max_tokens" },
  { pattern: /max_tokens.*reached|model.*output.*limit.*reached|finish_reason.*length|output.*truncated/i, action: "increase_tokens", description: "Output truncated - need more tokens" },
  { pattern: /rate.*limit|too.*many.*requests|429|quota.*exceeded/i, action: "rate_limit", description: "Rate limit hit - applying backoff" },
  { pattern: /500|502|503|504|internal.*server.*error|service.*unavailable/i, action: "server_error", description: "Server error - will retry" },
  { pattern: /timeout|timed.*out|ETIMEDOUT|ESOCKETTIMEDOUT/i, action: "timeout", description: "Request timeout - will retry" },
  { pattern: /empty.*response|no.*content|null.*response/i, action: "empty_response", description: "Empty response - will retry" },
];

export function learnFromError(model, errorMessage, context = {}) {
  if (!errorMessage) return { learned: false, shouldRetry: false };
  
  const result = { learned: false, shouldRetry: false, retryDelay: 0, adjustedTokens: null, disableJsonMode: false, description: null };
  const knowledge = model ? getKnowledge(model) : null;
  
  for (const ep of ERROR_PATTERNS) {
    if (!ep.pattern.test(errorMessage)) continue;
    result.description = ep.description;
    
    switch (ep.action) {
      case "update_capability":
        if (knowledge && knowledge[ep.capability] !== ep.newValue) {
          knowledge[ep.capability] = ep.newValue;
          knowledge.source = "learned_from_error";
          knowledge.learned_at = Date.now();
          result.learned = true;
          result.shouldRetry = true;
          if (ep.capability === "supports_json_mode") result.disableJsonMode = true;
          logger.info({ model, capability: ep.capability, newValue: ep.newValue }, "🧠 Model capability learned");
        }
        break;
        
      case "increase_tokens":
        adaptiveState.errorCounts.token_truncated++;
        const role = context.role || "default";
        const currentTokens = context.max_tokens || 500;
        result.adjustedTokens = increaseTokens(role, currentTokens);
        result.shouldRetry = true;
        result.learned = true;
        break;
        
      case "rate_limit":
        adaptiveState.errorCounts.rate_limit++;
        adaptiveState.consecutiveRateLimits++;
        const backoff = Math.min(1000 * Math.pow(2, adaptiveState.consecutiveRateLimits - 1), 30000);
        adaptiveState.rateLimitUntil = Date.now() + backoff;
        adaptiveState.callDelay = Math.min(adaptiveState.callDelay * 1.5, 2000);
        result.retryDelay = backoff;
        result.shouldRetry = adaptiveState.consecutiveRateLimits <= 5;
        result.learned = true;
        logger.warn({ backoffMs: backoff, consecutiveHits: adaptiveState.consecutiveRateLimits }, "⏳ Rate limit backoff");
        break;
        
      case "server_error":
        adaptiveState.errorCounts.server_error++;
        result.retryDelay = 2000;
        result.shouldRetry = true;
        break;
        
      case "timeout":
        adaptiveState.errorCounts.timeout++;
        result.retryDelay = 1000;
        result.shouldRetry = true;
        break;
        
      case "empty_response":
        adaptiveState.errorCounts.empty_response++;
        result.retryDelay = 500;
        result.shouldRetry = adaptiveState.errorCounts.empty_response <= 3;
        break;
    }
    break;
  }
  
  if (result.description && !result.description.includes("Rate limit")) {
    adaptiveState.consecutiveRateLimits = 0;
  }
  return result;
}

export function recordSuccess() {
  adaptiveState.consecutiveRateLimits = 0;
  adaptiveState.callDelay = Math.max(100, adaptiveState.callDelay * 0.9);
}

export function getAdaptiveStats() {
  return {
    tokenMultipliers: Object.fromEntries(adaptiveState.tokenMultipliers),
    callDelay: adaptiveState.callDelay,
    consecutiveRateLimits: adaptiveState.consecutiveRateLimits,
    errorCounts: { ...adaptiveState.errorCounts },
    rateLimitUntil: adaptiveState.rateLimitUntil > Date.now() ? new Date(adaptiveState.rateLimitUntil).toISOString() : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DESDE GOOGLE SHEET
// ═══════════════════════════════════════════════════════════════════════════

let _sheetModels = null;
let _configHub = null;

export function setConfigHub(hub) { _configHub = hub; }

export function setModelsFromSheet(models) {
  _sheetModels = models;
  if (models) logger.info({ roles: Object.keys(models) }, "AI models loaded from Google Sheet");
}

function getModelsFromSheet() {
  if (_sheetModels) return _sheetModels;
  if (_configHub?.getModels) { _sheetModels = _configHub.getModels(); return _sheetModels; }
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN POR ROL
// ═══════════════════════════════════════════════════════════════════════════

const ROLE_DEFAULTS = {
  schema_analyzer:       { model: "gpt-4o-mini", temperature: 0.1, max_tokens: 3000 },  // Alto para análisis de schemas complejos
  intent_classifier:     { model: "gpt-4o-mini", temperature: 0.1, max_tokens: 300 },
  tania_reply:           { model: "gpt-4o",      temperature: 0.7, max_tokens: 1000 },
  conversation_analyzer: { model: "gpt-4o-mini", temperature: 0.1, max_tokens: 500 },
  response_validator:    { model: "gpt-4o-mini", temperature: 0,   max_tokens: 200 },
  embeddings:            { model: "text-embedding-3-small", dimensions: 1536 },
  executor:              { model: "gpt-4o",      temperature: 0.3, max_tokens: 2000 },
};

export function getModelConfig(role) {
  const sheetModels = getModelsFromSheet();
  if (sheetModels?.[role]) return { ...sheetModels[role] };
  return { ...(ROLE_DEFAULTS[role] || ROLE_DEFAULTS.tania_reply) };
}

export function getModel(role) { return getModelConfig(role).model; }

// Mapeo de schemaKey a role para obtener la configuración correcta
const SCHEMA_TO_ROLE = {
  chatwoot_intent: "intent_classifier",
  order_step_classifier: "intent_classifier",
  flow_control_classifier: "intent_classifier",
  sentiment_result: "intent_classifier",
  tania_reply: "tania_reply",
  hitl_customer_reply: "tania_reply",
  incident_report: "tania_reply",
  conversation_analysis: "conversation_analyzer",
  response_validation: "response_validator",
};

export function getModelForSchema(schemaKey) {
  const role = SCHEMA_TO_ROLE[schemaKey] || "tania_reply";
  const config = getModelConfig(role);
  return {
    model: config.model,
    temperature: config.temperature,
    max_tokens: config.max_tokens,
    source: config.source || "registry",
  };
}

export function getChatParams(role) {
  const config = getModelConfig(role);
  const model = config.model;
  const knowledge = getKnowledge(model);
  const tokenMultiplier = getTokenMultiplier(role);
  const baseTokens = config.max_tokens || 500;
  const adjustedTokens = Math.ceil(baseTokens * tokenMultiplier);
  
  const params = { model };
  if (knowledge.supports_temperature && config.temperature !== undefined) params.temperature = config.temperature;
  if (knowledge.uses_max_completion_tokens) params.max_completion_tokens = adjustedTokens;
  else params.max_tokens = adjustedTokens;
  if (config.top_p !== undefined) params.top_p = config.top_p;
  return params;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES DE COMPATIBILIDAD
// ═══════════════════════════════════════════════════════════════════════════

export function supportsJsonMode(modelOrRole) {
  const model = ROLE_DEFAULTS[modelOrRole] ? getModel(modelOrRole) : modelOrRole;
  return getKnowledge(model).supports_json_mode;
}

export function requiresMaxCompletionTokens(modelOrRole) {
  const model = ROLE_DEFAULTS[modelOrRole] ? getModel(modelOrRole) : modelOrRole;
  return getKnowledge(model).uses_max_completion_tokens;
}

export function doesNotSupportCustomTemperature(modelOrRole) {
  const model = ROLE_DEFAULTS[modelOrRole] ? getModel(modelOrRole) : modelOrRole;
  return !getKnowledge(model).supports_temperature;
}

// ═══════════════════════════════════════════════════════════════════════════
// DEBUG Y UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

export function getAllKnowledge() { return Object.fromEntries(modelKnowledge); }
export function getModelKnowledge(model) { return getKnowledge(model); }

export function resetKnowledge() {
  modelKnowledge.clear();
  for (const [model, caps] of Object.entries(BOOTSTRAP_KNOWLEDGE)) {
    modelKnowledge.set(model, { ...caps, source: "bootstrap", learned_at: null });
  }
  adaptiveState.tokenMultipliers.clear();
  adaptiveState.rateLimitUntil = 0;
  adaptiveState.consecutiveRateLimits = 0;
  adaptiveState.callDelay = 100;
  adaptiveState.errorCounts = { empty_response: 0, rate_limit: 0, token_truncated: 0, server_error: 0, timeout: 0 };
  logger.info("Model knowledge and adaptive state reset");
}

// ═══════════════════════════════════════════════════════════════════════════
// 🧠 AUTO-DISCOVERY SYSTEM - Prueba modelos nuevos automáticamente
// ═══════════════════════════════════════════════════════════════════════════

let _openaiClient = null;
let _dbPool = null;

/**
 * Configura el cliente OpenAI para probing
 */
export function setOpenAIClient(client) {
  _openaiClient = client;
}

/**
 * Configura el pool de DB para persistencia
 */
export function setDbPool(pool) {
  _dbPool = pool;
}

/**
 * Probe automático de un modelo nuevo
 * Ejecuta pruebas mínimas para descubrir capacidades
 */
export async function probeModel(model) {
  if (!_openaiClient) {
    logger.warn({ model }, "Cannot probe model - OpenAI client not configured");
    return null;
  }
  
  // Si ya lo conocemos, no probar de nuevo
  const existing = modelKnowledge.get(model);
  if (existing && existing.source !== "default_optimistic") {
    return existing;
  }
  
  logger.info({ model }, "🔬 Starting auto-probe for new model...");
  
  const discovered = {
    supports_temperature: true,
    supports_json_mode: true,
    uses_max_completion_tokens: false,
    source: "auto_probed",
    learned_at: Date.now(),
    probe_results: {},
  };
  
  // Test 1: Temperature support
  try {
    await _openaiClient.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Say OK" }],
      temperature: 0.5,
      max_tokens: 5,
    });
    discovered.probe_results.temperature = "supported";
  } catch (e) {
    if (/temperature.*not support|only.*default.*temperature/i.test(e.message)) {
      discovered.supports_temperature = false;
      discovered.probe_results.temperature = "not_supported";
    } else if (/max_tokens.*not supported|use.*max_completion_tokens/i.test(e.message)) {
      discovered.uses_max_completion_tokens = true;
      discovered.probe_results.max_tokens_type = "max_completion_tokens";
    }
  }
  
  // Test 2: JSON mode support
  try {
    await _openaiClient.chat.completions.create({
      model,
      messages: [{ role: "user", content: "Reply with JSON: {\"ok\":true}" }],
      response_format: { type: "json_object" },
      ...(discovered.uses_max_completion_tokens 
        ? { max_completion_tokens: 20 } 
        : { max_tokens: 20 }),
      ...(discovered.supports_temperature ? { temperature: 0 } : {}),
    });
    discovered.probe_results.json_mode = "supported";
  } catch (e) {
    if (/json.*not support|response_format.*not support/i.test(e.message)) {
      discovered.supports_json_mode = false;
      discovered.probe_results.json_mode = "not_supported";
    }
  }
  
  // Test 3: Verify max_completion_tokens if not already detected
  if (!discovered.uses_max_completion_tokens) {
    try {
      await _openaiClient.chat.completions.create({
        model,
        messages: [{ role: "user", content: "OK" }],
        max_completion_tokens: 5,
        ...(discovered.supports_temperature ? { temperature: 0 } : {}),
      });
      discovered.uses_max_completion_tokens = true;
      discovered.probe_results.max_tokens_type = "max_completion_tokens";
    } catch (e) {
      if (/max_completion_tokens.*not supported|unknown.*parameter/i.test(e.message)) {
        discovered.uses_max_completion_tokens = false;
        discovered.probe_results.max_tokens_type = "max_tokens";
      }
    }
  }
  
  // Guardar conocimiento
  modelKnowledge.set(model, discovered);
  
  // Persistir en DB si está disponible
  await persistKnowledge(model, discovered);
  
  logger.info({ 
    model, 
    temperature: discovered.supports_temperature,
    json_mode: discovered.supports_json_mode,
    uses_max_completion_tokens: discovered.uses_max_completion_tokens,
  }, "🧠 Model capabilities discovered");
  
  return discovered;
}

/**
 * Obtiene conocimiento, probando automáticamente si es modelo nuevo
 */
export async function getKnowledgeWithProbe(model) {
  const existing = getKnowledge(model);
  
  // Si es conocimiento optimista (default), intentar probar
  if (existing.source === "default_optimistic" && _openaiClient) {
    const probed = await probeModel(model);
    if (probed) return probed;
  }
  
  return existing;
}

// ═══════════════════════════════════════════════════════════════════════════
// 💾 PERSISTENCIA - Guarda conocimiento en PostgreSQL
// ═══════════════════════════════════════════════════════════════════════════

const KNOWLEDGE_TABLE = "model_knowledge";

/**
 * Inicializa tabla de conocimiento si no existe
 */
export async function initKnowledgeTable() {
  if (!_dbPool) return false;
  
  try {
    await _dbPool.query(`
      CREATE TABLE IF NOT EXISTS ${KNOWLEDGE_TABLE} (
        model VARCHAR(100) PRIMARY KEY,
        supports_temperature BOOLEAN DEFAULT true,
        supports_json_mode BOOLEAN DEFAULT true,
        uses_max_completion_tokens BOOLEAN DEFAULT false,
        source VARCHAR(50) DEFAULT 'unknown',
        learned_at TIMESTAMPTZ,
        probe_results JSONB,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    logger.info("Model knowledge table initialized");
    return true;
  } catch (e) {
    logger.warn({ err: e.message }, "Failed to init knowledge table");
    return false;
  }
}

/**
 * Persiste conocimiento de un modelo en DB
 */
async function persistKnowledge(model, knowledge) {
  if (!_dbPool) return false;
  
  try {
    await _dbPool.query(`
      INSERT INTO ${KNOWLEDGE_TABLE} 
        (model, supports_temperature, supports_json_mode, uses_max_completion_tokens, source, learned_at, probe_results)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (model) DO UPDATE SET
        supports_temperature = EXCLUDED.supports_temperature,
        supports_json_mode = EXCLUDED.supports_json_mode,
        uses_max_completion_tokens = EXCLUDED.uses_max_completion_tokens,
        source = EXCLUDED.source,
        learned_at = EXCLUDED.learned_at,
        probe_results = EXCLUDED.probe_results,
        updated_at = NOW()
    `, [
      model,
      knowledge.supports_temperature,
      knowledge.supports_json_mode,
      knowledge.uses_max_completion_tokens,
      knowledge.source,
      knowledge.learned_at ? new Date(knowledge.learned_at) : null,
      knowledge.probe_results || null,
    ]);
    return true;
  } catch (e) {
    logger.warn({ model, err: e.message }, "Failed to persist model knowledge");
    return false;
  }
}

/**
 * Carga todo el conocimiento desde DB al iniciar
 */
export async function loadKnowledgeFromDb() {
  if (!_dbPool) return 0;
  
  try {
    const result = await _dbPool.query(`SELECT * FROM ${KNOWLEDGE_TABLE}`);
    let loaded = 0;
    
    for (const row of result.rows) {
      modelKnowledge.set(row.model, {
        supports_temperature: row.supports_temperature,
        supports_json_mode: row.supports_json_mode,
        uses_max_completion_tokens: row.uses_max_completion_tokens,
        source: row.source || "db_loaded",
        learned_at: row.learned_at ? new Date(row.learned_at).getTime() : null,
        probe_results: row.probe_results,
      });
      loaded++;
    }
    
    logger.info({ loaded }, "📚 Model knowledge loaded from DB");
    return loaded;
  } catch (e) {
    logger.warn({ err: e.message }, "Failed to load knowledge from DB");
    return 0;
  }
}

/**
 * Sincroniza conocimiento local a DB
 */
export async function syncKnowledgeToDb() {
  if (!_dbPool) return 0;
  
  let synced = 0;
  for (const [model, knowledge] of modelKnowledge.entries()) {
    if (knowledge.source !== "bootstrap") {
      const ok = await persistKnowledge(model, knowledge);
      if (ok) synced++;
    }
  }
  
  logger.info({ synced }, "💾 Knowledge synced to DB");
  return synced;
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔄 WRAPPER INTELIGENTE - Usa modelo con auto-adaptación
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta llamada a OpenAI con auto-learning y retry
 */
export async function smartCall(role, messages, options = {}) {
  if (!_openaiClient) {
    throw new Error("OpenAI client not configured - call setOpenAIClient first");
  }
  
  const config = getModelConfig(role);
  const model = config.model;
  
  // Obtener conocimiento (con probe si es nuevo)
  let knowledge = modelKnowledge.get(model);
  if (!knowledge || knowledge.source === "default_optimistic") {
    knowledge = await getKnowledgeWithProbe(model);
  }
  
  // Construir parámetros adaptativos
  const tokenMultiplier = getTokenMultiplier(role);
  const baseTokens = options.max_tokens || config.max_tokens || 500;
  const adjustedTokens = Math.ceil(baseTokens * tokenMultiplier);
  
  const params = {
    model,
    messages,
    ...options,
  };
  
  // Aplicar conocimiento del modelo
  if (knowledge.supports_temperature && config.temperature !== undefined) {
    params.temperature = config.temperature;
  } else {
    delete params.temperature;
  }
  
  if (knowledge.uses_max_completion_tokens) {
    params.max_completion_tokens = adjustedTokens;
    delete params.max_tokens;
  } else {
    params.max_tokens = adjustedTokens;
    delete params.max_completion_tokens;
  }
  
  if (options.json_mode && !knowledge.supports_json_mode) {
    delete params.response_format;
    // Agregar instrucción en el prompt
    if (params.messages.length > 0) {
      const last = params.messages[params.messages.length - 1];
      if (last.role === "user") {
        last.content += "\n\nRespond ONLY with valid JSON, no other text.";
      }
    }
  }
  
  // Aplicar delay si hay rate limiting
  await applyDelay();
  
  // Ejecutar con retry inteligente
  let lastError = null;
  const maxRetries = options.maxRetries || 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await _openaiClient.chat.completions.create(params);
      recordSuccess();
      return response;
    } catch (e) {
      lastError = e;
      const learning = learnFromError(model, e.message, { role, max_tokens: adjustedTokens });
      
      if (!learning.shouldRetry || attempt === maxRetries) {
        break;
      }
      
      // Ajustar parámetros si aprendimos algo
      if (learning.adjustedTokens) {
        if (knowledge.uses_max_completion_tokens) {
          params.max_completion_tokens = learning.adjustedTokens;
        } else {
          params.max_tokens = learning.adjustedTokens;
        }
      }
      
      if (learning.disableJsonMode) {
        delete params.response_format;
      }
      
      // Esperar antes de reintentar
      if (learning.retryDelay > 0) {
        await new Promise(r => setTimeout(r, learning.retryDelay));
      }
      
      logger.info({ 
        model, 
        attempt, 
        reason: learning.description,
        retryDelay: learning.retryDelay,
      }, "🔄 Retrying with adjusted params");
    }
  }
  
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPATIBILIDAD CON model_router.js
// ═══════════════════════════════════════════════════════════════════════════

export function routeTask(taskName) {
  const mapping = { reply: "tania_reply", classify: "intent_classifier", analyze: "conversation_analyzer", validate: "response_validator", schema: "schema_analyzer", embed: "embeddings", execute: "executor" };
  return getModel(mapping[taskName] || taskName);
}

export function fallbackModel(model) {
  const fallbacks = { "gpt-5": "gpt-4o", "gpt-5-mini": "gpt-4o-mini", "gpt-5-nano": "gpt-4o-mini", "gpt-5-turbo": "gpt-4-turbo", "gpt-4o": "gpt-4-turbo", "gpt-4o-mini": "gpt-4-turbo" };
  return fallbacks[model] || "gpt-4-turbo";
}

export function getRegistrySummary() {
  const sheetModels = getModelsFromSheet();
  return { source: sheetModels ? "google_sheet" : "defaults", roles: Object.keys(sheetModels || ROLE_DEFAULTS), adaptiveStats: getAdaptiveStats() };
}

export function listRoles() { return Object.keys(getModelsFromSheet() || ROLE_DEFAULTS); }

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const modelRegistry = {
  // Config y modelo
  getModel, getModelConfig, getModelForSchema, getChatParams,
  supportsJsonMode, requiresMaxCompletionTokens, doesNotSupportCustomTemperature,
  
  // Aprendizaje
  learnFromError, recordSuccess,
  getTokenMultiplier, increaseTokens, getRecommendedDelay, applyDelay, recordCall, getAdaptiveStats,
  
  // Auto-discovery
  probeModel, getKnowledgeWithProbe, setOpenAIClient,
  
  // Persistencia
  setDbPool, initKnowledgeTable, loadKnowledgeFromDb, syncKnowledgeToDb,
  
  // Smart call
  smartCall,
  
  // Configuración
  setModelsFromSheet, setConfigHub,
  routeTask, fallbackModel, getRegistrySummary, listRoles,
  
  // Debug
  getAllKnowledge, getModelKnowledge, resetKnowledge,
};

export default modelRegistry;
