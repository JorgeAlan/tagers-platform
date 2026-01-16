/**
 * ═══════════════════════════════════════════════════════════════════════════
 * KNOWLEDGE HUB - DYNAMIC MATCHERS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Funciones de matching que usan la configuración dinámica del Knowledge Hub.
 * REEMPLAZA todo el hardcoding en:
 * - intent_extractor.js (extractBranchHint, extractProductHint)
 * - payloadParser.js (branch patterns)
 * - orderCreateFlow.js (product lists)
 */

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO INTERNO
// ═══════════════════════════════════════════════════════════════════════════

let _config = null;
let _wooProducts = null; // Productos de WooCommerce en tiempo real

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

export function setConfig(config) {
  _config = config;
  console.log('[MATCHERS] Config updated:', {
    products: config?.products?.length || 0,
    branches: config?.branches?.length || 0,
    knowledge: config?.knowledge?.length || 0,
  });
}

export function getConfig() {
  return _config;
}

export function setWooProducts(products) {
  _wooProducts = products;
  console.log('[MATCHERS] WooCommerce products updated:', products?.length || 0);
}

export function getWooProducts() {
  return _wooProducts;
}

// ═══════════════════════════════════════════════════════════════════════════
// NORMALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

export function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN DE SUCURSALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae sucursal del texto usando synonyms del Knowledge Hub
 * REEMPLAZA: extractBranchHint() hardcodeado en intent_extractor.js
 */
export function extractBranch(text) {
  if (!_config?.branches?.length) return null;
  
  const normalized = normalizeText(text);
  if (!normalized) return null;
  
  // Buscar en cada sucursal
  for (const branch of _config.branches) {
    if (!branch.enabled) continue;
    
    // Match exacto con branch_id
    const normId = normalizeText(branch.branch_id);
    if (normalized === normId) {
      return {
        branch_id: branch.branch_id,
        name: branch.name,
        confidence: 1.0,
        source: 'exact_id'
      };
    }
    
    // Match con synonyms
    for (const synonym of branch.synonyms || []) {
      const normSynonym = normalizeText(synonym);
      if (normSynonym.length >= 2 && normalized.includes(normSynonym)) {
        return {
          branch_id: branch.branch_id,
          name: branch.name,
          confidence: 0.9,
          source: 'synonym',
          matched: synonym
        };
      }
    }
  }
  
  return null;
}

/**
 * Versión simplificada que solo devuelve el slug
 * Compatible con código existente que espera string
 */
