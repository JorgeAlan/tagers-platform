/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHEETS READER v2 - Dynamic Auto-Discovery
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Lee TODAS las pestañas de un Google Sheet sin mapeo hardcoded.
 * Captura datos crudos para que AI los analice.
 * 
 * CAMBIO CLAVE vs v1:
 * - v1: Lista hardcoded de pestañas (BRANCHES, FAQ, etc.)
 * - v2: Lee TODAS las pestañas dinámicamente
 * 
 * @version 2.0.0
 */

import { GoogleSpreadsheet } from 'google-spreadsheet';
import { JWT } from 'google-auth-library';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const readerConfig = {
  // Pestañas a ignorar siempre (sistema)
  ignoredSheets: new Set([
    '_template',
    '_ejemplo',
    '_example',
    'template',
    'plantilla',
  ]),
  
  // Prefijos que indican pestaña de sistema (ignorar)
  systemPrefixes: ['_', '#'],
  
  // Máximo de filas a leer por pestaña (para evitar sheets enormes)
  maxRowsPerSheet: parseInt(process.env.SHEETS_MAX_ROWS || '1000', 10),
  
  // Filtrar por columna enabled si existe
  filterEnabled: process.env.SHEETS_FILTER_ENABLED !== 'false',
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
 * Determina si una pestaña debe ignorarse
 */
function shouldIgnoreSheet(sheetName) {
  const nameLower = sheetName.toLowerCase().trim();
  
  // Ignorar pestañas en lista negra
  if (readerConfig.ignoredSheets.has(nameLower)) {
    return true;
  }
  
  // Ignorar pestañas con prefijos de sistema
  for (const prefix of readerConfig.systemPrefixes) {
    if (nameLower.startsWith(prefix)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Convierte una fila del sheet a objeto
 */
function rowToObject(row, headers) {
  const obj = {};
  headers.forEach(header => {
    if (!header || !header.trim()) return;
    
    const value = row.get(header);
    
    // Convertir tipos básicos
    if (value === undefined || value === null || value === '') {
      obj[header] = null;
    } else if (value === 'TRUE' || value === 'true') {
      obj[header] = true;
    } else if (value === 'FALSE' || value === 'false') {
      obj[header] = false;
    } else if (!isNaN(value) && value.trim() !== '') {
      // Solo convertir a número si es claramente numérico
      const num = Number(value);
      obj[header] = Number.isInteger(num) ? num : parseFloat(value);
    } else {
      obj[header] = String(value);
    }
  });
  return obj;
}

/**
 * Detecta si una fila está "enabled" basado en varias columnas comunes
 */
function isRowEnabled(row) {
  // Buscar columnas comunes que indican estado
  const enabledFields = ['enabled', 'activo', 'active', 'status', 'estado'];
  
  for (const field of enabledFields) {
    if (row[field] !== undefined && row[field] !== null) {
      const value = String(row[field]).toLowerCase().trim();
      
      // Si es columna de status, verificar valores específicos
      if (field === 'status' || field === 'estado') {
        return ['live', 'activo', 'active', 'publicado', 'published'].includes(value);
      }
      
      // Para enabled/activo, verificar truthy
      return ['true', '1', 'sí', 'si', 'yes', 'activo', 'active'].includes(value);
    }
  }
  
  // Si no hay columna de estado, asumir enabled
  return true;
}

// ═══════════════════════════════════════════════════════════════════════════
// LECTURA DINÁMICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee una pestaña y devuelve datos crudos
 * 
 * @param {GoogleSpreadsheet} doc - Documento
 * @param {Object} sheet - Pestaña
 * @returns {Promise<Object>} { columns, rows, metadata }
 */
async function readSheetRaw(doc, sheet) {
  const sheetName = sheet.title;
  
  try {
    await sheet.loadHeaderRow();
    const rows = await sheet.getRows({ limit: readerConfig.maxRowsPerSheet });
    const headers = sheet.headerValues.filter(h => h && h.trim());
    
    if (!headers.length) {
      return {
        sheetName,
        columns: [],
        rows: [],
        metadata: { empty: true, reason: 'no_headers' },
      };
    }
    
    // Convertir filas a objetos
    let rowObjects = rows.map(row => rowToObject(row, headers));
    
    // Filtrar por enabled si está configurado y existe la columna
    const hasEnabledColumn = headers.some(h => 
      ['enabled', 'activo', 'active', 'status', 'estado'].includes(h.toLowerCase())
    );
    
    if (readerConfig.filterEnabled && hasEnabledColumn) {
      const beforeFilter = rowObjects.length;
      rowObjects = rowObjects.filter(isRowEnabled);
      
      console.log(`[SHEETS] ${sheetName}: ${rowObjects.length}/${beforeFilter} filas (filtrado por enabled)`);
    } else {
      console.log(`[SHEETS] ${sheetName}: ${rowObjects.length} filas`);
    }
    
    return {
      sheetName,
      columns: headers,
      rows: rowObjects,
      metadata: {
        totalRows: rows.length,
        filteredRows: rowObjects.length,
        hasEnabledColumn,
        columnCount: headers.length,
      },
    };
    
  } catch (error) {
    console.error(`[SHEETS] Error leyendo "${sheetName}":`, error.message);
    return {
      sheetName,
      columns: [],
      rows: [],
      metadata: { error: error.message },
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: Lee TODO el Google Sheet
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee TODAS las pestañas de un Google Sheet
 * Devuelve datos crudos para que AI los analice
 * 
 * @returns {Promise<Object>} { sheets: { [name]: { columns, rows } }, metadata }
 */
export async function readAllSheets() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    throw new Error('GOOGLE_SHEET_ID es requerido');
  }
  
  console.log('[SHEETS] Conectando a Google Sheets (modo dinámico)...');
  
  const auth = getAuth();
  const doc = new GoogleSpreadsheet(sheetId, auth);
  
  await doc.loadInfo();
  console.log(`[SHEETS] Documento: "${doc.title}"`);
  console.log(`[SHEETS] Pestañas encontradas: ${doc.sheetsByIndex.length}`);
  
  const allSheets = {};
  const skippedSheets = [];
  
  // Leer TODAS las pestañas
  for (const sheet of doc.sheetsByIndex) {
    const sheetName = sheet.title;
    
    // Verificar si debe ignorarse
    if (shouldIgnoreSheet(sheetName)) {
      skippedSheets.push({ name: sheetName, reason: 'system_sheet' });
      console.log(`[SHEETS] ⏭️  Ignorando "${sheetName}" (pestaña de sistema)`);
      continue;
    }
    
    // Leer datos crudos
    const sheetData = await readSheetRaw(doc, sheet);
    
    // Solo incluir pestañas con datos
    if (sheetData.rows.length > 0) {
      allSheets[sheetName] = sheetData;
    } else {
      skippedSheets.push({ name: sheetName, reason: 'empty' });
      console.log(`[SHEETS] ⏭️  Ignorando "${sheetName}" (vacía)`);
    }
  }
  
  const metadata = {
    documentTitle: doc.title,
    documentId: sheetId,
    totalSheets: doc.sheetsByIndex.length,
    processedSheets: Object.keys(allSheets).length,
    skippedSheets,
    readAt: new Date().toISOString(),
  };
  
  console.log('[SHEETS] ═══════════════════════════════════════════');
  console.log(`[SHEETS] ✅ Leídas: ${metadata.processedSheets} pestañas`);
  console.log(`[SHEETS] ⏭️  Ignoradas: ${skippedSheets.length} pestañas`);
  console.log('[SHEETS] ═══════════════════════════════════════════');
  
  return {
    sheets: allSheets,
    metadata,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPATIBILIDAD: Función legacy para sync-service existente
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lee Google Sheets en formato legacy (compatible con sync-service actual)
 * 
 * NOTA: Esta función intenta mapear automáticamente las pestañas
 * a la estructura esperada por el sistema actual.
 * 
 * @returns {Promise<Object>} Config en formato legacy
 */
export async function readGoogleSheets() {
  const { sheets, metadata } = await readAllSheets();
  
  // Mapeo inteligente de nombres de pestañas
  const findSheet = (names) => {
    for (const name of names) {
      // Buscar exacto (case insensitive)
      const exact = Object.keys(sheets).find(s => s.toLowerCase() === name.toLowerCase());
      if (exact) return sheets[exact].rows;
      
      // Buscar parcial
      const partial = Object.keys(sheets).find(s => s.toLowerCase().includes(name.toLowerCase()));
      if (partial) return sheets[partial].rows;
    }
    return [];
  };
  
  const findKeyValueSheet = (names) => {
    const rows = findSheet(names);
    if (!rows.length) return {};
    
    // Detectar si es key-value (2 columnas: key/value o similar)
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    
    if (keys.length === 2) {
      const result = {};
      rows.forEach(row => {
        const key = row[keys[0]];
        const value = row[keys[1]];
        if (key) result[key] = value;
      });
      return result;
    }
    
    // Si no es key-value, devolver primer objeto
    return rows[0] || {};
  };
  
  // Buscar pestaña PUBLISH para versión
  const publishRows = findSheet(['publish', 'publicar']);
  const prodLive = publishRows.find(row => 
    String(row.env || '').toLowerCase() === 'prod' && 
    String(row.status || '').toUpperCase() === 'LIVE'
  );
  const activeRevision = prodLive ? parseInt(prodLive.active_revision || '1', 10) : 1;
  
  // Construir config legacy
  const config = {
    version: activeRevision,
    updated_at: new Date().toISOString(),
    published_at: prodLive?.published_at || '',
    published_by: prodLive?.published_by || '',
    
    // Key-value sheets
    meta: findKeyValueSheet(['meta', 'configuracion', 'config']),
    brand: findKeyValueSheet(['brand', 'marca']),
    persona: findKeyValueSheet(['persona', 'personalidad', 'agent']),
    
    // Array sheets
    branches: findSheet(['branches', 'sucursales', 'locations', 'ubicaciones']),
    branch_hours: findSheet(['branch_hours', 'horarios', 'hours']),
    menus: findSheet(['menus', 'menu', 'carta']),
    seasons: findSheet(['season', 'seasons', 'temporadas']),
    promos: findSheet(['promos', 'promociones', 'offers', 'ofertas']),
    push_rules: findSheet(['push_rules', 'reglas', 'rules']),
    faq: findSheet(['faq', 'preguntas', 'questions', 'faqs']),
    notices: findSheet(['notices', 'avisos', 'announcements']),
    staff: findSheet(['staff', 'personal', 'equipo', 'team']),
    escalation: findSheet(['escalation', 'escalamiento', 'escalaciones']),
    canned: findSheet(['canned', 'respuestas', 'responses', 'templates']),
    roscas: findSheet(['roscas', 'productos', 'products']),
    knowledge: findSheet(['knowledge', 'conocimiento', 'info']),
    products: findSheet(['products', 'productos', 'items']),
    
    // AI Models (para Model Registry)
    ai_models: findSheet(['ai_models', 'modelos', 'models', 'ai_config']),
    
    // Metadata para AI
    _rawSheets: sheets,
    _metadata: metadata,
  };
  
  console.log('[SHEETS] Config legacy construido:', {
    version: config.version,
    branches: config.branches.length,
    faq: config.faq.length,
    canned: config.canned.length,
    rawSheets: Object.keys(sheets).length,
  });
  
  return config;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valida la conexión al Sheet
 */
export async function testConnection() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    return { success: false, error: 'GOOGLE_SHEET_ID no configurado' };
  }
  
  try {
    const auth = getAuth();
    const doc = new GoogleSpreadsheet(sheetId, auth);
    await doc.loadInfo();
    
    return {
      success: true,
      title: doc.title,
      sheets: doc.sheetsByIndex.map(s => ({
        title: s.title,
        rowCount: s.rowCount,
        columnCount: s.columnCount,
      })),
    };
    
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Lista todas las pestañas del documento
 */
export async function listSheets() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  
  if (!sheetId) {
    throw new Error('GOOGLE_SHEET_ID es requerido');
  }
  
  const auth = getAuth();
  const doc = new GoogleSpreadsheet(sheetId, auth);
  await doc.loadInfo();
  
  return doc.sheetsByIndex.map(sheet => ({
    title: sheet.title,
    index: sheet.index,
    rowCount: sheet.rowCount,
    columnCount: sheet.columnCount,
    isSystem: shouldIgnoreSheet(sheet.title),
  }));
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default { 
  readGoogleSheets,    // Legacy compatible
  readAllSheets,       // Nuevo: datos crudos
  testConnection,
  listSheets,
};
