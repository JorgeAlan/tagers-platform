/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GROWTH ROUTES - A/B Testing, Proactive Messaging y Analytics Admin
 * ═══════════════════════════════════════════════════════════════════════════
 */

import express from "express";
import { logger } from "../utils/logger.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import { abTestingService } from "../services/abTesting.js";
import { proactiveService } from "../services/proactive.js";
import { analyticsService } from "../services/analytics.js";
import { multilangService } from "../services/multilang.js";

export const growthRouter = express.Router();

// Aplicar auth a todas las rutas
growthRouter.use(adminAuthMiddleware);

// ═══════════════════════════════════════════════════════════════════════════
// A/B TESTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /growth/ab/config - Obtener configuración
 */
growthRouter.get("/ab/config", (req, res) => {
  res.json(abTestingService.getConfig());
});

/**
 * GET /growth/ab/experiments - Listar experimentos activos
 */
growthRouter.get("/ab/experiments", async (req, res) => {
  const { type, withStats } = req.query;
  
  if (withStats === "true") {
    const experiments = await abTestingService.getAllExperimentsWithStats();
    return res.json({ ok: true, experiments });
  }
  
  const experiments = await abTestingService.getActiveExperiments(type || null);
  res.json({ ok: true, experiments });
});

/**
 * GET /growth/ab/experiments/:id - Obtener experimento con stats
 */
growthRouter.get("/ab/experiments/:id", async (req, res) => {
  const { id } = req.params;
  
  const experiment = await abTestingService.getExperiment(id);
  if (!experiment) {
    return res.status(404).json({ ok: false, error: "Experiment not found" });
  }
  
  const stats = await abTestingService.getExperimentStats(id);
  
  res.json({ ok: true, experiment, stats });
});

/**
 * POST /growth/ab/experiments - Crear experimento
 * 
 * Body:
 * {
 *   name: "Test tono formal vs casual",
 *   type: "prompt", // 'prompt', 'canned', 'tone', 'strategy'
 *   description: "Probando si tono formal genera más conversiones",
 *   variantA: { systemPrompt: "Eres Tan-IA, asistente formal..." },
 *   variantB: { systemPrompt: "Eres Tan-IA, asistente casual..." },
 *   trafficSplit: 0.5,
 *   endsAt: "2025-02-01T00:00:00Z" // opcional
 * }
 */
growthRouter.post("/ab/experiments", async (req, res) => {
  const { name, type, description, variantA, variantB, trafficSplit, endsAt } = req.body;
  
  if (!name || !type || !variantA || !variantB) {
    return res.status(400).json({
      ok: false,
      error: "name, type, variantA, and variantB are required",
    });
  }
  
  const validTypes = ["prompt", "canned", "tone", "strategy"];
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      ok: false,
      error: `type must be one of: ${validTypes.join(", ")}`,
    });
  }
  
  const experiment = await abTestingService.createExperiment({
    name,
    type,
    description,
    variantA,
    variantB,
    trafficSplit,
    endsAt: endsAt ? new Date(endsAt) : null,
  });
  
  if (!experiment) {
    return res.status(500).json({ ok: false, error: "Failed to create experiment" });
  }
  
  res.status(201).json({ ok: true, experiment });
});

/**
 * PATCH /growth/ab/experiments/:id - Actualizar estado
 * 
 * Body: { status: "paused" | "active" | "completed", winner: "a" | "b" }
 */
growthRouter.patch("/ab/experiments/:id", async (req, res) => {
  const { id } = req.params;
  const { status, winner } = req.body;
  
  if (!status) {
    return res.status(400).json({ ok: false, error: "status is required" });
  }
  
  const validStatuses = ["active", "paused", "completed"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({
      ok: false,
      error: `status must be one of: ${validStatuses.join(", ")}`,
    });
  }
  
  const success = await abTestingService.updateExperimentStatus(id, status, winner);
  
  if (!success) {
    return res.status(500).json({ ok: false, error: "Failed to update experiment" });
  }
  
  res.json({ ok: true, status, winner });
});

