/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTS ROUTES - API para ejecutar agentes LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints para ejecutar y monitorear agentes como La Fiscalía.
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { FiscaliaAgent } from "../agents/FiscaliaAgent.js";

const router = Router();

// Instancias de agentes
const agents = {
  fiscalia: new FiscaliaAgent({
    autoInvestigate: true,
    autoCreateCase: true,
    minSeverityForCase: "HIGH",
  }),
};

// ═══════════════════════════════════════════════════════════════════════════
// LIST AGENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/agents
 * List available agents
 */
router.get("/", async (req, res) => {
  try {
    const agentList = Object.keys(agents).map(id => ({
      id,
      name: agents[id].name,
      description: getAgentDescription(id),
      status: "ready",
    }));
    
    res.json({
      agents: agentList,
      total: agentList.length,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to list agents");
    res.status(500).json({ error: "Failed to list agents" });
  }
});

function getAgentDescription(agentId) {
  const descriptions = {
    fiscalia: "Detector de fraude end-to-end: detecta, investiga, diagnostica y genera expedientes",
  };
  return descriptions[agentId] || "Agent";
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN AGENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/agents/:agentId/run
 * Execute an agent
 */
router.post("/:agentId/run", async (req, res) => {
  try {
    const { agentId } = req.params;
    const { scope = {}, options = {} } = req.body;
    
    const agent = agents[agentId];
    if (!agent) {
      return res.status(404).json({ error: `Agent not found: ${agentId}` });
    }
    
    logger.info({ agentId, scope }, "Running agent");
    
    // Ejecutar agente
    const result = await agent.run(scope);
    
    res.json({
      agent_id: agentId,
      result,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to run agent");
    res.status(500).json({ error: err?.message || "Failed to run agent" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// FISCALÍA SPECIFIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/agents/fiscalia/detect
 * Run only detection phase
 */
router.post("/fiscalia/detect", async (req, res) => {
  try {
    const { scope = {} } = req.body;
    
    const result = await agents.fiscalia.detect(scope);
    
    res.json({
      agent: "La Fiscalía",
      phase: "detect",
      result,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Detection failed");
    res.status(500).json({ error: err?.message || "Detection failed" });
  }
});

/**
 * POST /api/luca/agents/fiscalia/investigate
 * Investigate a specific finding
 */
router.post("/fiscalia/investigate", async (req, res) => {
  try {
    const { finding, depth = "MEDIUM" } = req.body;
    
    if (!finding) {
      return res.status(400).json({ error: "Finding required" });
    }
    
    const investigation = await agents.fiscalia.investigator.investigate(finding, depth);
    
    res.json({
      agent: "La Fiscalía",
      phase: "investigate",
      investigation,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Investigation failed");
    res.status(500).json({ error: err?.message || "Investigation failed" });
  }
});

/**
 * POST /api/luca/agents/fiscalia/expediente/:caseId
 * Generate expediente for a fraud case
 */
router.post("/fiscalia/expediente/:caseId", async (req, res) => {
  try {
    const { caseId } = req.params;
    
    const expediente = await agents.fiscalia.generateExpediente(caseId);
    
    res.json({
      agent: "La Fiscalía",
      case_id: caseId,
      expediente,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Expediente generation failed");
    res.status(500).json({ error: err?.message || "Failed to generate expediente" });
  }
});

/**
 * GET /api/luca/agents/fiscalia/patterns
 * Get list of fraud patterns
 */
router.get("/fiscalia/patterns", async (req, res) => {
  try {
    const patterns = [
      {
        id: "sweethearting",
        name: "Sweethearting - Descuentos a Conocidos",
        description: "Detecta descuentos excesivos a amigos/familiares",
        signals: [
          "% descuento > 2σ vs peers",
          "Mismo cliente repite > 3 veces",
          "Alta proporción de efectivo",
        ],
      },
      {
        id: "cash_preference",
        name: "Cash Preference - Preferencia por Efectivo",
        description: "Detecta preferencia anormal por efectivo",
        signals: [
          "% efectivo en descuentos > 80%",
          "% efectivo > peers + 30%",
        ],
      },
      {
        id: "time_concentration",
        name: "Time Concentration - Concentración Horaria",
        description: "Detecta descuentos concentrados en horarios específicos",
        signals: [
          "Alto coeficiente de Gini",
          "Match con horas de baja supervisión",
        ],
      },
      {
        id: "collusion",
        name: "Collusion - Colusión",
        description: "Detecta combinaciones repetidas cajero-mesero-cliente",
        signals: [
          "Misma combinación > 3 veces",
          "Descuento en cada ocasión",
        ],
      },
    ];
    
    res.json({ patterns });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to get patterns");
    res.status(500).json({ error: "Failed to get patterns" });
  }
});

export default router;
