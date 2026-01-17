/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CX ROUTES - API para El Showman (Customer Experience & Retention)
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { showmanAgent } from "../agents/ShowmanAgent.js";
import {
  calculateHealthScore,
  getRecommendedAction,
  detectChurnSignals,
  segmentCustomers,
  HealthCategories,
} from "../agents/CustomerHealthScore.js";
import { churnRiskDetector } from "../detectors/cx/ChurnRiskDetector.js";
import { complaintSpikeDetector } from "../detectors/cx/ComplaintSpikeDetector.js";
import { sentimentDropDetector } from "../detectors/cx/SentimentDropDetector.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// SHOWMAN AGENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/cx/run
 * Ejecutar el flujo completo del Showman
 */
router.post("/run", async (req, res) => {
  try {
    const { branch_id, segment } = req.body;
    
    const result = await showmanAgent.run({
      branch_id,
      segment,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Showman run failed");
    res.status(500).json({ error: err?.message || "Run failed" });
  }
});

/**
 * GET /api/luca/cx/summary
 * Resumen de CX para briefing
 */
router.get("/summary", async (req, res) => {
  try {
    const summary = await showmanAgent.getCXSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/cx/wins
 * Obtener wins recientes
 */
router.get("/wins", async (req, res) => {
  try {
    const wins = await showmanAgent.checkForWins();
    res.json({ wins, count: wins.length });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CUSTOMER HEALTH SCORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/cx/health-score
 * Calcular health score de un cliente
 */
router.post("/health-score", async (req, res) => {
  try {
    const customerData = req.body;
    
    if (!customerData) {
      return res.status(400).json({ error: "Customer data required" });
    }
    
    const healthScore = calculateHealthScore(customerData);
    const recommendation = getRecommendedAction(healthScore);
    
    res.json({
      healthScore,
      recommendation,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cx/health-score/batch
 * Calcular health score para múltiples clientes
 */
router.post("/health-score/batch", async (req, res) => {
  try {
    const { customers } = req.body;
    
    if (!customers || !Array.isArray(customers)) {
      return res.status(400).json({ error: "customers array required" });
    }
    
    const results = customers.map(customer => ({
      customerId: customer.customerId,
      healthScore: calculateHealthScore(customer),
    }));
    
    res.json({ 
      results, 
      count: results.length,
      segments: {
        healthy: results.filter(r => r.healthScore.category === "HEALTHY").length,
        atRisk: results.filter(r => r.healthScore.category === "AT_RISK").length,
        churning: results.filter(r => r.healthScore.category === "CHURNING").length,
        churned: results.filter(r => r.healthScore.category === "CHURNED").length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cx/churn-signals
 * Detectar señales de churn
 */
router.post("/churn-signals", async (req, res) => {
  try {
    const { currentData, historicalData } = req.body;
    
    if (!currentData) {
      return res.status(400).json({ error: "currentData required" });
    }
    
    const signals = detectChurnSignals(currentData, historicalData || {});
    
    res.json({
      signals,
      count: signals.length,
      hasHighSeverity: signals.some(s => s.severity === "HIGH"),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/cx/health-categories
 * Obtener configuración de categorías de salud
 */
router.get("/health-categories", (req, res) => {
  res.json(HealthCategories);
});

// ═══════════════════════════════════════════════════════════════════════════
// DETECTORS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/cx/detect/churn-risk
 * Ejecutar detector de riesgo de churn
 */
router.post("/detect/churn-risk", async (req, res) => {
  try {
    const { branch_id } = req.body;
    
    const result = await churnRiskDetector.detect({
      branch_id,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Churn risk detection failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cx/detect/complaint-spike
 * Ejecutar detector de picos de quejas
 */
router.post("/detect/complaint-spike", async (req, res) => {
  try {
    const { branch_id } = req.body;
    
    const result = await complaintSpikeDetector.detect({
      branch_id,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Complaint spike detection failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cx/detect/sentiment-drop
 * Ejecutar detector de caída de sentimiento
 */
router.post("/detect/sentiment-drop", async (req, res) => {
  try {
    const { branch_id } = req.body;
    
    const result = await sentimentDropDetector.detect({
      branch_id,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Sentiment drop detection failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cx/detect/all
 * Ejecutar todos los detectores de CX
 */
router.post("/detect/all", async (req, res) => {
  try {
    const { branch_id } = req.body;
    const context = { branch_id };
    
    const [churnResult, complaintResult, sentimentResult] = await Promise.all([
      churnRiskDetector.detect(context),
      complaintSpikeDetector.detect(context),
      sentimentDropDetector.detect(context),
    ]);
    
    res.json({
      churnRisk: churnResult,
      complaintSpike: complaintResult,
      sentimentDrop: sentimentResult,
      summary: {
        totalFindings: 
          churnResult.findings.length + 
          complaintResult.findings.length + 
          sentimentResult.findings.length,
        bySeverity: {
          CRITICAL: [
            ...churnResult.findings,
            ...complaintResult.findings,
            ...sentimentResult.findings,
          ].filter(f => f.severity === "CRITICAL").length,
          HIGH: [
            ...churnResult.findings,
            ...complaintResult.findings,
            ...sentimentResult.findings,
          ].filter(f => f.severity === "HIGH").length,
        },
      },
    });
  } catch (err) {
    logger.error({ err: err?.message }, "CX detection failed");
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CAMPAIGNS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/cx/campaigns
 * Obtener campañas activas
 */
router.get("/campaigns", async (req, res) => {
  try {
    const campaigns = Array.from(showmanAgent.activeCampaigns.values());
    
    res.json({
      campaigns,
      count: campaigns.length,
      byStatus: {
        pending: campaigns.filter(c => !c.status).length,
        sent: campaigns.filter(c => c.status === "SENT").length,
        won: campaigns.filter(c => c.status === "WON").length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/cx/campaigns/:campaignId
 * Obtener detalle de una campaña
 */
router.get("/campaigns/:campaignId", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const campaign = showmanAgent.activeCampaigns.get(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/cx/campaigns/:campaignId/track
 * Trackear resultado de campaña
 */
router.post("/campaigns/:campaignId/track", async (req, res) => {
  try {
    const { campaignId } = req.params;
    const { event, data } = req.body;
    
    const campaign = showmanAgent.activeCampaigns.get(campaignId);
    
    if (!campaign) {
      return res.status(404).json({ error: "Campaign not found" });
    }
    
    // Registrar evento
    campaign.events = campaign.events || [];
    campaign.events.push({
      event,
      data,
      timestamp: new Date().toISOString(),
    });
    
    // Actualizar estado si corresponde
    if (event === "OFFER_REDEEMED") {
      campaign.status = "WON";
      campaign.wonAt = new Date().toISOString();
    }
    
    res.json({ success: true, campaign });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/cx/metrics
 * Métricas de CX
 */
router.get("/metrics", async (req, res) => {
  try {
    const campaigns = Array.from(showmanAgent.activeCampaigns.values());
    
    const totalCampaigns = campaigns.length;
    const wins = campaigns.filter(c => c.status === "WON").length;
    const conversionRate = totalCampaigns > 0 
      ? Math.round((wins / totalCampaigns) * 100) 
      : 0;

    res.json({
      totalCampaigns,
      wins,
      conversionRate,
      avgHealthScoreAtContact: campaigns.length > 0
        ? Math.round(campaigns.reduce((sum, c) => sum + (c.healthScore || 0), 0) / campaigns.length * 100) / 100
        : null,
      avgWinbackPotential: campaigns.length > 0
        ? Math.round(campaigns.reduce((sum, c) => sum + (c.winbackPotential || 0), 0) / campaigns.length)
        : null,
      byType: {
        WINBACK_LIGHT: campaigns.filter(c => c.type === "WINBACK_LIGHT").length,
        WINBACK_AGGRESSIVE: campaigns.filter(c => c.type === "WINBACK_AGGRESSIVE").length,
        REACTIVATION: campaigns.filter(c => c.type === "REACTIVATION").length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/cx/status
 * Estado del sistema de CX
 */
router.get("/status", (req, res) => {
  res.json({
    agent: "showman",
    status: "operational",
    detectors: {
      churnRisk: { name: churnRiskDetector.name, status: "active" },
      complaintSpike: { name: complaintSpikeDetector.name, status: "active" },
      sentimentDrop: { name: sentimentDropDetector.name, status: "active" },
    },
    activeCampaigns: showmanAgent.activeCampaigns?.size || 0,
  });
});

export default router;
