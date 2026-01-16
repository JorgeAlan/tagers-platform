/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PAYMENTS SERVICE - Integración con MercadoPago y Stripe
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Genera links de pago personalizados para pedidos.
 * Soporta MercadoPago (preferido en México) y Stripe como fallback.
 * 
 * Funcionalidades:
 * - Crear preferencia de pago
 * - Generar link de checkout
 * - Procesar webhooks de confirmación
 * - Consultar estado de pago
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { config } from "../config.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const paymentsConfig = {
  enabled: process.env.PAYMENTS_ENABLED === "true",
  
  // MercadoPago (preferido para México)
  mercadopago: {
    enabled: process.env.MP_ENABLED !== "false",
    accessToken: process.env.MP_ACCESS_TOKEN,
    publicKey: process.env.MP_PUBLIC_KEY,
    webhookSecret: process.env.MP_WEBHOOK_SECRET,
    sandbox: process.env.MP_SANDBOX === "true",
  },
  
  // Stripe (alternativa)
  stripe: {
    enabled: process.env.STRIPE_ENABLED === "true",
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
  },
  
  // URLs de callback
  baseUrl: process.env.PAYMENTS_BASE_URL || process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : "http://localhost:8787",
  successPath: process.env.PAYMENTS_SUCCESS_PATH || "/pago/exito",
  failurePath: process.env.PAYMENTS_FAILURE_PATH || "/pago/error",
  pendingPath: process.env.PAYMENTS_PENDING_PATH || "/pago/pendiente",
  webhookPath: process.env.PAYMENTS_WEBHOOK_PATH || "/payments/webhook",
  
  // Configuración de negocio
  currency: process.env.PAYMENTS_CURRENCY || "MXN",
  statementDescriptor: process.env.PAYMENTS_STATEMENT_DESCRIPTOR || "TAGERS",
  expirationMinutes: parseInt(process.env.PAYMENTS_EXPIRATION_MINUTES || "60", 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// MERCADOPAGO CLIENT
// ═══════════════════════════════════════════════════════════════════════════

let _mpClient = null;

async function getMercadoPagoClient() {
  if (_mpClient) return _mpClient;
  
  if (!paymentsConfig.mercadopago.accessToken) {
    return null;
  }
  
  try {
    // Importación dinámica para no fallar si no está instalado
    const { MercadoPagoConfig, Preference, Payment } = await import("mercadopago");
    
    _mpClient = {
      config: new MercadoPagoConfig({
        accessToken: paymentsConfig.mercadopago.accessToken,
      }),
      Preference,
      Payment,
    };
    
    logger.info("MercadoPago client initialized");
    return _mpClient;
    
  } catch (error) {
    logger.warn({ err: error.message }, "MercadoPago SDK not available");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STRIPE CLIENT
// ═══════════════════════════════════════════════════════════════════════════

let _stripeClient = null;

async function getStripeClient() {
  if (_stripeClient) return _stripeClient;
  
  if (!paymentsConfig.stripe.secretKey) {
    return null;
  }
  
  try {
    const Stripe = (await import("stripe")).default;
    _stripeClient = new Stripe(paymentsConfig.stripe.secretKey);
    logger.info("Stripe client initialized");
    return _stripeClient;
    
  } catch (error) {
    logger.warn({ err: error.message }, "Stripe SDK not available");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREAR LINK DE PAGO - MERCADOPAGO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una preferencia de pago en MercadoPago
 * 
 * @param {Object} order - Datos del pedido
 * @param {string} order.id - ID único del pedido
 * @param {string} order.title - Descripción del pedido
 * @param {number} order.amount - Monto total en pesos
 * @param {Object} order.customer - Datos del cliente
 * @param {string} order.customer.name - Nombre del cliente
 * @param {string} order.customer.email - Email (opcional)
 * @param {string} order.customer.phone - Teléfono
 * @param {Array} [order.items] - Items del pedido
 * @returns {Promise<{url: string, preferenceId: string}|null>}
 */
async function createMercadoPagoPayment(order) {
  const mp = await getMercadoPagoClient();
  if (!mp) return null;
  
  try {
    const preference = new mp.Preference(mp.config);
    
    // Construir items
    const items = order.items?.length ? order.items.map(item => ({
      id: item.sku || item.id || "item",
      title: item.name || item.title,
      quantity: item.quantity || 1,
      unit_price: parseFloat(item.price) || 0,
      currency_id: paymentsConfig.currency,
    })) : [{
      id: order.id,
      title: order.title || `Pedido #${order.id}`,
      quantity: 1,
      unit_price: parseFloat(order.amount),
      currency_id: paymentsConfig.currency,
    }];
    
    // Calcular expiración
    const expirationDate = new Date();
    expirationDate.setMinutes(expirationDate.getMinutes() + paymentsConfig.expirationMinutes);
    
    const preferenceData = {
      items,
      payer: {
        name: order.customer?.name || "Cliente",
        phone: order.customer?.phone ? {
          number: order.customer.phone.replace(/\D/g, ""),
        } : undefined,
        email: order.customer?.email || undefined,
      },
      back_urls: {
        success: `${paymentsConfig.baseUrl}${paymentsConfig.successPath}?order=${order.id}`,
        failure: `${paymentsConfig.baseUrl}${paymentsConfig.failurePath}?order=${order.id}`,
        pending: `${paymentsConfig.baseUrl}${paymentsConfig.pendingPath}?order=${order.id}`,
      },
      auto_return: "approved",
      external_reference: order.id,
      notification_url: `${paymentsConfig.baseUrl}${paymentsConfig.webhookPath}/mercadopago`,
      statement_descriptor: paymentsConfig.statementDescriptor,
      expires: true,
      expiration_date_to: expirationDate.toISOString(),
    };
    
    const result = await preference.create({ body: preferenceData });
    
    logger.info({
      orderId: order.id,
      preferenceId: result.id,
      amount: order.amount,
    }, "MercadoPago preference created");
    
    return {
      provider: "mercadopago",
      url: paymentsConfig.mercadopago.sandbox ? result.sandbox_init_point : result.init_point,
      preferenceId: result.id,
      expiresAt: expirationDate.toISOString(),
    };
    
  } catch (error) {
    logger.error({
      err: error.message,
      orderId: order.id,
    }, "Failed to create MercadoPago preference");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CREAR LINK DE PAGO - STRIPE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea una sesión de checkout en Stripe
 */
async function createStripePayment(order) {
  const stripe = await getStripeClient();
  if (!stripe) return null;
  
  try {
    const lineItems = order.items?.length ? order.items.map(item => ({
      price_data: {
        currency: paymentsConfig.currency.toLowerCase(),
        product_data: {
          name: item.name || item.title,
        },
        unit_amount: Math.round((parseFloat(item.price) || 0) * 100), // Stripe usa centavos
      },
      quantity: item.quantity || 1,
    })) : [{
      price_data: {
        currency: paymentsConfig.currency.toLowerCase(),
        product_data: {
          name: order.title || `Pedido #${order.id}`,
        },
        unit_amount: Math.round(parseFloat(order.amount) * 100),
      },
      quantity: 1,
    }];
    
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      line_items: lineItems,
      mode: "payment",
      success_url: `${paymentsConfig.baseUrl}${paymentsConfig.successPath}?order=${order.id}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${paymentsConfig.baseUrl}${paymentsConfig.failurePath}?order=${order.id}`,
      client_reference_id: order.id,
      customer_email: order.customer?.email || undefined,
      expires_at: Math.floor(Date.now() / 1000) + (paymentsConfig.expirationMinutes * 60),
      metadata: {
        order_id: order.id,
        customer_phone: order.customer?.phone || "",
      },
    });
    
    logger.info({
      orderId: order.id,
      sessionId: session.id,
      amount: order.amount,
    }, "Stripe session created");
    
    return {
      provider: "stripe",
      url: session.url,
      sessionId: session.id,
      expiresAt: new Date(session.expires_at * 1000).toISOString(),
    };
    
  } catch (error) {
    logger.error({
      err: error.message,
      orderId: order.id,
    }, "Failed to create Stripe session");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un link de pago para un pedido
 * Intenta MercadoPago primero, luego Stripe como fallback
 * 
 * @param {Object} order - Datos del pedido
 * @returns {Promise<{provider: string, url: string, id: string, expiresAt: string}|null>}
 */
export async function createPaymentLink(order) {
  if (!paymentsConfig.enabled) {
    logger.debug("Payments disabled");
    return null;
  }
  
  if (!order?.id || !order?.amount) {
    logger.warn("Invalid order data for payment");
    return null;
  }
  
  // Intentar MercadoPago primero (preferido en México)
  if (paymentsConfig.mercadopago.enabled) {
    const mpResult = await createMercadoPagoPayment(order);
    if (mpResult) return mpResult;
  }
  
  // Fallback a Stripe
  if (paymentsConfig.stripe.enabled) {
    const stripeResult = await createStripePayment(order);
    if (stripeResult) return stripeResult;
  }
  
  logger.warn({ orderId: order.id }, "No payment provider available");
  return null;
}

/**
 * Consulta el estado de un pago en MercadoPago
 */
export async function getMercadoPagoPaymentStatus(paymentId) {
  const mp = await getMercadoPagoClient();
  if (!mp) return null;
  
  try {
    const payment = new mp.Payment(mp.config);
    const result = await payment.get({ id: paymentId });
    
    return {
      id: result.id,
      status: result.status, // approved, pending, rejected, etc.
      statusDetail: result.status_detail,
      externalReference: result.external_reference,
      amount: result.transaction_amount,
      paidAt: result.date_approved,
    };
    
  } catch (error) {
    logger.error({ err: error.message, paymentId }, "Failed to get MP payment status");
    return null;
  }
}

/**
 * Consulta el estado de una sesión de Stripe
 */
export async function getStripeSessionStatus(sessionId) {
  const stripe = await getStripeClient();
  if (!stripe) return null;
  
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    return {
      id: session.id,
      status: session.payment_status, // paid, unpaid, no_payment_required
      orderId: session.client_reference_id,
      amount: session.amount_total / 100,
      paidAt: session.payment_status === "paid" ? new Date().toISOString() : null,
    };
    
  } catch (error) {
    logger.error({ err: error.message, sessionId }, "Failed to get Stripe session status");
    return null;
  }
}

/**
 * Procesa webhook de MercadoPago
 */
export async function processMercadoPagoWebhook(body, signature) {
  // Verificar firma si está configurado
  if (paymentsConfig.mercadopago.webhookSecret && signature) {
    // TODO: Implementar verificación de firma HMAC
  }
  
  const { type, data } = body;
  
  if (type === "payment") {
    const paymentId = data?.id;
    if (!paymentId) return { ok: false, reason: "no_payment_id" };
    
    const status = await getMercadoPagoPaymentStatus(paymentId);
    if (!status) return { ok: false, reason: "payment_not_found" };
    
    logger.info({
      paymentId,
      status: status.status,
      orderId: status.externalReference,
    }, "MercadoPago webhook processed");
    
    return {
      ok: true,
      paymentId,
      orderId: status.externalReference,
      status: status.status,
      approved: status.status === "approved",
    };
  }
  
  return { ok: true, type, ignored: true };
}

/**
 * Procesa webhook de Stripe
 * 
 * @param {Buffer|string} rawBody - Body raw tal como llegó (para verificación de firma)
 * @param {string} signature - Header stripe-signature
 */
export async function processStripeWebhook(rawBody, signature) {
  const stripe = await getStripeClient();
  if (!stripe) return { ok: false, reason: "stripe_not_configured" };
  
  try {
    let event;
    
    // FIXED: Verificar firma usando rawBody directamente
    // La firma DEBE verificarse si hay webhookSecret configurado (fail-closed)
    if (paymentsConfig.stripe.webhookSecret) {
      if (!signature) {
        logger.warn("Stripe webhook: signature required but not provided");
        return { ok: false, reason: "signature_required" };
      }
      
      // Stripe SDK espera el rawBody como string o Buffer
      event = stripe.webhooks.constructEvent(
        rawBody,  // Ya es Buffer o string, NO usar JSON.stringify
        signature,
        paymentsConfig.stripe.webhookSecret
      );
    } else {
      // Sin secret configurado, parsear body manualmente
      // ADVERTENCIA: Esto es inseguro en producción
      logger.warn("Stripe webhook: No STRIPE_WEBHOOK_SECRET configured - signature NOT verified");
      event = typeof rawBody === "string" ? JSON.parse(rawBody) : JSON.parse(rawBody.toString());
    }
    
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      
      logger.info({
        sessionId: session.id,
        orderId: session.client_reference_id,
        status: session.payment_status,
      }, "Stripe webhook processed");
      
      return {
        ok: true,
        sessionId: session.id,
        orderId: session.client_reference_id,
        status: session.payment_status,
        approved: session.payment_status === "paid",
      };
    }
    
    return { ok: true, type: event.type, ignored: true };
    
  } catch (error) {
    logger.error({ err: error.message }, "Failed to process Stripe webhook");
    return { ok: false, reason: error.message };
  }
}

/**
 * Genera mensaje de pago para el cliente
 */
export function generatePaymentMessage(paymentLink, order) {
  if (!paymentLink) {
    return "Lo siento, no pudimos generar el link de pago. Por favor paga directamente en sucursal.";
  }
  
  const amount = parseFloat(order.amount).toLocaleString("es-MX", {
    style: "currency",
    currency: "MXN",
  });
  
  return `💳 *Link de pago para tu pedido*

📦 Pedido: #${order.id}
💰 Total: ${amount}

👉 Paga aquí: ${paymentLink.url}

⏰ Este link expira en ${paymentsConfig.expirationMinutes} minutos.

Una vez confirmado tu pago, recibirás la confirmación automáticamente. ¡Gracias por tu preferencia! 🥐`;
}

/**
 * Verifica si pagos está habilitado
 */
export function isPaymentsEnabled() {
  return paymentsConfig.enabled && (
    paymentsConfig.mercadopago.enabled || 
    paymentsConfig.stripe.enabled
  );
}

/**
 * Obtiene configuración actual
 */
export function getPaymentsConfig() {
  return {
    enabled: paymentsConfig.enabled,
    mercadopago: {
      enabled: paymentsConfig.mercadopago.enabled,
      sandbox: paymentsConfig.mercadopago.sandbox,
      configured: !!paymentsConfig.mercadopago.accessToken,
    },
    stripe: {
      enabled: paymentsConfig.stripe.enabled,
      configured: !!paymentsConfig.stripe.secretKey,
    },
    currency: paymentsConfig.currency,
    expirationMinutes: paymentsConfig.expirationMinutes,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYMENT LINK TRACKING (para notificaciones automáticas)
// ═══════════════════════════════════════════════════════════════════════════

// Importación lazy del pool
let _getPool = null;

async function getPool() {
  if (!_getPool) {
    try {
      const module = await import("../db/repo.js");
      _getPool = module.getPool;
    } catch {
      return null;
    }
  }
  return _getPool?.();
}

/**
 * Guarda un payment link con su conversation_id asociado
 * Esto permite notificar al cliente cuando el pago se confirme
 * 
 * @param {Object} params
 * @param {string} params.orderId - ID del pedido
 * @param {string} params.conversationId - ID de la conversación de Chatwoot
 * @param {string} params.provider - 'mercadopago' o 'stripe'
 * @param {number} params.amount - Monto total
 * @param {string} [params.preferenceId] - ID de preferencia de MercadoPago
 * @param {string} [params.sessionId] - ID de sesión de Stripe
 * @param {Object} [params.customer] - Datos del cliente
 * @param {string} [params.contactId] - ID del contacto en Chatwoot
 * @param {string} [params.accountId] - ID de la cuenta de Chatwoot
 * @param {Date} [params.expiresAt] - Fecha de expiración del link
 * @returns {Promise<{saved: boolean, id?: number, error?: string}>}
 */
export async function savePaymentLink({
  orderId,
  conversationId,
  provider,
  amount,
  preferenceId = null,
  sessionId = null,
  customer = {},
  contactId = null,
  accountId = null,
  expiresAt = null,
  metadata = {},
}) {
  const pool = await getPool();
  if (!pool) {
    logger.warn("savePaymentLink: DB pool not available");
    return { saved: false, error: "db_unavailable" };
  }
  
  try {
    const result = await pool.query(`
      INSERT INTO payment_links 
        (order_id, conversation_id, provider, amount, preference_id, session_id,
         customer_phone, customer_name, customer_email, contact_id, account_id, 
         expires_at, metadata, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'pending')
      ON CONFLICT (preference_id) WHERE preference_id IS NOT NULL
        DO UPDATE SET 
          conversation_id = EXCLUDED.conversation_id,
          updated_at = NOW()
      RETURNING id
    `, [
      orderId,
      conversationId,
      provider,
      amount,
      preferenceId,
      sessionId,
      customer?.phone || null,
      customer?.name || null,
      customer?.email || null,
      contactId,
      accountId,
      expiresAt,
      JSON.stringify(metadata),
    ]);
    
    logger.info({
      orderId,
      conversationId,
      provider,
      id: result.rows[0]?.id,
    }, "Payment link saved for notification tracking");
    
    return { saved: true, id: result.rows[0]?.id };
    
  } catch (error) {
    // Si la tabla no existe, log warning pero no fallar
    if (error.code === '42P01') {
      logger.warn("payment_links table not found - run migration 004");
      return { saved: false, error: "table_not_found" };
    }
    
    logger.error({ err: error.message, orderId }, "Failed to save payment link");
    return { saved: false, error: error.message };
  }
}

/**
 * Busca la conversación asociada a un orderId
 * 
 * @param {string} orderId - ID del pedido
 * @returns {Promise<{conversationId: string, contactId: string, accountId: string, customer: Object}|null>}
 */
export async function getConversationByOrderId(orderId) {
  const pool = await getPool();
  if (!pool) return null;
  
  try {
    const result = await pool.query(`
      SELECT 
        conversation_id,
        contact_id,
        account_id,
        customer_phone,
        customer_name,
        customer_email
      FROM payment_links
      WHERE order_id = $1
      ORDER BY created_at DESC
      LIMIT 1
    `, [orderId]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      accountId: row.account_id,
      customer: {
        phone: row.customer_phone,
        name: row.customer_name,
        email: row.customer_email,
      },
    };
    
  } catch (error) {
    if (error.code === '42P01') {
      logger.debug("payment_links table not found");
      return null;
    }
    logger.error({ err: error.message, orderId }, "Failed to get conversation by order");
    return null;
  }
}

/**
 * Busca la conversación por payment/preference ID
 * 
 * @param {string} provider - 'mercadopago' o 'stripe'
 * @param {string} paymentId - ID del pago o preferencia
 * @returns {Promise<Object|null>}
 */
export async function getConversationByPaymentId(provider, paymentId) {
  const pool = await getPool();
  if (!pool) return null;
  
  try {
    let query;
    if (provider === 'mercadopago') {
      query = `
        SELECT * FROM payment_links
        WHERE preference_id = $1 OR payment_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;
    } else {
      query = `
        SELECT * FROM payment_links
        WHERE session_id = $1 OR payment_id = $1
        ORDER BY created_at DESC
        LIMIT 1
      `;
    }
    
    const result = await pool.query(query, [paymentId]);
    
    if (result.rows.length === 0) return null;
    
    const row = result.rows[0];
    return {
      conversationId: row.conversation_id,
      contactId: row.contact_id,
      accountId: row.account_id,
      orderId: row.order_id,
      amount: row.amount,
      customer: {
        phone: row.customer_phone,
        name: row.customer_name,
        email: row.customer_email,
      },
      notificationSent: row.notification_sent,
    };
    
  } catch (error) {
    if (error.code === '42P01') return null;
    logger.error({ err: error.message, paymentId }, "Failed to get conversation by payment");
    return null;
  }
}

/**
 * Actualiza el estado de un payment link
 * 
 * @param {string} orderId - ID del pedido
 * @param {string} status - Nuevo estado: 'paid', 'failed', 'expired'
 * @param {Object} [extra] - Datos adicionales
 */
export async function updatePaymentLinkStatus(orderId, status, extra = {}) {
  const pool = await getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      UPDATE payment_links
      SET 
        status = $2,
        payment_id = COALESCE($3, payment_id),
        paid_at = CASE WHEN $2 = 'paid' THEN NOW() ELSE paid_at END,
        notification_sent = COALESCE($4, notification_sent),
        notification_sent_at = CASE WHEN $4 = TRUE THEN NOW() ELSE notification_sent_at END,
        updated_at = NOW()
      WHERE order_id = $1
    `, [orderId, status, extra.paymentId || null, extra.notificationSent || null]);
    
    return true;
    
  } catch (error) {
    if (error.code === '42P01') return false;
    logger.error({ err: error.message, orderId }, "Failed to update payment link status");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const paymentsService = {
  createPaymentLink,
  getMercadoPagoPaymentStatus,
  getStripeSessionStatus,
  processMercadoPagoWebhook,
  processStripeWebhook,
  generatePaymentMessage,
  isEnabled: isPaymentsEnabled,
  getConfig: getPaymentsConfig,
  // Nuevas funciones para tracking
  savePaymentLink,
  getConversationByOrderId,
  getConversationByPaymentId,
  updatePaymentLinkStatus,
};

export default paymentsService;
