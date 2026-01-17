/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🦑 LUCA API - Operational Intelligence System
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * LUCA (Lurks Under, Catches Anomalies) es el sistema de inteligencia
 * operativa de Tagers. Detecta anomalías, investiga casos y genera
 * recomendaciones para los socios.
 * 
 * @version 0.3.0 - Iteration 3: Case Management + Alertas
 */

import express from "express";
import cors from "cors";
import { logger, getPool, closePool, getRedisClient, closeRedis } from "@tagers/shared";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";

// Config (MUST be first - loads all configuration from Google Sheets)
import { configLoader } from "./config/ConfigLoader.js";

// Routes
import healthRoutes from "./routes/health.js";
import lucaRoutes from "./routes/luca.js";
import towerRoutes from "./routes/tower.js";
import detectorRoutes from "./routes/detectors.js";
import casesRoutes from "./routes/cases.js";
import agentsRoutes from "./routes/agents.js";
import notificationsRoutes from "./routes/notifications.js";
import forenseRoutes from "./routes/forense.js";
import actionsRoutes from "./routes/actions.js";
import staffingRoutes from "./routes/staffing.js";
import inventoryRoutes from "./routes/inventory.js";
import cxRoutes from "./routes/cx.js";
import voiceRoutes from "./routes/voice.js";
import learningRoutes from "./routes/learning.js";
import externalRoutes from "./routes/external.js";
import twinRoutes from "./routes/twin.js";
import configHubRoutes from "./routes/configHub.js";

// Config Hub - Zero Hardcode System
import { lucaConfigHub } from "./config/LucaConfigHub.js";

// Jobs
import morningBriefingJob from "./jobs/morningBriefingJob.js";

// Engine
import { initScheduler, closeScheduler } from "./engine/scheduledRunner.js";
import { loadRegistry } from "./services/registryService.js";

// ═══════════════════════════════════════════════════════════════════════════
// APP SETUP
// ═══════════════════════════════════════════════════════════════════════════

const app = express();

// Middleware
app.use(cors({
  origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : "*",
  credentials: true,
}));
app.use(express.json({ limit: "10mb" }));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    const duration = Date.now() - start;
    if (req.path !== "/health") {
      logger.info({
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
      }, "Request completed");
    }
  });
  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════════════════

app.use("/health", healthRoutes);
app.use("/api/luca", lucaRoutes);
app.use("/api/luca", detectorRoutes);  // Detector, runs, findings routes
app.use("/api/luca", casesRoutes);     // Cases, alerts, actions routes
app.use("/api/luca/agents", agentsRoutes);  // Agent execution (La Fiscalía, etc.)
app.use("/api/luca/notifications", notificationsRoutes);  // WhatsApp, briefing, notifications
app.use("/api/luca/forense", forenseRoutes);  // El Forense (autopsias) + memoria
app.use("/api/luca/actions", actionsRoutes);  // Las Manos (Action Bus)
app.use("/api/luca/staffing", staffingRoutes);  // El Headhunter (staffing dinámico)
app.use("/api/luca/inventory", inventoryRoutes);  // El Mercader (supply chain)
app.use("/api/luca/cx", cxRoutes);  // El Showman (CX & Retention)
app.use("/api/luca/voice", voiceRoutes);  // El Podcast (Audio + Conversacional)
app.use("/api/luca/learning", learningRoutes);  // El Aprendiz (Feedback + Observabilidad)
app.use("/api/luca/external", externalRoutes);  // Los Sentidos (Integraciones Externas)
app.use("/api/luca/twin", twinRoutes);  // El Gemelo (Digital Twin + Simulador)
app.use("/api/luca/config", configHubRoutes);  // Config Hub (Zero Hardcode)
app.use("/api/tower", towerRoutes);

