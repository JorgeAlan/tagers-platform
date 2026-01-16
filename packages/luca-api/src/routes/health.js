/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HEALTH ROUTES - Health check endpoints
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { isDatabaseAvailable, isRedisAvailable } from "@tagers/shared";

const router = Router();

router.get("/", async (req, res) => {
  const dbOk = await isDatabaseAvailable();
  const redisOk = isRedisAvailable();
  
  const status = dbOk ? "healthy" : "degraded";
  
  res.status(dbOk ? 200 : 503).json({
    status,
    service: "luca-api",
    version: "0.1.0",
    timestamp: new Date().toISOString(),
    checks: {
      database: dbOk ? "ok" : "error",
      redis: redisOk ? "ok" : "unavailable",
    },
  });
});

export default router;
