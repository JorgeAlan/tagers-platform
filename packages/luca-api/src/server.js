/**
 * ═══════════════════════════════════════════════════════════════════════════
 * 🦑 LUCA API - Operational Intelligence System
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * LUCA (Lurks Under, Catches Anomalies) es el sistema de inteligencia
 * operativa de Tagers. Detecta anomalías, investiga casos y genera
 * recomendaciones para los socios.
 * 
 * @version 0.1.0
 */

import express from "express";
import cors from "cors";
import { logger, getPool, closePool, getRedisClient, closeRedis } from "@tagers/shared";
import { config } from "./config.js";
import { runMigrations } from "./db/migrate.js";

// Routes
import healthRoutes from "./routes/health.js";
import lucaRoutes from "./routes/luca.js";
import towerRoutes from "./routes/tower.js";

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
app.use("/api/tower", towerRoutes);

// Root
app.get("/", (req, res) => {
  res.json({
    service: "luca-api",
    version: "0.1.0",
    status: "operational",
    emoji: "🦑",
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
  
  // Start server
  const PORT = config.port;
  app.listen(PORT, () => {
    logger.info({ port: PORT }, "🦑 LUCA API listening");
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════

async function shutdown(signal) {
  logger.info({ signal }, "Shutdown signal received");
  
  try {
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
