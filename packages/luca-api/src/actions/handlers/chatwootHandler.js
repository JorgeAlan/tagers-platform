/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHATWOOT HANDLER - Ejecuta acciones de Chatwoot/CRM
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Acciones soportadas:
 * - CREATE_INTERNAL_NOTE: Crear nota interna en conversación
 * - CREATE_TICKET: Crear ticket de seguimiento
 * - ASSIGN_CONVERSATION: Asignar conversación a agente
 * - TAG_CONVERSATION: Agregar tag a conversación
 */

import { logger } from "@tagers/shared";

/**
 * Configuración de Chatwoot
 */
const CHATWOOT_URL = process.env.CHATWOOT_URL || "https://chatwoot.tagers.mx";
const CHATWOOT_API_KEY = process.env.CHATWOOT_API_KEY;
const CHATWOOT_ACCOUNT_ID = process.env.CHATWOOT_ACCOUNT_ID || "1";

export const chatwootHandler = {
  /**
   * Ejecuta una acción de Chatwoot
   */
  async execute(actionType, payload, context) {
    logger.info({ actionType, payload }, "Chatwoot handler executing");

    switch (actionType) {
      case "CREATE_INTERNAL_NOTE":
        return this.createInternalNote(payload, context);

      case "CREATE_TICKET":
        return this.createTicket(payload, context);

      case "ASSIGN_CONVERSATION":
        return this.assignConversation(payload, context);

      case "TAG_CONVERSATION":
        return this.tagConversation(payload, context);

      case "RESOLVE_CONVERSATION":
        return this.resolveConversation(payload, context);

      case "SNOOZE_CONVERSATION":
        return this.snoozeConversation(payload, context);

      default:
        throw new Error(`Unknown Chatwoot action: ${actionType}`);
    }
  },

  /**
   * Crea nota interna en una conversación
   */
  async createInternalNote(payload, context) {
    const { conversation_id, content, private: isPrivate = true } = payload;

    if (!conversation_id || !content) {
      throw new Error("conversation_id and content required");
    }

    const response = await this.chatwootRequest(
      `/conversations/${conversation_id}/messages`,
      "POST",
      {
        content,
        private: isPrivate,
        message_type: "outgoing",
      }
    );

    return {
      success: true,
      messageId: response?.id,
      conversationId: conversation_id,
    };
  },

  /**
   * Crea un ticket/caso de seguimiento
   */
  async createTicket(payload, context) {
    const { 
      conversation_id,
      title,
      description,
      priority = "medium",
      assignee_id,
    } = payload;

    // En Chatwoot, los "tickets" son conversaciones con labels especiales
    // Agregamos label de ticket y nota con detalles

    if (conversation_id) {
      // Agregar label de ticket
      await this.tagConversation({
        conversation_id,
        labels: ["ticket", `priority-${priority}`],
      }, context);

      // Agregar nota con detalles del ticket
      await this.createInternalNote({
        conversation_id,
        content: `📋 **TICKET CREADO**\n\n**Título:** ${title}\n**Prioridad:** ${priority}\n\n${description || ""}`,
      }, context);

      // Asignar si se especifica
      if (assignee_id) {
        await this.assignConversation({
          conversation_id,
          assignee_id,
        }, context);
      }
    }

    return {
      success: true,
      ticketId: `TKT-${Date.now()}`,
      conversationId: conversation_id,
      title,
      priority,
    };
  },

  /**
   * Asigna conversación a un agente
   */
  async assignConversation(payload, context) {
    const { conversation_id, assignee_id, team_id } = payload;

    if (!conversation_id) {
      throw new Error("conversation_id required");
    }

    const body = {};
    if (assignee_id) body.assignee_id = assignee_id;
    if (team_id) body.team_id = team_id;

    const response = await this.chatwootRequest(
      `/conversations/${conversation_id}/assignments`,
      "POST",
      body
    );

    return {
      success: true,
      conversationId: conversation_id,
      assigneeId: assignee_id,
      teamId: team_id,
    };
  },

  /**
   * Agrega tags/labels a una conversación
   */
  async tagConversation(payload, context) {
    const { conversation_id, labels } = payload;

    if (!conversation_id || !labels || labels.length === 0) {
      throw new Error("conversation_id and labels required");
    }

    const response = await this.chatwootRequest(
      `/conversations/${conversation_id}/labels`,
      "POST",
      { labels }
    );

    return {
      success: true,
      conversationId: conversation_id,
      labels,
    };
  },

  /**
   * Resuelve una conversación
   */
  async resolveConversation(payload, context) {
    const { conversation_id } = payload;

    if (!conversation_id) {
      throw new Error("conversation_id required");
    }

    const response = await this.chatwootRequest(
      `/conversations/${conversation_id}/toggle_status`,
      "POST",
      { status: "resolved" }
    );

    return {
      success: true,
      conversationId: conversation_id,
      status: "resolved",
    };
  },

  /**
   * Pone en snooze una conversación
   */
  async snoozeConversation(payload, context) {
    const { conversation_id, snoozed_until } = payload;

    if (!conversation_id) {
      throw new Error("conversation_id required");
    }

    const response = await this.chatwootRequest(
      `/conversations/${conversation_id}/toggle_status`,
      "POST",
      { 
        status: "snoozed",
        snoozed_until: snoozed_until || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      }
    );

    return {
      success: true,
      conversationId: conversation_id,
      status: "snoozed",
      snoozedUntil: snoozed_until,
    };
  },

  /**
   * Hace request a la API de Chatwoot
   */
  async chatwootRequest(endpoint, method = "GET", body = null) {
    if (!CHATWOOT_API_KEY) {
      logger.warn("Chatwoot API key not configured, mock mode");
      return { id: `mock_${Date.now()}`, success: true };
    }

    const url = `${CHATWOOT_URL}/api/v1/accounts/${CHATWOOT_ACCOUNT_ID}${endpoint}`;
    
    const options = {
      method,
      headers: {
        "api_access_token": CHATWOOT_API_KEY,
        "Content-Type": "application/json",
      },
    };

    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    try {
      const response = await fetch(url, options);
      
      if (!response.ok) {
        const error = await response.text();
        logger.error({ url, status: response.status, error }, "Chatwoot request failed");
        throw new Error(`Chatwoot API error: ${response.status}`);
      }

      return response.json();
    } catch (err) {
      logger.error({ url, err: err?.message }, "Chatwoot request error");
      throw err;
    }
  },

  /**
   * Valida payload sin ejecutar
   */
  async validate(actionType, payload, context) {
    const errors = [];

    switch (actionType) {
      case "CREATE_INTERNAL_NOTE":
        if (!payload.conversation_id) errors.push("conversation_id required");
        if (!payload.content) errors.push("content required");
        break;

      case "CREATE_TICKET":
        if (!payload.title) errors.push("title required");
        break;

      case "ASSIGN_CONVERSATION":
        if (!payload.conversation_id) errors.push("conversation_id required");
        if (!payload.assignee_id && !payload.team_id) {
          errors.push("assignee_id or team_id required");
        }
        break;

      case "TAG_CONVERSATION":
        if (!payload.conversation_id) errors.push("conversation_id required");
        if (!payload.labels || payload.labels.length === 0) {
          errors.push("labels required");
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: errors.length === 0 
        ? `Would execute Chatwoot action: ${actionType}` 
        : null,
    };
  },

  /**
   * Revierte una acción (si es posible)
   */
  async rollback(actionType, payload, context, executionResult) {
    switch (actionType) {
      case "TAG_CONVERSATION":
        // Remover los tags que agregamos
        if (executionResult?.labels) {
          // TODO: Chatwoot API para remover labels
          logger.info({ labels: executionResult.labels }, "Would remove labels");
        }
        return { success: true, rolledBack: true };

      case "ASSIGN_CONVERSATION":
        // Desasignar conversación
        await this.chatwootRequest(
          `/conversations/${payload.conversation_id}/assignments`,
          "POST",
          { assignee_id: null }
        );
        return { success: true, rolledBack: true };

      default:
        throw new Error(`Rollback not supported for ${actionType}`);
    }
  },
};

export default chatwootHandler;
