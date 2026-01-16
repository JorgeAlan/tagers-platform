/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAN • IA — SECURE ORDER STATUS FLOW (Consulta de pedidos)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Este flujo es principalmente READ, pero usa el patrón seguro para:
 * - Consistencia con otros flujos
 * - Verificación de ownership (cuando aplica)
 * - Manejo uniforme de escape routes
 * - Logging estructurado
 *
 * Flow steps:
 * INIT → RESOLVE_ORDER → VERIFY_OWNERSHIP → SHOW_STATUS → DONE
 *       ↓
 *     ASK_ORDER_ID (si no tenemos ID)
 *     PICK_ORDER (si hay múltiples)
 */

import { logger } from "../../utils/logger.js";
import { csBuscarPedido } from "../../integrations/wp_cs_client.js";
import { createHitlAdhocSearchRequestForChatwoot } from "../../hitl/hitl_service.js";

// ═══════════════════════════════════════════════════════════════════════════
// LANGSMITH TRACING
// ═══════════════════════════════════════════════════════════════════════════
import { traceable } from "langsmith/traceable";

function isLangSmithEnabled() {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY;
}

function wrapWithTrace(fn, name, metadata = {}) {
  if (!isLangSmithEnabled()) {
    return fn;
  }
  return traceable(fn, {
    name,
    run_type: "chain",
    metadata: {
      service: "tagers-kiss-api",
      flow: "order_status_secure",
      ...metadata,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow steps enum
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_STATUS_STEPS = {
  INIT: "INIT",
  RESOLVE_ORDER: "RESOLVE_ORDER",
  ASK_ORDER_ID: "ASK_ORDER_ID",
  PICK_ORDER: "PICK_ORDER",
  VERIFY_OWNERSHIP: "VERIFY_OWNERSHIP",
  SHOW_STATUS: "SHOW_STATUS",
  OFFER_ACTIONS: "OFFER_ACTIONS",
  DONE: "DONE",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (pure)
// ─────────────────────────────────────────────────────────────────────────────

function parseIntSafe(v) {
  const n = parseInt(String(v || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

function pickByNumber(text, list) {
  const n = parseIntSafe(text);
  if (!n || !Array.isArray(list)) return null;
  if (n < 1 || n > list.length) return null;
  return list[n - 1] || null;
}

function formatNumberedList(items, renderFn) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map((it, idx) => {
      const line = renderFn ? renderFn(it) : String(it);
      return `${idx + 1}. ${line}`;
    })
    .join("\n");
}

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function detectsCancel(text) {
  const t = normalizeText(text);
  return (
    /\b(cancelar|cancela|ya no|no quiero|olvidalo|dejalo|nada)\b/.test(t) ||
    /\b(adios|bye|chao|hasta luego)\b/.test(t)
  );
}

function detectsHuman(text) {
  const t = normalizeText(text);
  return /\b(humano|persona|agente|alguien|real|asesor|ejecutivo)\b/.test(t) || /\b(hablar con|pasame|comunicar)\b/.test(t);
}

function detectsModify(text) {
  const t = normalizeText(text);
  return /\b(cambiar|modificar|mover|reagendar)\b/.test(t);
}

function getOrderId(order) {
  return order?.id || order?.order_id || order?.number || null;
}

function getOrderStatus(order) {
  return order?.status || order?.estado || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Order lookup helpers
// ─────────────────────────────────────────────────────────────────────────────

async function fetchOrderById(orderId) {
  if (!orderId) return null;
  
  try {
    const r = await csBuscarPedido({ order_id: orderId });
    if (!r || !r.success) return null;
    
    const orders = Array.isArray(r.orders) ? r.orders : [];
    return orders.length > 0 ? orders[0] : null;
  } catch (e) {
    logger.warn({ err: e?.message || String(e), orderId }, "fetchOrderById failed");
    return null;
  }
}

async function fetchOrdersByPhone(phone) {
  if (!phone) return [];
  
  try {
    const r = await csBuscarPedido({ phone });
    if (!r || !r.success) return [];
    return Array.isArray(r.orders) ? r.orders : [];
  } catch (e) {
    logger.warn({ err: e?.message || String(e), phone }, "fetchOrdersByPhone failed");
    return [];
  }
}

async function fetchOrdersByEmail(email) {
  if (!email) return [];
  
  try {
    const r = await csBuscarPedido({ email });
    if (!r || !r.success) return [];
    return Array.isArray(r.orders) ? r.orders : [];
  } catch (e) {
    logger.warn({ err: e?.message || String(e), email }, "fetchOrdersByEmail failed");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Format order status message
// ─────────────────────────────────────────────────────────────────────────────

function formatOrderStatusMessage(order) {
  if (!order) return "No encontré información de ese pedido.";
  
  const id = getOrderId(order);
  const status = getOrderStatus(order);
  const statusDisplay = formatStatusDisplay(status);
  const total = order.total_display || order.total || null;
  const created = order.date_created || order.fecha_creacion || null;
  const deliveryDate = order.delivery_date || order.fecha_entrega || null;
  const branch = order.branch_name || order.sucursal || order.sucursal_nombre || null;
  const items = Array.isArray(order.items) ? order.items : (Array.isArray(order.line_items) ? order.line_items : []);
  
  let msg = `📦 **Pedido #${id}**\n`;
  msg += `Estado: ${statusDisplay}\n`;
  
  if (created) msg += `Fecha de pedido: ${formatDate(created)}\n`;
  if (deliveryDate) msg += `📅 Fecha de entrega: ${formatDate(deliveryDate)}\n`;
  if (branch) msg += `📍 Sucursal: ${branch}\n`;
  if (total) msg += `💰 Total: ${total}\n`;
  
  if (items.length > 0) {
    msg += `\n**Productos:**\n`;
    items.forEach(item => {
      const name = item.name || item.nombre || "Producto";
      const qty = item.quantity || item.cantidad || 1;
      msg += `• ${name} × ${qty}\n`;
    });
  }
  
  return msg;
}

function formatStatusDisplay(status) {
  if (!status) return "Desconocido";
  
  const statusMap = {
    "pending": "⏳ Pendiente de pago",
    "processing": "🔄 En proceso",
    "on-hold": "⏸️ En espera",
    "completed": "✅ Completado",
    "cancelled": "❌ Cancelado",
    "refunded": "💸 Reembolsado",
    "failed": "⚠️ Fallido",
    "pagado": "✅ Pagado",
    "preparando": "🔄 Preparando",
    "listo": "📦 Listo para recoger",
    "entregado": "✅ Entregado",
  };
  
  const normalized = String(status).toLowerCase();
  return statusMap[normalized] || status;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    return date.toLocaleDateString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "America/Mexico_City",
    });
  } catch {
    return dateStr;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HITL escalation
// ─────────────────────────────────────────────────────────────────────────────

async function maybeEscalateToHITL({
  enabled,
  branch_id,
  accountId,
  conversationId,
  inboxId,
  inboxName,
  customer_text,
  staff_prompt,
  order_id,
}) {
  if (!enabled) return null;
  
  try {
    const chatwoot_context = {
      account_id: accountId,
      conversation_id: conversationId,
      inbox_id: inboxId || null,
      inbox_name: inboxName || null,
    };

    await createHitlAdhocSearchRequestForChatwoot({
      branch_id: branch_id || "HQ",
      query_category: "order_status",
      staff_prompt: staff_prompt || "Apoyar a cliente con consulta de pedido",
      chatwoot_context,
      customer_text: customer_text || "",
      object_description: order_id ? `Pedido #${order_id}` : null,
      options: ["CONTACTAR", "RESUELTO", "INFO"],
      comment_placeholder: "Anota acción tomada.",
    });

    return { ok: true };
  } catch (e) {
    logger.warn({ err: e?.message || String(e) }, "HITL escalation failed (non-fatal)");
    return { ok: false, error: e?.message || String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// State factory
// ─────────────────────────────────────────────────────────────────────────────

export function createOrderStatusState({ order_context }) {
  const oc = order_context || {};
  
  return {
    flow: "ORDER_STATUS",
    secure: true,
    step: ORDER_STATUS_STEPS.INIT,
    started_at: Date.now(),
    draft: {
      order_id: oc.order_id || null,
    },
    // Cached order data
    order: null,
    // Options for selection
    options: {},
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handlers factory
// ─────────────────────────────────────────────────────────────────────────────

export function makeOrderStatusHandlers({ setFlow, clearFlow, sendChatwootMessage, hitlEnabled }) {
  if (typeof setFlow !== "function" || typeof clearFlow !== "function" || typeof sendChatwootMessage !== "function") {
    throw new Error("makeOrderStatusHandlers: missing required deps");
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ADVANCE: Main state machine logic
  // ─────────────────────────────────────────────────────────────────────────
  
  async function advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    const d = state.draft;
    const phone = contact?.phone_number || contact?.phone || null;
    const email = contact?.email || null;
    
    // ─────────────────────────────────────────────────────────────────────
    // Global escape routes
    // ─────────────────────────────────────────────────────────────────────
    
    if (detectsCancel(messageText)) {
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "De acuerdo. Si necesitas algo más, aquí estoy.",
      });
      return;
    }
    
    if (detectsHuman(messageText)) {
      await maybeEscalateToHITL({
        enabled: !!hitlEnabled,
        branch_id: "HQ",
        accountId,
        conversationId,
        inboxId,
        inboxName,
        customer_text: messageText,
        staff_prompt: "Cliente solicita apoyo humano para consulta de pedido",
        order_id: d.order_id,
      });
      
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Claro. Te canalizo con el equipo para ayudarte.",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: INIT - Try to resolve order
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_STATUS_STEPS.INIT) {
      // If we have order_id, fetch it directly
      if (d.order_id) {
        const order = await fetchOrderById(d.order_id);
        
        if (order) {
          state.order = order;
          state.step = ORDER_STATUS_STEPS.SHOW_STATUS;
          setFlow(conversationId, state);
          await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
          return;
        }
        
        // Order not found
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: `No encontré el pedido #${d.order_id}. ¿Me confirmas el número?`,
        });
        
        d.order_id = null;
        state.step = ORDER_STATUS_STEPS.ASK_ORDER_ID;
        setFlow(conversationId, state);
        return;
      }
      
      // Try phone lookup
      if (phone) {
        const orders = await fetchOrdersByPhone(phone);
        
        if (orders.length === 1) {
          // Single order found - show it directly
          state.order = orders[0];
          state.step = ORDER_STATUS_STEPS.SHOW_STATUS;
          setFlow(conversationId, state);
          await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
          return;
        }
        
        if (orders.length > 1) {
          // Multiple orders - ask which one
          state.options.orders = orders;
          state.step = ORDER_STATUS_STEPS.PICK_ORDER;
          setFlow(conversationId, state);
          await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
          return;
        }
      }
      
      // Try email lookup
      if (email && !phone) {
        const orders = await fetchOrdersByEmail(email);
        
        if (orders.length === 1) {
          state.order = orders[0];
          state.step = ORDER_STATUS_STEPS.SHOW_STATUS;
          setFlow(conversationId, state);
          await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
          return;
        }
        
        if (orders.length > 1) {
          state.options.orders = orders;
          state.step = ORDER_STATUS_STEPS.PICK_ORDER;
          setFlow(conversationId, state);
          await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
          return;
        }
      }
      
      // No order found, ask for ID
      state.step = ORDER_STATUS_STEPS.ASK_ORDER_ID;
      setFlow(conversationId, state);
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "¿Me compartes el número de pedido? (Ej. 1234)",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_ORDER_ID
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_STATUS_STEPS.ASK_ORDER_ID) {
      // This is a prompt step - transition happens in handle()
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "¿Me compartes el número de pedido? (Ej. 1234)",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: PICK_ORDER - Show list of orders
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_STATUS_STEPS.PICK_ORDER) {
      const orders = state.options.orders || [];
      
      if (orders.length === 0) {
        state.step = ORDER_STATUS_STEPS.ASK_ORDER_ID;
        setFlow(conversationId, state);
        await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      const orderList = formatNumberedList(orders, o => {
        const id = getOrderId(o);
        const status = formatStatusDisplay(getOrderStatus(o));
        const total = o.total_display || o.total || "";
        return `#${id} — ${status}${total ? ` — ${total}` : ""}`;
      });
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `Encontré estos pedidos:\n\n${orderList}\n\n¿Cuál quieres consultar? (Responde con el número)`,
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: SHOW_STATUS - Display order info
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_STATUS_STEPS.SHOW_STATUS) {
      const order = state.order;
      
      if (!order) {
        state.step = ORDER_STATUS_STEPS.ASK_ORDER_ID;
        setFlow(conversationId, state);
        await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      const statusMsg = formatOrderStatusMessage(order);
      const orderId = getOrderId(order);
      
      // Show status and offer next actions
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: statusMsg + `\n\n¿Necesitas algo más? Puedo ayudarte a:\n• Cambiar fecha o sucursal (dime "quiero cambiar mi pedido")\n• Consultar otro pedido`,
      });
      
      // Flow complete
      clearFlow(conversationId);
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Default: unknown step
    // ─────────────────────────────────────────────────────────────────────
    
    logger.warn({ step: state.step, conversationId }, "Unknown ORDER_STATUS step, resetting");
    state.step = ORDER_STATUS_STEPS.INIT;
    setFlow(conversationId, state);
    await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLE: Entry point from chatwoot.js (processes user response)
  // ─────────────────────────────────────────────────────────────────────────
  
  async function _handleInternal({ state, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    
    // Handle response to PICK_ORDER
    if (state.step === ORDER_STATUS_STEPS.PICK_ORDER) {
      const orders = state.options.orders || [];
      
      // Try by number selection
      let order = pickByNumber(messageText, orders);
      
      // Try by order ID match
      if (!order) {
        const maybeId = parseIntSafe(messageText);
        if (maybeId) {
          order = orders.find(o => getOrderId(o) === maybeId) || null;
        }
      }
      
      if (!order) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No identifiqué cuál. ¿Me dices el número de la lista o el # de pedido?",
        });
        return true;
      }
      
      state.order = order;
      state.options = {};
      state.step = ORDER_STATUS_STEPS.SHOW_STATUS;
      setFlow(conversationId, state);
      
      await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }
    
    // Handle response to ASK_ORDER_ID
    if (state.step === ORDER_STATUS_STEPS.ASK_ORDER_ID) {
      const maybeId = parseIntSafe(messageText);
      
      if (!maybeId) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "¿Me compartes el número de pedido? (solo números)",
        });
        return true;
      }
      
      state.draft.order_id = maybeId;
      state.step = ORDER_STATUS_STEPS.INIT;
      setFlow(conversationId, state);
      
      await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }
    
    // Check for intent to modify order
    if (detectsModify(messageText) && state.order) {
      const orderId = getOrderId(state.order);
      clearFlow(conversationId);
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `Entendido. Para cambiar el pedido #${orderId}, dime qué necesitas modificar: ¿fecha, sucursal o ambos?`,
      });
      
      // Note: This would trigger ORDER_MODIFY flow in the next message
      return true;
    }
    
    // Default: advance the flow
    await advance({ state, accountId, conversationId, contact, messageText, inboxId, inboxName });
    return true;
  }
  
  // Wrapped version with LangSmith tracing
  async function handle(params) {
    const { conversationId, state } = params;
    const traced = wrapWithTrace(
      _handleInternal,
      "secure-flow/order-status",
      {
        conversation_id: String(conversationId),
        step: state?.step || "unknown",
        task: "order_status_flow",
      }
    );
    return traced(params);
  }

  return {
    advanceOrderStatusFlow: advance,
    handleOrderStatusFlow: handle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createOrderStatusState,
  makeOrderStatusHandlers,
  ORDER_STATUS_STEPS,
};
