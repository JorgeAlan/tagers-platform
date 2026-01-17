/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEBHOOK HANDLER - Ejecuta acciones via Webhooks externos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Handler genérico para integraciones externas via HTTP.
 * Usado para: BUK, POS, WooCommerce, y otros sistemas externos.
 */

import { logger } from "@tagers/shared";

/**
 * Configuración de webhooks
 */
const WEBHOOK_CONFIG = {
  buk: {
    url: process.env.BUK_WEBHOOK_URL,
    apiKey: process.env.BUK_API_KEY,
    headers: { "x-api-key": process.env.BUK_API_KEY },
  },
  pos: {
    url: process.env.POS_WEBHOOK_URL,
    apiKey: process.env.POS_API_KEY,
    headers: { "Authorization": `Bearer ${process.env.POS_API_KEY}` },
  },
  woocommerce: {
    url: process.env.WOOCOMMERCE_URL,
    consumerKey: process.env.WC_CONSUMER_KEY,
    consumerSecret: process.env.WC_CONSUMER_SECRET,
  },
  generic: {
    url: null,
    headers: {},
  },
};

export const webhookHandler = {
  /**
   * Ejecuta una acción via webhook
   */
  async execute(actionType, payload, context) {
    logger.info({ actionType, payload }, "Webhook handler executing");

    // Determinar configuración de webhook según tipo de acción
    const config = this.getWebhookConfig(actionType, payload);

    // Construir request
    const request = this.buildRequest(actionType, payload, context, config);

    // Ejecutar
    return this.sendWebhook(request, config);
  },

  /**
   * Obtiene configuración de webhook según acción
   */
  getWebhookConfig(actionType, payload) {
    // Mapeo de acciones a sistemas
    const actionSystems = {
      SUBMIT_PURCHASE_ORDER: "erp",
      APPROVE_SHIFT_SWAP: "buk",
      SUSPEND_EMPLOYEE_ACCESS: "buk",
      BLOCK_POS_USER: "pos",
      UPDATE_PRODUCT_AVAILABILITY: "woocommerce",
      SYNC_INVENTORY: "woocommerce",
    };

    const system = actionSystems[actionType] || payload.system || "generic";
    return WEBHOOK_CONFIG[system] || WEBHOOK_CONFIG.generic;
  },

  /**
   * Construye el request según el tipo de acción
   */
  buildRequest(actionType, payload, context, config) {
    const base = {
      action: actionType,
      payload,
      context: {
        action_id: context.action_id,
        requested_by: context.requested_by,
        timestamp: new Date().toISOString(),
      },
    };

    // Personalizar según acción
    switch (actionType) {
      case "SUBMIT_PURCHASE_ORDER":
        return {
          ...base,
          endpoint: "/api/purchase-orders",
          method: "POST",
        };

      case "APPROVE_SHIFT_SWAP":
        return {
          ...base,
          endpoint: "/api/shifts/swap",
          method: "POST",
        };

      case "SUSPEND_EMPLOYEE_ACCESS":
        return {
          ...base,
          endpoint: `/api/employees/${payload.employee_id}/suspend`,
          method: "POST",
        };

      case "BLOCK_POS_USER":
        return {
          ...base,
          endpoint: `/api/users/${payload.user_id}/block`,
          method: "POST",
        };

      case "UPDATE_PRODUCT_AVAILABILITY":
        return {
          ...base,
          endpoint: `/wp-json/wc/v3/products/${payload.product_id}`,
          method: "PUT",
          body: {
            stock_status: payload.available ? "instock" : "outofstock",
            manage_stock: true,
            stock_quantity: payload.quantity || 0,
          },
        };

      default:
        return {
          ...base,
          endpoint: payload.endpoint || "/api/webhook",
          method: payload.method || "POST",
        };
    }
  },

  /**
   * Envía el webhook
   */
  async sendWebhook(request, config) {
    const url = config.url 
      ? `${config.url}${request.endpoint}` 
      : request.payload?.webhook_url;

    if (!url) {
      logger.warn({ action: request.action }, "Webhook URL not configured, mock mode");
      return {
        success: true,
        mock: true,
        action: request.action,
        message: "Would send webhook (URL not configured)",
      };
    }

    try {
      const headers = {
        "Content-Type": "application/json",
        ...config.headers,
        ...(request.payload?.headers || {}),
      };

      // Para WooCommerce, usar autenticación básica
      if (config.consumerKey && config.consumerSecret) {
        const auth = Buffer.from(
          `${config.consumerKey}:${config.consumerSecret}`
        ).toString("base64");
        headers["Authorization"] = `Basic ${auth}`;
      }

      const response = await fetch(url, {
        method: request.method || "POST",
        headers,
        body: JSON.stringify(request.body || {
          action: request.action,
          payload: request.payload,
          context: request.context,
        }),
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        logger.error({
          url,
          status: response.status,
          response: responseData,
        }, "Webhook request failed");

        return {
          success: false,
          status: response.status,
          error: responseData.error || responseData.message || "Request failed",
        };
      }

      logger.info({
        url,
        status: response.status,
        action: request.action,
      }, "Webhook sent successfully");

      return {
        success: true,
        status: response.status,
        response: responseData,
        action: request.action,
      };

    } catch (err) {
      logger.error({ url, err: err?.message }, "Webhook request error");
      
      return {
        success: false,
        error: err?.message,
        retryable: true,
      };
    }
  },

  /**
   * Valida payload sin ejecutar
   */
  async validate(actionType, payload, context) {
    const errors = [];

    // Validaciones específicas por acción
    switch (actionType) {
      case "SUBMIT_PURCHASE_ORDER":
        if (!payload.po_id && !payload.purchase_order) {
          errors.push("po_id or purchase_order required");
        }
        break;

      case "SUSPEND_EMPLOYEE_ACCESS":
        if (!payload.employee_id) errors.push("employee_id required");
        break;

      case "BLOCK_POS_USER":
        if (!payload.user_id) errors.push("user_id required");
        break;

      case "UPDATE_PRODUCT_AVAILABILITY":
        if (!payload.product_id) errors.push("product_id required");
        if (payload.available === undefined) errors.push("available required");
        break;
    }

    // Verificar que hay URL configurada o proporcionada
    const config = this.getWebhookConfig(actionType, payload);
    if (!config.url && !payload.webhook_url) {
      errors.push("No webhook URL configured for this action");
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: errors.length === 0 
        ? `Would send webhook for: ${actionType}` 
        : null,
    };
  },

  /**
   * Rollback (si el sistema lo soporta)
   */
  async rollback(actionType, payload, context, executionResult) {
    // Los rollbacks de webhook dependen del sistema externo
    switch (actionType) {
      case "SUSPEND_EMPLOYEE_ACCESS":
        // Reactivar acceso
        return this.execute("REACTIVATE_EMPLOYEE_ACCESS", {
          employee_id: payload.employee_id,
        }, context);

      case "BLOCK_POS_USER":
        // Desbloquear usuario
        return this.execute("UNBLOCK_POS_USER", {
          user_id: payload.user_id,
        }, context);

      case "UPDATE_PRODUCT_AVAILABILITY":
        // Revertir disponibilidad
        return this.execute("UPDATE_PRODUCT_AVAILABILITY", {
          product_id: payload.product_id,
          available: !payload.available,
          quantity: executionResult?.previous_quantity,
        }, context);

      default:
        throw new Error(`Rollback not supported for ${actionType}`);
    }
  },
};

export default webhookHandler;
