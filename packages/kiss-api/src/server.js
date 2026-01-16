// ═══════════════════════════════════════════════════════════════════════════
// OPENTELEMETRY - MUST BE FIRST FOR AUTO-INSTRUMENTATION
// ═══════════════════════════════════════════════════════════════════════════
import { 
  initTelemetry, 
  shutdownTelemetry, 
  getOtelConfig,
  traceContextMiddleware,
  registerQueueSizeCallback,
  registerCacheSizeCallback,
} from "./telemetry/index.js";

// Initialize OpenTelemetry BEFORE other imports for auto-instrumentation
initTelemetry();

import express from "express";
import http from "http";
import path from "path";
import cors from "cors";

import { config } from "./config.js";
import { initDb, getPool } from "./db/repo.js";
import { ingestHandler } from "./routes/ingest.js";
import { listInstructionsHandler } from "./routes/instructions.js";
import { healthHandler, langsmithHealthHandler } from "./routes/health.js";
import { metricsHandler } from "./routes/metrics.js";
import { hmacAuthMiddleware } from "./utils/auth.js";
import { adminAuthMiddleware } from "./middleware/adminAuth.js";

import { hitlRouter } from "./routes/hitl.js";
import { recommendationsRouter } from "./routes/recommendations.js";
import { attachHitlSocket } from "./hitl/socket_server.js";

// ═══════════════════════════════════════════════════════════════════════════
// RESILIENCE MODULE - Control de tráfico + Graceful Shutdown
// ═══════════════════════════════════════════════════════════════════════════
import { resilience } from "./core/resilience/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// CHATWOOT WEBHOOK - Async con BullMQ
// ═══════════════════════════════════════════════════════════════════════════
import chatwootRouter from "./routes/chatwoot.js";

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES - Endpoints protegidos para administración
// ═══════════════════════════════════════════════════════════════════════════
import adminRouter from "./routes/admin.js";

// ═══════════════════════════════════════════════════════════════════════════
// AI WORKER - Procesamiento asíncrono
// ═══════════════════════════════════════════════════════════════════════════
import { startWorker, getWorkerStats } from "./workers/aiWorker.js";
import { aiQueue } from "./core/queue.js";
import { semanticCache, warmupFromConfigHub } from "./core/semanticCache.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG HUB - Ana Studio Integration
// ═══════════════════════════════════════════════════════════════════════════
import { configRouter } from "./config-hub/routes.js";
import { startPeriodicSync, getConfigHealth } from "./config-hub/sync-service.js";
import { initializeTables as initConfigTables } from "./config-hub/config-store.js";

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE HUB - Dynamic Configuration (reemplaza hardcoding)
// ═══════════════════════════════════════════════════════════════════════════
import KnowledgeHub from "./knowledge-hub/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// RAG PIPELINE - Document ingestion for knowledge base
// ═══════════════════════════════════════════════════════════════════════════
import { ragRoutes } from "./rag/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR STORE - pgvector para RAG Semántico
// ═══════════════════════════════════════════════════════════════════════════
import { initVectorStore, vectorStore } from "./vector/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY - Configuración dinámica de modelos AI
// ═══════════════════════════════════════════════════════════════════════════
import { modelRegistry } from "../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS ENGINE - Motor de análisis de conversaciones
// ═══════════════════════════════════════════════════════════════════════════
import InsightsEngine from "./insights/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// FASE 4: GROWTH FEATURES - Payments, A/B Testing, Proactive Messaging
// ═══════════════════════════════════════════════════════════════════════════
import paymentsRouter from "./routes/payments.js";
import growthRouter from "./routes/growth.js";
import { proactiveService } from "./services/proactive.js";

const app = express();

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZAR RESILIENCIA (Control de tráfico + Graceful Shutdown)
// ═══════════════════════════════════════════════════════════════════════════
resilience.init();
console.log("[RESILIENCE] ✓ Local queue ready (concurrency:", process.env.LOCAL_QUEUE_CONCURRENCY || 3, ")");
console.log("[RESILIENCE] ✓ Graceful shutdown registered");

// CORS (optional)
if (config.allowedOrigins.length) {
  app.use(cors({ origin: config.allowedOrigins, credentials: true }));
}

// Body parsing
// Capture raw body for HMAC validation (signature must match the exact request body).
app.use(
  express.json({
    limit: "2mb",
    verify: (req, _res, buf) => {
      // NOTE: buf is a Buffer with the raw request body.
      // We keep it for HMAC signature checks.
      req.rawBody = buf;
    },
  })
);

