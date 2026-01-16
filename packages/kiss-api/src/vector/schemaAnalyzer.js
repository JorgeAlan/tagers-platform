/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCHEMA ANALYZER v3.0 - Full Auto-Adaptive AI Sheet Analysis
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Usa el sistema auto-adaptativo completo de modelRegistry v3:
 * - Delays automáticos entre llamadas
 * - Retry inteligente con backoff
 * - Ajuste dinámico de tokens
 * - Aprendizaje de errores
 * 
 * UBICACIÓN: /app/src/vector/schemaAnalyzer.js
 * 
 * @version 3.0.0
 * @author Tagers AI System
 */

import OpenAI from "openai";
import { logger } from "../utils/logger.js";
import { 
  getModel, 
  getChatParams, 
  supportsJsonMode, 
  learnFromError,
  recordSuccess,
  applyDelay,
  getAdaptiveStats,
} from "../../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  sampleRows: parseInt(process.env.SCHEMA_SAMPLE_ROWS || "5", 10),
  maxRetries: 3,
  cacheEnabled: process.env.SCHEMA_CACHE_ENABLED !== "false",
  cacheTtlMs: parseInt(process.env.SCHEMA_CACHE_TTL_MS || String(60 * 60 * 1000), 10),
  ignoredSheets: new Set([
    "_meta", "_config", "_settings", "template", 
    "instrucciones", "readme", "notas", "ai_models",
    "config", "settings", "metadata",
  ]),
};

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTE OPENAI
// ═══════════════════════════════════════════════════════════════════════════

let _client = null;