/**
 * POST /growth/ab/experiments/:id/record - Registrar resultado
 * 
 * Body:
 * {
 *   conversationId: "123",
 *   variant: "a",
 *   outcome: "success", // 'success', 'failure', 'neutral'
 *   metrics: { ... }
 * }
 */
growthRouter.post("/ab/experiments/:id/record", async (req, res) => {
  const { id } = req.params;
  const { conversationId, variant, outcome, metrics, contactId } = req.body;
  
  if (!conversationId || !variant || !outcome) {
    return res.status(400).json({
      ok: false,
      error: "conversationId, variant, and outcome are required",
    });
  }
  
  const success = await abTestingService.recordResult({
    experimentId: id,
    conversationId,
    contactId,
    variant,
    outcome,
    metrics,
  });
  
  if (!success) {
    return res.status(500).json({ ok: false, error: "Failed to record result" });
  }
  
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROACTIVE MESSAGING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /growth/proactive/config - Obtener configuración
 */
growthRouter.get("/proactive/config", (req, res) => {
  res.json(proactiveService.getConfig());
});

/**
 * GET /growth/proactive/history/:conversationId - Historial de mensajes
 */
growthRouter.get("/proactive/history/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  const { limit } = req.query;
  
  const history = await proactiveService.getMessageHistory(
    conversationId,
    parseInt(limit) || 10
  );
  
  res.json({ ok: true, history });
});

/**
 * POST /growth/proactive/send - Enviar mensaje proactivo
 * 
 * Body:
 * {
 *   conversationId: "123",
 *   template: "cart_abandoned", // o content directo
 *   content: "Mensaje personalizado", // opcional si template
 *   data: { name: "Juan", ... } // datos para template
 * }
 */
growthRouter.post("/proactive/send", async (req, res) => {
  const { conversationId, contactId, template, content, data } = req.body;
  
  if (!conversationId) {
    return res.status(400).json({ ok: false, error: "conversationId is required" });
  }
  
  let messageContent = content;
  
  if (template && !content) {
    messageContent = proactiveService.generateMessage(template, data || {});
    if (!messageContent) {
      return res.status(400).json({ ok: false, error: `Template '${template}' not found` });
    }
  }
  
  if (!messageContent) {
    return res.status(400).json({ ok: false, error: "content or template is required" });
  }
  
  const result = await proactiveService.sendProactiveMessage({
    conversationId,
    contactId,
    messageType: template || "manual",
    content: messageContent,
    metadata: data,
  });
  
  res.json({ ok: result.sent, ...result });
});

/**
 * POST /growth/proactive/schedule - Programar mensaje
 * 
 * Body:
 * {
 *   conversationId: "123",
 *   template: "post_purchase",
 *   data: { ... },
 *   delayMinutes: 60, // o scheduledFor
 *   scheduledFor: "2025-01-09T10:00:00Z"
 * }
 */
growthRouter.post("/proactive/schedule", async (req, res) => {
  const { conversationId, contactId, template, content, data, delayMinutes, scheduledFor } = req.body;
  
  if (!conversationId) {
    return res.status(400).json({ ok: false, error: "conversationId is required" });
  }
  
  if (!delayMinutes && !scheduledFor) {
    return res.status(400).json({ ok: false, error: "delayMinutes or scheduledFor is required" });
  }
  
  let messageContent = content;
  if (template && !content) {
    messageContent = proactiveService.generateMessage(template, data || {});
    if (!messageContent) {
      return res.status(400).json({ ok: false, error: `Template '${template}' not found` });
    }
  }
  
  if (!messageContent) {
    return res.status(400).json({ ok: false, error: "content or template is required" });
  }
  
  const result = await proactiveService.scheduleMessage({
    conversationId,
    contactId,
    messageType: template || "manual",
    content: messageContent,
    delayMinutes,
    scheduledFor: scheduledFor ? new Date(scheduledFor) : null,
    metadata: data,
  });
  
  res.json({ ok: result.scheduled, ...result });
});

/**
 * DELETE /growth/proactive/scheduled/:conversationId - Cancelar mensajes programados
 */
growthRouter.delete("/proactive/scheduled/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  const { messageType } = req.query;
  
  const success = await proactiveService.cancelScheduledMessages(
    conversationId,
    messageType || null
  );
  
  res.json({ ok: success });
});

