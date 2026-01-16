/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - SYNC SERVICE v2.0 (AI Auto-Discovery)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Orquesta la sincronización con:
 * - 🤖 AI Auto-Discovery: GPT analiza estructura de Google Sheet
 * - Smart Sync (Hash MD5) - No actualiza si no hay cambios
 * - Validación flexible
 * - Persistencia en Postgres
 * - Push a WordPress
 * - Vector Store population automático
 * 
 * CAMBIO CLAVE vs v1:
 * - v1: Mapeo hardcoded de pestañas
 * - v2: AI analiza cualquier estructura
 * 
 * @version 2.0.0
 */

import crypto from 'crypto';
import { readGoogleSheets, readAllSheets } from './sheets-reader.js';
import { FullConfigSchema } from './schemas.js';
import { pushToWordPress } from './wp-pusher.js';
import { saveConfig, getLastConfig, getLastHash, saveHash } from './config-store.js';
import { formatConfigForLLM } from './format-for-llm.js';
import { notifyError, notifySuccess } from './notifier.js';

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR STORE + AI ANALYZER
// ═══════════════════════════════════════════════════════════════════════════
import { vectorPopulator } from '../vector/vectorPopulator.js';
import { schemaAnalyzer } from '../vector/schemaAnalyzer.js';

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY - Para cargar modelos del Sheet ANTES del análisis AI
// ═══════════════════════════════════════════════════════════════════════════
import { setModelsFromSheet } from '../../config/modelRegistry.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const syncSettings = {
  // Modo de operación
  mode: process.env.CONFIG_HUB_MODE || 'auto', // 'auto' | 'legacy'
  
  // Usar AI para analizar estructura
  useAI: process.env.CONFIG_HUB_USE_AI !== 'false',
  
  // Validación estricta con Zod (false = más flexible)
  strictValidation: process.env.CONFIG_HUB_STRICT_VALIDATION === 'true',
};

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════════

// Config en memoria para acceso instantáneo
global.ANA_CONFIG = null;
global.ANA_CONFIG_VERSION = 0;
global.ANA_CONFIG_UPDATED_AT = null;
global.ANA_CONFIG_HASH = null;
global.ANA_CONFIG_ERROR = null;
global.ANA_CONFIG_LLM = null;
global.ANA_RAW_SHEETS = null;      // Datos crudos para AI
global.ANA_SCHEMA_ANALYSIS = null; // Resultado del análisis AI

// Rate limiting
let lastSyncTime = 0;
let lastRefreshTime = 0;
const MIN_SYNC_INTERVAL_MS = 60 * 1000;
const MIN_REFRESH_INTERVAL_MS = 60 * 1000;

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY HELPERS - Cargar modelos del Sheet
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Parsea el array de AI_Models del Sheet al formato del modelRegistry
 * 
 * Input (desde Sheet):
 * [
 *   { role: "schema_analyzer", model: "gpt-5-mini", temperature: 0.1, max_tokens: 500, enabled: true },
 *   { role: "tania_reply", model: "gpt-5-mini", temperature: 0.7, max_tokens: 1200, enabled: true },
 * ]
 * 
 * Output (para modelRegistry):
 * {
 *   "schema_analyzer": { model: "gpt-5-mini", temperature: 0.1, max_tokens: 500 },
 *   "tania_reply": { model: "gpt-5-mini", temperature: 0.7, max_tokens: 1200 },
 * }
 */
function parseAIModelsFromSheet(aiModelsArray) {
  if (!aiModelsArray || !Array.isArray(aiModelsArray) || aiModelsArray.length === 0) {
    return null;
  }
  
  const models = {};
  
  for (const row of aiModelsArray) {
    if (!row.role || !row.model) continue;
    
    const enabled = row.enabled;
    if (enabled === false || enabled === 'false' || enabled === 'FALSE' || enabled === 0 || enabled === '0') {
      continue;
    }
    
    const role = String(row.role).toLowerCase().trim();
    const config = { model: String(row.model).trim() };
    
    if (row.temperature !== undefined && row.temperature !== null && row.temperature !== '') {
      const temp = parseFloat(row.temperature);
      if (!isNaN(temp)) config.temperature = temp;
    }
    
    if (row.max_tokens !== undefined && row.max_tokens !== null && row.max_tokens !== '') {
      const tokens = parseInt(row.max_tokens, 10);
      if (!isNaN(tokens) && tokens > 0) config.max_tokens = tokens;
    }
    
    if (row.top_p !== undefined && row.top_p !== null && row.top_p !== '') {
      const topP = parseFloat(row.top_p);
      if (!isNaN(topP)) config.top_p = topP;
    }
    
    models[role] = config;
  }
  
  return Object.keys(models).length > 0 ? models : null;
}