function getClient() {
  if (_client) return _client;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY environment variable required");
  _client = new OpenAI({ apiKey, timeout: 30000, maxRetries: 0 });
  return _client;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE
// ═══════════════════════════════════════════════════════════════════════════

const analysisCache = new Map();

function computeCacheKey(sheetName, columns, rows) {
  const sampleStr = JSON.stringify(rows).substring(0, 500);
  let hash = 0;
  for (let i = 0; i < sampleStr.length; i++) {
    hash = ((hash << 5) - hash) + sampleStr.charCodeAt(i);
    hash = hash & hash;
  }
  return `${sheetName}:${columns.length}:${hash.toString(16)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACCIÓN DE JSON
// ═══════════════════════════════════════════════════════════════════════════

function extractJson(text) {
  if (!text) throw new Error("Empty response");
  const trimmed = text.trim();
  
  try { return JSON.parse(trimmed); } catch (e) {}
  
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try { return JSON.parse(codeBlock[1].trim()); } catch (e) {}
  }
  
  const jsonMatch = trimmed.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch (e) {}
    let repaired = jsonMatch[0]
      .replace(/,\s*([}\]])/g, "$1")
      .replace(/([{,]\s*)(\w+)(\s*:)/g, '$1"$2"$3');
    try { return JSON.parse(repaired); } catch (e) {}
  }
  
  throw new Error(`Cannot extract JSON: ${trimmed.substring(0, 100)}...`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LLAMADA INTELIGENTE AUTO-ADAPTATIVA
// ═══════════════════════════════════════════════════════════════════════════

async function smartOpenAICall(params, role = "schema_analyzer") {
  const client = getClient();
  let currentParams = { ...params };
  let lastError = null;
  
  for (let attempt = 1; attempt <= CONFIG.maxRetries + 1; attempt++) {
    try {
      // Aplicar delay recomendado (rate limiting adaptativo)
      await applyDelay();
      
      const response = await client.chat.completions.create(currentParams);
      
      // DEBUG: Log raw response structure
      const choice = response.choices?.[0];
      logger.debug({
        model: response.model,
        finish_reason: choice?.finish_reason,
        content_length: choice?.message?.content?.length || 0,
        has_refusal: !!choice?.message?.refusal,
        has_tool_calls: !!choice?.message?.tool_calls,
        usage: response.usage,
      }, "🔍 OpenAI raw response");
      
      // Check for refusal (some models use this)
      if (choice?.message?.refusal) {
        throw new Error(`Model refused: ${choice.message.refusal}`);
      }
      
      // Check for empty content with finish_reason
      if (!choice?.message?.content && choice?.finish_reason === "length") {
        throw new Error("max_tokens or model output limit was reached");
      }
      
      // Éxito - registrar para ajustar delays
      recordSuccess();
      
      return response;
      
    } catch (error) {
      lastError = error;
      const errorMsg = error.message || String(error);
      
      // Aprender del error y obtener instrucciones de retry
      const learned = learnFromError(currentParams.model, errorMsg, {
        role,
        max_tokens: currentParams.max_tokens || currentParams.max_completion_tokens,
      });
      
      logger.warn({
        attempt,
        error: errorMsg.substring(0, 100),
        learned: learned.learned,
        shouldRetry: learned.shouldRetry,
        retryDelay: learned.retryDelay,
        adjustedTokens: learned.adjustedTokens,
      }, "🔄 OpenAI call failed");
      
      if (!learned.shouldRetry || attempt > CONFIG.maxRetries) {
        break;
      }
      
      // Esperar delay recomendado
      if (learned.retryDelay > 0) {
        await new Promise(r => setTimeout(r, learned.retryDelay));
      }
      
      // Reconstruir parámetros con ajustes aprendidos
      const newBaseParams = getChatParams(role);
      currentParams = {
        ...newBaseParams,
        messages: params.messages,
      };
      
      // Ajustar tokens si se truncó
      if (learned.adjustedTokens) {
        if (currentParams.max_completion_tokens) {
          currentParams.max_completion_tokens = learned.adjustedTokens;
        } else {
          currentParams.max_tokens = learned.adjustedTokens;
        }
      }
      
      // Deshabilitar json_mode si no está soportado
      if (learned.disableJsonMode) {
        delete currentParams.response_format;
      } else if (params.response_format && supportsJsonMode(newBaseParams.model)) {
        currentParams.response_format = params.response_format;
      }
    }
  }
  
  throw lastError;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT
// ═══════════════════════════════════════════════════════════════════════════

const SYSTEM_PROMPT = `Eres un experto en análisis de datos para sistemas RAG.

Analiza la pestaña de Google Sheets y determina:
1. Si es útil para búsqueda semántica
2. Qué categoría representa
3. Qué columnas usar para embeddings
4. Qué columnas usar como metadata

CATEGORÍAS: faq, product, branch, canned, knowledge, promo, skip

REGLAS:
- Menos de 2 filas útiles → skip
- Solo números/IDs sin texto → skip
- Prioriza columnas con texto descriptivo

Responde SOLO JSON válido:
{"sheet_name":"nombre","should_index":true,"category":"faq","confidence":0.95,"reasoning":"...","text_columns":["col1"],"text_template":"{{col1}}","metadata_columns":["id"],"filter_column":"enabled","estimated_embeddings":50}`;

function buildUserPrompt(sheetName, columns, rows) {
  return `PESTAÑA: ${sheetName}
COLUMNAS: ${columns.join(", ")}
DATOS (${rows.length} filas):
${JSON.stringify(rows, null, 2)}
Responde JSON.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISIS DE UNA PESTAÑA
// ═══════════════════════════════════════════════════════════════════════════

async function analyzeSheet(sheetName, columns, rows) {
  if (CONFIG.ignoredSheets.has(sheetName.toLowerCase())) {
    return createSkipResult(sheetName, "System sheet (ignored)");
  }
  
  if (!columns || columns.length < 2) {
    return createSkipResult(sheetName, "Too few columns");
  }
  
  if (!rows || rows.length === 0) {
    return createSkipResult(sheetName, "No data rows");
  }
  
  const cacheKey = computeCacheKey(sheetName, columns, rows);
  if (CONFIG.cacheEnabled) {
    const cached = analysisCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CONFIG.cacheTtlMs) {
      logger.debug({ sheetName }, "Schema analysis cache hit");
      return cached.result;
    }
  }
  
  try {
    const model = getModel("schema_analyzer");
    const baseParams = getChatParams("schema_analyzer");
    
    const params = {
      ...baseParams,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(sheetName, columns, rows) },
      ],
    };
    
    // GPT-5-mini puede tener problemas con json_mode, intentar con y sin
    let useJsonMode = supportsJsonMode(model);
    
    if (useJsonMode) {
      params.response_format = { type: "json_object" };
    }
    
    // Log params para debugging
    logger.debug({
      sheetName,
      model: params.model,
      hasJsonMode: useJsonMode,
      maxTokens: params.max_tokens || params.max_completion_tokens,
      promptLength: params.messages[1].content.length,
    }, "📤 Sending to OpenAI");
    
    let response;
    try {
      response = await smartOpenAICall(params, "schema_analyzer");
    } catch (firstError) {
      // Si falló con json_mode, intentar sin él
      if (useJsonMode && firstError.message?.includes("Empty response")) {
        logger.warn({ sheetName }, "🔄 Retrying without json_mode");
        delete params.response_format;
        response = await smartOpenAICall(params, "schema_analyzer");
      } else {
        throw firstError;
      }
    }
    
    const content = response.choices[0]?.message?.content;
    
    if (!content) {
      throw new Error("Empty response from OpenAI");
    }
    
    const result = extractJson(content);
    const validated = validateAndNormalize(result, sheetName);
    
    if (CONFIG.cacheEnabled) {
      analysisCache.set(cacheKey, { result: validated, timestamp: Date.now() });
    }
    
    logger.info({
      sheetName,
      category: validated.category,
      shouldIndex: validated.should_index,
      confidence: validated.confidence,
      textColumns: validated.text_columns,
      model: response.model,
    }, "Sheet analyzed by AI ✨");
    
    return validated;
    
  } catch (error) {
    logger.error({ error: error.message, sheetName }, "AI analysis failed, using fallback");
    return inferFromColumnNames(sheetName, columns, rows);
  }
}

