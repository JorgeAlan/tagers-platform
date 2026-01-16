/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RAG INGEST PIPELINE - Orquestador de ingesta de documentos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Pipeline completo:
 * 1. LOAD    - Cargar documento (PDF, DOCX, TXT, MD, JSON, HTML, URL)
 * 2. CHUNK   - Dividir en fragmentos óptimos para embedding
 * 3. EMBED   - Generar embeddings con OpenAI
 * 4. STORE   - Guardar en pgvector
 * 5. INDEX   - Actualizar índices y metadata
 * 
 * Modos de operación:
 * - SINGLE: Procesar un documento
 * - BATCH: Procesar múltiples documentos
 * - WATCH: Monitorear directorio para cambios
 * - SYNC: Sincronizar con fuente externa
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { documentLoader } from "./documentLoader.js";
import { chunker } from "./chunker.js";
import aiEnhancer from "./aiEnhancer.js";
import { 
  upsertEmbeddingBatch, 
  invalidateBySource,
  searchSimilar,
  getStats as getVectorStats,
  isReady as isVectorReady,
} from "../vector/vectorStore.js";
import { getEmbedding } from "../vector/embeddings.js";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const pipelineConfig = {
  enabled: process.env.RAG_PIPELINE_ENABLED !== "false",
  
  // AI Enhancement
  aiEnhancement: {
    enabled: process.env.RAG_AI_ENHANCE !== "false",
    generateSummary: process.env.RAG_AI_SUMMARY !== "false",
    extractEntities: process.env.RAG_AI_ENTITIES !== "false",
    intelligentChunking: process.env.RAG_AI_CHUNKING !== "false",
  },
  
  // Batch processing
  batchSize: parseInt(process.env.RAG_BATCH_SIZE || "20", 10),
  maxConcurrent: parseInt(process.env.RAG_MAX_CONCURRENT || "3", 10),
  
  // Retry settings
  maxRetries: parseInt(process.env.RAG_MAX_RETRIES || "3", 10),
  retryDelayMs: parseInt(process.env.RAG_RETRY_DELAY_MS || "1000", 10),
  
  // TTL por categoría (ms)
  ttl: {
    menu: 7 * 24 * 60 * 60 * 1000,      // 7 días - menú estable
    policy: 30 * 24 * 60 * 60 * 1000,   // 30 días - políticas cambian poco
    recipe: 90 * 24 * 60 * 60 * 1000,   // 90 días - recetas son permanentes
    history: null,                       // Sin expiración - historia de marca
    faq: 7 * 24 * 60 * 60 * 1000,       // 7 días
    training: 14 * 24 * 60 * 60 * 1000, // 14 días - materiales de capacitación
    promo: 24 * 60 * 60 * 1000,         // 1 día - promociones cambian
    general: 7 * 24 * 60 * 60 * 1000,   // 7 días default
  },
  
  // Directorio de documentos
  documentsDir: process.env.RAG_DOCUMENTS_DIR || "./documents",
  
  // Directorio de uploads
  uploadsDir: process.env.RAG_UPLOADS_DIR || "./uploads/rag",
};

