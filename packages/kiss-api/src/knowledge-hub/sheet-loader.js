/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KNOWLEDGE HUB - SHEET LOADER v2.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Lee el formato TAN_IA_KNOWLEDGE_BASE_TEMPLATE desde Google Sheets.
 * 
 * PESTAÑAS ESPERADAS:
 * - KNOWLEDGE_FEED: Reglas, políticas, FAQs, promos
 * - PRODUCTS: Productos con fuzzy_keywords
 * - BRANCHES: Sucursales con synonyms
 * - AGENT_CONFIG: Configuración del agente
 * - TOOLS: Herramientas disponibles
 * - CANNED: Mensajes predefinidos
 * - SEASON_RULES: Reglas de temporada (NUEVO)
 * - SEASON_CONFIG: Configuración de temporada (NUEVO)
 * - ORDER_MODIFY_POLICY: Políticas de modificación (NUEVO)
 * 
 * @version 2.0.0
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE PESTAÑAS
// ═══════════════════════════════════════════════════════════════════════════

const SHEET_NAMES = {
  KNOWLEDGE_FEED: 'KNOWLEDGE_FEED',
  PRODUCTS: 'PRODUCTS',
  BRANCHES: 'BRANCHES',
  AGENT_CONFIG: 'AGENT_CONFIG',
  TOOLS: 'TOOLS',
  CANNED: 'CANNED',
  // Nuevas pestañas para reglas de temporada
  SEASON_RULES: 'SEASON_RULES',
  SEASON_CONFIG: 'SEASON_CONFIG',
  ORDER_MODIFY_POLICY: 'ORDER_MODIFY_POLICY',
};

// ═══════════════════════════════════════════════════════════════════════════
// AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════════════

let cachedAuth = null;

function getAuth() {
  if (cachedAuth) return cachedAuth;
  
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  
  if (!email || !key) {
    console.warn('[KNOWLEDGE-HUB] Google credentials not configured, using fallback');
    return null;
  }
  
  cachedAuth = new JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  
  return cachedAuth;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function rowToObject(row, headers) {
  const obj = {};
  headers.forEach(header => {
    const cleanHeader = header.replace('★', '').trim();
    const value = row.get(header);
    obj[cleanHeader] = value !== undefined && value !== null ? value : '';
  });
  return obj;
}

function parseBoolean(val) {
  if (typeof val === 'boolean') return val;
  const s = String(val || '').toLowerCase().trim();
  return ['true', '1', 'sí', 'si', 'yes', 'activo'].includes(s);
}

function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

function isActiveNow(row) {
  if (parseBoolean(row.enabled) === false) return false;
  
  const now = new Date();
  const start = parseDate(row.start_at);
  const end = parseDate(row.end_at);
  
  if (start && now < start) return false;
  if (end && now > end) return false;
  
  return true;
}

async function readSheet(doc, sheetName, options = {}) {
  const { filterEnabled = true, filterActive = false } = options;
  
  const sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) {
    console.warn(`[KNOWLEDGE-HUB] Sheet "${sheetName}" not found`);
    return [];
  }
  
  try {
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    const headers = sheet.headerValues;
    
    let results = rows.map(row => rowToObject(row, headers));
    
    if (filterEnabled) {
      results = results.filter(row => parseBoolean(row.enabled) !== false);
    }
    
    if (filterActive) {
      results = results.filter(isActiveNow);
    }
    
    return results;
  } catch (error) {
    console.error(`[KNOWLEDGE-HUB] Error reading "${sheetName}":`, error.message);
    return [];
  }
}