function createSkipResult(sheetName, reason) {
  return {
    sheet_name: sheetName,
    should_index: false,
    category: "skip",
    confidence: 1.0,
    reasoning: reason,
    text_columns: [],
    text_template: "",
    metadata_columns: [],
    filter_column: null,
    estimated_embeddings: 0,
  };
}

function validateAndNormalize(result, sheetName) {
  const validCategories = ["faq", "product", "branch", "canned", "knowledge", "promo", "skip"];
  return {
    sheet_name: result.sheet_name || sheetName,
    should_index: Boolean(result.should_index),
    category: validCategories.includes(result.category) ? result.category : "skip",
    confidence: typeof result.confidence === "number" ? result.confidence : 0.5,
    reasoning: result.reasoning || "",
    text_columns: Array.isArray(result.text_columns) ? result.text_columns : [],
    text_template: result.text_template || "",
    metadata_columns: Array.isArray(result.metadata_columns) ? result.metadata_columns : [],
    filter_column: result.filter_column || null,
    estimated_embeddings: typeof result.estimated_embeddings === "number" ? result.estimated_embeddings : 0,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK (inferencia sin AI)
// ═══════════════════════════════════════════════════════════════════════════

function inferFromColumnNames(sheetName, columns, rows) {
  const nameLower = sheetName.toLowerCase();
  
  let category = "knowledge";
  if (nameLower.includes("faq") || nameLower.includes("pregunta")) category = "faq";
  else if (nameLower.includes("product") || nameLower.includes("menu") || nameLower.includes("rosca")) category = "product";
  else if (nameLower.includes("branch") || nameLower.includes("sucursal") || nameLower.includes("tienda")) category = "branch";
  else if (nameLower.includes("canned") || nameLower.includes("respuesta")) category = "canned";
  else if (nameLower.includes("promo") || nameLower.includes("oferta")) category = "promo";
  
  const textKeywords = ["question", "answer", "pregunta", "respuesta", "description", "descripcion", "message", "mensaje", "content", "contenido", "name", "nombre", "title", "titulo", "text", "texto", "detalle", "info"];
  
  const textColumns = columns.filter(col => {
    const lower = col.toLowerCase();
    if (textKeywords.some(k => lower.includes(k))) return true;
    if (rows.length > 0) {
      const sample = rows[0][col];
      if (typeof sample === "string" && sample.length > 20) return true;
    }
    return false;
  });
  
  const metaKeywords = ["id", "sku", "category", "categoria", "type", "tipo", "enabled", "activo", "status"];
  const metadataColumns = columns.filter(col => metaKeywords.some(k => col.toLowerCase().includes(k)));
  
  const filterColumn = columns.find(c => ["enabled", "activo", "active", "visible"].includes(c.toLowerCase())) || null;
  
  return {
    sheet_name: sheetName,
    should_index: textColumns.length > 0,
    category,
    confidence: 0.6,
    reasoning: "Inferred from column names (AI fallback)",
    text_columns: textColumns.slice(0, 4),
    text_template: textColumns.slice(0, 3).map(c => `{{${c}}}`).join(" | "),
    metadata_columns: metadataColumns,
    filter_column: filterColumn,
    estimated_embeddings: rows.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISIS COMPLETO DE GOOGLE SHEET
// ═══════════════════════════════════════════════════════════════════════════

export async function analyzeGoogleSheet(sheetsData) {
  if (!sheetsData || typeof sheetsData !== "object") {
    logger.warn("analyzeGoogleSheet: Invalid or empty sheetsData");
    return { 
      sheets: {}, 
      summary: { total: 0, indexed: 0, skipped: 0, categories: {} },
      generated_at: new Date().toISOString(),
    };
  }
  
  const sheetNames = Object.keys(sheetsData);
  logger.info({ sheetCount: sheetNames.length }, "Starting Google Sheet analysis");
  
  const results = {};
  let indexed = 0;
  
  for (const sheetName of sheetNames) {
    const sheetData = sheetsData[sheetName];
    const columns = sheetData.columns || Object.keys(sheetData.rows?.[0] || {});
    const sampleRows = (sheetData.rows || []).slice(0, CONFIG.sampleRows);
    
    results[sheetName] = await analyzeSheet(sheetName, columns, sampleRows);
    
    if (results[sheetName].should_index) {
      indexed++;
    }
  }
  
  const categories = {};
  for (const analysis of Object.values(results)) {
    if (analysis.should_index) {
      categories[analysis.category] = (categories[analysis.category] || 0) + 1;
    }
  }
  
  const config = {
    sheets: results,
    summary: { total: sheetNames.length, indexed, skipped: sheetNames.length - indexed, categories },
    generated_at: new Date().toISOString(),
    analyzer_model: getModel("schema_analyzer"),
    adaptive_stats: getAdaptiveStats(),
  };
  
  logger.info({
    total: config.summary.total,
    indexed: config.summary.indexed,
    skipped: config.summary.skipped,
    categories: config.summary.categories,
    adaptiveStats: config.adaptive_stats,
  }, "Google Sheet analysis complete ✅");
  
  return config;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERADOR DE DOCUMENTOS PARA EMBEDDINGS
// ═══════════════════════════════════════════════════════════════════════════

export function generateDocumentsFromAnalysis(sheetsData, analysisConfig) {
  const documents = [];
  
  for (const [sheetName, analysis] of Object.entries(analysisConfig.sheets)) {
    if (!analysis.should_index) continue;
    
    const rows = sheetsData[sheetName]?.rows || [];
    
    for (const row of rows) {
      if (analysis.filter_column) {
        const filterValue = row[analysis.filter_column];
        if (filterValue === false || filterValue === "FALSE" || filterValue === "false" || filterValue === 0 || filterValue === "0" || filterValue === "no") {
          continue;
        }
      }
      
      let text = "";
      if (analysis.text_template) {
        text = analysis.text_template.replace(/\{\{(\w+)\}\}/g, (_, col) => row[col] || "");
      } else if (analysis.text_columns?.length) {
        text = analysis.text_columns.map(c => row[c]).filter(Boolean).join(" | ");
      }
      
      if (!text || text.trim().length < 10) continue;
      
      const metadata = { type: analysis.category, source: "config_hub", sheet: sheetName };
      
      for (const col of analysis.metadata_columns || []) {
        if (row[col] !== undefined && row[col] !== null) {
          metadata[col.toLowerCase().replace(/\s+/g, "_")] = row[col];
        }
      }
      
      for (const col of analysis.text_columns || []) {
        const key = col.toLowerCase().replace(/\s+/g, "_");
        if (row[col] && !metadata[key]) {
          metadata[key] = row[col];
        }
      }
      
      documents.push({ text: text.trim(), category: analysis.category, source: "config_hub", metadata, sheetName });
    }
  }
  
  const byCategory = documents.reduce((acc, d) => { acc[d.category] = (acc[d.category] || 0) + 1; return acc; }, {});
  logger.info({ totalDocuments: documents.length, byCategory }, "Documents generated from analysis");
  
  return documents;
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

export function clearCache() {
  const size = analysisCache.size;
  analysisCache.clear();
  logger.info({ cleared: size }, "Schema analysis cache cleared");
  return size;
}

export function getCacheStats() {
  return { enabled: CONFIG.cacheEnabled, size: analysisCache.size, ttlMs: CONFIG.cacheTtlMs };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const schemaAnalyzer = {
  analyzeSheet,
  analyzeGoogleSheet,
  generateDocumentsFromAnalysis,
  clearCache,
  getCacheStats,
};

export default schemaAnalyzer;