/**
 * Carga los modelos AI desde la configuración leída
 * DEBE llamarse ANTES de usar schemaAnalyzer o cualquier AI
 */
function loadAIModelsToRegistry(rawConfig) {
  const aiModelsArray = rawConfig?.ai_models || rawConfig?._rawSheets?.AI_Models?.rows;
  
  if (!aiModelsArray || aiModelsArray.length === 0) {
    log('debug', 'No AI_Models found in Sheet, using defaults');
    return false;
  }
  
  const parsedModels = parseAIModelsFromSheet(aiModelsArray);
  
  if (parsedModels) {
    setModelsFromSheet(parsedModels);
    log('info', '🤖 AI Models loaded from Sheet', { 
      roles: Object.keys(parsedModels),
      schema_analyzer: parsedModels.schema_analyzer?.model || 'default',
    });
    return true;
  }
  
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function generateConfigHash(config) {
  const configForHash = { ...config };
  delete configForHash.updated_at;
  delete configForHash.config_hash;
  delete configForHash._rawSheets;
  delete configForHash._metadata;
  
  const json = JSON.stringify(configForHash, Object.keys(configForHash).sort());
  return crypto.createHash('md5').update(json).digest('hex');
}

function log(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [CONFIG-HUB] [${level.toUpperCase()}]`;
  
  if (Object.keys(data).length > 0) {
    console.log(`${prefix} ${message}`, JSON.stringify(data));
  } else {
    console.log(`${prefix} ${message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR POPULATION CON AI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pobla vectores usando AI para analizar estructura
 */
async function populateVectorsWithAI(rawSheetsData) {
  if (process.env.VECTOR_STORE_ENABLED !== 'true') {
    log('debug', 'Vector store disabled');
    return null;
  }
  
  if (!rawSheetsData || !Object.keys(rawSheetsData).length) {
    log('warn', 'No raw sheets data for AI analysis');
    return null;
  }
  
  try {
    log('info', '🤖 Starting AI schema analysis...');
    
    // Usar AI para analizar estructura
    const result = await vectorPopulator.populateWithAutoDiscovery(rawSheetsData);
    
    if (result.populated) {
      // Guardar análisis para referencia
      global.ANA_SCHEMA_ANALYSIS = result.analysis;
      
      log('info', '✅ AI analysis complete', {
        sheetsAnalyzed: result.stats?.sheetsAnalyzed,
        sheetsIndexed: result.stats?.sheetsIndexed,
        documentsCreated: result.stats?.inserted,
        categories: result.stats?.byCategory,
      });
    }
    
    return result;
    
  } catch (err) {
    log('error', `AI vector population failed: ${err.message}`);
    return { populated: false, error: err.message };
  }
}

/**
 * Pobla vectores en modo legacy (sin AI)
 */
async function populateVectorsLegacy(config) {
  if (process.env.VECTOR_STORE_ENABLED !== 'true') {
    return null;
  }
  
  try {
    const result = await vectorPopulator.populateFromConfigHub(config);
    if (result.populated) {
      log('info', 'Vector embeddings populated (legacy)', result.stats);
    }
    return result;
  } catch (err) {
    log('warn', `Failed to populate vectors (legacy): ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK CONFIG
// ═══════════════════════════════════════════════════════════════════════════

const FALLBACK_CONFIG = {
  version: 0,
  updated_at: new Date().toISOString(),
  is_fallback: true,
  
  meta: {
    timezone: 'America/Mexico_City',
    currency: 'MXN',
  },
  
  brand: {
    brand_name: 'Tagers',
    whatsapp_display: '221 281 6591',
    whatsapp_url: 'https://wa.me/5212212816591',
    website: 'https://tagers.com',
  },
  
  persona: {
    agent_name: 'Ana',
    agent_suffix: '• IA',
    tone: 'amigable',
    greeting: '¡Hola! Soy Tan • IA de Tagers. Estoy teniendo problemas técnicos. Por favor escríbenos por WhatsApp al 221 281 6591.',
    fallback_message: 'Por favor escríbenos al WhatsApp 221 281 6591',
  },
  
  branches: [],
  branch_hours: [],
  menus: [],
  seasons: [],
  promos: [],
  push_rules: [],
  faq: [],
  notices: [],
  staff: [],
  escalation: [],
  canned: [],
  roscas: [],
  products: [],
  knowledge: [],
};

const FALLBACK_LLM = `## Estado del Sistema
⚠️ MODO FALLBACK - Configuración de emergencia activa

## Información Básica
- Marca: Tagers
- WhatsApp: 221 281 6591

## Instrucciones
Estás operando con configuración mínima. Dirige al cliente a WhatsApp.`;

// ═══════════════════════════════════════════════════════════════════════════
// SYNC PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sincroniza configuración desde Google Sheets
 * 
 * @param {Object} options - Opciones
 * @param {boolean} options.force - Forzar sync aunque hash sea igual
 * @returns {Promise<Object>} Resultado del sync
 */
export async function syncConfig(options = {}) {
  const { force = false } = options;
  
  const now = Date.now();
  
  // Rate limiting
  if (!force && (now - lastSyncTime) < MIN_SYNC_INTERVAL_MS) {
    const waitSeconds = Math.ceil((MIN_SYNC_INTERVAL_MS - (now - lastSyncTime)) / 1000);
    log('info', `Sync skipped - rate limit (esperar ${waitSeconds}s)`);
    return { 
      success: true, 
      skipped: true, 
      reason: 'rate_limit',
      wait_seconds: waitSeconds,
    };
  }
  
  lastSyncTime = now;
  log('info', `Starting sync... (mode: ${syncSettings.mode}, useAI: ${syncSettings.useAI})`);
  
  try {
    // ─────────────────────────────────────────────────────────────────────────
    // 1. Leer Google Sheets (con datos crudos)
    // ─────────────────────────────────────────────────────────────────────────
    
    const rawConfig = await readGoogleSheets();
    const rawSheets = rawConfig._rawSheets || null;
    
    log('info', `Read from Sheets`, {
      version: rawConfig.version,
      rawSheets: rawSheets ? Object.keys(rawSheets).length : 0,
    });
    
    // Guardar datos crudos para AI
    if (rawSheets) {
      global.ANA_RAW_SHEETS = rawSheets;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 1.5. 🆕 CARGAR MODELOS AI ANTES DE CUALQUIER ANÁLISIS
    // ─────────────────────────────────────────────────────────────────────────
    
    const modelsLoaded = loadAIModelsToRegistry(rawConfig);
    if (!modelsLoaded) {
      log('debug', 'Using default AI models (no AI_Models sheet found)');
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 2. Validar (flexible o estricto)
    // ─────────────────────────────────────────────────────────────────────────
    
    let validatedConfig;
    
    if (syncSettings.strictValidation) {
      // Validación estricta con Zod
      validatedConfig = FullConfigSchema.parse(rawConfig);
      log('info', 'Strict validation passed');
    } else {
      // Validación flexible: usar config como viene
      validatedConfig = {
        ...FALLBACK_CONFIG,
        ...rawConfig,
      };
      // Limpiar campos internos
      delete validatedConfig._rawSheets;
      delete validatedConfig._metadata;
      log('info', 'Flexible validation (schema not enforced)');
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 3. Smart Sync - Verificar hash
    // ─────────────────────────────────────────────────────────────────────────
    
    const newHash = generateConfigHash(validatedConfig);
    const lastHash = global.ANA_CONFIG_HASH || await getLastHash();
    
    // Generar versión para LLM
    const llmConfig = formatConfigForLLM(validatedConfig);
    
    const needsMemoryHydration =
      !global.ANA_CONFIG ||
      !global.ANA_CONFIG_LLM ||
      global.ANA_CONFIG_HASH !== newHash;
    
    if (needsMemoryHydration) {
      global.ANA_CONFIG = validatedConfig;
      global.ANA_CONFIG_VERSION = validatedConfig.version;
      global.ANA_CONFIG_UPDATED_AT = new Date().toISOString();
      global.ANA_CONFIG_HASH = newHash;
      global.ANA_CONFIG_ERROR = null;
      global.ANA_CONFIG_LLM = llmConfig;
      
      log('info', 'In-memory config hydrated', { 
        version: validatedConfig.version, 
        hash: newHash.substring(0, 8) 
      });
      
      // ═══ VECTOR STORE: Poblar con AI si está habilitado ═══
      if (syncSettings.useAI && rawSheets) {
        populateVectorsWithAI(rawSheets).catch(err => {
          log('warn', `AI vector population failed: ${err.message}`);
        });
      } else {
        populateVectorsLegacy(validatedConfig).catch(err => {
          log('warn', `Legacy vector population failed: ${err.message}`);
        });
      }
    }
    
    // Si no hay cambios, skip
    if (!force && newHash === lastHash) {
      // Push a WordPress si es necesario
      if (global.ANA_WP_PUSHED_HASH !== newHash) {
        try {
          await pushToWordPress(validatedConfig, { hash: newHash });
          global.ANA_WP_PUSHED_HASH = newHash;
          log('info', 'Pushed to WordPress (warmup)');
        } catch (wpError) {
          log('error', `WordPress push failed: ${wpError.message}`);
        }
      }
      
      log('info', 'No changes detected, skipping full sync');
      return {
        success: true,
        skipped: true,
        reason: 'no_changes',
        hash: newHash,
        version: validatedConfig.version,
      };
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 4-5. Guardar en DB
    // ─────────────────────────────────────────────────────────────────────────
    
    await saveConfig(validatedConfig);
    await saveHash(newHash);
    log('info', 'Saved to database');
    
    // ─────────────────────────────────────────────────────────────────────────
    // 6. Actualizar memoria
    // ─────────────────────────────────────────────────────────────────────────
    
    global.ANA_CONFIG = validatedConfig;
    global.ANA_CONFIG_VERSION = validatedConfig.version;
    global.ANA_CONFIG_UPDATED_AT = new Date().toISOString();
    global.ANA_CONFIG_HASH = newHash;
    global.ANA_CONFIG_ERROR = null;
    global.ANA_CONFIG_LLM = llmConfig;
    
    // ═══ VECTOR STORE: Poblar cuando hay cambios ═══
    if (syncSettings.useAI && rawSheets) {
      populateVectorsWithAI(rawSheets).catch(err => {
        log('warn', `AI vector population failed: ${err.message}`);
      });
    } else {
      populateVectorsLegacy(validatedConfig).catch(err => {
        log('warn', `Legacy vector population failed: ${err.message}`);
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 7. Push a WordPress
    // ─────────────────────────────────────────────────────────────────────────
    
    try {
      await pushToWordPress(validatedConfig, { hash: newHash });
      global.ANA_WP_PUSHED_HASH = newHash;
      log('info', 'Pushed to WordPress');
    } catch (wpError) {
      log('error', `WordPress push failed: ${wpError.message}`);
      await notifyError({
        title: '⚠️ WordPress Push Failed',
        message: wpError.message,
        severity: 'warning',
      });
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // 8. Notificar éxito
    // ─────────────────────────────────────────────────────────────────────────
    
    if (force) {
      await notifySuccess({
        title: '🔄 Config Refresh Manual',
        message: `Version ${validatedConfig.version} cargada`,
      });
    }
    
    log('info', 'Sync completed successfully', { 
      version: validatedConfig.version,
      hash: newHash.substring(0, 8),
      mode: syncSettings.mode,
    });
    
    return {
      success: true,
      skipped: false,
      version: validatedConfig.version,
      hash: newHash,
      changes: true,
      mode: syncSettings.mode,
      aiAnalysis: global.ANA_SCHEMA_ANALYSIS?.summary || null,
    };
    
  } catch (error) {
    log('error', `Sync failed: ${error.message}`);
    global.ANA_CONFIG_ERROR = error.message;
    
    await notifyError({
      title: '🔴 Config Sync Failed',
      message: error.message,
      severity: 'critical',
    });
    
    if (!global.ANA_CONFIG) {
      log('warn', 'Loading fallback config...');
      await loadFallbackConfig();
    }
    
    return {
      success: false,
      error: error.message,
      using_fallback: !global.ANA_CONFIG || global.ANA_CONFIG.is_fallback,
    };
  }
}

/**
 * Carga configuración de fallback
 */
async function loadFallbackConfig() {
  try {
    const lastValid = await getLastConfig();
    if (lastValid && !lastValid.is_fallback) {
      global.ANA_CONFIG = lastValid;
      global.ANA_CONFIG_VERSION = lastValid.version;
      global.ANA_CONFIG_UPDATED_AT = lastValid.updated_at;
      global.ANA_CONFIG_LLM = formatConfigForLLM(lastValid);
      log('info', 'Loaded last valid config from database', { version: lastValid.version });
      return;
    }
  } catch (dbError) {
    log('error', `Failed to load from database: ${dbError.message}`);
  }
  
  global.ANA_CONFIG = FALLBACK_CONFIG;
  global.ANA_CONFIG_VERSION = 0;
  global.ANA_CONFIG_UPDATED_AT = new Date().toISOString();
  global.ANA_CONFIG_LLM = FALLBACK_LLM;
  log('warn', 'Using hardcoded fallback config');
}

// ═══════════════════════════════════════════════════════════════════════════
// REFRESH MANUAL
// ═══════════════════════════════════════════════════════════════════════════

export async function forceRefresh(context = {}) {
  const now = Date.now();
  const { requestedBy = 'unknown', ip = '' } = context;
  
  if ((now - lastRefreshTime) < MIN_REFRESH_INTERVAL_MS) {
    const waitSeconds = Math.ceil((MIN_REFRESH_INTERVAL_MS - (now - lastRefreshTime)) / 1000);
    log('warn', `Refresh blocked - rate limit`, { requestedBy, ip, waitSeconds });
    return {
      success: false,
      error: 'rate_limit',
      wait_seconds: waitSeconds,
      message: `Espera ${waitSeconds} segundos antes de otro refresh`,
    };
  }
  
  lastRefreshTime = now;
  log('info', `Manual refresh requested`, { requestedBy, ip });
  
  await notifySuccess({
    title: '🔄 Refresh Manual',
    message: `Solicitado por: ${requestedBy}`,
  });
  
  return await syncConfig({ force: true });
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-ANALYZE: Forzar nuevo análisis AI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fuerza un nuevo análisis AI de la estructura
 * Útil cuando cambias las pestañas del Google Sheet
 */
export async function reanalyzeWithAI() {
  log('info', '🤖 Forcing AI re-analysis...');
  
  // Limpiar cache del analyzer
  schemaAnalyzer.clearCache();
  
  // Leer sheets frescos
  const { sheets } = await readAllSheets();
  global.ANA_RAW_SHEETS = sheets;
  
  // 🆕 Recargar modelos AI del Sheet ANTES del análisis
  const rawConfig = await readGoogleSheets();
  loadAIModelsToRegistry(rawConfig);
  
  // Analizar con AI (ahora usa modelos del Sheet)
  const analysis = await schemaAnalyzer.analyzeGoogleSheet(sheets);
  global.ANA_SCHEMA_ANALYSIS = analysis;
  
  // Poblar vectores con nuevo análisis
  if (process.env.VECTOR_STORE_ENABLED === 'true') {
    await vectorPopulator.populateWithAutoDiscovery(sheets);
  }
  
  log('info', '✅ AI re-analysis complete', analysis.summary);
  
  return {
    success: true,
    analysis,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════════════════

export function getConfig() {
  return global.ANA_CONFIG;
}

export function getConfigForLLM() {
  return global.ANA_CONFIG_LLM;
}

export function getRawSheets() {
  return global.ANA_RAW_SHEETS;
}

export function getSchemaAnalysis() {
  return global.ANA_SCHEMA_ANALYSIS;
}

export function getConfigHealth() {
  const now = new Date();
  const updatedAt = global.ANA_CONFIG_UPDATED_AT 
    ? new Date(global.ANA_CONFIG_UPDATED_AT) 
    : null;
  const stalenessSeconds = updatedAt 
    ? Math.floor((now - updatedAt) / 1000) 
    : null;
  
  return {
    version: global.ANA_CONFIG_VERSION,
    updated_at: global.ANA_CONFIG_UPDATED_AT,
    hash: global.ANA_CONFIG_HASH?.substring(0, 12),
    staleness_seconds: stalenessSeconds,
    is_stale: stalenessSeconds ? stalenessSeconds > 600 : true,
    last_error: global.ANA_CONFIG_ERROR,
    has_config: !!global.ANA_CONFIG,
    is_fallback: global.ANA_CONFIG?.is_fallback || false,
    mode: syncSettings.mode,
    ai_enabled: syncSettings.useAI,
    ai_analysis: global.ANA_SCHEMA_ANALYSIS?.summary || null,
    raw_sheets_count: global.ANA_RAW_SHEETS ? Object.keys(global.ANA_RAW_SHEETS).length : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// SYNC PERIÓDICO
// ═══════════════════════════════════════════════════════════════════════════

let syncInterval = null;

export function startPeriodicSync(intervalMinutes = 5) {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  const intervalMs = intervalMinutes * 60 * 1000;
  
  log('info', `Starting periodic sync every ${intervalMinutes} minutes (AI: ${syncSettings.useAI})`);
  syncConfig();
  
  syncInterval = setInterval(() => {
    syncConfig();
  }, intervalMs);
  
  return syncInterval;
}

export function stopPeriodicSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    log('info', 'Periodic sync stopped');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  syncConfig,
  forceRefresh,
  reanalyzeWithAI,
  getConfig,
  getConfigForLLM,
  getRawSheets,
  getSchemaAnalysis,
  getConfigHealth,
  startPeriodicSync,
  stopPeriodicSync,
};
