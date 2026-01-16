/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADMIN ROUTES - Endpoints Administrativos Protegidos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints para administración del sistema:
 * - Blacklist management
 * - Cache control
 * - System stats
 * - Memory management
 * 
 * Todos los endpoints requieren autenticación via X-Admin-Token
 * 
 * @version 1.0.0
 */

import { Router } from "express";
import { logger } from "../utils/logger.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";

// Services
import { getStats as getDedupeStats } from "../core/deduplication.js";
import { 
  isBlocked, 
  addToBlacklist, 
  removeFromBlacklist, 
  getStats as getBlacklistStats 
} from "../core/blacklist.js";
import { isRedisAvailable } from "../core/redis.js";
import { getMemoryStats } from "../tania/agentic_flow_selector.js";
import { semanticCache } from "../core/semanticCache.js";
import { aiQueue } from "../core/queue.js";
import { getCacheStats as getEmbeddingCacheStats } from "../vector/embeddings.js";
import { 
  getDLQJobs, 
  retryFromDLQ, 
  retryAllFromDLQ, 
  discardFromDLQ, 
  clearDLQ,
  getDLQStats 
} from "../core/dlqProcessor.js";
import { getGovernorStats } from "../core/governor.js";

const adminRouter = Router();

// ═══════════════════════════════════════════════════════════════════════════
// SYSTEM STATS (no auth required for basic health)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /admin/stats
 * Estadísticas completas del sistema
 */
