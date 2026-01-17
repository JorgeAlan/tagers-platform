/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FORENSE ROUTES - API para El Forense (Autopsias)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { ForenseAgent } from "../agents/ForenseAgent.js";
import { ForenseDetector } from "../detectors/sales/ForenseDetector.js";
import { memoryService } from "../memory/MemoryService.js";
import { indexAllKnowledge, indexInsight } from "../memory/ingestion/contextIngestion.js";
import { indexPendingCases } from "../memory/ingestion/caseIngestion.js";

const router = Router();
const forenseAgent = new ForenseAgent();
const forenseDetector = new ForenseDetector();

// ═══════════════════════════════════════════════════════════════════════════
// FORENSE AGENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/forense/run
 * Ejecutar el flujo completo del Forense
 */
router.post("/run", async (req, res) => {
  try {
    const { branch_id, date, date_from, date_to } = req.body;
    
    const result = await forenseAgent.run({
      branch_id,
      date: date || date_from,
      dateTo: date_to,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Forense run failed");
    res.status(500).json({ error: err?.message || "Run failed" });
  }
});

/**
 * POST /api/luca/forense/detect
 * Solo ejecutar detección (sin autopsia completa)
 */
router.post("/detect", async (req, res) => {
  try {
    const { branch_id, date } = req.body;
    
    const result = await forenseDetector.execute({
      branch_id,
      date,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Detection failed");
    res.status(500).json({ error: err?.message || "Detection failed" });
  }
});

/**
 * POST /api/luca/forense/autopsy
 * Ejecutar autopsia en un finding específico
 */
router.post("/autopsy", async (req, res) => {
  try {
    const { finding } = req.body;
    
    if (!finding) {
      return res.status(400).json({ error: "finding required" });
    }
    
    const autopsy = await forenseAgent.runAutopsy(finding);
    const diagnosis = await forenseAgent.diagnose(finding, autopsy);
    const similarCases = await forenseAgent.findSimilarCases(finding, autopsy);
    const recommendations = await forenseAgent.recommend(finding, autopsy, diagnosis, similarCases);
    
    res.json({
      finding,
      autopsy,
      diagnosis,
      similarCases,
      recommendations,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Autopsy failed");
    res.status(500).json({ error: err?.message || "Autopsy failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// MEMORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/forense/memory/stats
 * Obtener estadísticas de la memoria
 */
router.get("/memory/stats", async (req, res) => {
  try {
    const stats = await memoryService.getStats();
    res.json(stats);
  } catch (err) {
    logger.error({ err: err?.message }, "Memory stats failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/forense/memory/search
 * Buscar en la memoria
 */
router.post("/memory/search", async (req, res) => {
  try {
    const { query, type, branch_id, limit } = req.body;
    
    if (!query) {
      return res.status(400).json({ error: "query required" });
    }
    
    const results = await memoryService.search(query, {
      type,
      branchId: branch_id,
      limit: limit || 5,
    });
    
    res.json({ results });
  } catch (err) {
    logger.error({ err: err?.message }, "Memory search failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/forense/memory/similar-cases
 * Buscar casos similares
 */
router.post("/memory/similar-cases", async (req, res) => {
  try {
    const { finding, branch_id, limit } = req.body;
    
    if (!finding) {
      return res.status(400).json({ error: "finding required" });
    }
    
    const results = await memoryService.findSimilarCases(finding, {
      branchId: branch_id,
      limit: limit || 3,
    });
    
    res.json({ results });
  } catch (err) {
    logger.error({ err: err?.message }, "Similar cases search failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/forense/memory/index-knowledge
 * Indexar todo el conocimiento base
 */
router.post("/memory/index-knowledge", async (req, res) => {
  try {
    const result = await indexAllKnowledge();
    res.json({ status: "indexed", ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Knowledge indexing failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/forense/memory/index-cases
 * Indexar casos cerrados pendientes
 */
router.post("/memory/index-cases", async (req, res) => {
  try {
    const result = await indexPendingCases();
    res.json({ status: "indexed", ...result });
  } catch (err) {
    logger.error({ err: err?.message }, "Case indexing failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/forense/memory/add-insight
 * Agregar un insight manual
 */
router.post("/memory/add-insight", async (req, res) => {
  try {
    const { title, description, type, branch_id, tags, author } = req.body;
    
    if (!title || !description) {
      return res.status(400).json({ error: "title and description required" });
    }
    
    await indexInsight({
      id: `insight_${Date.now()}`,
      title,
      description,
      type: type || "manual",
      branch_id,
      tags,
      author: author || "manual",
    });
    
    res.json({ status: "added" });
  } catch (err) {
    logger.error({ err: err?.message }, "Add insight failed");
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// KNOWLEDGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/forense/knowledge/seasonality
 * Obtener datos de estacionalidad
 */
router.get("/knowledge/seasonality", async (req, res) => {
  try {
    const seasonality = await import("../knowledge/seasonality.json", { assert: { type: "json" } });
    res.json(seasonality.default);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/forense/knowledge/events
 * Obtener datos de eventos
 */
router.get("/knowledge/events", async (req, res) => {
  try {
    const events = await import("../knowledge/events_impact.json", { assert: { type: "json" } });
    res.json(events.default);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/forense/knowledge/branches
 * Obtener perfiles de sucursales
 */
router.get("/knowledge/branches", async (req, res) => {
  try {
    const branches = await import("../knowledge/branch_profiles.json", { assert: { type: "json" } });
    res.json(branches.default);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
