/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VECTOR POPULATOR v2 - Auto-Discovery con AI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Pobla el vector store desde Google Sheets de forma inteligente.
 * 
 * MODOS DE OPERACIÓN:
 * 1. AUTO (default): Usa AI para analizar estructura y generar embeddings
 * 2. LEGACY: Usa mapeo hardcoded (config.branches, config.faq, etc.)
 * 
 * FLUJO AUTO:
 * 1. Lee datos crudos de Google Sheets
 * 2. SchemaAnalyzer (GPT) analiza cada pestaña
 * 3. Genera documentos basado en análisis
 * 4. Crea embeddings y guarda en pgvector
 * 
 * @version 2.0.0
 */

import { logger } from "../utils/logger.js";
import { 
  upsertEmbeddingBatch, 
  invalidateBySource, 
  isReady as isVectorStoreReady 
} from "./vectorStore.js";
import { schemaAnalyzer } from "./schemaAnalyzer.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const populatorConfig = {
  enabled: process.env.VECTOR_POPULATOR_ENABLED !== "false",
  
  // Modo: "auto" (AI) o "legacy" (hardcoded)
  mode: process.env.VECTOR_POPULATOR_MODE || "auto",
  
  // TTL por categoría (milisegundos)
  ttl: {
    faq: parseInt(process.env.VECTOR_TTL_FAQ_MS || String(7 * 24 * 60 * 60 * 1000), 10),
    product: parseInt(process.env.VECTOR_TTL_PRODUCT_MS || String(24 * 60 * 60 * 1000), 10),
    branch: parseInt(process.env.VECTOR_TTL_BRANCH_MS || String(7 * 24 * 60 * 60 * 1000), 10),
    canned: parseInt(process.env.VECTOR_TTL_CANNED_MS || String(7 * 24 * 60 * 60 * 1000), 10),
    knowledge: parseInt(process.env.VECTOR_TTL_KNOWLEDGE_MS || String(4 * 60 * 60 * 1000), 10),
    promo: parseInt(process.env.VECTOR_TTL_PROMO_MS || String(24 * 60 * 60 * 1000), 10),
  },
  
  // Batch size para embeddings
  batchSize: parseInt(process.env.VECTOR_BATCH_SIZE || "50", 10),
};

// Cache del último análisis
let lastAnalysis = null;
let lastAnalysisTimestamp = 0;

// ═══════════════════════════════════════════════════════════════════════════
// MODO AUTO: Poblado con AI Analysis
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pobla el vector store usando AI para analizar estructura
 * 
 * @param {Object} rawSheetsData - Datos crudos de Google Sheets { sheetName: { columns, rows } }
 * @returns {Promise<Object>} Resultado del poblado
 */
