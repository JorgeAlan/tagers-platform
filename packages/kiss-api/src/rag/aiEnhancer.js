/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RAG AI ENHANCER - Enriquecimiento inteligente de documentos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Funciones de IA para mejorar la calidad del RAG:
 * 1. CHUNKING INTELIGENTE - IA decide los puntos de corte óptimos
 * 2. RESÚMENES AUTOMÁTICOS - Genera resumen del documento
 * 3. EXTRACCIÓN DE ENTIDADES - Detecta productos, precios, fechas, etc.
 * 
 * Soporta múltiples proveedores (configurable desde Google Sheets):
 * - OpenAI (gpt-5-mini, gpt-5, gpt-4o, etc.)
 * - Anthropic (claude-3-5-haiku, claude-3-5-sonnet, etc.)
 * 
 * @version 2.0.0
 */

import OpenAI from "openai";
// Anthropic se importa dinámicamente solo cuando se necesita
import crypto from "crypto";
import { logger } from "../utils/logger.js";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const enhancerConfig = {
  enabled: process.env.RAG_AI_ENHANCE !== "false",
  
  // Modelo por defecto (se sobrescribe con Google Sheets AI_Models)
  defaultModel: process.env.RAG_ENHANCER_MODEL || "gpt-5-mini",
  
  // Rol en AI_Models de Google Sheets
  configRole: "rag_enhancer",
  
  // Límites
  maxTextForAnalysis: parseInt(process.env.RAG_MAX_ANALYSIS_TEXT || "50000", 10),
  maxTextForChunking: parseInt(process.env.RAG_MAX_CHUNKING_TEXT || "30000", 10),
  
  // Timeouts
  timeoutMs: parseInt(process.env.RAG_AI_TIMEOUT_MS || "60000", 10),
  
  // Cache de análisis (evita re-procesar documentos idénticos)
  cacheEnabled: process.env.RAG_ENHANCE_CACHE !== "false",
  cacheTTLMs: parseInt(process.env.RAG_ENHANCE_CACHE_TTL || "3600000", 10), // 1 hora
  
  // Entidades específicas para Tagers
  entityTypes: [
    "producto",      // Nombres de productos (rosca, pan, café)
    "precio",        // Precios y rangos
    "sucursal",      // Ubicaciones y sucursales
    "horario",       // Horarios de atención
    "fecha",         // Fechas importantes
    "promocion",     // Promociones y descuentos
    "ingrediente",   // Ingredientes y alérgenos
    "politica",      // Políticas (envío, devolución, etc)
    "contacto",      // Teléfonos, emails, redes
    "tamano",        // Tamaños y porciones
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTES DE IA (Multi-proveedor)
// ═══════════════════════════════════════════════════════════════════════════

let openaiClient = null;
let anthropicClient = null;
let configHubRef = null;

/**
 * Configura la referencia al ConfigHub para leer AI_Models
 */
export function setConfigHub(hub) {
  configHubRef = hub;
  logger.debug("AI Enhancer: ConfigHub reference set");
}

/**
 * Obtiene el modelo configurado desde Google Sheets o usa default
 */
function getConfiguredModel() {
  if (configHubRef?.getModelForRole) {
    const model = configHubRef.getModelForRole(enhancerConfig.configRole);
    if (model) {
      logger.debug({ role: enhancerConfig.configRole, model }, "Using model from ConfigHub");
      return model;
    }
  }
  
  // Fallback al default
  return enhancerConfig.defaultModel;
}

/**
 * Detecta el proveedor basado en el nombre del modelo
 */
function detectProvider(model) {
  const modelLower = model.toLowerCase();
  
  if (modelLower.includes("claude")) {
    return "anthropic";
  }
  
  // Default a OpenAI (gpt-5, gpt-4o, etc.)
  return "openai";
}

/**
 * Obtiene cliente OpenAI
 */
function getOpenAI() {
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_RAG_API_KEY || config.openaiApiKey,
      timeout: enhancerConfig.timeoutMs,
    });
  }
  return openaiClient;
}

/**
 * Obtiene cliente Anthropic (import dinámico)
 */
async function getAnthropic() {
  if (!anthropicClient) {
    const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY not configured. Add it to use Claude models.");
    }
    
    // Import dinámico - solo se carga cuando se necesita
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    anthropicClient = new Anthropic({
      apiKey,
      timeout: enhancerConfig.timeoutMs,
    });
  }
  return anthropicClient;
}

/**
 * Llama al modelo de IA (soporta OpenAI y Anthropic)
 */