export function extractBranchHint(text) {
  const result = extractBranch(text);
  if (!result) return null;
  
  // Convertir a formato snake_case para compatibilidad
  return result.branch_id.toLowerCase().replace(/-/g, '_');
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN DE PRODUCTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae producto del texto usando fuzzy_keywords del Knowledge Hub
 * REEMPLAZA: extractProductHint() hardcodeado en intent_extractor.js
 */
export function extractProduct(text) {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  
  // Fuente 1: WooCommerce en tiempo real (prioridad)
  if (_wooProducts?.length) {
    for (const product of _wooProducts) {
      const keywords = [
        normalizeText(product.name),
        normalizeText(product.sku),
        ...(product.fuzzy_keywords || []).map(normalizeText),
      ].filter(Boolean);
      
      for (const keyword of keywords) {
        if (keyword.length >= 3 && normalized.includes(keyword)) {
          return {
            woo_id: product.woo_id || product.id,
            sku: product.sku,
            name: product.name,
            price: product.price,
            confidence: 0.95,
            source: 'woocommerce'
          };
        }
      }
    }
  }
  
  // Fuente 2: Knowledge Hub (Sheet)
  if (_config?.products?.length) {
    for (const product of _config.products) {
      if (!product.enabled) continue;
      
      const keywords = [
        normalizeText(product.name),
        normalizeText(product.sku),
        ...product.fuzzy_keywords,
      ].filter(Boolean);
      
      for (const keyword of keywords) {
        if (keyword.length >= 3 && normalized.includes(keyword)) {
          return {
            woo_id: product.woo_id,
            sku: product.sku,
            name: product.name,
            price: product.price,
            confidence: 0.9,
            source: 'knowledge_hub'
          };
        }
      }
    }
  }
  
  // Fuente 3: Detección genérica (sin producto específico)
  const genericWords = ['rosca', 'roscas', 'pan', 'cafe', 'pastel'];
  for (const word of genericWords) {
    if (normalized.includes(word)) {
      return {
        woo_id: null,
        sku: null,
        name: word,
        price: null,
        confidence: 0.5,
        source: 'generic',
        needs_clarification: true
      };
    }
  }
  
  return null;
}

/**
 * Versión simplificada compatible con código existente
 */
export function extractProductHint(text) {
  const result = extractProduct(text);
  if (!result) return null;
  return result.sku || result.name;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONOCIMIENTO CONTEXTUAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene conocimiento activo relevante para el contexto actual
 */
export function getActiveKnowledge(options = {}) {
  const { branchId = null, scope = null, type = null } = options;
  
  if (!_config?.knowledge?.length) return [];
  
  const now = new Date();
  
  return _config.knowledge.filter(k => {
    if (!k.enabled) return false;
    
    // Filtrar por fecha
    if (k.start_at && now < k.start_at) return false;
    if (k.end_at && now > k.end_at) return false;
    
    // Filtrar por sucursal
    if (branchId && k.branch_id !== 'ALL' && k.branch_id !== branchId) return false;
    
    // Filtrar por scope
    if (scope && k.scope !== 'GLOBAL' && k.scope !== scope) return false;
    
    // Filtrar por tipo
    if (type && k.type !== type) return false;
    
    return true;
  }).sort((a, b) => {
    // Ordenar por prioridad
    const priorities = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
    return (priorities[a.priority] || 3) - (priorities[b.priority] || 3);
  });
}

/**
 * Obtiene texto de conocimiento para embedding/contexto
 */
export function getKnowledgeContext(options = {}) {
  const knowledge = getActiveKnowledge(options);
  return knowledge.map(k => k.embedding_text).filter(Boolean);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERADORES PARA SCHEMAS Y PROMPTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera enum de sucursales para schema de OpenAI
 * REEMPLAZA: enum hardcodeado en intent_extractor.js línea 68
 */
export function getBranchEnumForSchema() {
  if (!_config?.branches?.length) {
    return ['sonata', 'angelopolis', 'zavaleta', '5_sur', 'san_angel', 'cdmx', 'puebla', null];
  }
  
  const slugs = _config.branches
    .filter(b => b.enabled)
    .map(b => b.branch_id.toLowerCase().replace(/-/g, '_'));
  
  // Agregar ciudades genéricas
  const cities = [...new Set(_config.branches.map(b => normalizeText(b.city)))];
  
  return [...new Set([...slugs, ...cities, null])];
}

/**
 * Genera sección de sucursales para el system prompt
 * REEMPLAZA: texto hardcodeado en intent_extractor.js líneas 205-209
 */
export function getBranchesPromptSection() {
  if (!_config?.branches?.length) {
    return `SUCURSALES:
- "5 sur" / "cinco sur" → "5_sur"
- "angelópolis" → "angelopolis"
- "san angel" / "cdmx" → "san_angel"
- "sonata" → "sonata"
- "zavaleta" → "zavaleta"`;
  }
  
  let section = "SUCURSALES DISPONIBLES:\n";
  
  for (const branch of _config.branches) {
    if (!branch.enabled) continue;
    
    const synonyms = (branch.synonyms || []).slice(0, 4).map(s => `"${s}"`).join(', ');
    const slug = branch.branch_id.toLowerCase().replace(/-/g, '_');
    
    section += `- ${synonyms} → "${slug}"\n`;
  }
  
  return section;
}

/**
 * Genera lista de productos para mostrar al cliente
 * REEMPLAZA: mensaje hardcodeado en orderCreateFlow.js
 */
export function getProductListForCustomer(category = null) {
  let products = _wooProducts?.length ? _wooProducts : (_config?.products || []);
  
  products = products.filter(p => {
    if (p.enabled === false) return false;
    if (category && p.category !== category) return false;
    return true;
  });
  
  if (products.length === 0) {
    return "No hay productos disponibles en este momento.";
  }
  
  const list = products
    .map((p, i) => {
      let line = `${i + 1}. ${p.name}`;
      if (p.price) line += ` - $${p.price}`;
      return line;
    })
    .join('\n');
  
  return `Estas son nuestras opciones:\n\n${list}\n\n¿Cuál te gustaría?`;
}

/**
 * Genera regex de keywords de productos para detección
 */
export function getProductKeywordsRegex() {
  const keywords = new Set(['rosca', 'roscas', 'reyes']);
  
  const products = _wooProducts?.length ? _wooProducts : (_config?.products || []);
  
  for (const product of products) {
    // Keywords del producto
    for (const kw of product.fuzzy_keywords || []) {
      if (kw.length >= 3) keywords.add(kw);
    }
    
    // Palabras del nombre
    const words = normalizeText(product.name || '').split(/\s+/);
    for (const word of words) {
      if (word.length >= 4 && !['de', 'la', 'el', 'con', 'para', 'reyes'].includes(word)) {
        keywords.add(word);
      }
    }
  }
  
  const pattern = [...keywords].join('|');
  return new RegExp(`\\b(${pattern})\\b`, 'i');
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAJES PREDEFINIDOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene mensaje predefinido con interpolación de variables
 * REEMPLAZA: mensajes hardcodeados en chatwoot.js y aiOrchestrator.js
 */
export function getCannedMessage(key, vars = {}) {
  const canned = _config?.canned?.find(c => c.key === key && c.enabled !== false);
  
  if (canned?.message) {
    return canned.message.replace(/\{(\w+)\}/g, (match, varName) => {
      return vars[varName] ?? match;
    });
  }
  
  // Fallbacks para mensajes críticos
  const fallbacks = {
    greeting: `¡Hola! Soy ${vars.agent_name || 'Tan • IA'} de ${vars.brand_name || 'Tagers'} 🥐 ¿En qué puedo ayudarte?`,
    ask_product: '¿Qué producto te gustaría?',
    ask_quantity: '¿Cuántos necesitas?',
    ask_branch: '¿En qué sucursal?',
    ask_date: '¿Para qué fecha?',
    escalate: 'Te comunico con alguien del equipo. Un momento por favor 🙏',
    not_understood: 'Disculpa, no entendí bien. ¿Podrías decirme de otra forma?',
    out_of_stock: 'Lo siento, no está disponible en este momento.',
    thanks: '¡Gracias! ¿Hay algo más en lo que pueda ayudarte?',
    goodbye: '¡Fue un placer! Que tengas excelente día 😊',
  };
  
  return fallbacks[key] || `[${key}]`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL AGENTE
// ═══════════════════════════════════════════════════════════════════════════

export function getAgentConfig(key = null) {
  if (!_config?.agent) return key ? '' : {};
  
  if (key) {
    return _config.agent[key] || '';
  }
  
  return _config.agent;
}

export function getAgentName() {
  return getAgentConfig('agent_name') || 'Tan • IA';
}

export function getBrandName() {
  return getAgentConfig('brand_name') || 'Tagers';
}

// ═══════════════════════════════════════════════════════════════════════════
// HERRAMIENTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta si el texto activa alguna herramienta
 */
export function detectToolTrigger(text) {
  if (!_config?.tools?.length) return null;
  
  const normalized = normalizeText(text);
  
  for (const tool of _config.tools) {
    if (!tool.enabled) continue;
    
    for (const phrase of tool.trigger_phrases || []) {
      if (normalized.includes(phrase)) {
        return {
          tool_name: tool.tool_name,
          description: tool.description,
          required_params: tool.required_params,
          matched_phrase: phrase
        };
      }
    }
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

export function getAllBranches() {
  return (_config?.branches || []).filter(b => b.enabled !== false);
}

export function getBranchById(branchId) {
  return _config?.branches?.find(b => 
    b.branch_id === branchId || 
    b.branch_id.toLowerCase() === branchId?.toLowerCase()
  );
}

export function getAllProducts() {
  return _wooProducts?.length 
    ? _wooProducts 
    : (_config?.products || []).filter(p => p.enabled !== false);
}

export function getProductBySku(sku) {
  const products = getAllProducts();
  return products.find(p => 
    p.sku === sku || 
    p.sku?.toLowerCase() === sku?.toLowerCase()
  );
}

export function isConfigLoaded() {
  return {
    knowledge_hub: !!_config,
    branches: (_config?.branches?.length || 0) > 0,
    products: (_config?.products?.length || 0) > 0 || (_wooProducts?.length || 0) > 0,
    canned: (_config?.canned?.length || 0) > 0,
    woocommerce: (_wooProducts?.length || 0) > 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT DEFAULT
// ═══════════════════════════════════════════════════════════════════════════

export default {
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
};
