/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHATSAPP CLIENT - Meta Business API Integration
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cliente para enviar mensajes por WhatsApp usando la API de Meta Business.
 * Soporta mensajes de texto, templates y mensajes interactivos.
 * 
 * Requiere:
 * - WHATSAPP_TOKEN: Access token de la app de Meta
 * - WHATSAPP_PHONE_ID: ID del número de teléfono de WhatsApp Business
 * - WHATSAPP_BUSINESS_ID: ID del negocio en Meta
 */

import { logger } from "@tagers/shared";

const WHATSAPP_API_URL = "https://graph.facebook.com/v18.0";

export class WhatsAppClient {
  constructor(config = {}) {
    this.token = config.token || process.env.WHATSAPP_TOKEN;
    this.phoneId = config.phoneId || process.env.WHATSAPP_PHONE_ID;
    this.businessId = config.businessId || process.env.WHATSAPP_BUSINESS_ID;
    
    if (!this.token || !this.phoneId) {
      logger.warn("WhatsApp credentials not configured - client will be in mock mode");
      this.mockMode = true;
    } else {
      this.mockMode = false;
    }
  }

  /**
   * Envía un mensaje de texto simple
   */
  async sendText(to, text, options = {}) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.normalizePhone(to),
      type: "text",
      text: {
        preview_url: options.previewUrl || false,
        body: text,
      },
    };

    return this.send(payload);
  }

  /**
   * Envía un mensaje usando un template pre-aprobado por Meta
   */
  async sendTemplate(to, templateName, languageCode = "es_MX", components = []) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.normalizePhone(to),
      type: "template",
      template: {
        name: templateName,
        language: {
          code: languageCode,
        },
        components: components,
      },
    };

    return this.send(payload);
  }

  /**
   * Envía un mensaje interactivo con botones
   */
  async sendButtons(to, bodyText, buttons, headerText = null, footerText = null) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.normalizePhone(to),
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map((btn, i) => ({
            type: "reply",
            reply: {
              id: btn.id || `btn_${i}`,
              title: btn.title.substring(0, 20), // Max 20 chars
            },
          })),
        },
      },
    };

    if (headerText) {
      payload.interactive.header = { type: "text", text: headerText };
    }
    if (footerText) {
      payload.interactive.footer = { text: footerText };
    }

    return this.send(payload);
  }

  /**
   * Envía un mensaje interactivo con lista
   */
  async sendList(to, bodyText, buttonText, sections, headerText = null, footerText = null) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.normalizePhone(to),
      type: "interactive",
      interactive: {
        type: "list",
        body: { text: bodyText },
        action: {
          button: buttonText.substring(0, 20),
          sections: sections.slice(0, 10).map(section => ({
            title: section.title?.substring(0, 24) || "Opciones",
            rows: section.rows.slice(0, 10).map(row => ({
              id: row.id,
              title: row.title.substring(0, 24),
              description: row.description?.substring(0, 72),
            })),
          })),
        },
      },
    };

    if (headerText) {
      payload.interactive.header = { type: "text", text: headerText };
    }
    if (footerText) {
      payload.interactive.footer = { text: footerText };
    }

    return this.send(payload);
  }

  /**
   * Envía una imagen
   */
  async sendImage(to, imageUrl, caption = null) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.normalizePhone(to),
      type: "image",
      image: {
        link: imageUrl,
      },
    };

    if (caption) {
      payload.image.caption = caption;
    }

    return this.send(payload);
  }

  /**
   * Envía un documento
   */
  async sendDocument(to, documentUrl, filename, caption = null) {
    const payload = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: this.normalizePhone(to),
      type: "document",
      document: {
        link: documentUrl,
        filename: filename,
      },
    };

    if (caption) {
      payload.document.caption = caption;
    }

    return this.send(payload);
  }

  /**
   * Marca un mensaje como leído
   */
  async markAsRead(messageId) {
    const payload = {
      messaging_product: "whatsapp",
      status: "read",
      message_id: messageId,
    };

    return this.send(payload);
  }

  /**
   * Envía el payload a la API de WhatsApp
   */
  async send(payload) {
    if (this.mockMode) {
      logger.info({ payload }, "WhatsApp MOCK: Would send message");
      return {
        success: true,
        mock: true,
        messageId: `mock_${Date.now()}`,
        payload,
      };
    }

    const url = `${WHATSAPP_API_URL}/${this.phoneId}/messages`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        logger.error({
          status: response.status,
          error: data.error,
        }, "WhatsApp API error");
        
        return {
          success: false,
          error: data.error?.message || "Unknown error",
          code: data.error?.code,
        };
      }

      logger.info({
        to: payload.to,
        type: payload.type,
        messageId: data.messages?.[0]?.id,
      }, "WhatsApp message sent");

      return {
        success: true,
        messageId: data.messages?.[0]?.id,
        contacts: data.contacts,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "WhatsApp send failed");
      return {
        success: false,
        error: err?.message || "Network error",
      };
    }
  }

  /**
   * Normaliza número de teléfono al formato internacional
   */
  normalizePhone(phone) {
    // Remover espacios, guiones, paréntesis
    let normalized = phone.replace(/[\s\-\(\)]/g, "");
    
    // Si empieza con +, quitar
    if (normalized.startsWith("+")) {
      normalized = normalized.substring(1);
    }
    
    // Si es número mexicano de 10 dígitos, agregar código de país
    if (normalized.length === 10 && !normalized.startsWith("52")) {
      normalized = "52" + normalized;
    }
    
    return normalized;
  }

  /**
   * Verifica el estado del webhook
   */
  verifyWebhook(mode, token, challenge, verifyToken) {
    if (mode === "subscribe" && token === verifyToken) {
      logger.info("WhatsApp webhook verified");
      return challenge;
    }
    logger.warn("WhatsApp webhook verification failed");
    return null;
  }

  /**
   * Procesa webhook de mensajes entrantes
   */
  processWebhook(body) {
    const messages = [];
    
    try {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      
      if (value?.messages) {
        for (const message of value.messages) {
          messages.push({
            messageId: message.id,
            from: message.from,
            timestamp: new Date(parseInt(message.timestamp) * 1000),
            type: message.type,
            text: message.text?.body,
            button: message.interactive?.button_reply,
            list: message.interactive?.list_reply,
            image: message.image,
            document: message.document,
            contacts: value.contacts,
          });
        }
      }
      
      // También procesar status updates
      if (value?.statuses) {
        for (const status of value.statuses) {
          messages.push({
            type: "status",
            messageId: status.id,
            status: status.status, // sent, delivered, read, failed
            timestamp: new Date(parseInt(status.timestamp) * 1000),
            recipientId: status.recipient_id,
            error: status.errors?.[0],
          });
        }
      }
    } catch (err) {
      logger.error({ err: err?.message }, "Error processing WhatsApp webhook");
    }
    
    return messages;
  }
}

// Export singleton instance
export const whatsappClient = new WhatsAppClient();

export default WhatsAppClient;
