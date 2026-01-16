/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - ROUTES v1.2
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * TESTING ENDPOINTS:
 * - POST /internal/config/search    - Búsqueda semántica
 * - GET  /internal/config/stats     - Estadísticas de embeddings
 * - GET  /internal/config/categories - Lista categorías
 * 
 * ⚠️ AJUSTAR EL IMPORT DE vectorStore SEGÚN TU ESTRUCTURA DE CARPETAS
 */

import { Router } from 'express';
import { 
  getConfig, 
  getConfigForLLM, 
  getConfigHealth, 
  forceRefresh,
  reanalyzeWithAI,
  getSchemaAnalysis,
} from './sync-service.js';
import { getVersionHistory } from './config-store.js';
import { getAdaptiveStats } from '../../config/modelRegistry.js';

// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ AJUSTAR ESTE IMPORT SEGÚN TU ESTRUCTURA
// ═══════════════════════════════════════════════════════════════════════════
// Opciones comunes:
//   '../vector/vectorStore.js'
//   '../../vector/vectorStore.js' 
//   '../../src/vector/vectorStore.js'
//   '../src/vector/vectorStore.js'

// TEMPORAL: Import dinámico para evitar crash
let searchSimilar = null;
let getVectorStats = null;

// Se carga async al inicio
(async () => {
  try {
    const vectorStore = await import('../vector/vectorStore.js');
    searchSimilar = vectorStore.searchSimilar;
    getVectorStats = vectorStore.getStats;
    console.log('[CONFIG-ROUTES] ✅ VectorStore loaded successfully');
  } catch (error) {
    console.error('[CONFIG-ROUTES] ❌ Failed to load VectorStore:', error.message);
  }
})();

export const configRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE DE AUTENTICACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const validateAdminToken = (req, res, next) => {
  const token = req.headers['x-tagers-admin-token'] || req.query.token;
  const expectedToken = process.env.TAGERS_ADMIN_TOKEN || process.env.TAGERS_SHARED_SECRET;
  
  if (!expectedToken) {
    console.warn('[CONFIG-ROUTES] No admin token configured, allowing request');
    return next();
  }
  
  if (token !== expectedToken) {
    return res.status(401).json({ 
      error: 'UNAUTHORIZED',
      message: 'Token de administrador inválido',
    });
  }
  
  next();
};

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE LECTURA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /internal/config
 */
configRouter.get('/', (req, res) => {
  const config = getConfig();
  
  if (!config) {
    return res.status(503).json({
      error: 'CONFIG_NOT_AVAILABLE',
      message: 'Configuración no disponible aún.',
    });
  }
  
  res.set('ETag', `"${config.version}-${config.config_hash?.substring(0, 8) || 'none'}"`);
  res.set('Cache-Control', 'private, max-age=60');
  res.json(config);
});

/**
 * GET /internal/config/health
 */