/**
 * GET /growth/proactive/can-send/:conversationId - Verificar si se puede enviar
 */
growthRouter.get("/proactive/can-send/:conversationId", async (req, res) => {
  const { conversationId } = req.params;
  
  const canSend = await proactiveService.canSendMessage(conversationId);
  const isQuiet = proactiveService.isQuietHours();
  
  res.json({
    ok: true,
    canSend,
    isQuietHours: isQuiet,
  });
});

/**
 * POST /growth/proactive/trigger/:type - Disparar trigger específico
 * 
 * Types: cart_abandoned, post_purchase, order_reminder, payment_pending
 */
growthRouter.post("/proactive/trigger/:type", async (req, res) => {
  const { type } = req.params;
  const { conversationId, contactId, ...data } = req.body;
  
  if (!conversationId) {
    return res.status(400).json({ ok: false, error: "conversationId is required" });
  }
  
  let result;
  
  switch (type) {
    case "cart_abandoned":
      result = await proactiveService.triggerCartAbandoned(conversationId, contactId, data);
      break;
    case "post_purchase":
      result = await proactiveService.triggerPostPurchase(conversationId, contactId, data);
      break;
    case "order_reminder":
      result = await proactiveService.triggerOrderReminder(conversationId, contactId, data);
      break;
    case "payment_pending":
      result = await proactiveService.triggerPaymentPending(conversationId, contactId, data);
      break;
    default:
      return res.status(400).json({ ok: false, error: `Unknown trigger type: ${type}` });
  }
  
  res.json({ ok: result.sent || result.scheduled, ...result });
});

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /growth/analytics/config - Obtener configuración
 */
growthRouter.get("/analytics/config", (req, res) => {
  res.json(analyticsService.getConfig());
});

/**
 * GET /growth/analytics/events - Conteo de eventos por tipo
 * Query: startDate, endDate, channel
 */
growthRouter.get("/analytics/events", async (req, res) => {
  const { startDate, endDate, channel } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  const counts = await analyticsService.getEventCounts(start, end, channel || null);
  
  res.json({
    ok: true,
    period: { start: start.toISOString(), end: end.toISOString() },
    events: counts,
  });
});

/**
 * GET /growth/analytics/orders - Métricas de conversión de pedidos
 */
growthRouter.get("/analytics/orders", async (req, res) => {
  const { startDate, endDate, channel } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  const conversion = await analyticsService.getOrderConversionRate(start, end, channel || null);
  
  res.json({
    ok: true,
    period: { start: start.toISOString(), end: end.toISOString() },
    orders: conversion,
  });
});

/**
 * GET /growth/analytics/payments - Métricas de pagos
 */
growthRouter.get("/analytics/payments", async (req, res) => {
  const { startDate, endDate } = req.query;
  
  const start = startDate ? new Date(startDate) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const end = endDate ? new Date(endDate) : new Date();
  
  const payments = await analyticsService.getPaymentsSummary(start, end);
  
  res.json({
    ok: true,
    period: { start: start.toISOString(), end: end.toISOString() },
    payments,
  });
});

/**
 * GET /growth/analytics/daily - Métricas diarias agregadas
 */
growthRouter.get("/analytics/daily", async (req, res) => {
  const { startDate, endDate, metrics } = req.query;
  
  const start = startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
  const end = endDate || new Date().toISOString().split("T")[0];
  const metricNames = metrics ? metrics.split(",") : [];
  
  const daily = await analyticsService.getDailyMetrics(start, end, metricNames);
  
  res.json({
    ok: true,
    period: { start, end },
    metrics: daily,
  });
});

/**
 * POST /growth/analytics/track - Trackear evento manual
 */
growthRouter.post("/analytics/track", async (req, res) => {
  const { eventType, conversationId, contactId, channel, metadata } = req.body;
  
  if (!eventType) {
    return res.status(400).json({ ok: false, error: "eventType is required" });
  }
  
  await analyticsService.trackEvent(eventType, {
    conversationId,
    contactId,
    channel,
    metadata,
  });
  
  res.json({ ok: true, tracked: eventType });
});