// ═══════════════════════════════════════════════════════════════════════════
// OPENTELEMETRY - Trace context middleware (adds trace ID to req/res)
// ═══════════════════════════════════════════════════════════════════════════
app.use(traceContextMiddleware);


// NOTE: This suite purposely keeps dependencies minimal.
// If you want HTTP request logging or additional headers, add them via middleware.

// Core routes
app.get("/", async (req, res) => {
  // Incluir estado del Config Hub y Queue en el health check principal
  const configHealth = getConfigHealth();
  const queueStats = await aiQueue.getStats();
  const cacheStats = semanticCache.getStats();
  const resilienceStats = resilience.getStats();
  
  // Vector store stats (si está habilitado)
  let vectorStats = { enabled: false };
  try {
    if (vectorStore && vectorStore.isReady()) {
      vectorStats = await vectorStore.getStats();
      vectorStats.enabled = true;
    }
  } catch (err) {
    vectorStats = { enabled: false, error: err.message };
  }
  
  res.json({
    ok: true,
    service: "tagers-kiss-production-api",
    version: "5.4.1-growth",
    buildTime: "2026-01-08T23:12:00Z", // Force rebuild
    env: config.env,
    hitl_enabled: config.hitl.enabled,
    chatwoot_enabled: config.chatwoot.enabled,
    config_hub: {
      enabled: !!process.env.GOOGLE_SHEET_ID,
      version: configHealth.version,
      healthy: configHealth.has_config && !configHealth.is_fallback,
    },
    async_queue: {
      redis: queueStats.redis,
      pending: queueStats.waiting || 0,
      active: queueStats.active || 0,
    },
    semantic_cache: {
      enabled: cacheStats.enabled,
      entries: cacheStats.entries,
      hitRate: cacheStats.hitRate,
    },
    vector_store: vectorStats,
    resilience: {
      queue_pending: resilienceStats.queue.pending,
      queue_active: resilienceStats.queue.active,
      queue_success_rate: resilienceStats.queue.successRate,
      shutdown_handlers: resilienceStats.shutdownHandlers.length,
    },
    model_registry: {
      roles: modelRegistry.listRoles().length,
      executor: modelRegistry.getModelConfig("executor").model,
      executor_source: modelRegistry.getModelConfig("executor").source,
    },
  });
});

// Health check de resiliencia
app.get("/health/resilience", (req, res) => {
  res.json(resilience.getStats());
});

