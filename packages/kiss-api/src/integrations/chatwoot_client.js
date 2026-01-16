/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHATWOOT CLIENT - Integración completa con visibilidad de agentes
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Funciones para interactuar con Chatwoot API:
 * - Enviar mensajes a clientes
 * - Enviar notas privadas a agentes
 * - Asignar conversaciones a equipos/agentes
 * - Obtener información de conversaciones
 * - Forzar refresh de UI para agentes
 * 
 * @version 2.0.0 - Con visibilidad de agentes
 */

import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { fetchWithTimeout } from "../utils/fetch_with_timeout.js";

// ═══════════════════════════════════════════════════════════════════════════
// URL BUILDERS
// ═══════════════════════════════════════════════════════════════════════════

function buildUrl(accountId, conversationId) {
  const base = (config.chatwoot.baseUrl || "").replace(/\/$/, "");
  return `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}/messages`;
}

function buildConversationUrl(accountId, conversationId) {
  const base = (config.chatwoot.baseUrl || "").replace(/\/$/, "");
  return `${base}/api/v1/accounts/${accountId}/conversations/${conversationId}`;
}

function getEffectiveAccountId(accountId) {
  return accountId || config.chatwoot.accountId || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// SANITIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Customer-facing guardrail: avoid accidentally sending internal operational
 * playbooks or very long copy-pasted policies to customers.
 */
function sanitizeCustomerFacingContent(content) {
  if (typeof content !== "string") return content;

  // Trim hard if something goes wildly long.
  const HARD_MAX = 3500;
  if (content.length > HARD_MAX) {
    return `${content.slice(0, HARD_MAX).trim()}\n\n(…mensaje truncado)`;
  }

  const upper = content.toUpperCase();
  const hasPolicyMarker = upper.includes("POLÍTICA") || upper.includes("POLITICA");
  const hasInternalOpsMarkers =
    upper.includes("NOTAS TÉCNICAS") ||
    upper.includes("NOTAS TECNICAS") ||
    upper.includes("SCRIPTS SUGERIDOS") ||
    upper.includes("OBJETIVO:") ||
    upper.includes("PRIORIDAD FIFO") ||
    upper.includes("FRONT-END") ||
    upper.includes("BACKEND") ||
    upper.includes("IMPLEMENTACIÓN") ||
    upper.includes("IMPLEMENTACION");

  // If it looks like an internal policy dump, keep only the short customer-friendly
  // portion before the policy section.
  if (content.length > 900 && hasPolicyMarker && hasInternalOpsMarkers) {
    const idx = Math.max(upper.indexOf("POLÍTICA"), upper.indexOf("POLITICA"));
    if (idx > 0) {
      return content.slice(0, idx).trim();
    }
  }

  return content;
}

// Backwards-compatible alias
const sanitizeCustomerContent = sanitizeCustomerFacingContent;

// ═══════════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS (EXISTING)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Fetch messages from a conversation
 */
export async function fetchChatwootMessages({ accountId, conversationId, limit = 20 }) {
  if (!config.chatwoot.apiAccessToken) {
    throw new Error("CHATWOOT_API_ACCESS_TOKEN not configured");
  }
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) throw new Error("Chatwoot accountId missing");

  const url = buildUrl(effectiveAccountId, conversationId);
  const resp = await fetchWithTimeout(url, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "api_access_token": config.chatwoot.apiAccessToken,
    },
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Chatwoot fetch messages failed: ${resp.status} ${resp.statusText} ${text}`);
  }

  const json = await resp.json().catch(() => ({}));

  // Chatwoot can return { payload: [...] } or an array. Normalize to array.
  const arr = Array.isArray(json) ? json : (Array.isArray(json?.payload) ? json.payload : []);
  return arr.slice(-Math.max(1, Math.min(200, Number(limit) || 20)));
}

/**
 * Send a message to a conversation (visible to customer)
 */
export async function sendChatwootMessage({ accountId, conversationId, content, touchAfter = true }) {
  if (!config.chatwoot.apiAccessToken) {
    throw new Error("CHATWOOT_API_ACCESS_TOKEN not configured");
  }
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) throw new Error("Chatwoot accountId missing");

  const safeContent = sanitizeCustomerFacingContent(content);
  const url = buildUrl(effectiveAccountId, conversationId);

  logger.info({ accountId: effectiveAccountId, conversationId, contentLength: safeContent?.length }, "Chatwoot: sending message");

  const resp = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api_access_token": config.chatwoot.apiAccessToken,
    },
    body: JSON.stringify({
      content: safeContent,
      message_type: "outgoing",
      private: false,
      echo_id: `tania_${Date.now()}`,
    }),
  });

  const responseText = await resp.text();
  let responseJson = {};
  try {
    responseJson = JSON.parse(responseText);
  } catch (e) {
    // not JSON
  }

  if (!resp.ok) {
    logger.error({ status: resp.status, response: responseText }, "Chatwoot send failed");
    throw new Error(`Chatwoot send failed: ${resp.status} ${resp.statusText} ${responseText}`);
  }

  logger.info({ 
    status: resp.status, 
    messageId: responseJson?.id,
    messageType: responseJson?.message_type,
    senderType: responseJson?.sender?.type,
    senderName: responseJson?.sender?.name,
  }, "Chatwoot: message sent successfully");

  // Touch conversation to notify agents
  if (touchAfter && responseJson?.id) {
    await touchConversation({ accountId: effectiveAccountId, conversationId }).catch(() => null);
  }

  return responseJson;
}

/**
 * Toggle bot handoff - change conversation status
 */
export async function toggleBotHandoff({ accountId, conversationId, status = "open" }) {
  if (!config.chatwoot.apiAccessToken) return null;
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = buildConversationUrl(effectiveAccountId, conversationId) + "/toggle_status";

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({ status }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ status: resp.status, response: text }, "Chatwoot toggle_status failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    logger.info({ conversationId, newStatus: json?.status }, "Chatwoot: toggled status");
    return json;
  } catch (e) {
    logger.warn({ err: e?.message }, "Chatwoot toggle_status error");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// NEW FUNCTIONS - AGENT VISIBILITY & ASSIGNMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get conversation details including assignee info
 * Useful to check if an agent is already handling the conversation
 */
export async function getConversation({ accountId, conversationId }) {
  if (!config.chatwoot.apiAccessToken) return null;
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = buildConversationUrl(effectiveAccountId, conversationId);

  try {
    const resp = await fetchWithTimeout(url, {
      method: "GET",
      headers: {
        "api_access_token": config.chatwoot.apiAccessToken,
      },
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, status: resp.status, response: text }, "getConversation failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    return json;
  } catch (e) {
    logger.warn({ err: e?.message, conversationId }, "getConversation error");
    return null;
  }
}

/**
 * Assign conversation to a team
 * Use this for handoff to route to the correct CS team
 */
export async function assignToTeam({ accountId, conversationId, teamId }) {
  if (!config.chatwoot.apiAccessToken) return null;
  if (!teamId) {
    logger.warn({ conversationId }, "assignToTeam called without teamId");
    return null;
  }
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = `${buildConversationUrl(effectiveAccountId, conversationId)}/assignments`;

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({ team_id: teamId }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, teamId, status: resp.status, response: text }, "assignToTeam failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    logger.info({ conversationId, teamId, assignee: json?.assignee?.name }, "Assigned conversation to team");
    return json;
  } catch (e) {
    logger.warn({ err: e?.message, conversationId, teamId }, "assignToTeam error");
    return null;
  }
}

/**
 * Assign conversation to a specific agent
 */
export async function assignToAgent({ accountId, conversationId, agentId }) {
  if (!config.chatwoot.apiAccessToken) return null;
  if (!agentId) {
    logger.warn({ conversationId }, "assignToAgent called without agentId");
    return null;
  }
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = `${buildConversationUrl(effectiveAccountId, conversationId)}/assignments`;

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({ assignee_id: agentId }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, agentId, status: resp.status, response: text }, "assignToAgent failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    logger.info({ conversationId, agentId, assigneeName: json?.assignee?.name }, "Assigned conversation to agent");
    return json;
  } catch (e) {
    logger.warn({ err: e?.message, conversationId, agentId }, "assignToAgent error");
    return null;
  }
}

/**
 * Unassign conversation (remove current assignee)
 */
export async function unassignConversation({ accountId, conversationId }) {
  if (!config.chatwoot.apiAccessToken) return null;
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = `${buildConversationUrl(effectiveAccountId, conversationId)}/assignments`;

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({ assignee_id: null }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, status: resp.status, response: text }, "unassignConversation failed");
      return null;
    }

    logger.info({ conversationId }, "Unassigned conversation");
    return resp.json().catch(() => ({}));
  } catch (e) {
    logger.warn({ err: e?.message, conversationId }, "unassignConversation error");
    return null;
  }
}

/**
 * Send a private note (only visible to agents, NOT to customer)
 * Perfect for handoff context, internal notes, debugging info
 */
export async function sendPrivateNote({ accountId, conversationId, content }) {
  if (!config.chatwoot.apiAccessToken) return null;
  if (!content) {
    logger.warn({ conversationId }, "sendPrivateNote called without content");
    return null;
  }
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = buildUrl(effectiveAccountId, conversationId);

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({
        content,
        message_type: "outgoing",
        private: true, // ← KEY: Only agents see this
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, status: resp.status, response: text }, "sendPrivateNote failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    logger.info({ conversationId, messageId: json?.id, contentLength: content?.length }, "Sent private note to agents");
    return json;
  } catch (e) {
    logger.warn({ err: e?.message, conversationId }, "sendPrivateNote error");
    return null;
  }
}

/**
 * Touch conversation - update custom_attributes to force UI refresh for agents
 * Call this after sending bot messages so agents see updates in real-time
 */
export async function touchConversation({ accountId, conversationId }) {
  if (!config.chatwoot.apiAccessToken) return false;
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return false;

  const url = buildConversationUrl(effectiveAccountId, conversationId);

  try {
    const resp = await fetchWithTimeout(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({
        custom_attributes: {
          last_bot_reply_at: new Date().toISOString(),
          bot_active: true,
        },
      }),
    });

    if (!resp.ok) {
      // Non-fatal, just log
      logger.debug({ conversationId, status: resp.status }, "touchConversation failed (non-fatal)");
      return false;
    }

    return true;
  } catch (e) {
    // Non-fatal
    logger.debug({ err: e?.message, conversationId }, "touchConversation error (non-fatal)");
    return false;
  }
}

/**
 * Add labels to a conversation
 */
export async function addLabels({ accountId, conversationId, labels }) {
  if (!config.chatwoot.apiAccessToken) return null;
  if (!labels || !labels.length) return null;
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = `${buildConversationUrl(effectiveAccountId, conversationId)}/labels`;

  try {
    const resp = await fetchWithTimeout(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({ labels }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, labels, status: resp.status, response: text }, "addLabels failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    logger.info({ conversationId, labels }, "Added labels to conversation");
    return json;
  } catch (e) {
    logger.warn({ err: e?.message, conversationId, labels }, "addLabels error");
    return null;
  }
}

/**
 * Update conversation custom attributes
 */
export async function updateCustomAttributes({ accountId, conversationId, customAttributes }) {
  if (!config.chatwoot.apiAccessToken) return null;
  if (!customAttributes) return null;
  
  const effectiveAccountId = getEffectiveAccountId(accountId);
  if (!effectiveAccountId) return null;

  const url = buildConversationUrl(effectiveAccountId, conversationId);

  try {
    const resp = await fetchWithTimeout(url, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        "api_access_token": config.chatwoot.apiAccessToken,
      },
      body: JSON.stringify({
        custom_attributes: customAttributes,
      }),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      logger.warn({ conversationId, status: resp.status, response: text }, "updateCustomAttributes failed");
      return null;
    }

    const json = await resp.json().catch(() => ({}));
    logger.info({ conversationId, attributes: Object.keys(customAttributes) }, "Updated custom attributes");
    return json;
  } catch (e) {
    logger.warn({ err: e?.message, conversationId }, "updateCustomAttributes error");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  // Core
  fetchChatwootMessages,
  sendChatwootMessage,
  toggleBotHandoff,
  
  // Agent visibility & assignment
  getConversation,
  assignToTeam,
  assignToAgent,
  unassignConversation,
  sendPrivateNote,
  touchConversation,
  
  // Utilities
  addLabels,
  updateCustomAttributes,
  
  // Internal (for testing)
  sanitizeCustomerFacingContent,
  sanitizeCustomerContent,
};