/**
 * POST /growth/analytics/cleanup - Limpiar eventos antiguos
 */
growthRouter.post("/analytics/cleanup", async (req, res) => {
  const deleted = await analyticsService.cleanupOldEvents();
  res.json({ ok: true, deleted });
});

// ═══════════════════════════════════════════════════════════════════════════
// MULTILANG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /growth/multilang/config - Obtener configuración de multi-idioma
 */
growthRouter.get("/multilang/config", (req, res) => {
  res.json({
    ok: true,
    ...multilangService.getConfig(),
  });
});

/**
 * GET /growth/multilang/languages - Listar idiomas soportados
 */
growthRouter.get("/multilang/languages", (req, res) => {
  res.json({
    ok: true,
    languages: multilangService.getSupportedLanguages(),
    translations: Object.keys(multilangService.translations),
  });
});

/**
 * GET /growth/multilang/conversation/:conversationId - Obtener idioma de una conversación
 */
growthRouter.get("/multilang/conversation/:conversationId", (req, res) => {
  const { conversationId } = req.params;
  
  res.json({
    ok: true,
    conversationId,
    language: multilangService.getConversationLanguage(conversationId),
  });
});

/**
 * POST /growth/multilang/conversation/:conversationId - Establecer idioma de una conversación
 */
growthRouter.post("/multilang/conversation/:conversationId", (req, res) => {
  const { conversationId } = req.params;
  const { language } = req.body;
  
  if (!language) {
    return res.status(400).json({ ok: false, error: "language is required" });
  }
  
  const success = multilangService.setConversationLanguage(conversationId, language);
  
  if (!success) {
    return res.status(400).json({
      ok: false,
      error: `Unsupported language: ${language}`,
      supported: multilangService.getSupportedLanguages(),
    });
  }
  
  res.json({
    ok: true,
    conversationId,
    language,
  });
});

/**
 * POST /growth/multilang/detect - Detectar idioma de un texto
 */
growthRouter.post("/multilang/detect", async (req, res) => {
  const { text, conversationId } = req.body;
  
  if (!text) {
    return res.status(400).json({ ok: false, error: "text is required" });
  }
  
  const detected = await multilangService.detectLanguage(text, conversationId);
  
  res.json({
    ok: true,
    detected,
    text: text.substring(0, 100),
  });
});

/**
 * GET /growth/multilang/translation/:key - Obtener traducción por clave
 */
growthRouter.get("/multilang/translation/:key", (req, res) => {
  const { key } = req.params;
  const { language } = req.query;
  
  const translations = {};
  for (const lang of multilangService.getSupportedLanguages()) {
    translations[lang] = multilangService.getTranslation(key, lang);
  }
  
  res.json({
    ok: true,
    key,
    currentLanguage: language || "es",
    translation: multilangService.getTranslation(key, language || "es"),
    allTranslations: translations,
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD SUMMARY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /growth/dashboard - Resumen completo de growth features
 */
growthRouter.get("/dashboard", async (req, res) => {
  const { days } = req.query;
  const daysBack = parseInt(days) || 7;
  
  const [abConfig, proactiveConfig, analyticsConfig, multilangConfig, experiments, analyticsSummary] = await Promise.all([
    abTestingService.getConfig(),
    proactiveService.getConfig(),
    analyticsService.getConfig(),
    multilangService.getConfig(),
    abTestingService.getAllExperimentsWithStats(),
    analyticsService.getDashboardSummary(daysBack),
  ]);
  
  res.json({
    ok: true,
    period: analyticsSummary.period,
    abTesting: {
      ...abConfig,
      activeExperiments: experiments.length,
      experiments: experiments.slice(0, 5), // Top 5
    },
    proactive: {
      ...proactiveConfig,
      isQuietHours: proactiveService.isQuietHours(),
    },
    analytics: {
      ...analyticsConfig,
      summary: analyticsSummary,
    },
    multilang: {
      ...multilangConfig,
    },
  });
});

export default growthRouter;