adminRouter.get("/stats", adminAuthMiddleware, async (req, res) => {
  try {
    const [queueStats, dedupeStats, blacklistStats] = await Promise.all([
      aiQueue.getStats(),
      getDedupeStats(),
      getBlacklistStats(),
    ]);
    
    res.json({
      ok: true,
      timestamp: new Date().toISOString(),
      redis: isRedisAvailable(),
      queue: queueStats,
      dedupe: dedupeStats,
      blacklist: blacklistStats,
      memory: getMemoryStats(),
      semanticCache: semanticCache.getStats(),
      embeddingCache: getEmbeddingCacheStats(),
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get admin stats");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BLACKLIST MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /admin/blacklist
 * Ver estadísticas de blacklist
 */
adminRouter.get("/blacklist", adminAuthMiddleware, async (req, res) => {
  const stats = await getBlacklistStats();
  res.json({ ok: true, ...stats });
});

/**
 * POST /admin/blacklist/check
 * Verificar si un usuario está bloqueado
 * Body: { phone?, email?, contactId?, conversationId? }
 */
adminRouter.post("/blacklist/check", adminAuthMiddleware, async (req, res) => {
  const { phone, email, contactId, conversationId } = req.body;
  
  const result = await isBlocked({ phone, email, contactId, conversationId });
  res.json({ ok: true, ...result });
});

/**
 * POST /admin/blacklist/add
 * Agregar usuario a blacklist
 * Body: { phone?, email?, contactId?, conversationId?, reason, ttlSeconds? }
 */
adminRouter.post("/blacklist/add", adminAuthMiddleware, async (req, res) => {
  const { phone, email, contactId, conversationId, reason, ttlSeconds } = req.body;
  
  if (!reason) {
    return res.status(400).json({ ok: false, error: "reason is required" });
  }
  
  if (!phone && !email && !contactId && !conversationId) {
    return res.status(400).json({ 
      ok: false, 
      error: "At least one identifier required: phone, email, contactId, or conversationId" 
    });
  }
  
  const success = await addToBlacklist({ phone, email, contactId, conversationId, reason, ttlSeconds });
  
  logger.info({ phone, email, contactId, reason }, "Blacklist entry added via admin");
  
  res.json({ ok: success, added: { phone, email, contactId, conversationId, reason } });
});

/**
 * POST /admin/blacklist/remove
 * Remover usuario de blacklist
 * Body: { phone?, email?, contactId?, conversationId? }
 */
adminRouter.post("/blacklist/remove", adminAuthMiddleware, async (req, res) => {
  const { phone, email, contactId, conversationId } = req.body;
  
  if (!phone && !email && !contactId && !conversationId) {
    return res.status(400).json({ 
      ok: false, 
      error: "At least one identifier required" 
    });
  }
  
  const success = await removeFromBlacklist({ phone, email, contactId, conversationId });
  
  logger.info({ phone, email, contactId }, "Blacklist entry removed via admin");
  
  res.json({ ok: success, removed: { phone, email, contactId, conversationId } });
});

// ═══════════════════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /admin/cache/clear
 * Limpiar semantic cache
 */
adminRouter.post("/cache/clear", adminAuthMiddleware, async (req, res) => {
  const cleared = semanticCache.clear();
  logger.info({ cleared }, "Semantic cache cleared via admin");
  res.json({ ok: true, cleared });
});

/**
 * GET /admin/cache/stats
 * Estadísticas de todos los caches
 */
adminRouter.get("/cache/stats", adminAuthMiddleware, async (req, res) => {
  res.json({
    ok: true,
    semanticCache: semanticCache.getStats(),
    embeddingCache: getEmbeddingCacheStats(),
    memory: getMemoryStats(),
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /admin/queue/pause
 * Pausar procesamiento de cola
 */
adminRouter.post("/queue/pause", adminAuthMiddleware, async (req, res) => {
  await aiQueue.pause();
  logger.warn("Queue paused via admin");
  res.json({ ok: true, action: "paused" });
});

/**
 * POST /admin/queue/resume
 * Reanudar procesamiento de cola
 */
adminRouter.post("/queue/resume", adminAuthMiddleware, async (req, res) => {
  await aiQueue.resume();
  logger.info("Queue resumed via admin");
  res.json({ ok: true, action: "resumed" });
});

/**
 * GET /admin/queue/stats
 * Estadísticas de la cola
 */
adminRouter.get("/queue/stats", adminAuthMiddleware, async (req, res) => {
  const stats = await aiQueue.getStats();
  res.json({ ok: true, ...stats });
});

// ═══════════════════════════════════════════════════════════════════════════
// DEAD LETTER QUEUE (DLQ) MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /admin/dlq
 * Ver jobs en la Dead Letter Queue
 * Query: start, end (paginación)
 */
adminRouter.get("/dlq", adminAuthMiddleware, async (req, res) => {
  try {
    const start = parseInt(req.query.start || "0", 10);
    const end = parseInt(req.query.end || "50", 10);
    
    const result = await getDLQJobs({ start, end });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get DLQ jobs");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

/**
 * GET /admin/dlq/stats
 * Estadísticas de la DLQ
 */
adminRouter.get("/dlq/stats", adminAuthMiddleware, async (req, res) => {
  try {
    const stats = await getDLQStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message });
  }
});

/**
 * POST /admin/dlq/retry/:jobId
 * Reintentar un job específico de la DLQ
 */
adminRouter.post("/dlq/retry/:jobId", adminAuthMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({ ok: false, error: "jobId is required" });
    }
    
    const result = await retryFromDLQ(jobId);
    
    if (result.success) {
      logger.info({ dlqJobId: jobId, newJobId: result.newJobId }, "Job retried from DLQ via admin");
    }
    
    res.json({ ok: result.success, ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to retry DLQ job");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

/**
 * POST /admin/dlq/retry-all
 * Reintentar todos los jobs en la DLQ
 */
adminRouter.post("/dlq/retry-all", adminAuthMiddleware, async (req, res) => {
  try {
    const result = await retryAllFromDLQ();
    logger.warn({ result }, "Bulk retry from DLQ via admin");
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to retry all DLQ jobs");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

/**
 * DELETE /admin/dlq/:jobId
 * Descartar (eliminar) un job de la DLQ
 */
adminRouter.delete("/dlq/:jobId", adminAuthMiddleware, async (req, res) => {
  try {
    const { jobId } = req.params;
    
    if (!jobId) {
      return res.status(400).json({ ok: false, error: "jobId is required" });
    }
    
    const result = await discardFromDLQ(jobId);
    
    if (result.success) {
      logger.info({ dlqJobId: jobId }, "Job discarded from DLQ via admin");
    }
    
    res.json({ ok: result.success, ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to discard DLQ job");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

/**
 * DELETE /admin/dlq
 * Limpiar toda la DLQ (¡peligroso!)
 */
adminRouter.delete("/dlq", adminAuthMiddleware, async (req, res) => {
  try {
    const { confirm } = req.body;
    
    if (confirm !== "DELETE_ALL_DLQ_JOBS") {
      return res.status(400).json({ 
        ok: false, 
        error: "Confirmation required. Send { confirm: 'DELETE_ALL_DLQ_JOBS' }" 
      });
    }
    
    const result = await clearDLQ();
    logger.warn("DLQ cleared via admin");
    res.json({ ok: result.success, ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to clear DLQ");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GOVERNOR STATS (Rate Limiting Distribuido)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /admin/governor/stats
 * Estadísticas del Governor y Rate Limiter distribuido
 */
adminRouter.get("/governor/stats", adminAuthMiddleware, async (req, res) => {
  try {
    const stats = await getGovernorStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get Governor stats");
    res.status(500).json({ ok: false, error: err?.message });
  }
});

export default adminRouter;