// Estado del pipeline
const pipelineState = {
  isProcessing: false,
  lastRun: null,
  lastError: null,
  stats: {
    totalProcessed: 0,
    totalChunks: 0,
    totalErrors: 0,
    byCategory: {},
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ingesta un documento individual
 * 
 * @param {string|Buffer} source - Path, URL, o Buffer del documento
 * @param {Object} options
 * @param {string} [options.title] - Título del documento
 * @param {string} [options.category] - Categoría (menu, policy, recipe, history, faq, training, promo)
 * @param {string} [options.source] - Identificador de origen (para invalidación)
 * @param {Object} [options.metadata] - Metadata adicional
 * @param {string} [options.chunkStrategy] - Estrategia de chunking
 * @returns {Promise<IngestResult>}
 */
export async function ingestDocument(source, options = {}) {
  const startTime = Date.now();
  const jobId = generateJobId();
  
  if (!pipelineConfig.enabled) {
    return { 
      ok: false, 
      error: "Pipeline disabled",
      jobId,
    };
  }
  
  if (!isVectorReady()) {
    return { 
      ok: false, 
      error: "Vector store not ready",
      jobId,
    };
  }
  
  const {
    title,
    category = "general",
    source: sourceId = "manual",
    metadata = {},
    chunkStrategy,
    fileName,
  } = options;
  
  logger.info({ jobId, source: typeof source === "string" ? source : fileName, category }, "Starting document ingestion");
  
  try {
    // STEP 1: LOAD
    let document;
    
    if (Buffer.isBuffer(source)) {
      if (!fileName) {
        throw new Error("fileName required for buffer input");
      }
      document = await documentLoader.loadFromBuffer(source, fileName, { title, category, metadata });
    } else if (typeof source === "string") {
      document = await documentLoader.loadDocument(source, { title, category, metadata });
    } else {
      throw new Error("Invalid source type. Expected string (path/URL) or Buffer");
    }
    
    logger.debug({ 
      jobId, 
      contentLength: document.content.length,
      format: document.metadata.format,
    }, "Document loaded");
    
    // STEP 1.5: AI ENHANCEMENT (opcional)
    let enhancement = null;
    let aiChunks = null;
    
    if (pipelineConfig.aiEnhancement.enabled && !options.skipEnhancement) {
      logger.debug({ jobId }, "Starting AI enhancement");
      
      try {
        const enhanced = await aiEnhancer.enhanceDocument(document, {
          generateSummary: pipelineConfig.aiEnhancement.generateSummary,
          extractEntities: pipelineConfig.aiEnhancement.extractEntities,
          intelligentChunking: pipelineConfig.aiEnhancement.intelligentChunking,
        });
        
        enhancement = enhanced.enhancement;
        
        // Si el chunking con IA generó chunks, usarlos
        if (Array.isArray(enhancement?.chunks) && enhancement.chunks.length > 0) {
          aiChunks = enhancement.chunks;
          logger.info({ 
            jobId, 
            aiChunks: aiChunks.length,
            hasSummary: !!enhancement.summary?.summary,
            entityCount: enhancement.entities?.raw?.length || 0,
          }, "AI enhancement completed");
        }
      } catch (enhanceError) {
        logger.warn({ jobId, err: enhanceError.message }, "AI enhancement failed, continuing with basic chunking");
      }
    }
    
    // STEP 2: CHUNK (usa AI chunks si disponibles, sino chunking tradicional)
    let chunks;
    let chunkingMethod;
    
    if (aiChunks && aiChunks.length > 0) {
      // Usar chunks generados por IA
      chunkingMethod = "ai";
      chunks = aiChunks.map((aiChunk, idx) => ({
        text: aiChunk.text,
        hash: generateChunkHash(aiChunk.text),
        metadata: {
          documentHash: document.contentHash,
          documentTitle: title || document.metadata.title || document.metadata.fileName,
          category,
          sourceId,
          chunkTitle: aiChunk.title,
          chunkSummary: aiChunk.summary,
          aiGenerated: true,
          ...metadata,
        },
      }));
    } else {
      // Chunking tradicional
      chunkingMethod = chunkStrategy || chunker.detectBestStrategy(document.content, document.metadata);
      chunks = chunker.chunk(document.content, {
        strategy: chunkingMethod,
        metadata: {
          documentHash: document.contentHash,
          documentTitle: title || document.metadata.title || document.metadata.fileName,
          category,
          sourceId,
          ...metadata,
        },
      });
    }
    
    if (!chunks.length) {
      return {
        ok: false,
        error: "No chunks generated",
        jobId,
        document: {
          contentLength: document.content.length,
          format: document.metadata.format,
        },
      };
    }
    
    logger.debug({ 
      jobId, 
      chunksCount: chunks.length,
      strategy: chunkingMethod,
      aiEnhanced: chunkingMethod === "ai",
    }, "Document chunked");
    
    // STEP 3 & 4: EMBED + STORE
    const ttlMs = pipelineConfig.ttl[category] || pipelineConfig.ttl.general;
    
    // Preparar metadata de enhancement para incluir en cada chunk
    const enhancementMeta = {};
    if (enhancement) {
      if (enhancement.summary?.summary) {
        enhancementMeta.documentSummary = enhancement.summary.summary;
        enhancementMeta.keyPoints = enhancement.summary.keyPoints;
        enhancementMeta.topics = enhancement.summary.topics;
      }
      if (enhancement.entities?.raw?.length) {
        enhancementMeta.entities = enhancement.entities.raw;
        enhancementMeta.entityCount = enhancement.entities.raw.length;
      }
    }
    
    const embedDocs = chunks.map((chunk, idx) => ({
      text: chunk.text,
      category,
      source: sourceId,
      metadata: {
        ...chunk.metadata,
        ...enhancementMeta,
        chunkHash: chunk.hash,
        chunkIndex: idx,
        totalChunks: chunks.length,
        documentTitle: title || document.metadata.title,
        format: document.metadata.format,
        chunkingMethod,
        ingestedAt: new Date().toISOString(),
        jobId,
      },
      ttlMs,
    }));
    
    // Procesar en batches
    const batches = [];
    for (let i = 0; i < embedDocs.length; i += pipelineConfig.batchSize) {
      batches.push(embedDocs.slice(i, i + pipelineConfig.batchSize));
    }
    
    let totalInserted = 0;
    let errors = [];
    
    for (const batch of batches) {
      try {
        const result = await upsertEmbeddingBatch(batch);
        totalInserted += result.inserted || 0;
        if (result.errors?.length) {
          errors.push(...result.errors);
        }
      } catch (err) {
        logger.error({ jobId, err: err.message }, "Batch embedding failed");
        errors.push(err.message);
      }
    }
    
    // STEP 5: Update stats
    const duration = Date.now() - startTime;
    
    pipelineState.lastRun = new Date().toISOString();
    pipelineState.stats.totalProcessed++;
    pipelineState.stats.totalChunks += chunks.length;
    pipelineState.stats.byCategory[category] = (pipelineState.stats.byCategory[category] || 0) + 1;
    
    const result = {
      ok: true,
      jobId,
      document: {
        title: title || document.metadata.title || document.metadata.fileName,
        contentLength: document.content.length,
        format: document.metadata.format,
        hash: document.contentHash,
      },
      chunks: {
        total: chunks.length,
        inserted: totalInserted,
        strategy: chunkingMethod,
      },
      enhancement: enhancement ? {
        enabled: true,
        summary: enhancement.summary?.summary ? true : false,
        entities: enhancement.entities?.raw?.length || 0,
        aiChunking: chunkingMethod === "ai",
        processingTimeMs: enhancement.processingTimeMs,
      } : { enabled: false },
      category,
      source: sourceId,
      duration_ms: duration,
      errors: errors.length ? errors : undefined,
    };
    
    logger.info(result, "Document ingested successfully");
    
    return result;
    
  } catch (error) {
    pipelineState.lastError = error.message;
    pipelineState.stats.totalErrors++;
    
    logger.error({ jobId, err: error.message }, "Document ingestion failed");
    
    return {
      ok: false,
      jobId,
      error: error.message,
      duration_ms: Date.now() - startTime,
    };
  }
}

/**
 * Ingesta múltiples documentos
 * 
 * @param {Array<{source: string|Buffer, options: Object}>} documents
 * @returns {Promise<BatchIngestResult>}
 */
export async function ingestBatch(documents) {
  const startTime = Date.now();
  const batchId = generateJobId("batch");
  
  logger.info({ batchId, count: documents.length }, "Starting batch ingestion");
  
  const results = {
    ok: true,
    batchId,
    total: documents.length,
    succeeded: 0,
    failed: 0,
    documents: [],
  };
  
  // Procesar con concurrencia limitada
  const queue = [...documents];
  const inProgress = new Set();
  
  while (queue.length > 0 || inProgress.size > 0) {
    // Llenar hasta maxConcurrent
    while (queue.length > 0 && inProgress.size < pipelineConfig.maxConcurrent) {
      const doc = queue.shift();
      const promise = ingestDocument(doc.source, doc.options)
        .then(result => {
          results.documents.push(result);
          if (result.ok) {
            results.succeeded++;
          } else {
            results.failed++;
          }
        })
        .catch(err => {
          results.documents.push({
            ok: false,
            error: err.message,
            source: typeof doc.source === "string" ? doc.source : "buffer",
          });
          results.failed++;
        })
        .finally(() => {
          inProgress.delete(promise);
        });
      
      inProgress.add(promise);
    }
    
    // Esperar a que termine al menos uno
    if (inProgress.size > 0) {
      await Promise.race(inProgress);
    }
  }
  
  results.ok = results.failed === 0;
  results.duration_ms = Date.now() - startTime;
  
  logger.info({
    batchId,
    succeeded: results.succeeded,
    failed: results.failed,
    duration_ms: results.duration_ms,
  }, "Batch ingestion complete");
  
  return results;
}

/**
 * Ingesta todos los documentos de un directorio
 * 
 * @param {string} dirPath - Path del directorio
 * @param {Object} options
 * @param {boolean} [options.recursive=true] - Buscar en subdirectorios
 * @param {string} [options.category] - Categoría para todos
 * @param {boolean} [options.invalidateFirst=false] - Invalidar documentos existentes primero
 */
export async function ingestDirectory(dirPath, options = {}) {
  const {
    recursive = true,
    category,
    invalidateFirst = false,
    sourceId,
  } = options;
  
  const source = sourceId || `dir:${path.basename(dirPath)}`;
  
  // Invalidar existentes si se solicita
  if (invalidateFirst) {
    await invalidateBySource(source);
    logger.info({ source }, "Invalidated existing documents from source");
  }
  
  // Cargar documentos del directorio
  const { documents, errors } = await documentLoader.loadDirectory(dirPath, { 
    recursive, 
    category,
  });
  
  if (errors.length) {
    logger.warn({ errorCount: errors.length }, "Some documents failed to load");
  }
  
  if (!documents.length) {
    return {
      ok: false,
      error: "No documents found in directory",
      loadErrors: errors,
    };
  }
  
  // Preparar para batch ingestion
  const docsToIngest = documents.map(doc => ({
    source: doc.metadata.filePath,
    options: {
      title: doc.metadata.title || doc.metadata.fileName,
      category: category || detectCategoryFromPath(doc.metadata.filePath),
      source,
      metadata: doc.metadata,
    },
  }));
  
  const result = await ingestBatch(docsToIngest);
  result.loadErrors = errors;
  
  return result;
}

/**
 * Re-ingesta documentos de una fuente específica
 * Útil para actualizar embeddings cuando cambia el modelo
 */
export async function reindexSource(sourceId) {
  logger.info({ sourceId }, "Starting reindex");
  
  // Buscar documentos existentes
  // Por ahora solo invalidamos y el usuario debe re-ingestar
  const invalidated = await invalidateBySource(sourceId);
  
  return {
    ok: true,
    invalidated: invalidated.invalidated,
    message: `Invalidated ${invalidated.invalidated} embeddings. Please re-ingest documents.`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// BÚSQUEDA RAG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Busca documentos relevantes para una query
 * Usado por el agente para responder preguntas
 * 
 * @param {string} query - Pregunta del usuario
 * @param {Object} options
 * @param {string} [options.category] - Filtrar por categoría
 * @param {number} [options.limit=5] - Máximo de resultados
 * @param {number} [options.threshold=0.7] - Umbral de similitud
 */
export async function searchDocuments(query, options = {}) {
  const {
    category,
    limit = 5,
    threshold = 0.7,
  } = options;
  
  if (!isVectorReady()) {
    return { results: [], error: "Vector store not ready" };
  }
  
  try {
    const results = await searchSimilar(query, {
      category,
      limit,
      threshold,
    });
    
    // Enriquecer resultados
    const enriched = results.map(r => ({
      text: r.content_text,
      score: r.similarity,
      metadata: r.metadata,
      category: r.category,
      source: r.source,
    }));
    
    return {
      results: enriched,
      query,
      count: enriched.length,
    };
    
  } catch (error) {
    logger.error({ err: error.message, query }, "RAG search failed");
    return { results: [], error: error.message };
  }
}

/**
 * Genera contexto RAG para el prompt del agente
 * Formatea los resultados de búsqueda como contexto
 */
export async function generateRAGContext(query, options = {}) {
  const { results } = await searchDocuments(query, options);
  
  if (!results.length) {
    return null;
  }
  
  // Formatear como contexto
  const contextParts = results.map((r, idx) => {
    const source = r.metadata?.documentTitle || r.source || "Documento";
    return `[${idx + 1}] ${source}:\n${r.text}`;
  });
  
  return {
    context: contextParts.join("\n\n---\n\n"),
    sources: results.map(r => ({
      title: r.metadata?.documentTitle,
      category: r.category,
      score: r.score,
    })),
    count: results.length,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES
// ═══════════════════════════════════════════════════════════════════════════

function generateJobId(prefix = "ingest") {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${timestamp}-${random}`;
}

function generateChunkHash(text) {
  return crypto.createHash("md5").update(text).digest("hex").slice(0, 16);
}

function detectCategoryFromPath(filePath) {
  const lower = filePath.toLowerCase();
  
  if (lower.includes("menu") || lower.includes("carta")) return "menu";
  if (lower.includes("policy") || lower.includes("politica")) return "policy";
  if (lower.includes("recipe") || lower.includes("receta")) return "recipe";
  if (lower.includes("history") || lower.includes("historia")) return "history";
  if (lower.includes("faq") || lower.includes("pregunta")) return "faq";
  if (lower.includes("training") || lower.includes("capacita")) return "training";
  if (lower.includes("promo")) return "promo";
  
  return "general";
}

/**
 * Obtiene estadísticas del pipeline
 */
export function getPipelineStats() {
  return {
    config: {
      enabled: pipelineConfig.enabled,
      batchSize: pipelineConfig.batchSize,
      maxConcurrent: pipelineConfig.maxConcurrent,
    },
    state: {
      isProcessing: pipelineState.isProcessing,
      lastRun: pipelineState.lastRun,
      lastError: pipelineState.lastError,
    },
    stats: { ...pipelineState.stats },
  };
}

/**
 * Verifica estado del pipeline
 */
export function getHealthStatus() {
  return {
    pipeline: pipelineConfig.enabled,
    vectorStore: isVectorReady(),
    lastRun: pipelineState.lastRun,
    errors: pipelineState.stats.totalErrors,
  };
}

/**
 * Obtiene configuración
 */
export function getPipelineConfig() {
  return { ...pipelineConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicializa el pipeline (crear directorios, etc.)
 */
export async function initPipeline() {
  try {
    // Crear directorios si no existen
    await fs.mkdir(pipelineConfig.documentsDir, { recursive: true });
    await fs.mkdir(pipelineConfig.uploadsDir, { recursive: true });
    
    logger.info({
      documentsDir: pipelineConfig.documentsDir,
      uploadsDir: pipelineConfig.uploadsDir,
    }, "RAG pipeline initialized");
    
    return { ok: true };
    
  } catch (error) {
    logger.error({ err: error.message }, "Failed to initialize RAG pipeline");
    return { ok: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const ragPipeline = {
  // Ingestion
  ingest: ingestDocument,
  ingestBatch,
  ingestDirectory,
  reindexSource,
  
  // Search
  search: searchDocuments,
  generateContext: generateRAGContext,
  
  // Status
  getStats: getPipelineStats,
  getHealth: getHealthStatus,
  getConfig: getPipelineConfig,
  
  // Lifecycle
  init: initPipeline,
};

export default ragPipeline;
