/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTEGRATIONS MODULE - Clientes para servicios externos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Chatwoot y WhatsApp clients compartidos.
 * 
 * @version 1.0.0
 */

import axios from "axios";
import { logger } from "../utils/index.js";
import { baseConfig } from "../config/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// CHATWOOT CLIENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cliente para Chatwoot API
 */
export class ChatwootClient {
  constructor(config = {}) {
    this.baseUrl = config.baseUrl || baseConfig.chatwoot.baseUrl;
    this.apiToken = config.apiToken || baseConfig.chatwoot.apiAccessToken;
    this.accountId = config.accountId || baseConfig.chatwoot.accountId;
    
    this.client = axios.create({
      baseURL: `${this.baseUrl}/api/v1/accounts/${this.accountId}`,
      headers: {
        "Content-Type": "application/json",
        "api_access_token": this.apiToken,
      },
      timeout: 10000,
    });
  }
  
  /**
   * Envía un mensaje a una conversación
   */
  async sendMessage(conversationId, content, options = {}) {
    try {
      const response = await this.client.post(
        `/conversations/${conversationId}/messages`,
        {
          content,
          message_type: options.messageType || "outgoing",
          private: options.private || false,
          content_attributes: options.contentAttributes || {},
        }
      );
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, conversationId }, "Chatwoot sendMessage failed");
      throw err;
    }
  }
  
  /**
   * Crea una nota privada en una conversación
   */
  async createPrivateNote(conversationId, content) {
    return this.sendMessage(conversationId, content, { private: true });
  }
  
  /**
   * Obtiene información de una conversación
   */
  async getConversation(conversationId) {
    try {
      const response = await this.client.get(`/conversations/${conversationId}`);
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, conversationId }, "Chatwoot getConversation failed");
      throw err;
    }
  }
  
  /**
   * Obtiene mensajes de una conversación
   */
  async getMessages(conversationId, options = {}) {
    try {
      const response = await this.client.get(
        `/conversations/${conversationId}/messages`,
        { params: options }
      );
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, conversationId }, "Chatwoot getMessages failed");
      throw err;
    }
  }
  
  /**
   * Asigna un agente a una conversación
   */
  async assignAgent(conversationId, agentId) {
    try {
      const response = await this.client.post(
        `/conversations/${conversationId}/assignments`,
        { assignee_id: agentId }
      );
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, conversationId, agentId }, "Chatwoot assignAgent failed");
      throw err;
    }
  }
  
  /**
   * Cambia el estado de una conversación
   */
  async toggleStatus(conversationId, status) {
    try {
      const response = await this.client.post(
        `/conversations/${conversationId}/toggle_status`,
        { status }
      );
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, conversationId, status }, "Chatwoot toggleStatus failed");
      throw err;
    }
  }
  
  /**
   * Obtiene información de un contacto
   */
  async getContact(contactId) {
    try {
      const response = await this.client.get(`/contacts/${contactId}`);
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, contactId }, "Chatwoot getContact failed");
      throw err;
    }
  }
  
  /**
   * Actualiza atributos de un contacto
   */
  async updateContact(contactId, attributes) {
    try {
      const response = await this.client.put(
        `/contacts/${contactId}`,
        attributes
      );
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, contactId }, "Chatwoot updateContact failed");
      throw err;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// WHATSAPP CLIENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Cliente para WhatsApp Business API (Cloud API)
 */
export class WhatsAppClient {
  constructor(config = {}) {
    this.phoneNumberId = config.phoneNumberId || baseConfig.whatsapp.phoneNumberId;
    this.accessToken = config.accessToken || baseConfig.whatsapp.accessToken;
    
    this.client = axios.create({
      baseURL: `https://graph.facebook.com/v18.0/${this.phoneNumberId}`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.accessToken}`,
      },
      timeout: 30000,
    });
  }
  
  /**
   * Envía un mensaje de texto
   */
  async sendText(to, text) {
    try {
      const response = await this.client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "text",
        text: { body: text },
      });
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, to }, "WhatsApp sendText failed");
      throw err;
    }
  }
  
  /**
   * Envía un mensaje de template
   */
  async sendTemplate(to, templateName, language = "es", components = []) {
    try {
      const response = await this.client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: {
          name: templateName,
          language: { code: language },
          components,
        },
      });
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, to, templateName }, "WhatsApp sendTemplate failed");
      throw err;
    }
  }
  
  /**
   * Envía un documento (PDF, etc.)
   */
  async sendDocument(to, documentUrl, caption = "", filename = "") {
    try {
      const response = await this.client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "document",
        document: {
          link: documentUrl,
          caption,
          filename,
        },
      });
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, to }, "WhatsApp sendDocument failed");
      throw err;
    }
  }
  
  /**
   * Envía un audio
   */
  async sendAudio(to, audioUrl) {
    try {
      const response = await this.client.post("/messages", {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "audio",
        audio: { link: audioUrl },
      });
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message, to }, "WhatsApp sendAudio failed");
      throw err;
    }
  }
  
  /**
   * Marca mensaje como leído
   */
  async markAsRead(messageId) {
    try {
      const response = await this.client.post("/messages", {
        messaging_product: "whatsapp",
        status: "read",
        message_id: messageId,
      });
      return response.data;
    } catch (err) {
      logger.warn({ err: err?.message, messageId }, "WhatsApp markAsRead failed");
      return null;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCES
// ═══════════════════════════════════════════════════════════════════════════

let chatwootClient = null;
let whatsappClient = null;

export function getChatwootClient(config) {
  if (!chatwootClient) {
    chatwootClient = new ChatwootClient(config);
  }
  return chatwootClient;
}

export function getWhatsAppClient(config) {
  if (!whatsappClient) {
    whatsappClient = new WhatsAppClient(config);
  }
  return whatsappClient;
}

export default {
  ChatwootClient,
  WhatsAppClient,
  getChatwootClient,
  getWhatsAppClient,
};
