/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA CONFIG HUB - Configuración Dinámica desde Google Sheets
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * FILOSOFÍA: Zero Hardcode
 * - Toda configuración viene de Google Sheets
 * - Pestañas con prefijo LUCA_ son para LUCA
 * - Cache en memoria con refresh periódico
 * - Fallback a valores por defecto si falla
 * 
 * PESTAÑAS ESPERADAS:
 * - LUCA_BRANCHES     → Sucursales (ID, nombre, lat/lon, baseline)
 * - LUCA_STAFFING     → Personal por turno y costos
 * - LUCA_THRESHOLDS   → Umbrales de detección
 * - LUCA_WEATHER      → Impacto del clima
 * - LUCA_HOLIDAYS     → Feriados y temporadas
 * - LUCA_FRAUD        → Patrones de fraude
 * - LUCA_ROI          → Valores de referencia
 * - LUCA_CAPACITY     → Capacidades por rol
 * - LUCA_AUTONOMY     → Niveles de autonomía
 * 
 * @version 1.0.0
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';
import { logger } from "@tagers/shared";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Prefijo para pestañas de LUCA
  sheetPrefix: 'LUCA_',
  
  // Refresh cada 5 minutos
  refreshIntervalMs: 5 * 60 * 1000,
  
  // Cache TTL (10 minutos max staleness)
  maxStalenessMs: 10 * 60 * 1000,
  
  // Sheet ID (puede ser el mismo que KISS o uno separado)
  sheetId: process.env.LUCA_CONFIG_SHEET_ID || process.env.GOOGLE_SHEET_ID,
};

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ═══════════════════════════════════════════════════════════════════════════

