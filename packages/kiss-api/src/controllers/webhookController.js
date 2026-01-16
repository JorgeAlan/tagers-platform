/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEBHOOK CONTROLLER - Solo HTTP, validación y delegación
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Responsabilidad única: Recibir webhooks HTTP y delegar el procesamiento.
 * NO sabe de IA, NO sabe de flujos, NO sabe de Chatwoot API.
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import express from "express";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { aiOrchestrator } from "../services/aiOrchestrator.js";
import { chatwootService } from "../services/chatwootService.js";
import { extractWebhookPayload, isValidIncomingMessage } from "../services/payloadParser.js";

export const webhookRouter = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK ENDPOINT
// ═══════════════════════════════════════════════════════════════════════════

webhookRouter.post("/webhook", async (req, res) => {
  // 1. Verificar que Chatwoot está habilitado
  if (!config.chatwoot.enabled) {
    return res.status(404).json({ ok: false, error: "CHATWOOT_DISABLED" });
  }

  // 2. Validar token de seguridad
  if (!validateWebhookToken(req)) {
    logger.warn({ ip: req.ip }, "Webhook: unauthorized request");
    return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
  }

  // 3. Responder RÁPIDO para evitar timeouts de Chatwoot
  res.status(200).json({ ok: true });

  // 4. Procesar de forma asíncrona (no bloquear)
  processWebhookAsync(req.body);
});

// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE SEGURIDAD
// ═══════════════════════════════════════════════════════════════════════════

function validateWebhookToken(req) {
  if (!config.chatwoot.webhookToken) {
    return true; // No token configurado = no validación
  }

  const queryToken = String(req.query.token || "");
  const headerToken = String(req.headers["x-tagers-chatwoot-token"] || "");
  const token = queryToken || headerToken;

  return token === config.chatwoot.webhookToken;
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESAMIENTO ASÍNCRONO
// ═══════════════════════════════════════════════════════════════════════════

async function processWebhookAsync(body) {
  try {
    await processWebhookEvent(body);
  } catch (error) {
    logger.error({ err: error?.message || String(error) }, "Webhook processing failed");
    
    // Fallback: enviar mensaje de error al cliente (nunca silencio)
    await sendFallbackMessage(body);
  }
}

async function processWebhookEvent(body) {
  // 1. Extraer datos del payload
  const payload = extractWebhookPayload(body);
  
  logger.info({
    event: payload.event,
    conversationId: payload.conversationId,
    hasMessage: !!payload.messageText,
  }, "Webhook: processing event");

  // 2. Validar que es un mensaje entrante válido
  if (!isValidIncomingMessage(payload)) {
    logger.debug({ event: payload.event }, "Webhook: ignoring non-incoming message");
    return;
  }

  // 3. Verificar deduplicación
  if (payload.messageId && chatwootService.isDuplicateMessage(payload.messageId)) {
    logger.debug({ messageId: payload.messageId }, "Webhook: duplicate message ignored");
    return;
  }

  // 4. Delegar al orquestador de IA
  const response = await aiOrchestrator.process({
    conversationId: payload.conversationId,
    accountId: payload.accountId,
    inboxId: payload.inboxId,
    inboxName: payload.inboxName,
    messageText: payload.messageText,
    contact: payload.contact,
  });

  // 5. Enviar respuesta si hay
  if (response?.message) {
    await chatwootService.sendMessage({
      accountId: payload.accountId,
      conversationId: payload.conversationId,
      content: response.message,
    });
  }
}

async function sendFallbackMessage(body) {
  try {
    const payload = extractWebhookPayload(body);
    
    if (payload.conversationId && payload.accountId && payload.messageText) {
      await chatwootService.sendMessage({
        accountId: payload.accountId,
        conversationId: payload.conversationId,
        content: "Disculpa, tuve un problema para procesar tu mensaje. ¿Me lo repites o me dices qué necesitas?",
      });
    }
  } catch (innerError) {
    // Silenciar - ya logueamos el error principal
    logger.warn({ err: innerError?.message }, "Fallback message also failed");
  }
}

export default webhookRouter;