async function readKeyValueSheet(doc, sheetName) {
  const sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) {
    console.warn(`[KNOWLEDGE-HUB] Sheet "${sheetName}" not found`);
    return {};
  }
  
  try {
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows();
    
    const result = {};
    rows.forEach(row => {
      const key = row.get('key') || row.get('key★');
      const value = row.get('value') || row.get('value★');
      if (key && key.trim()) {
        result[key.trim()] = value !== undefined ? value : '';
      }
    });
    
    return result;
  } catch (error) {
    console.error(`[KNOWLEDGE-HUB] Error reading "${sheetName}":`, error.message);
    return {};
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESADORES POR TIPO
// ═══════════════════════════════════════════════════════════════════════════

function processProducts(rows) {
  return rows.map(row => ({
    woo_id: row.woo_id || null,
    sku: row.sku || '',
    name: row.name || '',
    category: row.category || '',
    price: parseFloat(row.price) || 0,
    fuzzy_keywords: (row.fuzzy_keywords || '')
      .split(',')
      .map(k => k.trim().toLowerCase())
      .filter(Boolean),
    description: row.description || '',
    agent_notes: row.agent_notes || '',
    allergens: row.allergens || '',
    enabled: parseBoolean(row.enabled),
  }));
}

function processBranches(rows) {
  return rows.map(row => ({
    branch_id: row.branch_id || '',
    name: row.name || '',
    city: row.city || '',
    synonyms: (row.synonyms || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    address: row.address || '',
    phone: row.phone || '',
    hours_default: row.hours_default || '',
    services: (row.services || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
    maps_url: row.maps_url || '',
    enabled: parseBoolean(row.enabled),
  }));
}

function processKnowledge(rows) {
  return rows.map(row => ({
    id: row.id || '',
    type: row.type || 'INFO',
    priority: row.priority || 'MEDIUM',
    scope: row.scope || 'GLOBAL',
    embedding_text: row.embedding_text || '',
    action_trigger: row.action_trigger || null,
    start_at: parseDate(row.start_at),
    end_at: parseDate(row.end_at),
    branch_id: row.branch_id || 'ALL',
    enabled: parseBoolean(row.enabled),
    _is_active: isActiveNow(row),
  }));
}

function processTools(rows) {
  return rows.map(row => ({
    tool_name: row.tool_name || '',
    trigger_phrases: (row.trigger_phrases || '')
      .split(',')
      .map(p => p.trim().toLowerCase())
      .filter(Boolean),
    required_params: row.required_params || '',
    description: row.description || '',
    example_response: row.example_response || '',
    enabled: parseBoolean(row.enabled),
  }));
}

function processCanned(rows) {
  return rows.map(row => ({
    key: row.key || '',
    message: row.message || '',
    use_case: row.use_case || '',
    variables: (row.variables || '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean),
    enabled: parseBoolean(row.enabled),
  }));
}

/**
 * Procesa reglas de temporada (NUEVO)
 * 
 * Columnas esperadas:
 * rule_id, rule_type, start_date, end_date, min_lead_days, channels,
 * product_categories, priority, message_bot, can_check_stock, can_suggest_branch, enabled
 */
function processSeasonRules(rows) {
  return rows.map(row => ({
    rule_id: row.rule_id || '',
    rule_type: (row.rule_type || 'PREVENTA').toUpperCase(),
    start_date: row.start_date || null,
    end_date: row.end_date || null,
    min_lead_days: parseInt(row.min_lead_days) || 0,
    channels: row.channels || 'all',
    product_categories: row.product_categories || 'all',
    priority: parseInt(row.priority) || 10,
    message_bot: row.message_bot || '',
    can_check_stock: parseBoolean(row.can_check_stock),
    can_suggest_branch: parseBoolean(row.can_suggest_branch),
    enabled: parseBoolean(row.enabled),
  }));
}

/**
 * Procesa configuración de temporada (NUEVO)
 * Key-value format
 */
function processSeasonConfig(data) {
  return {
    season_name: data.season_name || 'Temporada',
    season_start: data.season_start || null,
    season_end: data.season_end || null,
    default_min_lead_days: parseInt(data.default_min_lead_days) || 2,
    timezone: data.timezone || 'America/Mexico_City',
    bot_channel_id: data.bot_channel_id || 'bot',
  };
}

/**
 * Procesa política de modificación de pedidos (NUEVO)
 * Key-value format
 */
function processOrderModifyPolicy(data) {
  // Parsear fechas bloqueadas
  let blockedDates = [];
  if (data.blocked_dates_for_modify) {
    blockedDates = String(data.blocked_dates_for_modify)
      .split(',')
      .map(d => d.trim())
      .filter(Boolean);
  }
  
  return {
    enabled: parseBoolean(data.enabled !== undefined ? data.enabled : true),
    require_verification: parseBoolean(data.require_verification !== undefined ? data.require_verification : true),
    verification_fields: String(data.verification_fields || 'phone,email')
      .split(',')
      .map(f => f.trim())
      .filter(Boolean),
    blocked_dates_for_modify: data.blocked_dates_for_modify || '',
    blocked_dates: blockedDates,
    blocked_modify_message: data.blocked_modify_message || 
      'Para cambios en pedidos de esa fecha, contacta directamente a la sucursal.',
    min_hours_before_modify: parseInt(data.min_hours_before_modify) || 24,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

export async function loadKnowledgeBase() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    console.warn('[KNOWLEDGE-HUB] GOOGLE_SHEET_ID not configured, using fallback');
    return getFallbackConfig();
  }
  
  const auth = getAuth();
  if (!auth) {
    return getFallbackConfig();
  }
  
  console.log('[KNOWLEDGE-HUB] Loading from Google Sheets...');
  
  try {
    const doc = new GoogleSpreadsheet(sheetId, auth);
    await doc.loadInfo();
    console.log(`[KNOWLEDGE-HUB] Document loaded: "${doc.title}"`);
    
    // Cargar todas las pestañas en paralelo
    const [
      knowledgeRaw,
      productsRaw,
      branchesRaw,
      agentConfig,
      toolsRaw,
      cannedRaw,
      seasonRulesRaw,
      seasonConfigRaw,
      orderModifyPolicyRaw,
    ] = await Promise.all([
      readSheet(doc, SHEET_NAMES.KNOWLEDGE_FEED, { filterEnabled: true }),
      readSheet(doc, SHEET_NAMES.PRODUCTS, { filterEnabled: true }),
      readSheet(doc, SHEET_NAMES.BRANCHES, { filterEnabled: true }),
      readKeyValueSheet(doc, SHEET_NAMES.AGENT_CONFIG),
      readSheet(doc, SHEET_NAMES.TOOLS, { filterEnabled: true }),
      readSheet(doc, SHEET_NAMES.CANNED, { filterEnabled: true }),
      readSheet(doc, SHEET_NAMES.SEASON_RULES, { filterEnabled: true }),
      readKeyValueSheet(doc, SHEET_NAMES.SEASON_CONFIG),
      readKeyValueSheet(doc, SHEET_NAMES.ORDER_MODIFY_POLICY),
    ]);
    
    const config = {
      version: Date.now(),
      updated_at: new Date().toISOString(),
      
      // Pestañas originales
      knowledge: processKnowledge(knowledgeRaw),
      products: processProducts(productsRaw),
      branches: processBranches(branchesRaw),
      agent: agentConfig,
      tools: processTools(toolsRaw),
      canned: processCanned(cannedRaw),
      
      // Nuevas pestañas de temporada
      season_rules: processSeasonRules(seasonRulesRaw),
      season_config: processSeasonConfig(seasonConfigRaw),
      order_modify_policy: processOrderModifyPolicy(orderModifyPolicyRaw),
    };
    
    console.log('[KNOWLEDGE-HUB] Loaded:', {
      knowledge: config.knowledge.length,
      products: config.products.length,
      branches: config.branches.length,
      tools: config.tools.length,
      canned: config.canned.length,
      season_rules: config.season_rules.length,
      has_season_config: Object.keys(config.season_config).length > 0,
      has_order_modify_policy: config.order_modify_policy.enabled !== undefined,
    });
    
    return config;
    
  } catch (error) {
    console.error('[KNOWLEDGE-HUB] Failed to load:', error.message);
    return getFallbackConfig();
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK (cuando no hay Google Sheets configurado)
// ═══════════════════════════════════════════════════════════════════════════

function getFallbackConfig() {
  console.warn('[KNOWLEDGE-HUB] Using fallback configuration');
  
  return {
    version: 0,
    updated_at: new Date().toISOString(),
    _is_fallback: true,
    
    knowledge: [],
    
    products: [
      { woo_id: '27422', sku: 'ROSCA-CLASICA', name: 'Rosca Clásica', category: 'roscas', price: 529, fuzzy_keywords: ['clasica', 'tradicional', 'normal', 'sencilla'], description: '', agent_notes: '', allergens: '', enabled: true },
      { woo_id: '27450', sku: 'ROSCA-DULCE', name: 'Rosca Dulce de Leche', category: 'roscas', price: 695, fuzzy_keywords: ['dulce', 'cajeta', 'nuez'], description: '', agent_notes: 'Contiene nuez', allergens: 'nuez', enabled: true },
      { woo_id: '43512', sku: 'ROSCA-LOTUS', name: 'Rosca Lotus', category: 'roscas', price: 695, fuzzy_keywords: ['lotus', 'biscoff', 'galleta'], description: '', agent_notes: '', allergens: '', enabled: true },
      { woo_id: '27447', sku: 'ROSCA-NUTELLA', name: 'Rosca Nutella', category: 'roscas', price: 695, fuzzy_keywords: ['nutella', 'chocolate', 'avellana'], description: '', agent_notes: '', allergens: 'avellana', enabled: true },
    ],
    
    branches: [
      { branch_id: 'SONATA', name: 'Tagers Sonata', city: 'Puebla', synonyms: ['sonata', 'lomas', 'atlixcayotl'], address: '', phone: '', hours_default: 'L-D: 8-22h', services: ['wifi', 'terraza', 'pet_friendly'], maps_url: '', enabled: true },
      { branch_id: 'ANGELOPOLIS', name: 'Tagers Angelópolis', city: 'Puebla', synonyms: ['angelopolis', 'angelópolis', 'paseo', 'mall'], address: '', phone: '', hours_default: 'L-D: 10-21h', services: ['wifi', 'kids_area'], maps_url: '', enabled: true },
      { branch_id: 'ZAVALETA', name: 'Tagers Zavaleta', city: 'Puebla', synonyms: ['zavaleta', 'zava'], address: '', phone: '', hours_default: 'L-D: 8-22h', services: ['wifi', 'terraza', 'pet_friendly'], maps_url: '', enabled: true },
      { branch_id: '5SUR', name: 'Tagers 5 Sur', city: 'Puebla', synonyms: ['5 sur', 'cinco sur', '5sur', 'centro'], address: '', phone: '', hours_default: 'L-D: 8-22h', services: ['wifi', 'pet_friendly'], maps_url: '', enabled: true },
      { branch_id: 'SAN_ANGEL', name: 'Tagers San Ángel', city: 'CDMX', synonyms: ['san angel', 'san ángel', 'cdmx', 'mexico', 'df'], address: '', phone: '', hours_default: 'L-D: 8-22h', services: ['wifi', 'terraza'], maps_url: '', enabled: true },
    ],
    
    agent: {
      agent_name: 'Tan • IA',
      brand_name: 'Tagers',
      tone_general: 'Cálida, amigable, profesional',
      greeting_default: '¡Hola! Soy Tan • IA de Tagers 🥐 ¿En qué puedo ayudarte?',
    },
    
    tools: [
      { tool_name: 'woo_check_stock', trigger_phrases: ['disponible', 'hay', 'tienen', 'stock'], required_params: 'product_id', description: 'Verificar stock', example_response: '', enabled: true },
      { tool_name: 'escalate_human', trigger_phrases: ['humano', 'persona', 'agente'], required_params: '', description: 'Escalar a humano', example_response: '', enabled: true },
    ],
    
    canned: [
      { key: 'greeting', message: '¡Hola! Soy {agent_name} de {brand_name} 🥐 ¿En qué puedo ayudarte?', use_case: 'Saludo inicial', variables: ['agent_name', 'brand_name'], enabled: true },
      { key: 'escalate', message: 'Te comunico con alguien del equipo. Un momento por favor 🙏', use_case: 'Escalar a humano', variables: [], enabled: true },
    ],
    
    // Fallback de reglas de temporada (NO USAR EN PRODUCCIÓN)
    // Estas reglas deben venir del Sheet
    season_rules: [
      // Push días específicos (Dic 24, 31)
      { rule_id: 'PUSH_DIC_24', rule_type: 'PUSH', start_date: '2025-12-24', end_date: '2025-12-24', min_lead_days: 0, channels: 'web;bot;pos', product_categories: 'roscas', priority: 100, message_bot: '¡Hoy es día de push! Puedes ordenar para recoger hoy mismo.', can_check_stock: true, can_suggest_branch: false, enabled: true },
      { rule_id: 'PUSH_DIC_31', rule_type: 'PUSH', start_date: '2025-12-31', end_date: '2025-12-31', min_lead_days: 0, channels: 'web;bot;pos', product_categories: 'roscas', priority: 100, message_bot: '¡Hoy es día de push!', can_check_stock: true, can_suggest_branch: false, enabled: true },
      // Push Ene 2-4 (roscas OK, postres bloqueados)
      { rule_id: 'PUSH_ENE_2_4', rule_type: 'PUSH', start_date: '2026-01-02', end_date: '2026-01-04', min_lead_days: 0, channels: 'web;bot;pos', product_categories: 'roscas', priority: 100, message_bot: '', can_check_stock: true, can_suggest_branch: false, enabled: true },
      { rule_id: 'PUSH_ENE_2_4_POSTRES', rule_type: 'BLOQUEADO', start_date: '2026-01-02', end_date: '2026-01-04', min_lead_days: 0, channels: '', product_categories: 'postres', priority: 110, message_bot: 'Los postres no están disponibles del 2 al 4 de enero.', can_check_stock: false, can_suggest_branch: false, enabled: true },
      // Solo POS Ene 5-6
      { rule_id: 'SOLO_POS_ENE_5_6', rule_type: 'SOLO_POS', start_date: '2026-01-05', end_date: '2026-01-06', min_lead_days: 0, channels: 'pos', product_categories: 'roscas', priority: 100, message_bot: '📍 El 5 y 6 de enero solo vendemos en sucursal. Te puedo decir dónde hay disponibilidad.', can_check_stock: true, can_suggest_branch: true, enabled: true },
      // Push Ene 7-11
      { rule_id: 'PUSH_ENE_7_11', rule_type: 'PUSH', start_date: '2026-01-07', end_date: '2026-01-11', min_lead_days: 0, channels: 'web;bot;pos', product_categories: 'roscas', priority: 100, message_bot: '', can_check_stock: true, can_suggest_branch: false, enabled: true },
      // Preventa Ene 12-18
      { rule_id: 'PREVENTA_ENE_12_18', rule_type: 'PREVENTA', start_date: '2026-01-12', end_date: '2026-01-18', min_lead_days: 2, channels: 'web;bot;pos', product_categories: 'all', priority: 100, message_bot: '', can_check_stock: true, can_suggest_branch: false, enabled: true },
      // Fin temporada
      { rule_id: 'FIN_TEMPORADA', rule_type: 'FIN_TEMPORADA', start_date: '2026-01-19', end_date: '2026-12-31', min_lead_days: 0, channels: '', product_categories: 'all', priority: 1000, message_bot: 'La temporada de roscas terminó el 18 de enero.', can_check_stock: false, can_suggest_branch: false, enabled: true },
    ],
    
    season_config: {
      season_name: 'Roscas 2025-2026',
      season_start: '2025-12-01',
      season_end: '2026-01-18',
      default_min_lead_days: 2,
      timezone: 'America/Mexico_City',
      bot_channel_id: 'bot',
    },
    
    order_modify_policy: {
      enabled: true,
      require_verification: true,
      verification_fields: ['phone', 'email'],
      blocked_dates_for_modify: '2026-01-05,2026-01-06',
      blocked_dates: ['2026-01-05', '2026-01-06'],
      blocked_modify_message: 'Para cambios en pedidos del 5 y 6 de enero, por favor contacta directamente a la sucursal.',
      min_hours_before_modify: 24,
    },
  };
}

export default { loadKnowledgeBase };