export async function populateWithAutoDiscovery(rawSheetsData) {
  if (!isVectorStoreReady()) {
    logger.warn("Vector store not ready, skipping auto-discovery population");
    return { populated: false, reason: "vector_store_not_ready" };
  }
  
  if (!rawSheetsData || !Object.keys(rawSheetsData).length) {
    logger.warn("No raw sheets data provided");
    return { populated: false, reason: "no_data" };
  }
  
  const startTime = Date.now();
  
  try {
    // STEP 1: Analizar estructura con AI
    logger.info({ sheets: Object.keys(rawSheetsData) }, "Starting AI schema analysis");
    const analysisConfig = await schemaAnalyzer.analyzeGoogleSheet(rawSheetsData);
    
    // Guardar análisis para referencia
    lastAnalysis = analysisConfig;
    lastAnalysisTimestamp = Date.now();
    
    // STEP 2: Generar documentos desde análisis
    const documents = schemaAnalyzer.generateDocumentsFromAnalysis(rawSheetsData, analysisConfig);
    
    if (!documents.length) {
      logger.warn("No documents generated from analysis");
      return { 
        populated: false, 
        reason: "no_documents",
        analysis: analysisConfig.summary,
      };
    }
    
    // STEP 3: Invalidar embeddings anteriores
    const invalidated = await invalidateBySource("config_hub");
    logger.info({ invalidated: invalidated.invalidated }, "Invalidated old embeddings");
    
    // STEP 4: Agregar TTL a documentos
    const documentsWithTtl = documents.map(doc => ({
      ...doc,
      ttlMs: populatorConfig.ttl[doc.category] || populatorConfig.ttl.knowledge,
    }));
    
    // STEP 5: Generar embeddings en batches
    const batches = [];
    for (let i = 0; i < documentsWithTtl.length; i += populatorConfig.batchSize) {
      batches.push(documentsWithTtl.slice(i, i + populatorConfig.batchSize));
    }
    
    let totalInserted = 0;
    for (const batch of batches) {
      const result = await upsertEmbeddingBatch(batch);
      totalInserted += result.inserted || 0;
    }
    
    const duration = Date.now() - startTime;
    
    const stats = {
      mode: "auto",
      total: documents.length,
      inserted: totalInserted,
      sheetsAnalyzed: analysisConfig.summary.total,
      sheetsIndexed: analysisConfig.summary.indexed,
      byCategory: analysisConfig.summary.categories,
      duration_ms: duration,
    };
    
    logger.info(stats, "Auto-discovery population complete");
    
    return {
      populated: true,
      stats,
      analysis: analysisConfig,
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Auto-discovery population failed");
    return { 
      populated: false, 
      reason: error.message,
      fallback: "Trying legacy mode...",
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODO LEGACY: Poblado Hardcoded (compatibilidad)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pobla el vector store usando mapeo hardcoded (modo legacy)
 * Compatible con estructura actual de Config Hub
 * 
 * @param {Object} config - Config procesado de Config Hub
 * @returns {Promise<Object>} Resultado del poblado
 */
export async function populateFromConfigHub(config) {
  if (!populatorConfig.enabled) {
    logger.debug("Vector populator disabled");
    return { populated: false, reason: "disabled" };
  }
  
  if (!isVectorStoreReady()) {
    logger.warn("Vector store not ready, skipping population");
    return { populated: false, reason: "vector_store_not_ready" };
  }
  
  if (!config) {
    logger.warn("No config provided for vector population");
    return { populated: false, reason: "no_config" };
  }
  
  const stats = {
    products: 0,
    branches: 0,
    faqs: 0,
    knowledge: 0,
    canned: 0,
    errors: 0,
  };
  
  const documents = [];
  
  try {
    // ═══════════════════════════════════════════════════════════════
    // 1. PRODUCTOS
    // ═══════════════════════════════════════════════════════════════
    if (config.products?.length) {
      for (const product of config.products) {
        if (!product.enabled) continue;
        
        const textParts = [
          product.name,
          product.description,
          product.sku,
          ...(product.fuzzy_keywords || []),
        ].filter(Boolean);
        
        if (product.name?.toLowerCase().includes("rosca")) {
          textParts.push("pan de reyes", "roscón", "roscon de reyes");
        }
        
        const text = textParts.join(" | ");
        
        documents.push({
          text,
          category: "product",
          source: "config_hub",
          metadata: {
            woo_id: product.woo_id,
            sku: product.sku,
            name: product.name,
            price: product.price,
            type: "product",
          },
          ttlMs: populatorConfig.ttl.product,
        });
        
        stats.products++;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 2. SUCURSALES
    // ═══════════════════════════════════════════════════════════════
    if (config.branches?.length) {
      for (const branch of config.branches) {
        if (!branch.enabled) continue;
        
        const textParts = [
          branch.name,
          branch.short_name,
          branch.address,
          branch.city,
          branch.branch_id,
          ...(branch.synonyms || []),
        ].filter(Boolean);
        
        const text = textParts.join(" | ");
        
        documents.push({
          text,
          category: "branch",
          source: "config_hub",
          metadata: {
            branch_id: branch.branch_id,
            name: branch.name,
            short_name: branch.short_name,
            address: branch.address,
            city: branch.city,
            type: "branch",
          },
          ttlMs: populatorConfig.ttl.branch,
        });
        
        stats.branches++;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 3. FAQs
    // ═══════════════════════════════════════════════════════════════
    if (config.faq?.length) {
      for (const faq of config.faq) {
        if (!faq.enabled) continue;
        
        const keywordsRaw = faq.keywords || "";
        const keywords = Array.isArray(keywordsRaw) 
          ? keywordsRaw.join(" ") 
          : String(keywordsRaw);
        
        const textParts = [
          faq.question,
          faq.answer,
          keywords,
          faq.category,
        ].filter(Boolean);
        
        const text = textParts.join(" | ");
        
        documents.push({
          text,
          category: "faq",
          source: "config_hub",
          metadata: {
            question: faq.question,
            answer: faq.answer,
            faq_category: faq.category,
            type: "faq",
          },
          ttlMs: populatorConfig.ttl.faq,
        });
        
        stats.faqs++;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 4. KNOWLEDGE BASE
    // ═══════════════════════════════════════════════════════════════
    if (config.knowledge?.length) {
      for (const item of config.knowledge) {
        if (!item.enabled) continue;
        
        const textParts = [
          item.key,
          item.value,
          item.context,
        ].filter(Boolean);
        
        const text = textParts.join(" | ");
        
        documents.push({
          text,
          category: "knowledge",
          source: "config_hub",
          metadata: {
            key: item.key,
            scope: item.scope || "all",
            priority: item.priority || 1,
            type: "knowledge",
          },
          ttlMs: populatorConfig.ttl.knowledge,
        });
        
        stats.knowledge++;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // 5. CANNED RESPONSES
    // ═══════════════════════════════════════════════════════════════
    if (config.canned?.length) {
      for (const canned of config.canned) {
        if (!canned.enabled) continue;
        
        const textParts = [
          canned.title,
          canned.use_case,
          canned.category,
          canned.message,
        ].filter(Boolean);
        
        const text = textParts.join(" | ");
        
        documents.push({
          text,
          category: "canned",
          source: "config_hub",
          metadata: {
            title: canned.title,
            message: canned.message,
            use_case: canned.use_case,
            canned_category: canned.category,
            type: "canned_response",
          },
          ttlMs: populatorConfig.ttl.canned,
        });
        
        stats.canned++;
      }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // GENERAR EMBEDDINGS
    // ═══════════════════════════════════════════════════════════════
    
    if (documents.length === 0) {
      logger.info("No documents to embed from Config Hub");
      return { populated: false, reason: "no_documents", stats };
    }
    
    // Invalidar embeddings anteriores del config_hub
    const invalidated = await invalidateBySource("config_hub");
    logger.info({ invalidated: invalidated.invalidated }, "Invalidated embeddings by source");
    
    // Generar embeddings en batch
    const result = await upsertEmbeddingBatch(documents);
    
    logger.info({
      stats,
      total: documents.length,
      inserted: result.inserted,
      mode: "legacy",
    }, "Populated vector store from Config Hub");
    
    return {
      populated: true,
      stats,
      total: documents.length,
      inserted: result.inserted,
      mode: "legacy",
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Vector population failed");
    stats.errors++;
    return { populated: false, reason: error.message, stats };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: Auto-selecciona modo
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Pobla el vector store, seleccionando automáticamente el modo
 * 
 * @param {Object} data - Config procesado O datos crudos de sheets
 * @param {Object} options - Opciones adicionales
 * @returns {Promise<Object>} Resultado del poblado
 */
export async function populate(data, options = {}) {
  const mode = options.mode || populatorConfig.mode;
  
  if (mode === "auto" && options.rawSheetsData) {
    // Modo auto con datos crudos
    logger.info("Using AUTO mode with AI analysis");
    return populateWithAutoDiscovery(options.rawSheetsData);
  }
  
  // Modo legacy con config procesado
  logger.info("Using LEGACY mode with hardcoded mapping");
  return populateFromConfigHub(data);
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

export function getLastAnalysis() {
  return {
    analysis: lastAnalysis,
    timestamp: lastAnalysisTimestamp,
    age_ms: lastAnalysis ? Date.now() - lastAnalysisTimestamp : null,
  };
}

export function getPopulatorConfig() {
  return { ...populatorConfig };
}

export function setMode(mode) {
  if (["auto", "legacy"].includes(mode)) {
    populatorConfig.mode = mode;
    logger.info({ mode }, "Vector populator mode changed");
    return true;
  }
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const vectorPopulator = {
  // Main functions
  populate,
  populateFromConfigHub,
  populateWithAutoDiscovery,
  
  // Config
  getConfig: getPopulatorConfig,
  setMode,
  getLastAnalysis,
};

export default vectorPopulator;