async function callAI(systemPrompt, userPrompt, options = {}) {
  const model = options.model || getConfiguredModel();
  const provider = detectProvider(model);
  
  logger.debug({ model, provider }, "Calling AI for RAG enhancement");
  
  if (provider === "anthropic") {
    return callAnthropic(model, systemPrompt, userPrompt, options);
  } else {
    return callOpenAI(model, systemPrompt, userPrompt, options);
  }
}

/**
 * Llamada a OpenAI
 */
async function callOpenAI(model, systemPrompt, userPrompt, options = {}) {
  const openai = getOpenAI();
  
  const response = await openai.chat.completions.create({
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: options.temperature ?? 0.3,
    max_tokens: options.maxTokens ?? 4000,
    response_format: { type: "json_object" },
  });
  
  return JSON.parse(response.choices[0].message.content);
}

/**
 * Llamada a Anthropic (Claude)
 */
async function callAnthropic(model, systemPrompt, userPrompt, options = {}) {
  const anthropic = await getAnthropic();
  
  const response = await anthropic.messages.create({
    model,
    max_tokens: options.maxTokens ?? 4000,
    system: systemPrompt + "\n\nIMPORTANTE: Responde SOLO con JSON válido, sin markdown, sin ```json, sin explicaciones.",
    messages: [
      { role: "user", content: userPrompt },
    ],
  });
  
  // Extraer texto de la respuesta de Claude
  let text = response.content[0]?.text || "";
  
  // Limpiar posibles markdown code blocks
  text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  
  return JSON.parse(text);
}

// Cache simple en memoria
const analysisCache = new Map();

