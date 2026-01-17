/**
 * ═══════════════════════════════════════════════════════════════════════════
 * NOTIFICATIONS ROUTES - API para notificaciones y briefing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { notificationRouter } from "../channels/notifications/NotificationRouter.js";
import { notificationQueue } from "../channels/notifications/NotificationQueue.js";
import { briefingGenerator, BriefingTypes } from "../briefing/BriefingGenerator.js";
import morningBriefingJob from "../jobs/morningBriefingJob.js";
import { whatsappClient } from "../channels/whatsapp/WhatsAppClient.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// NOTIFICATION SENDING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/notifications/send
 * Send a notification through the routing system
 */
router.post("/send", async (req, res) => {
  try {
    const { type, severity, topic, targetUsers, data } = req.body;
    
    if (!type || !data) {
      return res.status(400).json({ error: "type and data required" });
    }
    
    // Route the notification
    const routes = await notificationRouter.route({
      type,
      severity: severity || "MEDIUM",
      topic,
      targetUsers,
      data,
    });
    
    // Enqueue for sending
    await notificationQueue.enqueue(routes);
    
    res.json({
      status: "queued",
      routes: routes.length,
      recipients: routes.map(r => ({
        userId: r.userId,
        channel: r.channel,
      })),
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to send notification");
    res.status(500).json({ error: err?.message || "Send failed" });
  }
});

/**
 * POST /api/luca/notifications/send-direct
 * Send a direct message (bypasses routing)
 */
router.post("/send-direct", async (req, res) => {
  try {
    const { phone, message, type = "text" } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message required" });
    }
    
    const result = await whatsappClient.sendText(phone, message);
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to send direct message");
    res.status(500).json({ error: err?.message || "Send failed" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BRIEFING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/notifications/briefing/preview/:userId
 * Preview a briefing without sending
 */
router.get("/briefing/preview/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    const briefingType = req.query.type || await notificationRouter.getBriefingType(userId);
    
    const briefing = await briefingGenerator.generate(userId, briefingType);
    
    res.json(briefing);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to preview briefing");
    res.status(500).json({ error: err?.message || "Preview failed" });
  }
});

/**
 * POST /api/luca/notifications/briefing/send/:userId
 * Send briefing to a specific user
 */
router.post("/briefing/send/:userId", async (req, res) => {
  try {
    const { userId } = req.params;
    
    const result = await morningBriefingJob.trigger(userId);
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to send briefing");
    res.status(500).json({ error: err?.message || "Send failed" });
  }
});

/**
 * POST /api/luca/notifications/briefing/trigger
 * Trigger morning briefing for all recipients
 */
router.post("/briefing/trigger", async (req, res) => {
  try {
    const result = await morningBriefingJob.run();
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to trigger briefing");
    res.status(500).json({ error: err?.message || "Trigger failed" });
  }
});

/**
 * GET /api/luca/notifications/briefing/status
 * Get briefing job status
 */
router.get("/briefing/status", (req, res) => {
  const status = morningBriefingJob.status();
  res.json(status);
});

/**
 * GET /api/luca/notifications/briefing/types
 * List available briefing types
 */
router.get("/briefing/types", (req, res) => {
  res.json({
    types: Object.keys(BriefingTypes),
    descriptions: {
      FULL: "Briefing completo con todas las secciones (para owner)",
      HEADLINES: "Solo titulares y alertas críticas (para finanzas)",
      OPERATIONAL: "Enfocado en operaciones y staff (para operaciones)",
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// QUEUE STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/notifications/queue/status
 * Get notification queue status
 */
router.get("/queue/status", (req, res) => {
  const metrics = notificationQueue.getMetrics();
  res.json(metrics);
});

/**
 * POST /api/luca/notifications/queue/clear
 * Clear the notification queue
 */
router.post("/queue/clear", (req, res) => {
  notificationQueue.clear();
  res.json({ status: "cleared" });
});

// ═══════════════════════════════════════════════════════════════════════════
// USERS & ROUTING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/notifications/recipients
 * List all configured recipients
 */
router.get("/recipients", async (req, res) => {
  const recipients = await notificationRouter.getBriefingRecipients();
  res.json({ recipients });
});

/**
 * GET /api/luca/notifications/recipients/:userId
 * Get a specific recipient's configuration
 */
router.get("/recipients/:userId", async (req, res) => {
  const { userId } = req.params;
  const user = await notificationRouter.getUser(userId);
  
  if (!user) {
    return res.status(404).json({ error: "User not found" });
  }
  
  res.json(user);
});

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP WEBHOOK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/notifications/webhook/whatsapp
 * WhatsApp webhook verification
 */
router.get("/webhook/whatsapp", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  
  const result = whatsappClient.verifyWebhook(mode, token, challenge, verifyToken);
  
  if (result) {
    res.status(200).send(result);
  } else {
    res.status(403).send("Verification failed");
  }
});

/**
 * POST /api/luca/notifications/webhook/whatsapp
 * WhatsApp webhook for incoming messages
 */
router.post("/webhook/whatsapp", async (req, res) => {
  // Always respond 200 quickly to WhatsApp
  res.status(200).send("EVENT_RECEIVED");
  
  try {
    const messages = whatsappClient.processWebhook(req.body);
    
    for (const message of messages) {
      if (message.type === "status") {
        // Log status updates
        logger.debug({ status: message }, "WhatsApp status update");
      } else {
        // Process incoming message
        await processIncomingMessage(message);
      }
    }
  } catch (err) {
    logger.error({ err: err?.message }, "Error processing WhatsApp webhook");
  }
});

/**
 * Procesa un mensaje entrante de WhatsApp
 */
async function processIncomingMessage(message) {
  logger.info({
    from: message.from,
    type: message.type,
    text: message.text,
  }, "Incoming WhatsApp message");
  
  // Marcar como leído
  await whatsappClient.markAsRead(message.messageId);
  
  // Procesar respuestas de botones
  if (message.button) {
    const buttonId = message.button.id;
    
    if (buttonId.startsWith("approve_")) {
      const actionId = buttonId.replace("approve_", "");
      // TODO: Llamar a caseService.approveAction
      logger.info({ actionId }, "Approval received via WhatsApp");
    }
    
    if (buttonId.startsWith("reject_")) {
      const actionId = buttonId.replace("reject_", "");
      // TODO: Llamar a caseService.rejectAction
      logger.info({ actionId }, "Rejection received via WhatsApp");
    }
  }
  
  // Procesar comandos de texto
  if (message.text) {
    const text = message.text.toLowerCase().trim();
    
    if (text === "aprobar" || text === "approve") {
      // Aprobar última acción pendiente
      logger.info("Approval command received");
    }
    
    if (text === "rechazar" || text === "reject") {
      // Rechazar última acción pendiente
      logger.info("Rejection command received");
    }
    
    if (text === "briefing" || text === "resumen") {
      // Enviar briefing on-demand
      // TODO: Identificar usuario por teléfono
      logger.info("Briefing requested");
    }
  }
}

export default router;
