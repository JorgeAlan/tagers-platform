/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KNOWLEDGE HUB - MAIN MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Punto de entrada único para toda la configuración dinámica.
 * Integra:
 * - Google Sheets (TAN_IA_KNOWLEDGE_BASE_TEMPLATE)
 * - WooCommerce (productos en tiempo real)
 * - Matchers dinámicos
 * 
 * USO:
 * ```javascript
 * import KnowledgeHub from './knowledge-hub/index.js';
 * 
 * // Inicializar (llamar una vez al startup)
 * await KnowledgeHub.initialize();
 * 
 * // Usar matchers
 * const branch = KnowledgeHub.extractBranch("quiero en angelopolis");
 * const product = KnowledgeHub.extractProduct("la de nutella");
 * ```
 */

import { loadKnowledgeBase } from './sheet-loader.js';
import * as matchers from './matchers.js';
import { fetchCSInfoCompleta } from '../integrations/wp_cs_client.js';

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════════

let _initialized = false;
let _syncInterval = null;

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa el Knowledge Hub
 * - Carga configuración de Google Sheets
 * - Sincroniza productos de WooCommerce
 * - Configura auto-refresh
 */
export async function initialize(options = {}) {
  const {
    autoSync = true,
    syncIntervalMs = 5 * 60 * 1000, // 5 minutos default
  } = options;
  
  console.log('[KNOWLEDGE-HUB] Initializing...');
  
  try {
    // 1. Cargar configuración de Google Sheets
    const config = await loadKnowledgeBase();
    matchers.setConfig(config);
    
    // 2. Sincronizar productos de WooCommerce
    await syncWooProducts();
    
    // 3. Configurar auto-sync si está habilitado
    if (autoSync && !_syncInterval) {
      _syncInterval = setInterval(async () => {
        try {
          await refresh();
        } catch (err) {
          console.error('[KNOWLEDGE-HUB] Auto-sync failed:', err.message);
        }
      }, syncIntervalMs);
      
      console.log(`[KNOWLEDGE-HUB] Auto-sync enabled (every ${syncIntervalMs / 1000}s)`);
    }
    
    _initialized = true;
    console.log('[KNOWLEDGE-HUB] Initialized successfully');
    
    return { success: true, config };
    
  } catch (error) {
    console.error('[KNOWLEDGE-HUB] Initialization failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Refresca la configuración
 */
export async function refresh() {
  console.log('[KNOWLEDGE-HUB] Refreshing...');
  
  try {
    const config = await loadKnowledgeBase();
    matchers.setConfig(config);
    await syncWooProducts();
    
    console.log('[KNOWLEDGE-HUB] Refresh complete');
    return { success: true };
    
  } catch (error) {
    console.error('[KNOWLEDGE-HUB] Refresh failed:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Sincroniza productos de WooCommerce
 */
async function syncWooProducts() {
  try {
    const data = await fetchCSInfoCompleta();
    
    if (data?.productos?.length) {
      // Transformar productos de WooCommerce al formato esperado
      const products = data.productos.map(p => ({
        woo_id: p.id || p.woo_id || p.product_id,
        sku: p.sku || '',
        name: p.name || p.nombre || '',
        category: p.category || p.categoria || '',
        price: parseFloat(p.price || p.precio || 0),
        stock: p.stock || p.stock_quantity || null,
        in_stock: p.in_stock ?? p.disponible ?? true,
        fuzzy_keywords: extractKeywordsFromName(p.name || p.nombre || ''),
      }));
      
      matchers.setWooProducts(products);
    }
    
  } catch (error) {
    console.warn('[KNOWLEDGE-HUB] WooCommerce sync failed:', error.message);
    // No es fatal, seguimos con los productos del Sheet
  }
}

/**
 * Extrae keywords del nombre del producto
 */
function extractKeywordsFromName(name) {
  const normalized = matchers.normalizeText(name);
  const words = normalized.split(/\s+/);
  
  const stopwords = ['de', 'la', 'el', 'los', 'las', 'con', 'para', 'y', 'o', 'rosca', 'reyes'];
  
  return words
    .filter(w => w.length >= 3 && !stopwords.includes(w))
    .slice(0, 5);
}

/**
 * Detiene el auto-sync
 */
export function stopAutoSync() {
  if (_syncInterval) {
    clearInterval(_syncInterval);
    _syncInterval = null;
    console.log('[KNOWLEDGE-HUB] Auto-sync stopped');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// RE-EXPORTS DE MATCHERS (para uso directo)
// ═══════════════════════════════════════════════════════════════════════════

export const {
  // Config
  setConfig,
  getConfig,
  setWooProducts,
  getWooProducts,
  isConfigLoaded,
  
  // Matchers
  normalizeText,
  extractBranch,
  extractBranchHint,
  extractProduct,
  extractProductHint,
  
  // Knowledge
  getActiveKnowledge,
  getKnowledgeContext,
  
  // Generators
  getBranchEnumForSchema,
  getBranchesPromptSection,
  getProductListForCustomer,
  getProductKeywordsRegex,
  
  // Messages & Config
  getCannedMessage,
  getAgentConfig,
  getAgentName,
  getBrandName,
  
  // Tools
  detectToolTrigger,
  
  // Utilities
  getAllBranches,
  getBranchById,
  getAllProducts,
  getProductBySku,
} = matchers;

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DEFAULT
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Lifecycle
  initialize,
  refresh,
  stopAutoSync,
  
  // Re-exports
  ...matchers,
};