function getCacheKey(text, type) {
  const hash = crypto.createHash("md5").update(text).digest("hex").slice(0, 16);
  return `${type}:${hash}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. CHUNKING INTELIGENTE CON IA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Usa IA para identificar los puntos de corte semánticos óptimos
 * 
 * @param {string} text - Texto a dividir
 * @param {Object} options
 * @param {number} [options.targetChunkSize=1500] - Tamaño objetivo por chunk (chars)
 * @param {number} [options.minChunkSize=500] - Tamaño mínimo
 * @param {number} [options.maxChunks=50] - Máximo de chunks
 * @param {Object} [options.context] - Contexto adicional (tipo documento, etc)
 * @returns {Promise<Array<{text: string, title: string, summary: string}>>}
 */
export async function intelligentChunk(text, options = {}) {
  const {
    targetChunkSize = 1500,
    minChunkSize = 500,
    maxChunks = 50,
    context = {},
  } = options;
  
  if (!enhancerConfig.enabled) {
    logger.debug("AI chunking disabled, falling back to basic chunking");
    return fallbackChunk(text, targetChunkSize);
  }
  
  // Si el texto es muy corto, no vale la pena usar IA
  if (text.length < minChunkSize * 2) {
    return [{ text, title: "Documento completo", summary: "" }];
  }
  
  // Si el texto es muy largo, primero dividir en secciones grandes
  let textToProcess = text;
  if (text.length > enhancerConfig.maxTextForChunking) {
    logger.info({ 
      originalLength: text.length, 
      maxLength: enhancerConfig.maxTextForChunking 
    }, "Text too long for AI chunking, using hybrid approach");
    textToProcess = text.slice(0, enhancerConfig.maxTextForChunking);
  }
  
  const openai = getOpenAI();
  
  const systemPrompt = `Eres un experto en procesamiento de documentos para sistemas RAG (Retrieval Augmented Generation).

Tu tarea es analizar el texto y dividirlo en CHUNKS semánticos óptimos para búsqueda.

REGLAS:
1. Cada chunk debe ser una unidad de información coherente y autocontenida
2. Tamaño objetivo: ${targetChunkSize} caracteres (flexible ±30%)
3. Mínimo: ${minChunkSize} caracteres por chunk
4. Máximo: ${maxChunks} chunks
5. Preservar contexto: cada chunk debe poder entenderse sin los demás
6. Identificar: títulos de sección, cambios de tema, listas relacionadas

CONTEXTO DEL DOCUMENTO:
${context.category ? `- Categoría: ${context.category}` : ""}
${context.title ? `- Título: ${context.title}` : ""}
${context.format ? `- Formato original: ${context.format}` : ""}

Responde SOLO con JSON válido, sin markdown ni explicaciones.`;

  const userPrompt = `Divide este texto en chunks semánticos óptimos:

"""
${textToProcess}
"""

Responde con este formato JSON exacto:
{
  "chunks": [
    {
      "start": 0,
      "end": 500,
      "title": "Título descriptivo del chunk",
      "summary": "Resumen de 1 línea del contenido"
    }
  ],
  "reasoning": "Breve explicación de cómo dividiste el texto"
}`;

  try {
    const model = getConfiguredModel();
    const result = await callAI(systemPrompt, userPrompt, {
      model,
      temperature: 0.3,
      maxTokens: 4000,
    });
    
    if (!result.chunks || !Array.isArray(result.chunks)) {
      throw new Error("Invalid response structure");
    }
    
    // Extraer los chunks del texto original
    const chunks = result.chunks.map((c, idx) => {
      const chunkText = text.slice(c.start, c.end);
      return {
        text: chunkText.trim(),
        title: c.title || `Sección ${idx + 1}`,
        summary: c.summary || "",
        aiGenerated: true,
        position: { start: c.start, end: c.end },
      };
    }).filter(c => c.text.length >= minChunkSize / 2); // Filtrar chunks vacíos
    
    logger.info({ 
      chunksGenerated: chunks.length,
      model,
      reasoning: result.reasoning?.slice(0, 100),
    }, "AI chunking completed");
    
    // Si quedó texto sin procesar (documento muy largo), agregar chunks adicionales
    if (text.length > enhancerConfig.maxTextForChunking) {
      const remainingText = text.slice(enhancerConfig.maxTextForChunking);
      const additionalChunks = fallbackChunk(remainingText, targetChunkSize);
      chunks.push(...additionalChunks.map((c, i) => ({
        ...c,
        title: `Continuación ${i + 1}`,
        aiGenerated: false,
      })));
    }
    
    return chunks;
    
  } catch (error) {
    logger.error({ err: error.message }, "AI chunking failed, falling back to basic");
    return fallbackChunk(text, targetChunkSize);
  }
}

/**
 * Chunking básico de fallback
 */
function fallbackChunk(text, targetSize = 1500) {
  const chunks = [];
  const paragraphs = text.split(/\n\n+/);
  let currentChunk = "";
  
  for (const para of paragraphs) {
    if ((currentChunk + para).length > targetSize && currentChunk.length > 0) {
      chunks.push({ text: currentChunk.trim(), title: "", summary: "", aiGenerated: false });
      currentChunk = para;
    } else {
      currentChunk += (currentChunk ? "\n\n" : "") + para;
    }
  }
  
  if (currentChunk.trim()) {
    chunks.push({ text: currentChunk.trim(), title: "", summary: "", aiGenerated: false });
  }
  
  return chunks;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. GENERACIÓN DE RESÚMENES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un resumen estructurado del documento
 * 
 * @param {string} text - Texto del documento
 * @param {Object} options
 * @param {string} [options.style="concise"] - Estilo: concise, detailed, bullets
 * @param {number} [options.maxLength=500] - Longitud máxima del resumen
 * @param {string} [options.language="es"] - Idioma del resumen
 * @param {Object} [options.context] - Contexto adicional
 * @returns {Promise<{summary: string, keyPoints: string[], topics: string[]}>}
 */
export async function generateSummary(text, options = {}) {
  const {
    style = "concise",
    maxLength = 500,
    language = "es",
    context = {},
  } = options;
  
  if (!enhancerConfig.enabled) {
    return { summary: "", keyPoints: [], topics: [] };
  }
  
  // Truncar si es muy largo
  let textToAnalyze = text;
  if (text.length > enhancerConfig.maxTextForAnalysis) {
    // Tomar inicio y final para mejor contexto
    const halfLimit = Math.floor(enhancerConfig.maxTextForAnalysis / 2);
    textToAnalyze = text.slice(0, halfLimit) + "\n\n[...]\n\n" + text.slice(-halfLimit);
  }
  
  const styleInstructions = {
    concise: "Resumen breve y directo, máximo 2-3 oraciones.",
    detailed: "Resumen completo que capture todos los puntos importantes.",
    bullets: "Lista de puntos clave en formato bullet.",
  };
  
  const systemPrompt = `Eres un experto en análisis de documentos para Tagers, una cadena de panaderías y restaurantes en México.

Tu tarea es generar un resumen útil para un sistema de atención al cliente.

ESTILO: ${styleInstructions[style] || styleInstructions.concise}
LONGITUD MÁXIMA: ${maxLength} caracteres
IDIOMA: ${language === "es" ? "Español mexicano" : "English"}

CONTEXTO:
${context.category ? `- Tipo de documento: ${context.category}` : ""}
${context.title ? `- Título: ${context.title}` : ""}

IMPORTANTE:
- Enfócate en información útil para clientes (precios, horarios, políticas, productos)
- Menciona datos específicos cuando estén disponibles
- Ignora información administrativa interna

Responde SOLO con JSON válido.`;

  const userPrompt = `Analiza este documento y genera un resumen:

"""
${textToAnalyze}
"""

Responde con este formato JSON:
{
  "summary": "Resumen del documento",
  "keyPoints": ["Punto clave 1", "Punto clave 2", "..."],
  "topics": ["tema1", "tema2"],
  "documentType": "tipo de documento detectado",
  "relevanceScore": 0.0-1.0
}`;

  try {
    const model = getConfiguredModel();
    const result = await callAI(systemPrompt, userPrompt, {
      model,
      temperature: 0.3,
      maxTokens: 1000,
    });
    
    logger.debug({ 
      summaryLength: result.summary?.length,
      keyPointsCount: result.keyPoints?.length,
      topics: result.topics,
      model,
    }, "Summary generated");
    
    return {
      summary: result.summary || "",
      keyPoints: result.keyPoints || [],
      topics: result.topics || [],
      documentType: result.documentType,
      relevanceScore: result.relevanceScore,
    };
    
  } catch (error) {
    logger.error({ err: error.message }, "Summary generation failed");
    return { summary: "", keyPoints: [], topics: [] };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. EXTRACCIÓN DE ENTIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae entidades estructuradas del texto
 * 
 * @param {string} text - Texto a analizar
 * @param {Object} options
 * @param {string[]} [options.entityTypes] - Tipos de entidades a extraer
 * @param {Object} [options.context] - Contexto adicional
 * @returns {Promise<Object>} Entidades extraídas por tipo
 */
export async function extractEntities(text, options = {}) {
  const {
    entityTypes = enhancerConfig.entityTypes,
    context = {},
  } = options;
  
  if (!enhancerConfig.enabled) {
    return { entities: {}, raw: [] };
  }
  
  // Truncar si es muy largo
  let textToAnalyze = text;
  if (text.length > enhancerConfig.maxTextForAnalysis) {
    textToAnalyze = text.slice(0, enhancerConfig.maxTextForAnalysis);
  }
  
  const entityDescriptions = {
    producto: "Nombres de productos (roscas, panes, pasteles, bebidas, etc)",
    precio: "Precios y rangos de precios (ej: $529, desde $200)",
    sucursal: "Nombres de sucursales y ubicaciones",
    horario: "Horarios de atención (ej: 7am-9pm, lunes a domingo)",
    fecha: "Fechas importantes (temporadas, días festivos, promociones)",
    promocion: "Promociones, descuentos, ofertas",
    ingrediente: "Ingredientes y alérgenos",
    politica: "Políticas (envío, devolución, cancelación, etc)",
    contacto: "Teléfonos, emails, WhatsApp, redes sociales",
    tamano: "Tamaños, porciones, rendimientos",
  };
  
  const systemPrompt = `Eres un experto en extracción de entidades para Tagers, una cadena de panaderías y restaurantes.

TIPOS DE ENTIDADES A EXTRAER:
${entityTypes.map(t => `- ${t}: ${entityDescriptions[t] || t}`).join("\n")}

REGLAS:
1. Extrae SOLO información explícita en el texto
2. Normaliza precios a formato numérico (529, no "$529 pesos")
3. Normaliza horarios a formato 24h cuando sea posible
4. Para productos, incluye variantes si las hay
5. Marca el nivel de confianza (high, medium, low)

Responde SOLO con JSON válido.`;

  const userPrompt = `Extrae las entidades de este texto:

"""
${textToAnalyze}
"""

Responde con este formato JSON:
{
  "entities": {
    "producto": [
      {"value": "Rosca de Reyes Clásica", "confidence": "high", "context": "texto donde aparece"}
    ],
    "precio": [
      {"value": 529, "currency": "MXN", "product": "Rosca Clásica", "confidence": "high"}
    ],
    "sucursal": [...],
    "horario": [...],
    "fecha": [...],
    "promocion": [...],
    "ingrediente": [...],
    "politica": [...],
    "contacto": [...],
    "tamano": [...]
  },
  "relationships": [
    {"type": "precio_producto", "from": "Rosca Clásica", "to": 529}
  ]
}`;

  try {
    const model = getConfiguredModel();
    const result = await callAI(systemPrompt, userPrompt, {
      model,
      temperature: 0.2,
      maxTokens: 2000,
    });
    
    // Contar entidades extraídas
    const entityCounts = {};
    for (const [type, entities] of Object.entries(result.entities || {})) {
      entityCounts[type] = Array.isArray(entities) ? entities.length : 0;
    }
    
    logger.debug({ entityCounts, model }, "Entities extracted");
    
    return {
      entities: result.entities || {},
      relationships: result.relationships || [],
      raw: flattenEntities(result.entities),
    };
    
  } catch (error) {
    logger.error({ err: error.message }, "Entity extraction failed");
    return { entities: {}, relationships: [], raw: [] };
  }
}

/**
 * Aplana las entidades a una lista simple
 */
function flattenEntities(entities) {
  const flat = [];
  for (const [type, items] of Object.entries(entities || {})) {
    if (Array.isArray(items)) {
      for (const item of items) {
        flat.push({
          type,
          value: item.value,
          confidence: item.confidence,
          ...item,
        });
      }
    }
  }
  return flat;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: ENHANCE DOCUMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Enriquece un documento con todas las funciones de IA
 * 
 * @param {Object} document - Documento cargado
 * @param {string} document.content - Contenido del documento
 * @param {Object} document.metadata - Metadata del documento
 * @param {Object} options
 * @param {boolean} [options.generateSummary=true] - Generar resumen
 * @param {boolean} [options.extractEntities=true] - Extraer entidades
 * @param {boolean} [options.intelligentChunking=true] - Usar chunking con IA
 * @returns {Promise<EnhancedDocument>}
 */
export async function enhanceDocument(document, options = {}) {
  const {
    generateSummary: doSummary = true,
    extractEntities: doEntities = true,
    intelligentChunking: doChunking = true,
  } = options;
  
  const startTime = Date.now();
  const enhanced = {
    ...document,
    enhancement: {
      enabled: enhancerConfig.enabled,
      timestamp: new Date().toISOString(),
      summary: null,
      entities: null,
      chunks: null,
      processingTimeMs: 0,
    },
  };
  
  if (!enhancerConfig.enabled) {
    logger.debug("AI enhancement disabled");
    enhanced.enhancement.enabled = false;
    return enhanced;
  }
  
  const context = {
    title: document.metadata?.title,
    category: document.metadata?.category,
    format: document.metadata?.format,
  };
  
  // Ejecutar en paralelo para eficiencia
  const tasks = [];
  
  if (doSummary) {
    tasks.push(
      generateSummary(document.content, { context })
        .then(result => { enhanced.enhancement.summary = result; })
        .catch(err => { 
          logger.error({ err: err.message }, "Summary task failed"); 
          enhanced.enhancement.summary = { error: err.message };
        })
    );
  }
  
  if (doEntities) {
    tasks.push(
      extractEntities(document.content, { context })
        .then(result => { enhanced.enhancement.entities = result; })
        .catch(err => { 
          logger.error({ err: err.message }, "Entity extraction task failed"); 
          enhanced.enhancement.entities = { error: err.message };
        })
    );
  }
  
  if (doChunking) {
    tasks.push(
      intelligentChunk(document.content, { context })
        .then(result => { enhanced.enhancement.chunks = result; })
        .catch(err => { 
          logger.error({ err: err.message }, "Chunking task failed"); 
          enhanced.enhancement.chunks = { error: err.message };
        })
    );
  }
  
  await Promise.all(tasks);
  
  enhanced.enhancement.processingTimeMs = Date.now() - startTime;
  
  logger.info({
    processingTimeMs: enhanced.enhancement.processingTimeMs,
    hasSummary: !!enhanced.enhancement.summary?.summary,
    entityCount: enhanced.enhancement.entities?.raw?.length || 0,
    chunkCount: enhanced.enhancement.chunks?.length || 0,
  }, "Document enhancement completed");
  
  return enhanced;
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si el enhancer está habilitado y listo
 */
export function isEnhancerReady() {
  return enhancerConfig.enabled && !!config.openaiApiKey;
}

/**
 * Obtiene la configuración actual
 */
export function getEnhancerConfig() {
  return { ...enhancerConfig };
}

/**
 * Limpia el cache de análisis
 */
export function clearCache() {
  const size = analysisCache.size;
  analysisCache.clear();
  return { cleared: size };
}

// Export default
export default {
  enhanceDocument,
  intelligentChunk,
  generateSummary,
  extractEntities,
  isEnhancerReady,
  getEnhancerConfig,
  clearCache,
};