// Root
app.get("/", (req, res) => {
  res.json({
    service: "luca-api",
    version: "0.15.0",
    iteration: "15 - Config Hub (Zero Hardcode)",
    status: "operational",
    emoji: "🦑",
    endpoints: {
      health: "/health",
      cases: "/api/luca/cases",
      alerts: "/api/luca/alerts",
      actions: "/api/luca/actions",
      detectors: "/api/luca/detectors",
      agents: "/api/luca/agents",
      notifications: "/api/luca/notifications",
      forense: "/api/luca/forense",
      staffing: "/api/luca/staffing",
      inventory: "/api/luca/inventory",
      cx: "/api/luca/cx",
      voice: "/api/luca/voice",
      learning: "/api/luca/learning",
      external: "/api/luca/external",
      twin: "/api/luca/twin",
      config: "/api/luca/config",
      runs: "/api/luca/runs",
      findings: "/api/luca/findings",
      audit: "/api/luca/audit",
      config: "/api/luca/config",
      queue: "/api/luca/queue",
    },
  });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Error handler
app.use((err, req, res, next) => {
  logger.error({ err: err?.message, stack: err?.stack }, "Unhandled error");
  res.status(500).json({ error: "Internal server error" });
});

// ═══════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════

async function start() {
  logger.info("🦑 LUCA starting...");
  
  // Run migrations
  try {
    await runMigrations();
    logger.info("Database migrations completed");
  } catch (err) {
    logger.error({ err: err?.message }, "Migration failed");
    // Continue anyway - tables might already exist
  }
  
  // Initialize connections
  getPool();
  getRedisClient();
  
  // Initialize Config Hub (Zero Hardcode)
  try {
    lucaConfigHub.startPeriodicRefresh();
    logger.info("🔧 Config Hub initialized (zero hardcode mode)");
  } catch (err) {
    logger.warn({ err: err?.message }, "Config Hub failed to initialize (using defaults)");
  }
  
  // Load registry
  try {
    const registry = await loadRegistry();
    logger.info({
      sources: registry.sources.length,
      dataProducts: registry.dataProducts.length,
      detectors: registry.detectors.length,
    }, "Registry loaded");
  } catch (err) {
    logger.warn({ err: err?.message }, "Failed to load registry (will retry on demand)");
  }
  
  // Initialize scheduler (optional - only if ENABLE_SCHEDULER=true)
  if (process.env.ENABLE_SCHEDULER === "true") {
    try {
      await initScheduler();
      logger.info("Detector scheduler initialized");
    } catch (err) {
      logger.warn({ err: err?.message }, "Scheduler initialization failed (detectors can still be triggered manually)");
    }
  } else {
    logger.info("Scheduler disabled (set ENABLE_SCHEDULER=true to enable)");
  }
  
  // Initialize morning briefing job (optional - only if ENABLE_BRIEFING=true)
  if (process.env.ENABLE_BRIEFING === "true") {
    try {
      morningBriefingJob.start();
      logger.info("Morning briefing job started (8:00 AM daily)");
    } catch (err) {
      logger.warn({ err: err?.message }, "Morning briefing job failed to start");
    }
  } else {
    logger.info("Morning briefing disabled (set ENABLE_BRIEFING=true to enable)");
  }
  
  // Start server
  const PORT = config.port;
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "🦑 LUCA API listening");
    logger.info(`
╔═══════════════════════════════════════════════════════════════════════════╗
║  🦑 LUCA v0.3.0 - Iteration 3: Case Management                            ║
║                                                                           ║
║  Cases & State Machine:                                                   ║
║  • POST /api/luca/cases              - Create case                        ║
║  • POST /api/luca/cases/:id/transition - State transition                 ║
║  • POST /api/luca/cases/:id/evidence - Add evidence                       ║
║  • POST /api/luca/cases/:id/diagnose - Diagnose                           ║
║  • POST /api/luca/cases/:id/recommend - Recommend action                  ║
║                                                                           ║
║  Alerts with Routing:                                                     ║
║  • POST /api/luca/alerts/:id/ack     - Acknowledge                        ║
║  • POST /api/luca/alerts/:id/resolve - Resolve                            ║
║  • POST /api/luca/alerts/:id/escalate - Escalate to case                  ║
║                                                                           ║
║  Actions with Approval:                                                   ║
║  • POST /api/luca/actions/:id/approve - Approve                           ║
║  • POST /api/luca/actions/:id/reject  - Reject                            ║
║  • GET  /api/luca/actions/pending     - Pending approvals                 ║
║                                                                           ║
║  Audit:                                                                   ║
║  • GET  /api/luca/audit              - Query audit log                    ║
║  • GET  /api/luca/cases/:id/timeline - Case timeline                      ║
║                                                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
    `);
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════

async function shutdown(signal) {
  logger.info({ signal }, "Shutdown signal received");
  
  try {
    // Close scheduler first
    await closeScheduler();
    
    await closePool();
    await closeRedis();
    logger.info("Graceful shutdown completed");
    process.exit(0);
  } catch (err) {
    logger.error({ err: err?.message }, "Error during shutdown");
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

// Start the server
start().catch((err) => {
  logger.fatal({ err: err?.message }, "Failed to start LUCA");
  process.exit(1);
});

export default app;