// Health check del vector store
app.get("/health/vector", async (req, res) => {
  try {
    if (!vectorStore || !vectorStore.isReady()) {
      return res.json({ 
        ok: false, 
        enabled: false,
        reason: process.env.VECTOR_STORE_ENABLED !== 'true' 
          ? 'VECTOR_STORE_ENABLED not set' 
          : 'Vector store not initialized'
      });
    }
    const stats = await vectorStore.getStats();
    res.json({ ok: true, ...stats });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR SEARCH ENDPOINT - Prueba de búsqueda semántica (PROTEGIDO - genera embeddings)
// ═══════════════════════════════════════════════════════════════════════════
app.get("/health/vector/search", adminAuthMiddleware, async (req, res) => {
  try {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: "Missing ?q= parameter" });
    }
    
    if (!vectorStore || !vectorStore.isReady()) {
      return res.status(503).json({ error: "Vector store not ready" });
    }
    
    // Debug: probar generación de embedding directamente
    const { getEmbedding } = await import("./vector/embeddings.js");
    const testEmbedding = await getEmbedding(query);
    
    if (!testEmbedding) {
      return res.status(500).json({ 
        error: "Failed to generate query embedding",
        query,
        hint: "Check OPENAI_API_KEY is set correctly"
      });
    }
    
    // Ahora buscar
    const { searchSimilar } = await import("./vector/vectorStore.js");
    const results = await searchSimilar(query, { limit: 5, threshold: 0.55 });
    
    res.json({ 
      query,
      embeddingGenerated: true,
      embeddingDimensions: testEmbedding.length,
      count: results.length,
      results: results.map(r => ({
        category: r.category,
        content: r.text?.substring(0, 200),
        similarity: r.similarity?.toFixed(3),
        metadata: r.metadata
      }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message, stack: err.stack?.substring(0, 500) });
  }
});

app.get("/health", healthHandler);
app.get("/health/langsmith", langsmithHealthHandler);
app.get("/metrics", metricsHandler);

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY ENDPOINT - Ver configuración de modelos AI (PROTEGIDO)
// ═══════════════════════════════════════════════════════════════════════════
app.get("/health/models", adminAuthMiddleware, (req, res) => {
  try {
    const summary = modelRegistry.getRegistrySummary();
    const roles = modelRegistry.listRoles();
    
    res.json({
      ok: true,
      roles_count: roles.length,
      roles,
      models: summary,
      hint: "Edita la pestaña AI_MODELS en Google Sheet para cambiar modelos sin deploy"
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Endpoint para ver config de un modelo específico (PROTEGIDO)
app.get("/health/models/:role", adminAuthMiddleware, (req, res) => {
  try {
    const { role } = req.params;
    const config = modelRegistry.getModelConfig(role);
    
    res.json({
      ok: true,
      role,
      config,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MODEL KNOWLEDGE - Auto-Discovery Endpoints (TODOS PROTEGIDOS)
// ═══════════════════════════════════════════════════════════════════════════

// Ver todo el conocimiento aprendido de modelos (PROTEGIDO)
app.get("/health/models/knowledge/all", adminAuthMiddleware, (req, res) => {
  try {
    const knowledge = modelRegistry.getAllKnowledge();
    const stats = modelRegistry.getAdaptiveStats();
    
    res.json({
      ok: true,
      models_known: Object.keys(knowledge).length,
      knowledge,
      adaptive_stats: stats,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Probar (probe) un modelo manualmente para descubrir capacidades (PROTEGIDO - COSTO OPENAI)
app.post("/health/models/probe/:model", adminAuthMiddleware, async (req, res) => {
  try {
    const { model } = req.params;
    
    if (!model) {
      return res.status(400).json({ ok: false, error: "Model name required" });
    }
    
    console.log(`[MODEL-REGISTRY] Manual probe requested for: ${model}`);
    const result = await modelRegistry.probeModel(model);
    
    if (!result) {
      return res.status(503).json({ 
        ok: false, 
        error: "OpenAI client not configured for probing" 
      });
    }
    
    res.json({
      ok: true,
      model,
      discovered: result,
      message: `Capabilities discovered for ${model}`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Sincronizar conocimiento a DB manualmente (PROTEGIDO)
app.post("/health/models/sync", adminAuthMiddleware, async (req, res) => {
  try {
    const synced = await modelRegistry.syncKnowledgeToDb();
    res.json({
      ok: true,
      synced,
      message: `${synced} model knowledge entries synced to DB`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Reset conocimiento (debug) (PROTEGIDO)
app.post("/health/models/reset", adminAuthMiddleware, (req, res) => {
  try {
    modelRegistry.resetKnowledge();
    res.json({
      ok: true,
      message: "Model knowledge reset to bootstrap defaults",
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// KISS endpoints
// Protect ingest + list endpoints with shared-secret HMAC (if TAGERS_SHARED_SECRET is configured).
app.post("/kiss/ingest", hmacAuthMiddleware, ingestHandler);
app.get("/kiss/instructions", hmacAuthMiddleware, listInstructionsHandler);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG HUB ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
app.use("/internal/config", configRouter);

// HITL endpoints (branches list for PWA)
app.use("/hitl", hitlRouter);

// ═══════════════════════════════════════════════════════════════════════════
// CHATWOOT WEBHOOK - Arquitectura Async
// ═══════════════════════════════════════════════════════════════════════════
app.use("/chatwoot", chatwootRouter);

// ═══════════════════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS - Protegidos con ADMIN_API_TOKEN
// ═══════════════════════════════════════════════════════════════════════════
app.use("/admin", adminRouter);

// ═══════════════════════════════════════════════════════════════════════════
// FASE 4: PAYMENTS WEBHOOKS & ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════════
app.use("/payments", paymentsRouter);
app.use("/pago", paymentsRouter); // Páginas de resultado (español)

// ═══════════════════════════════════════════════════════════════════════════
// FASE 4: GROWTH FEATURES (A/B Testing, Proactive Messaging)
// ═══════════════════════════════════════════════════════════════════════════
app.use("/growth", growthRouter);

// Auto recommendations endpoints
app.use("/system/recommendations", recommendationsRouter);

// ═══════════════════════════════════════════════════════════════════════════
// RAG PIPELINE - Document ingestion and search
// ═══════════════════════════════════════════════════════════════════════════
app.use("/rag", ragRoutes);

// Staff PWA (served from this same origin for simplest deployment)
app.use(
  "/staff",
  express.static(path.join(process.cwd(), "public", "staff-pwa"), { maxAge: 0 })
);

// Init DB then start
await initDb();

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-MIGRATE - Run SQL migrations on startup
// ═══════════════════════════════════════════════════════════════════════════
if (process.env.AUTO_MIGRATE_ON_STARTUP !== "false") {
  try {
    const { runMigrations } = await import("./db/autoMigrate.js");
    const pool = getPool();
    if (pool) {
      console.log("[AUTO-MIGRATE] Running pending migrations...");
      const result = await runMigrations(pool);
      if (result.executed.length > 0) {
        console.log(`[AUTO-MIGRATE] ✓ Executed ${result.executed.length} migrations:`, result.executed);
      } else {
        console.log("[AUTO-MIGRATE] ✓ All migrations already applied");
      }
      if (result.errors.length > 0) {
        console.warn("[AUTO-MIGRATE] ⚠ Errors:", result.errors);
      }
    } else {
      console.log("[AUTO-MIGRATE] No database pool, skipping migrations");
    }
  } catch (err) {
    console.warn("[AUTO-MIGRATE] ⚠ Migration error:", err.message);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MODEL REGISTRY INITIALIZATION - Auto-Discovery System
// ═══════════════════════════════════════════════════════════════════════════
try {
  console.log("[MODEL-REGISTRY] Initializing self-learning system...");
  
  // Configurar pool de DB para persistencia
  const dbPool = getPool();
  if (dbPool) {
    modelRegistry.setDbPool(dbPool);
    await modelRegistry.initKnowledgeTable();
    const loaded = await modelRegistry.loadKnowledgeFromDb();
    console.log(`[MODEL-REGISTRY] ✓ Loaded ${loaded} model capabilities from DB`);
  }
  
  // Configurar cliente OpenAI para auto-discovery
  if (process.env.OPENAI_API_KEY) {
    const { default: OpenAI } = await import("openai");
    const openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    modelRegistry.setOpenAIClient(openaiClient);
    console.log("[MODEL-REGISTRY] ✓ OpenAI client configured for auto-discovery");
  }
  
  console.log("[MODEL-REGISTRY] ✓ Self-learning system ready");
} catch (err) {
  console.warn("[MODEL-REGISTRY] ⚠ Partial initialization:", err.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// INSIGHTS ENGINE INITIALIZATION - Motor de análisis de conversaciones
// ═══════════════════════════════════════════════════════════════════════════
try {
  console.log("[INSIGHTS-ENGINE] Initializing...");
  
  // Obtener cliente OpenAI si existe
  let openaiClientForInsights = null;
  if (process.env.OPENAI_API_KEY) {
    const { default: OpenAI } = await import("openai");
    openaiClientForInsights = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  
  // Inicializar (auto-crea tablas si no existen)
  const insightsResult = await InsightsEngine.init({
    openaiClient: openaiClientForInsights,
    startCronJobs: true,
  });
  
  if (insightsResult.ok) {
    // Montar router de insights
    app.use("/insights", InsightsEngine.router);
    console.log("[INSIGHTS-ENGINE] ✓ Initialized and mounted at /insights");
  } else {
    console.warn("[INSIGHTS-ENGINE] ⚠ Partial initialization:", insightsResult.error);
  }
} catch (err) {
  console.warn("[INSIGHTS-ENGINE] ⚠ Failed to initialize:", err.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// VECTOR STORE INITIALIZATION - pgvector para RAG Semántico
// ═══════════════════════════════════════════════════════════════════════════
try {
  const vectorResult = await initVectorStore();
  if (vectorResult.ok) {
    console.log("[VECTOR-STORE] ✓ Initialized:", vectorResult.storage);
  } else {
    console.log("[VECTOR-STORE] ⚠ Disabled:", vectorResult.reason);
  }
} catch (err) {
  console.warn("[VECTOR-STORE] ✗ Failed to initialize:", err.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATION MEMORY SYSTEM - Persistent Memory with Summarization
// ═══════════════════════════════════════════════════════════════════════════
if (process.env.CONVERSATION_MEMORY_ENABLED === "true") {
  try {
    console.log("[MEMORY-SYSTEM] Initializing conversation memory...");
    
    // Importar servicios dinámicamente
    const { conversationMemoryService } = await import("./services/conversationMemoryService.js");
    const { conversationSummarizer } = await import("./services/conversationSummarizer.js");
    
    // Inicializar servicio de memoria
    await conversationMemoryService.init();
    console.log("[MEMORY-SYSTEM] ✓ Memory service initialized");
    
    // Iniciar scheduler de resúmenes
    conversationSummarizer.start();
    const summarizerStats = await conversationSummarizer.getStats();
    const cycleSeconds = summarizerStats?.config?.cycleIntervalMs 
      ? summarizerStats.config.cycleIntervalMs / 1000 
      : 1800; // Default 30min
    console.log(`[MEMORY-SYSTEM] ✓ Summarizer started (cycle: ${cycleSeconds}s)`);
    
  } catch (err) {
    console.warn("[MEMORY-SYSTEM] ⚠ Failed to initialize:", err.message);
  }
} else {
  console.log("[MEMORY-SYSTEM] Disabled (set CONVERSATION_MEMORY_ENABLED=true to enable)");
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG HUB INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
await initConfigTables();

// Start periodic config sync (every 5 minutes)
const configSyncInterval = parseInt(process.env.CONFIG_SYNC_INTERVAL_MINUTES || "5", 10);
if (process.env.GOOGLE_SHEET_ID) {
  console.log(`[CONFIG-HUB] Starting periodic sync every ${configSyncInterval} minutes`);
  startPeriodicSync(configSyncInterval);
  
  // Warmup semantic cache con datos del Config Hub (después de primer sync)
  setTimeout(async () => {
    try {
      const loaded = await warmupFromConfigHub();
      console.log(`[SEMANTIC-CACHE] Warmed up ${loaded} entries from Config Hub`);
    } catch (err) {
      console.warn("[SEMANTIC-CACHE] Failed to warmup from Config Hub:", err.message);
    }
  }, 3000); // Esperar 3s para que Config Hub sincronice
} else {
  console.warn("[CONFIG-HUB] GOOGLE_SHEET_ID not configured - Config Hub disabled");
}

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE HUB INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════
try {
  console.log("[KNOWLEDGE-HUB] Initializing...");
  await KnowledgeHub.initialize({
    autoSync: true,
    syncIntervalMs: configSyncInterval * 60 * 1000,
  });
  console.log("[KNOWLEDGE-HUB] Ready:", KnowledgeHub.isConfigLoaded());
} catch (err) {
  console.warn("[KNOWLEDGE-HUB] Initialization failed, using fallback:", err.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// AI WORKER INITIALIZATION (Embebido) - Controlado por RUN_MODE
// ═══════════════════════════════════════════════════════════════════════════
// RUN_MODE: "web" | "worker" | "both" (default: "both" para backwards compat)
const RUN_MODE = process.env.RUN_MODE || "both";

if (RUN_MODE === "both" || RUN_MODE === "worker") {
  console.log(`[AI-WORKER] RUN_MODE=${RUN_MODE} - Starting embedded worker...`);
  try {
    await startWorker();
    const stats = await aiQueue.getStats();
    if (stats.redis) {
      console.log("[AI-WORKER] ✓ Connected to Redis - BullMQ mode");
    } else {
      console.log("[AI-WORKER] ⚠ Redis unavailable - using in-memory fallback");
    }
  } catch (err) {
    console.warn("[AI-WORKER] Failed to start:", err.message);
    console.warn("[AI-WORKER] Webhook will use synchronous fallback");
  }
} else {
  console.log(`[AI-WORKER] RUN_MODE=${RUN_MODE} - Worker disabled (run separate worker process)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// PROACTIVE MESSAGING SCHEDULER
// ═══════════════════════════════════════════════════════════════════════════
if (process.env.PROACTIVE_ENABLED !== "false") {
  proactiveService.startScheduler(60000); // Check every 60 seconds
  console.log("[PROACTIVE] ✓ Scheduler started");
  
  // Registrar en graceful shutdown
  resilience.shutdown.register('proactive', async () => {
    proactiveService.stopScheduler();
  }, { priority: 7 });
}

const server = http.createServer(app);

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRAR COMPONENTES EN GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════
resilience.shutdown.register('bullmq', async () => {
  await aiQueue.close();
}, { priority: 8 });

resilience.shutdown.register('http', resilience.shutdown.wrapHttpServer(server), {
  priority: 1, // Último en cerrarse
});

// Socket.io HITL channel (optional)
const io = attachHitlSocket(server);
if (io) {
  resilience.shutdown.register('socketio', resilience.shutdown.wrapSocketIO(io), {
    priority: 2,
  });
}

server.listen(config.port, () => {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('  🥐 TAGERS KISS PRODUCTION API - v5.4.0 Growth');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`  ✓ Server listening on :${config.port}`);
  console.log(`  ✓ Environment: ${config.env}`);
  console.log('');
  console.log('  RESILIENCE:');
  const rStats = resilience.getStats();
  console.log(`  ├─ Queue concurrency: ${rStats.queue.concurrency}`);
  console.log(`  └─ Shutdown handlers: ${rStats.shutdownHandlers.map(h => h.name).join(', ')}`);
  console.log('');
  console.log('  Press Ctrl+C for graceful shutdown.');
  console.log('═══════════════════════════════════════════════════════════════════');
});

// NOTA: Graceful shutdown manejado por resilience.shutdown
// Los handlers SIGTERM/SIGINT están registrados automáticamente