configRouter.get('/health', (req, res) => {
  const health = getConfigHealth();
  const statusCode = health.has_config && !health.is_fallback 
    ? 200 
    : health.has_config ? 206 : 503;
  
  res.status(statusCode).json({
    status: statusCode === 200 ? 'healthy' : statusCode === 206 ? 'degraded' : 'unhealthy',
    ...health,
    adaptive_stats: getAdaptiveStats(),
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /internal/config/llm
 */
configRouter.get('/llm', (req, res) => {
  const llmConfig = getConfigForLLM();
  
  if (!llmConfig) {
    return res.status(503).json({ error: 'CONFIG_NOT_AVAILABLE' });
  }
  
  if (req.accepts('application/json')) {
    res.json({ 
      content: llmConfig,
      version: getConfig()?.version,
      updated_at: getConfigHealth().updated_at,
    });
  } else {
    res.type('text/markdown').send(llmConfig);
  }
});

/**
 * GET /internal/config/schema
 */
configRouter.get('/schema', (req, res) => {
  const analysis = getSchemaAnalysis();
  
  if (!analysis) {
    return res.status(503).json({ error: 'SCHEMA_NOT_AVAILABLE' });
  }
  
  res.json({
    ...analysis,
    adaptive_stats: getAdaptiveStats(),
  });
});

/**
 * GET /internal/config/history
 */
configRouter.get('/history', validateAdminToken, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  try {
    const history = await getVersionHistory(limit);
    res.json({ count: history.length, versions: history });
  } catch (error) {
    res.status(500).json({ error: 'FETCH_FAILED', message: error.message });
  }
});

/**
 * GET /internal/config/branch/:branchId
 */
configRouter.get('/branch/:branchId', (req, res) => {
  const config = getConfig();
  
  if (!config) {
    return res.status(503).json({ error: 'CONFIG_NOT_AVAILABLE' });
  }
  
  const branch = config.branches?.find(
    b => b.branch_id.toLowerCase() === req.params.branchId.toLowerCase()
  );
  
  if (!branch) {
    return res.status(404).json({ 
      error: 'BRANCH_NOT_FOUND',
      available: config.branches?.map(b => b.branch_id) || [],
    });
  }
  
  const hours = config.branch_hours?.filter(h => h.branch_id === branch.branch_id) || [];
  res.json({ ...branch, hours });
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE ACCIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /internal/config/refresh
 */
configRouter.post('/refresh', validateAdminToken, async (req, res) => {
  const requestedBy = req.body?.requestedBy || req.headers['x-requested-by'] || 'api';
  const ip = req.headers['x-forwarded-for'] || req.ip || 'unknown';
  
  console.log(`[CONFIG-ROUTES] Refresh requested by: ${requestedBy} (${ip})`);
  
  try {
    const result = await forceRefresh({ requestedBy, ip });
    
    if (result.success) {
      res.json({
        success: true,
        message: result.skipped 
          ? `Sin cambios detectados` 
          : `Configuración actualizada a versión ${result.version}`,
        ...result,
      });
    } else if (result.error === 'rate_limit') {
      res.status(429).json({
        success: false,
        error: 'RATE_LIMIT',
        message: result.message,
        wait_seconds: result.wait_seconds,
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'SYNC_FAILED',
        message: result.error,
      });
    }
    
  } catch (error) {
    console.error('[CONFIG-ROUTES] Refresh error:', error);
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: error.message,
    });
  }
});

/**
 * POST /internal/config/reanalyze
 */
configRouter.post('/reanalyze', validateAdminToken, async (req, res) => {
  const requestedBy = req.body?.requestedBy || req.headers['x-requested-by'] || 'api';
  
  console.log(`[CONFIG-ROUTES] 🤖 AI Re-analysis requested by: ${requestedBy}`);
  
  try {
    const startTime = Date.now();
    const result = await reanalyzeWithAI();
    const duration = Date.now() - startTime;
    
    res.json({
      success: true,
      message: 'Re-análisis AI completado',
      duration_ms: duration,
      summary: result.analysis?.summary,
      model: result.analysis?.analyzer_model,
      adaptive_stats: result.analysis?.adaptive_stats || getAdaptiveStats(),
    });
    
  } catch (error) {
    console.error('[CONFIG-ROUTES] Re-analyze error:', error);
    res.status(500).json({
      success: false,
      error: 'REANALYZE_FAILED',
      message: error.message,
      adaptive_stats: getAdaptiveStats(),
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS DE TESTING 🆕
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /internal/config/search
 * Búsqueda semántica en embeddings
 * 
 * Body:
 *   - query: string (requerido)
 *   - category: string (opcional)
 *   - source: string (opcional)
 *   - limit: number (default 5)
 *   - threshold: number (default 0.55)
 */
configRouter.post('/search', async (req, res) => {
  // Check if vectorStore loaded
  if (!searchSimilar) {
    return res.status(503).json({
      error: 'VECTOR_STORE_NOT_READY',
      message: 'VectorStore aún no está cargado. Intenta de nuevo en unos segundos.',
    });
  }

  const { 
    query, 
    category = null, 
    source = null, 
    limit = 5, 
    threshold = 0.55 
  } = req.body;
  
  if (!query || typeof query !== 'string') {
    return res.status(400).json({
      error: 'INVALID_REQUEST',
      message: 'Se requiere "query" como string',
      example: { query: "horario de la sucursal" },
    });
  }
  
  if (query.length < 2 || query.length > 500) {
    return res.status(400).json({
      error: 'INVALID_QUERY_LENGTH',
      message: 'Query debe tener entre 2 y 500 caracteres',
    });
  }
  
  console.log(`[CONFIG-ROUTES] 🔍 Search: "${query.substring(0, 50)}..."`);
  
  try {
    const startTime = Date.now();
    
    const results = await searchSimilar(query, {
      category,
      source,
      limit: Math.min(limit, 20),
      threshold: Math.max(0.3, Math.min(threshold, 0.95)),
    });
    
    const duration = Date.now() - startTime;
    
    const formattedResults = results.map((r, i) => ({
      rank: i + 1,
      similarity: Math.round(r.similarity * 100) / 100,
      category: r.category,
      source: r.source,
      text: r.text?.substring(0, 300) + (r.text?.length > 300 ? '...' : ''),
      metadata: r.metadata,
    }));
    
    res.json({
      success: true,
      query: query.substring(0, 100),
      filters: { category, source, limit, threshold },
      results_count: formattedResults.length,
      duration_ms: duration,
      results: formattedResults,
    });
    
  } catch (error) {
    console.error('[CONFIG-ROUTES] Search error:', error);
    res.status(500).json({
      success: false,
      error: 'SEARCH_FAILED',
      message: error.message,
    });
  }
});

/**
 * GET /internal/config/stats
 * Estadísticas de embeddings
 */
configRouter.get('/stats', async (req, res) => {
  // Check if vectorStore loaded
  if (!getVectorStats) {
    return res.status(503).json({
      error: 'VECTOR_STORE_NOT_READY',
      message: 'VectorStore aún no está cargado.',
    });
  }

  try {
    const stats = await getVectorStats();
    
    if (!stats) {
      return res.status(503).json({
        error: 'STATS_NOT_AVAILABLE',
        message: 'Vector store no inicializado',
      });
    }
    
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      ...stats,
      adaptive_stats: getAdaptiveStats(),
    });
    
  } catch (error) {
    console.error('[CONFIG-ROUTES] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'STATS_FAILED',
      message: error.message,
    });
  }
});

/**
 * GET /internal/config/categories
 * Lista categorías con conteo
 */
configRouter.get('/categories', async (req, res) => {
  // Check if vectorStore loaded
  if (!getVectorStats) {
    return res.status(503).json({
      error: 'VECTOR_STORE_NOT_READY',
      message: 'VectorStore aún no está cargado.',
    });
  }

  try {
    const stats = await getVectorStats();
    
    if (!stats?.byCategory) {
      return res.status(503).json({ error: 'CATEGORIES_NOT_AVAILABLE' });
    }
    
    res.json({
      success: true,
      categories: stats.byCategory,
      total: stats.total,
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'FETCH_FAILED',
      message: error.message,
    });
  }
});

export default configRouter;
