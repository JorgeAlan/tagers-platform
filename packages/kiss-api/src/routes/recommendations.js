import express from "express";
import { hmacAuthMiddleware } from "../utils/auth.js";
import { listSystemRecommendations } from "../db/repo.js";
import { runCodeRecommendation } from "../engine/code_recommender.js";

export const recommendationsRouter = express.Router();

// Protect all endpoints with shared-secret HMAC
recommendationsRouter.use(hmacAuthMiddleware);

recommendationsRouter.get("/", async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || "20", 10)));
  const rows = await listSystemRecommendations(limit);
  res.json({ ok: true, recommendations: rows });
});

recommendationsRouter.post("/run", async (req, res) => {
  const body = req.body || {};
  const component = String(body.component || "kiss-api");
  const focusPaths = Array.isArray(body.focus_paths) ? body.focus_paths : (Array.isArray(body.focusPaths) ? body.focusPaths : []);
  const notes = String(body.notes || "");

  try {
    const result = await runCodeRecommendation({ component, focusPaths, notes });
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});
