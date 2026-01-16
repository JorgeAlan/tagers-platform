/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RAG ROUTES - API HTTP para ingesta y búsqueda de documentos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 * - POST /rag/ingest/file     - Subir archivo
 * - POST /rag/ingest/url      - Ingestar desde URL
 * - POST /rag/ingest/text     - Ingestar texto directo
 * - POST /rag/ingest/directory - Ingestar directorio (admin)
 * - GET  /rag/search          - Buscar en knowledge base
 * - GET  /rag/context         - Obtener contexto para AI
 * - GET  /rag/stats           - Estadísticas del pipeline
 * - DELETE /rag/reindex/:source - Re-indexar fuente
 * 
 * @version 1.0.0
 */

import express from "express";
import multer from "multer";
import { logger } from "../utils/logger.js";
import { ragPipeline } from "./ingestPipeline.js";
import { documentLoader } from "./documentLoader.js";

const router = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DE UPLOAD
// ═══════════════════════════════════════════════════════════════════════════

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: parseInt(process.env.RAG_MAX_FILE_SIZE || String(50 * 1024 * 1024), 10), // 50MB
    files: 10,
  },
  fileFilter: (req, file, cb) => {
    if (documentLoader.isSupported(file.originalname)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.originalname}. Supported: ${documentLoader.supportedExtensions.join(", ")}`));
    }
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE DE AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════════════

function requireAdminAuth(req, res, next) {
  const apiKey = req.headers["x-api-key"] || req.headers["authorization"]?.replace("Bearer ", "");
  const adminKey = process.env.ADMIN_API_KEY || process.env.RAG_ADMIN_KEY;
  
  if (!adminKey) {
    logger.warn("RAG admin auth disabled - no ADMIN_API_KEY configured");
    return next();
  }
  
  if (!apiKey || apiKey !== adminKey) {
    return res.status(401).json({
      ok: false,
      error: "Unauthorized",
      message: "Valid API key required for RAG operations",
    });
  }
  
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE INGESTA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /rag/ingest/file
 * Subir uno o más archivos para indexar
 */
router.post("/ingest/file", requireAdminAuth, upload.array("file", 10), async (req, res) => {
  const files = req.files;
  
  if (!files || !files.length) {
    return res.status(400).json({
      ok: false,
      error: "No files provided",
      supported: documentLoader.supportedExtensions,
    });
  }
  
  const { title, category, metadata: metadataStr } = req.body;
  let metadata = {};
  
  try {
    if (metadataStr) {
      metadata = JSON.parse(metadataStr);
    }
  } catch (e) {
    logger.warn({ metadataStr }, "Invalid metadata JSON, ignoring");
  }
  
  const results = [];
  
  for (const file of files) {
    try {
      const result = await ragPipeline.ingest(file.buffer, {
        title: title || file.originalname,
        category: category || "general",
        source: "upload",
        fileName: file.originalname,
        metadata: {
          ...metadata,
          originalName: file.originalname,
          mimeType: file.mimetype,
          size: file.size,
        },
      });
      
      results.push({
        file: file.originalname,
        ...result,
      });
      
    } catch (err) {
      results.push({
        file: file.originalname,
        ok: false,
        error: err.message,
      });
    }
  }
  
  const successCount = results.filter(r => r.ok).length;
  
  res.json({
    ok: successCount > 0,
    total: files.length,
    success: successCount,
    failed: files.length - successCount,
    results,
  });
});

/**
 * POST /rag/ingest/url
 * Indexar documento desde URL
 */
router.post("/ingest/url", requireAdminAuth, express.json(), async (req, res) => {
  const { url, title, category, metadata } = req.body;
  
  if (!url) {
    return res.status(400).json({
      ok: false,
      error: "URL is required",
    });
  }
  
  try {
    const result = await ragPipeline.ingest(url, {
      title,
      category: category || "general",
      source: "url",
      metadata,
    });
    
    res.json(result);
    
  } catch (err) {
    logger.error({ error: err.message, url }, "URL ingestion failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /rag/ingest/text
 * Indexar texto directo
 */
router.post("/ingest/text", requireAdminAuth, express.json(), async (req, res) => {
  const { text, title, category, metadata } = req.body;
  
  if (!text) {
    return res.status(400).json({
      ok: false,
      error: "Text content is required",
    });
  }
  
  if (!title) {
    return res.status(400).json({
      ok: false,
      error: "Title is required for text ingestion",
    });
  }
  
  try {
    const buffer = Buffer.from(text, "utf-8");
    const fileName = `${title.replace(/[^a-z0-9]/gi, "_")}.txt`;
    
    const result = await ragPipeline.ingest(buffer, {
      title,
      category: category || "general",
      source: "direct_text",
      fileName,
      metadata: {
        ...metadata,
        inputType: "direct_text",
        textLength: text.length,
      },
    });
    
    res.json(result);
    
  } catch (err) {
    logger.error({ error: err.message }, "Text ingestion failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /rag/ingest/directory
 * Indexar directorio completo
 */
router.post("/ingest/directory", requireAdminAuth, express.json(), async (req, res) => {
  const { path: dirPath, recursive = true, category, invalidateFirst = false } = req.body;
  
  if (!dirPath) {
    return res.status(400).json({
      ok: false,
      error: "Directory path is required",
    });
  }
  
  try {
    const result = await ragPipeline.ingestDirectory(dirPath, {
      recursive,
      category: category || "general",
      invalidateFirst,
    });
    
    res.json(result);
    
  } catch (err) {
    logger.error({ error: err.message, dirPath }, "Directory ingestion failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE BÚSQUEDA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /rag/search
 * Buscar en knowledge base
 */
router.get("/search", async (req, res) => {
  const { q, category, limit, threshold } = req.query;
  
  if (!q) {
    return res.status(400).json({
      ok: false,
      error: "Query parameter 'q' is required",
    });
  }
  
  try {
    const result = await ragPipeline.search(q, {
      category,
      limit: limit ? parseInt(limit, 10) : 5,
      threshold: threshold ? parseFloat(threshold) : 0.7,
    });
    
    res.json({
      ok: true,
      ...result,
    });
    
  } catch (err) {
    logger.error({ error: err.message, query: q }, "RAG search failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * POST /rag/search
 * Buscar con body (para queries largas)
 */
router.post("/search", express.json(), async (req, res) => {
  const { query, category, limit, threshold } = req.body;
  
  if (!query) {
    return res.status(400).json({
      ok: false,
      error: "Query is required",
    });
  }
  
  try {
    const result = await ragPipeline.search(query, {
      category,
      limit: limit || 5,
      threshold: threshold || 0.7,
    });
    
    res.json({
      ok: true,
      ...result,
    });
    
  } catch (err) {
    logger.error({ error: err.message }, "RAG search failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /rag/context
 * Obtener contexto RAG para prompt de AI
 */
router.get("/context", async (req, res) => {
  const { q, category, limit } = req.query;
  
  if (!q) {
    return res.status(400).json({
      ok: false,
      error: "Query parameter 'q' is required",
    });
  }
  
  try {
    const result = await ragPipeline.generateContext(q, {
      category,
      limit: limit ? parseInt(limit, 10) : 5,
    });
    
    res.json({
      ok: true,
      query: q,
      ...result,
    });
    
  } catch (err) {
    logger.error({ error: err.message }, "RAG context generation failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE ADMINISTRACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /rag/stats
 * Estadísticas del pipeline
 */
router.get("/stats", requireAdminAuth, async (req, res) => {
  try {
    const stats = ragPipeline.getStats();
    
    res.json({
      ok: true,
      ...stats,
    });
    
  } catch (err) {
    logger.error({ error: err.message }, "Failed to get RAG stats");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /rag/health
 * Health check del pipeline
 */
router.get("/health", (req, res) => {
  const health = ragPipeline.getHealth();
  const healthy = health.pipeline && health.vectorStore;
  
  res.status(healthy ? 200 : 503).json({
    ok: healthy,
    ...health,
  });
});

/**
 * DELETE /rag/reindex/:source
 * Re-indexar documentos de una fuente
 */
router.delete("/reindex/:source", requireAdminAuth, async (req, res) => {
  const { source } = req.params;
  
  if (!source) {
    return res.status(400).json({
      ok: false,
      error: "Source parameter is required",
    });
  }
  
  try {
    const result = await ragPipeline.reindexSource(source);
    res.json(result);
    
  } catch (err) {
    logger.error({ error: err.message, source }, "RAG reindex failed");
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

/**
 * GET /rag/categories
 * Listar categorías válidas y extensiones soportadas
 */
router.get("/categories", (req, res) => {
  const config = ragPipeline.getConfig();
  
  res.json({
    ok: true,
    categories: Object.keys(config.ttl),
    supported_extensions: documentLoader.supportedExtensions,
  });
});

/**
 * POST /rag/init
 * Inicializar pipeline (crear directorios)
 */
router.post("/init", requireAdminAuth, async (req, res) => {
  try {
    const result = await ragPipeline.init();
    res.json(result);
  } catch (err) {
    res.status(500).json({
      ok: false,
      error: err.message,
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ERROR HANDLER
// ═══════════════════════════════════════════════════════════════════════════

router.use((err, req, res, next) => {
  logger.error({ error: err.message, path: req.path }, "RAG route error");
  
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      ok: false,
      error: err.code === "LIMIT_FILE_SIZE" 
        ? "File too large" 
        : `Upload error: ${err.message}`,
    });
  }
  
  res.status(500).json({
    ok: false,
    error: err.message || "Internal server error",
  });
});

export default router;
