/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYMENTS ROUTES - Webhooks y endpoints de pago
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja:
 * - Webhooks de MercadoPago
 * - Webhooks de Stripe
 * - Consulta de estado de pago
 * - Creación de links de pago (admin)
 * 
 * @version 1.0.0
 */

import express from "express";
import { logger } from "../utils/logger.js";
import { adminAuthMiddleware } from "../middleware/adminAuth.js";
import {
  paymentsService,
  processMercadoPagoWebhook,
  processStripeWebhook,
  createPaymentLink,
  getMercadoPagoPaymentStatus,
  getStripeSessionStatus,
  getPaymentsConfig,
  getConversationByOrderId,
  getConversationByPaymentId,
  updatePaymentLinkStatus,
} from "../services/payments.js";

// Importar para notificar al cliente
import { sendChatwootMessage } from "../integrations/chatwoot_client.js";

// Analytics para tracking de pagos
import { analyticsService } from "../services/analytics.js";

// Multi-idioma para mensajes localizados
import { getConversationLanguage, getTranslation } from "../services/multilang.js";

export const paymentsRouter = express.Router();

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOKS (Sin auth - los proveedores los llaman)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Webhook de MercadoPago
 * POST /payments/webhook/mercadopago
 */
paymentsRouter.post("/webhook/mercadopago", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const signature = req.headers["x-signature"];
    const result = await processMercadoPagoWebhook(req.body, signature);
    
    if (!result.ok) {
      logger.warn({ reason: result.reason }, "MercadoPago webhook failed");
      return res.status(400).json(result);
    }
    
    // Si el pago fue aprobado, notificar al cliente
    if (result.approved && result.orderId) {
      await notifyPaymentSuccess(result.orderId, "mercadopago", result.paymentId);
    }
    
    logger.info({
      paymentId: result.paymentId,
      orderId: result.orderId,
      status: result.status,
      durationMs: Date.now() - startTime,
    }, "MercadoPago webhook processed");
    
    return res.status(200).json({ ok: true });
    
  } catch (error) {
    logger.error({ err: error.message }, "MercadoPago webhook error");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

/**
 * Webhook de Stripe
 * POST /payments/webhook/stripe
 * 
 * IMPORTANTE: Stripe requiere el raw body exacto para verificar firma.
 * Usamos req.rawBody que se captura en server.js via express.json verify callback.
 */
paymentsRouter.post("/webhook/stripe", async (req, res) => {
  const startTime = Date.now();
  
  try {
    const signature = req.headers["stripe-signature"];
    
    // FIXED: Usar rawBody para verificación de firma (capturado en server.js)
    // Stripe requiere el body exacto tal como llegó, no re-stringificado
    const rawBody = req.rawBody;
    
    if (!rawBody) {
      logger.error("Stripe webhook: rawBody not available - check express.json verify callback");
      return res.status(500).json({ ok: false, error: "raw_body_unavailable" });
    }
    
    const result = await processStripeWebhook(rawBody, signature);
    
    if (!result.ok) {
      logger.warn({ reason: result.reason }, "Stripe webhook failed");
      return res.status(400).json(result);
    }
    
    // Si el pago fue aprobado, notificar al cliente
    if (result.approved && result.orderId) {
      await notifyPaymentSuccess(result.orderId, "stripe", result.sessionId);
    }
    
    logger.info({
      sessionId: result.sessionId,
      orderId: result.orderId,
      status: result.status,
      durationMs: Date.now() - startTime,
    }, "Stripe webhook processed");
    
    return res.status(200).json({ received: true });
    
  } catch (error) {
    logger.error({ err: error.message }, "Stripe webhook error");
    return res.status(500).json({ ok: false, error: "internal_error" });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ENDPOINTS ADMIN (Con auth)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtener configuración de pagos
 * GET /payments/config
 */
paymentsRouter.get("/config", adminAuthMiddleware, (req, res) => {
  res.json(getPaymentsConfig());
});

/**
 * Crear link de pago manualmente
 * POST /payments/create
 */
paymentsRouter.post("/create", adminAuthMiddleware, async (req, res) => {
  const { orderId, amount, title, customer, items, conversationId } = req.body;
  
  if (!orderId || !amount) {
    return res.status(400).json({ 
      ok: false, 
      error: "orderId and amount are required" 
    });
  }
  
  const order = {
    id: orderId,
    amount: parseFloat(amount),
    title: title || `Pedido #${orderId}`,
    customer: customer || {},
    items: items || [],
  };
  
  const paymentLink = await createPaymentLink(order);
  
  if (!paymentLink) {
    return res.status(503).json({
      ok: false,
      error: "No payment provider available",
    });
  }
  
  // Track creación de link de pago
  analyticsService.trackPaymentLinkCreated(conversationId, {
    orderId,
    provider: paymentLink.provider,
    amount: parseFloat(amount),
  }).catch(() => {});
  
  res.json({
    ok: true,
    ...paymentLink,
    message: paymentsService.generatePaymentMessage(paymentLink, order),
  });
});

/**
 * Consultar estado de pago MercadoPago
 * GET /payments/status/mercadopago/:paymentId
 */
paymentsRouter.get("/status/mercadopago/:paymentId", adminAuthMiddleware, async (req, res) => {
  const { paymentId } = req.params;
  
  const status = await getMercadoPagoPaymentStatus(paymentId);
  
  if (!status) {
    return res.status(404).json({ ok: false, error: "Payment not found" });
  }
  
  res.json({ ok: true, ...status });
});

/**
 * Consultar estado de pago Stripe
 * GET /payments/status/stripe/:sessionId
 */
paymentsRouter.get("/status/stripe/:sessionId", adminAuthMiddleware, async (req, res) => {
  const { sessionId } = req.params;
  
  const status = await getStripeSessionStatus(sessionId);
  
  if (!status) {
    return res.status(404).json({ ok: false, error: "Session not found" });
  }
  
  res.json({ ok: true, ...status });
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Notifica al cliente que su pago fue exitoso
 * Busca la conversación asociada al pedido y envía mensaje por Chatwoot
 */
async function notifyPaymentSuccess(orderId, provider, paymentId, amount = null) {
  try {
    // 1. Buscar conversación asociada al orderId
    let conversationData = await getConversationByOrderId(orderId);
    
    // Si no encontramos por orderId, intentar por paymentId
    if (!conversationData && paymentId) {
      conversationData = await getConversationByPaymentId(provider, paymentId);
    }
    
    if (!conversationData?.conversationId) {
      logger.warn({
        orderId,
        provider,
        paymentId,
      }, "Payment success: conversation not found for notification");
      
      // Track el pago aunque no podamos notificar
      analyticsService.trackPaymentCompleted(null, {
        orderId,
        provider,
        paymentId,
        amount,
        notified: false,
        reason: "conversation_not_found",
      }).catch(() => {});
      
      return;
    }
    
    // 2. Evitar notificaciones duplicadas
    if (conversationData.notificationSent) {
      logger.debug({ orderId }, "Payment notification already sent");
      return;
    }
    
    // 3. Generar mensaje en el idioma del cliente
    const lang = getConversationLanguage(conversationData.conversationId);
    let message;
    
    if (lang !== 'es') {
      message = getTranslation('paymentSuccess', lang);
    } else {
      message = `✅ ¡Pago recibido!

Tu pedido **#${orderId}** está confirmado.

${amount ? `💰 Monto: $${parseFloat(amount).toLocaleString('es-MX')} MXN` : ''}

Te avisaremos cuando esté listo para recoger. ¡Gracias por tu preferencia! 🥐`;
    }
    
    // 4. Enviar mensaje por Chatwoot
    const accountId = conversationData.accountId || process.env.CHATWOOT_ACCOUNT_ID;
    
    const result = await sendChatwootMessage({
      accountId: parseInt(accountId),
      conversationId: parseInt(conversationData.conversationId),
      content: message,
      private: false,
    });
    
    if (result?.id) {
      logger.info({
        orderId,
        conversationId: conversationData.conversationId,
        provider,
        messageId: result.id,
      }, "Payment success notification sent");
      
      // 5. Marcar como notificado en DB
      await updatePaymentLinkStatus(orderId, 'paid', {
        paymentId,
        notificationSent: true,
      });
      
      // 6. Track analítica
      analyticsService.trackPaymentCompleted(conversationData.conversationId, {
        orderId,
        provider,
        paymentId,
        amount,
        notified: true,
      }).catch(() => {});
      
    } else {
      logger.error({
        orderId,
        conversationId: conversationData.conversationId,
      }, "Failed to send payment notification via Chatwoot");
    }
    
  } catch (error) {
    logger.error({ 
      err: error.message, 
      orderId,
      provider,
    }, "Error in notifyPaymentSuccess");
  }
}

/**
 * Trackea un fallo de pago
 */
async function trackPaymentFailed(orderId, provider, reason) {
  try {
    await analyticsService.trackEvent(analyticsService.EVENT_TYPES?.PAYMENT_FAILED || "payment_failed", {
      metadata: { orderId, provider, reason },
    });
  } catch (e) {
    // Non-fatal
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PÁGINAS DE RESULTADO (Opcional - redirección del checkout)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Página de éxito de pago
 * GET /pago/exito
 */
paymentsRouter.get("/exito", (req, res) => {
  const { order } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pago Exitoso - Tagers</title>
      <style>
        body { font-family: system-ui; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { max-width: 400px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #22c55e; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; }
        .order-id { font-family: monospace; background: #f0f0f0; padding: 8px 16px; border-radius: 8px; display: inline-block; margin: 16px 0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">✅</div>
        <h1>¡Pago Exitoso!</h1>
        <p>Tu pago ha sido procesado correctamente.</p>
        ${order ? `<div class="order-id">Pedido #${order}</div>` : ""}
        <p>Recibirás la confirmación por WhatsApp en unos momentos.</p>
        <p style="margin-top: 24px; font-size: 14px;">Puedes cerrar esta ventana y volver a la conversación.</p>
      </div>
    </body>
    </html>
  `);
});

/**
 * Página de error de pago
 * GET /pago/error
 */
paymentsRouter.get("/error", (req, res) => {
  const { order } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Error en Pago - Tagers</title>
      <style>
        body { font-family: system-ui; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { max-width: 400px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #ef4444; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">❌</div>
        <h1>Error en el Pago</h1>
        <p>No pudimos procesar tu pago. Por favor intenta nuevamente o contacta con nosotros por WhatsApp.</p>
        <p style="margin-top: 24px; font-size: 14px;">Puedes volver a la conversación para solicitar un nuevo link de pago.</p>
      </div>
    </body>
    </html>
  `);
});

/**
 * Página de pago pendiente
 * GET /pago/pendiente
 */
paymentsRouter.get("/pendiente", (req, res) => {
  const { order } = req.query;
  
  res.send(`
    <!DOCTYPE html>
    <html lang="es">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Pago Pendiente - Tagers</title>
      <style>
        body { font-family: system-ui; text-align: center; padding: 50px; background: #f5f5f5; }
        .container { max-width: 400px; margin: 0 auto; background: white; padding: 40px; border-radius: 16px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .icon { font-size: 64px; margin-bottom: 20px; }
        h1 { color: #f59e0b; margin-bottom: 16px; }
        p { color: #666; line-height: 1.6; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="icon">⏳</div>
        <h1>Pago Pendiente</h1>
        <p>Tu pago está siendo procesado. Te notificaremos por WhatsApp cuando se confirme.</p>
        ${order ? `<p style="font-family: monospace; background: #f0f0f0; padding: 8px 16px; border-radius: 8px; display: inline-block;">Pedido #${order}</p>` : ""}
      </div>
    </body>
    </html>
  `);
});

export default paymentsRouter;