const state = {
  // Datos cacheados por pestaña
  cache: new Map(),
  
  // Metadata
  lastRefresh: null,
  lastError: null,
  isInitialized: false,
  
  // Intervalo de refresh
  refreshInterval: null,
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
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY son requeridos');
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

/**
 * Convierte fila a objeto con tipos correctos
 */
function rowToObject(row, headers) {
  const obj = {};
  
  for (const header of headers) {
    if (!header?.trim()) continue;
    
    const value = row.get(header);
    
    if (value === undefined || value === null || value === '') {
      obj[header] = null;
    } else if (value === 'TRUE' || value === 'true') {
      obj[header] = true;
    } else if (value === 'FALSE' || value === 'false') {
      obj[header] = false;
    } else if (!isNaN(value) && String(value).trim() !== '') {
      const num = Number(value);
      obj[header] = Number.isInteger(num) ? num : parseFloat(value);
    } else {
      obj[header] = String(value);
    }
  }
  
  return obj;
}

/**
 * Verifica si fila está habilitada
 */
function isRowEnabled(row) {
  const enabledFields = ['enabled', 'activo', 'active'];
  
  for (const field of enabledFields) {
    if (row[field] !== undefined && row[field] !== null) {
      return row[field] === true || row[field] === 1;
    }
  }
  
  return true; // Default: enabled
}

/**
 * Normaliza nombre de pestaña (quita prefijo LUCA_)
 */
function normalizeSheetName(name) {
  return name.replace(CONFIG.sheetPrefix, '').toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// LECTURA DE SHEETS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee todas las pestañas LUCA_ del Google Sheet
 */
async function readAllLucaSheets() {
  if (!CONFIG.sheetId) {
    throw new Error('LUCA_CONFIG_SHEET_ID o GOOGLE_SHEET_ID es requerido');
  }
  
  logger.info({ sheetId: CONFIG.sheetId }, '[LUCA-CONFIG] Conectando a Google Sheets...');
  
  const auth = getAuth();
  const doc = new GoogleSpreadsheet(CONFIG.sheetId, auth);
  
  await doc.loadInfo();
  logger.info({ title: doc.title, sheets: doc.sheetsByIndex.length }, '[LUCA-CONFIG] Documento cargado');
  
  const result = {};
  
  for (const sheet of doc.sheetsByIndex) {
    const sheetName = sheet.title;
    
    // Solo procesar pestañas LUCA_
    if (!sheetName.startsWith(CONFIG.sheetPrefix)) {
      continue;
    }
    
    try {
      await sheet.loadHeaderRow();
      const rows = await sheet.getRows({ limit: 1000 });
      const headers = sheet.headerValues.filter(h => h?.trim());
      
      if (!headers.length || !rows.length) {
        logger.debug({ sheet: sheetName }, '[LUCA-CONFIG] Pestaña vacía, ignorando');
        continue;
      }
      
      // Convertir a objetos
      let rowObjects = rows.map(row => rowToObject(row, headers));
      
      // Filtrar por enabled si existe la columna
      const hasEnabled = headers.some(h => ['enabled', 'activo', 'active'].includes(h.toLowerCase()));
      if (hasEnabled) {
        rowObjects = rowObjects.filter(isRowEnabled);
      }
      
      const normalizedName = normalizeSheetName(sheetName);
      result[normalizedName] = {
        rows: rowObjects,
        columns: headers,
        count: rowObjects.length,
      };
      
      logger.info({ sheet: sheetName, rows: rowObjects.length }, '[LUCA-CONFIG] Pestaña cargada');
      
    } catch (err) {
      logger.warn({ sheet: sheetName, error: err.message }, '[LUCA-CONFIG] Error leyendo pestaña');
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// REFRESH Y CACHE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Refresca todo el cache desde Google Sheets
 */
async function refresh() {
  try {
    logger.info('[LUCA-CONFIG] Iniciando refresh...');
    
    const data = await readAllLucaSheets();
    
    // Actualizar cache
    state.cache.clear();
    for (const [name, sheetData] of Object.entries(data)) {
      state.cache.set(name, sheetData);
    }
    
    state.lastRefresh = new Date();
    state.lastError = null;
    state.isInitialized = true;
    
    logger.info({ 
      sheets: Object.keys(data),
      totalSheets: Object.keys(data).length,
    }, '[LUCA-CONFIG] Refresh completado');
    
    return { success: true, sheets: Object.keys(data) };
    
  } catch (err) {
    state.lastError = err.message;
    logger.error({ error: err.message }, '[LUCA-CONFIG] Error en refresh');
    
    // Si es primer intento, cargar defaults
    if (!state.isInitialized) {
      loadDefaults();
    }
    
    return { success: false, error: err.message };
  }
}

/**
 * Inicia refresh periódico
 */
function startPeriodicRefresh() {
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
  }
  
  // Refresh inicial
  refresh();
  
  // Refresh periódico
  state.refreshInterval = setInterval(() => {
    refresh();
  }, CONFIG.refreshIntervalMs);
  
  logger.info({ intervalMs: CONFIG.refreshIntervalMs }, '[LUCA-CONFIG] Refresh periódico iniciado');
}

/**
 * Detiene refresh periódico
 */
function stopPeriodicRefresh() {
  if (state.refreshInterval) {
    clearInterval(state.refreshInterval);
    state.refreshInterval = null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULTS (Fallback si no hay Sheet)
// ═══════════════════════════════════════════════════════════════════════════

function loadDefaults() {
  logger.warn('[LUCA-CONFIG] Cargando valores por defecto (fallback)');
  
  // BRANCHES - Sucursales básicas
  state.cache.set('branches', {
    rows: [
      { branch_id: 'SUC-ANG', name: 'Angelópolis', city: 'Puebla', lat: 19.027, lon: -98.226, type: 'flagship', daily_sales_baseline: 85000, avg_ticket: 185, peak_factor: 1.8, open_hour: '07:00', close_hour: '22:00' },
      { branch_id: 'SUC-ZAV', name: 'Zavaleta', city: 'Puebla', lat: 19.012, lon: -98.215, type: 'standard', daily_sales_baseline: 55000, avg_ticket: 165, peak_factor: 1.6, open_hour: '07:00', close_hour: '21:00' },
      { branch_id: 'SUC-POL', name: 'Polanco', city: 'CDMX', lat: 19.433, lon: -99.197, type: 'premium', daily_sales_baseline: 120000, avg_ticket: 220, peak_factor: 2.0, open_hour: '07:00', close_hour: '23:00' },
      { branch_id: 'SUC-CON', name: 'Condesa', city: 'CDMX', lat: 19.411, lon: -99.174, type: 'trendy', daily_sales_baseline: 75000, avg_ticket: 195, peak_factor: 1.7, open_hour: '07:30', close_hour: '22:00' },
      { branch_id: 'SUC-ROM', name: 'Roma', city: 'CDMX', lat: 19.420, lon: -99.162, type: 'trendy', daily_sales_baseline: 78000, avg_ticket: 190, peak_factor: 1.7, open_hour: '07:30', close_hour: '22:00' },
      { branch_id: 'SUC-COY', name: 'Coyoacán', city: 'CDMX', lat: 19.347, lon: -99.162, type: 'family', daily_sales_baseline: 95000, avg_ticket: 175, peak_factor: 1.9, open_hour: '07:00', close_hour: '21:30' },
    ],
    isDefault: true,
  });
  
  // THRESHOLDS - Umbrales básicos
  state.cache.set('thresholds', {
    rows: [
      { detector_id: 'fraud', metric: 'discount_anomaly', threshold: 15, severity: 'HIGH' },
      { detector_id: 'fraud', metric: 'time_concentration', threshold: 0.4, severity: 'MEDIUM' },
      { detector_id: 'forense', metric: 'sales_drop', threshold: -10, severity: 'HIGH' },
      { detector_id: 'churn', metric: 'health_score', threshold: 0.5, severity: 'MEDIUM' },
    ],
    isDefault: true,
  });
  
  // WEATHER - Impactos de clima
  state.cache.set('weather', {
    rows: [
      { condition: 'light_rain', dine_in: -0.10, delivery: 0.10, takeaway: -0.05 },
      { condition: 'rain', dine_in: -0.20, delivery: 0.15, takeaway: -0.10 },
      { condition: 'heavy_rain', dine_in: -0.35, delivery: 0.25, takeaway: -0.20 },
      { condition: 'thunderstorm', dine_in: -0.40, delivery: -0.20, takeaway: -0.30 },
      { condition: 'extreme_heat', dine_in: -0.10, delivery: 0.20, beverages_cold: 0.30 },
      { condition: 'cold', dine_in: 0.05, beverages_hot: 0.25 },
    ],
    isDefault: true,
  });
  
  // CAPACITY - Capacidades por rol
  state.cache.set('capacity', {
    rows: [
      { role: 'barista', drinks_per_hour: 30, cost_per_hour: 85 },
      { role: 'kitchen', dishes_per_hour: 12, cost_per_hour: 80 },
      { role: 'floor', customers_per_hour: 20, cost_per_hour: 70 },
      { role: 'cashier', transactions_per_hour: 45, cost_per_hour: 75 },
    ],
    isDefault: true,
  });
  
  // ROI - Valores de referencia
  state.cache.set('roi', {
    rows: [
      { key: 'customer_lifetime_value', value: 5000, unit: 'MXN' },
      { key: 'employee_turnover_cost', value: 15000, unit: 'MXN' },
      { key: 'avg_margin', value: 0.35, unit: 'ratio' },
      { key: 'openai_monthly_cost', value: 5000, unit: 'MXN' },
    ],
    isDefault: true,
  });
  
  state.isInitialized = true;
}

// ═══════════════════════════════════════════════════════════════════════════
// GETTERS TIPADOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene configuración de una sucursal
 */
function getBranch(branchId) {
  const branches = state.cache.get('branches');
  if (!branches?.rows) return null;
  
  return branches.rows.find(b => b.branch_id === branchId) || null;
}

/**
 * Obtiene todas las sucursales
 */
function getAllBranches() {
  const branches = state.cache.get('branches');
  return branches?.rows || [];
}

/**
 * Obtiene IDs de todas las sucursales
 */
function getBranchIds() {
  return getAllBranches().map(b => b.branch_id);
}

/**
 * Obtiene umbral para un detector
 */
function getThreshold(detectorId, metric) {
  const thresholds = state.cache.get('thresholds');
  if (!thresholds?.rows) return null;
  
  const found = thresholds.rows.find(t => 
    t.detector_id === detectorId && t.metric === metric
  );
  
  return found?.threshold ?? null;
}

/**
 * Obtiene todos los umbrales de un detector
 */
function getDetectorThresholds(detectorId) {
  const thresholds = state.cache.get('thresholds');
  if (!thresholds?.rows) return [];
  
  return thresholds.rows.filter(t => t.detector_id === detectorId);
}

/**
 * Obtiene impacto de clima
 */
function getWeatherImpact(condition) {
  const weather = state.cache.get('weather');
  if (!weather?.rows) return null;
  
  return weather.rows.find(w => w.condition === condition) || null;
}

/**
 * Obtiene todos los impactos de clima
 */
function getAllWeatherImpacts() {
  const weather = state.cache.get('weather');
  return weather?.rows || [];
}

/**
 * Obtiene feriado por fecha (MM-DD)
 */
function getHoliday(monthDay) {
  const holidays = state.cache.get('holidays');
  if (!holidays?.rows) return null;
  
  return holidays.rows.find(h => h.date === monthDay) || null;
}

/**
 * Obtiene todos los feriados
 */
function getAllHolidays() {
  const holidays = state.cache.get('holidays');
  return holidays?.rows || [];
}

/**
 * Obtiene capacidad de un rol
 */
function getRoleCapacity(role) {
  const capacity = state.cache.get('capacity');
  if (!capacity?.rows) return null;
  
  return capacity.rows.find(c => c.role === role) || null;
}

/**
 * Obtiene todas las capacidades
 */
function getAllCapacities() {
  const capacity = state.cache.get('capacity');
  return capacity?.rows || [];
}

/**
 * Obtiene valor de ROI por key
 */
function getRoiValue(key) {
  const roi = state.cache.get('roi');
  if (!roi?.rows) return null;
  
  const found = roi.rows.find(r => r.key === key);
  return found?.value ?? null;
}

/**
 * Obtiene staffing para una sucursal y turno
 */
function getStaffing(branchId, shift) {
  const staffing = state.cache.get('staffing');
  if (!staffing?.rows) return null;
  
  return staffing.rows.find(s => 
    s.branch_id === branchId && s.shift === shift
  ) || null;
}

/**
 * Obtiene patrón de fraude
 */
function getFraudPattern(patternId) {
  const fraud = state.cache.get('fraud');
  if (!fraud?.rows) return null;
  
  return fraud.rows.find(f => f.pattern_id === patternId) || null;
}

/**
 * Obtiene nivel de autonomía
 */
function getAutonomyLevel(level) {
  const autonomy = state.cache.get('autonomy');
  if (!autonomy?.rows) return null;
  
  return autonomy.rows.find(a => a.level === level) || null;
}

/**
 * Obtiene datos crudos de una pestaña
 */
function getRawSheet(sheetName) {
  const normalized = sheetName.toLowerCase().replace(CONFIG.sheetPrefix.toLowerCase(), '');
  return state.cache.get(normalized);
}

// ═══════════════════════════════════════════════════════════════════════════
// HEALTH CHECK
// ═══════════════════════════════════════════════════════════════════════════

function getHealth() {
  const now = new Date();
  const lastRefresh = state.lastRefresh ? new Date(state.lastRefresh) : null;
  const stalenessMs = lastRefresh ? now - lastRefresh : null;
  
  return {
    initialized: state.isInitialized,
    lastRefresh: state.lastRefresh?.toISOString() || null,
    lastError: state.lastError,
    stalenessSeconds: stalenessMs ? Math.floor(stalenessMs / 1000) : null,
    isStale: stalenessMs ? stalenessMs > CONFIG.maxStalenessMs : true,
    sheetsLoaded: [...state.cache.keys()],
    sheetCount: state.cache.size,
    usingDefaults: state.cache.get('branches')?.isDefault || false,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const lucaConfigHub = {
  // Lifecycle
  refresh,
  startPeriodicRefresh,
  stopPeriodicRefresh,
  
  // Branches
  getBranch,
  getAllBranches,
  getBranchIds,
  
  // Thresholds
  getThreshold,
  getDetectorThresholds,
  
  // Weather
  getWeatherImpact,
  getAllWeatherImpacts,
  
  // Holidays
  getHoliday,
  getAllHolidays,
  
  // Capacity
  getRoleCapacity,
  getAllCapacities,
  
  // ROI
  getRoiValue,
  
  // Staffing
  getStaffing,
  
  // Fraud
  getFraudPattern,
  
  // Autonomy
  getAutonomyLevel,
  
  // Raw access
  getRawSheet,
  
  // Health
  getHealth,
};

export default lucaConfigHub;
