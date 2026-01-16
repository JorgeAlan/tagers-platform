/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ANA SUPER — SECURE ORDER MODIFY FLOW (Reschedule / Branch change)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Design principles:
 * 1) Sheet (Config Hub) defines PERMISSIONS.
 * 2) WooCommerce (via WP CS endpoints) defines PHYSICAL POSSIBILITY.
 * 3) Identity validation (best available signal) is REQUIRED before write.
 * 4) No write without explicit customer confirmation (two-phase commit).
 * 5) Always handle race conditions (stock can disappear between check and commit).
 *
 * NOTE:
 * - This module does NOT change Chatwoot payload formats.
 * - This module does NOT modify OpenAI configuration.
 */

import { logger } from "../utils/logger.js";
import { randomUUID } from "crypto";
import { csBuscarPedido, csConsultaDisponibilidad, csCambiarEntregaSafe } from "../integrations/wp_cs_client.js";
import { matchBranchFromText } from "../hitl/branch_registry.js";
import { matchDateFromText } from "../helpers/date_normalizer.js";
import { getOrderModifyPolicy } from "./order_modify_policy.js";
import { createHitlAdhocSearchRequestForChatwoot } from "../hitl/hitl_service.js";

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
      flow: "order_modify_secure",
      ...metadata,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature flag
// ─────────────────────────────────────────────────────────────────────────────

export function isSecureOrderModifyEnabled() {
  const v = String(process.env.ANA_SECURE_ORDER_MODIFY || process.env.ANA_ORDER_MODIFY_SECURE || "").trim().toLowerCase();
  return ["1", "true", "yes", "y", "on"].includes(v);
}

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
    /\b(cancelar|cancela|ya no|no quiero|olvidalo|olvidalo|dejalo|nada)\b/.test(t) ||
    /\b(adios|bye|chao|hasta luego)\b/.test(t)
  );
}

function detectsHuman(text) {
  const t = normalizeText(text);
  return /\b(humano|persona|agente|alguien|real|asesor|ejecutivo)\b/.test(t) || /\b(hablar con|pasame|comunicar)\b/.test(t);
}

function detectsConfirm(text) {
  const t = normalizeText(text);
  // Recommended explicit phrase to reduce accidental commits
  if (t.includes("confirmar cambio")) return true;
  // Allow a few short variants
  if (t === "confirmar" || t === "confirmo" || t === "si confirmo" || t === "sí confirmo") return true;
  return false;
}

function buildIdentity(contact) {
  const phone = contact?.phone_number || contact?.phone || null;
  const email = contact?.email || null;
  const name = contact?.name || null;
  // Future: support JWT coming from authenticated widget (custom attribute)
  const jwt = contact?.custom_attributes?.jwt || contact?.custom_attributes?.token || null;
  const jwt_sub = contact?.custom_attributes?.jwt_sub || contact?.custom_attributes?.sub || null;
  const customer_id = contact?.custom_attributes?.customer_id || contact?.custom_attributes?.woocommerce_customer_id || null;

  return {
    phone: phone ? String(phone) : null,
    email: email ? String(email) : null,
    name: name ? String(name) : null,
    jwt: jwt ? String(jwt) : null,
    jwt_sub: jwt_sub ? String(jwt_sub) : null,
    customer_id: customer_id ? String(customer_id) : null,
  };
}

function getOrderIdFromOrder(order) {
  return order?.id || order?.order_id || order?.number || null;
}

function getOrderStatus(order) {
  const s = order?.status || order?.estado || null;
  return s ? String(s).toLowerCase() : null;
}

function isPaidEnough(order) {
  // Best-effort heuristic (depends on Woo setup)
  const st = getOrderStatus(order);
  if (!st) return null;
  if (["pending", "failed", "cancelled", "refunded"].includes(st)) return false;
  // processing/completed/on-hold typically means payment captured or pending manual.
  if (["processing", "completed"].includes(st)) return true;
  return true;
}

function getOrderItems(order) {
  // Normalize possible shapes returned by WP endpoint
  const candidates = [order?.items, order?.line_items, order?.productos, order?.products];
  const arr = candidates.find(a => Array.isArray(a));
  if (!Array.isArray(arr)) return [];

  return arr
    .map((it) => {
      const quantity = Number.isFinite(Number(it?.quantity)) ? Number(it.quantity) : (Number.isFinite(Number(it?.qty)) ? Number(it.qty) : 1);
      return {
        name: it?.name || it?.nombre || it?.product_name || null,
        product_id: it?.product_id || it?.producto_id || null,
        product_key: it?.product_key || it?.key || null,
        variation_id: it?.variation_id || it?.wc_variation_id || null,
        quantity: quantity > 0 ? quantity : 1,
      };
    })
    .filter(x => x.name || x.product_id || x.product_key);
}

function resolveBranchFromTextOrContext({ text, csInfo, order }) {
  // 1) Try explicit text match (branch_registry)
  if (text) {
    const bh = matchBranchFromText(text);
    if (bh?.branch_id) {
      return { branch_id: bh.branch_id, confidence: bh.confidence ?? 0.7, source: "text" };
    }
  }

  // 2) Try to use order's branch if present
  const orderBranch = order?.branch_id || order?.sucursal_id || order?.sucursal || null;
  if (orderBranch) {
    return { branch_id: String(orderBranch), confidence: 0.8, source: "order" };
  }

  // 3) Use csInfo default/assistant hint
  const fallback = csInfo?.assistant?.routing?.default_branch_id || null;
  if (fallback) {
    return { branch_id: String(fallback), confidence: 0.5, source: "assistant" };
  }

  return { branch_id: null, confidence: 0, source: "none" };
}

function resolveDateFromText({ text, csInfo }) {
  const fechas = Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
  if (!text) return { fecha: null, match: null };
  if (fechas.length) {
    const match = matchDateFromText(text, fechas);
    if (match?.slug) return { fecha: String(match.slug), match };
    if (match?.fecha_iso) return { fecha: String(match.fecha_iso), match };
  }
  // Fallback: allow raw text but mark uncertain (WP may parse, but we prefer ISO)
  return { fecha: null, match: null };
}

async function fetchOrdersByPhone(phone) {
  if (!phone) return null;
  const r = await csBuscarPedido({ phone }).catch(() => null);
  if (!r || !r.success) return null;
  return Array.isArray(r.orders) ? r.orders : [];
}

async function fetchOwnedOrder({ phone, order_id }) {
  // Best-effort ownership check using phone lookup.
  // In the future, swap to JWT ownership check.
  if (!phone || !order_id) return { ok: false, reason: "missing_inputs" };

  // IMPORTANT SECURITY NOTE:
  // WordPress endpoint /buscar-pedido prioritizes order_id over phone when both are provided.
  // Therefore, we MUST NOT call it with { phone, order_id } as it would bypass ownership checks.
  // We only fetch by phone and filter locally.
  const orders = await fetchOrdersByPhone(phone);
  if (!orders) return { ok: false, reason: "phone_lookup_failed" };

  const found = orders.find(o => String(getOrderIdFromOrder(o)) === String(order_id)) || null;
  if (found) return { ok: true, order: found, orders };
  return { ok: false, reason: "not_found_for_phone", orders };
}

async function checkAvailabilityForItems({ items, fecha, branch_id }) {
  // For performance, stop at first failure.
  const results = [];

  for (const it of items) {
    const productoNombre = it.name || null;
    const productoId = it.product_id || null;
    const productoKey = it.product_key || null;
    const cantidad = it.quantity || 1;

    const disponibilidad = await csConsultaDisponibilidad({
      producto: productoNombre,
      producto_id: productoId,
      producto_key: productoKey,
      fecha,
      sucursal: branch_id,
      cantidad,
    }).catch(() => null);

    const ok = !!(disponibilidad?.success && disponibilidad?.disponible);
    results.push({ item: it, ok, disponibilidad });

    if (!ok) {
      return { ok: false, results };
    }
  }

  return { ok: true, results };
}

async function findAlternativeDates({ items, csInfo, branch_id, excludeDates = [] }) {
  const fechas = Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
  if (!fechas.length) return [];

  const exclude = new Set(excludeDates.map(String));
  const out = [];

  // Heuristic: try first 12 upcoming dates.
  for (const f of fechas.slice(0, 12)) {
    const fecha = f?.slug || f?.fecha_iso || null;
    if (!fecha) continue;
    if (exclude.has(String(fecha))) continue;

    const availability = await checkAvailabilityForItems({ items, fecha, branch_id });
    if (availability.ok) {
      out.push({ slug: String(fecha), nombre: f?.nombre || f?.label || String(fecha) });
      if (out.length >= 3) break;
    }
  }

  return out;
}

async function maybeEscalateToHITL({
  enabled,
  branch_id,
  accountId,
  conversationId,
  inboxId,
  inboxName,
  customer_text,
  staff_prompt,
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
      query_category: "order_modify",
      staff_prompt: staff_prompt || "Apoyar a cliente con modificación de pedido",
      chatwoot_context,
      customer_text: customer_text || "",
      object_description: null,
      options: ["CONTACTAR", "RESUELTO", "INFO"],
      comment_placeholder: "Anota acción tomada y/o siguiente paso.",
    });

    return { ok: true };
  } catch (e) {
    logger.warn({ err: e?.message || String(e) }, "HITL escalation failed (non-fatal)");
    return { ok: false, error: e?.message || String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export function createSecureOrderModifyState({ order_context }) {
  const oc = order_context || {};

  return {
    flow: "ORDER_MODIFY",
    secure: true,
    step: "INIT",
    started_at: Date.now(),
    draft: {
      order_id: typeof oc?.order_id === "number" ? oc.order_id : null,
      new_fecha_text: oc?.new_delivery_date_text ? String(oc.new_delivery_date_text) : null,
      new_sucursal_text: oc?.new_branch_text ? String(oc.new_branch_text) : null,
    },
    order: null,
    pending: null,
    options: {},
  };
}

export function makeSecureOrderModifyHandlers({ setFlow, clearFlow, sendChatwootMessage, hitlEnabled }) {
  if (typeof setFlow !== "function" || typeof clearFlow !== "function" || typeof sendChatwootMessage !== "function") {
    throw new Error("makeSecureOrderModifyHandlers: missing required deps");
  }

  async function advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    const identity = buildIdentity(contact);
    const phone = identity.phone;

    // Global escape routes
    if (detectsCancel(messageText)) {
      clearFlow(conversationId);
      await sendChatwootMessage({ accountId, conversationId, content: "De acuerdo, cancelé el cambio. Si necesitas otra cosa, aquí estoy." });
      return;
    }
    if (detectsHuman(messageText)) {
      // Try to escalate to HITL (HQ) if available
      await maybeEscalateToHITL({
        enabled: !!hitlEnabled,
        branch_id: "HQ",
        accountId,
        conversationId,
        inboxId,
        inboxName,
        customer_text: messageText,
        staff_prompt: "Cliente solicita apoyo humano para modificación de pedido",
      });

      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Claro. Te canalizo con el equipo para ayudarte con el cambio. Si me confirmas tu # de pedido y teléfono, avanzamos más rápido.",
      });
      return;
    }

    // 0) Policy gate (Sheet)
    const { effective, source } = getOrderModifyPolicy();

    if (!effective.allow_reschedule && !effective.allow_branch_change) {
      // Hard stop: permissions deny / unknown
      clearFlow(conversationId);

      const base = source === "fallback"
        ? "En este momento no puedo aplicar cambios automáticamente (modo contingencia)."
        : "Por política, en este momento no puedo aplicar cambios de fecha/sucursal automáticamente.";

      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `${base}\n\nSi quieres, te ayudo a canalizarlo con el equipo. ¿Me confirmas tu # de pedido?`,
      });
      return;
    }

    // 1) Resolve order id
    if (!state.draft.order_id) {
      // Try phone lookup first
      if (phone) {
        const orders = await fetchOrdersByPhone(phone);
        if (Array.isArray(orders) && orders.length === 1) {
          state.draft.order_id = getOrderIdFromOrder(orders[0]);
        } else if (Array.isArray(orders) && orders.length > 1) {
          state.step = "PICK_ORDER";
          state.options = { orders };
          setFlow(conversationId, state);
          const msg =
            "Encontré estos pedidos asociados a tu número. ¿Cuál quieres cambiar?\n" +
            formatNumberedList(orders, (o) => `#${getOrderIdFromOrder(o)} — ${o?.status || ""} — ${o?.total_display || ""}`);
          await sendChatwootMessage({ accountId, conversationId, content: msg + "\n\nResponde con el número de la lista o con el # de pedido." });
          return;
        }
      }

      state.step = "ASK_ORDER_ID";
      setFlow(conversationId, state);
      await sendChatwootMessage({ accountId, conversationId, content: "Para ayudarte a cambiarlo, ¿me compartes el número de pedido? (Ej. 1234)" });
      return;
    }

    // 2) Fetch order + ownership validation
    if (!state.order) {
      if (!phone) {
        // Without identity, we cannot safely validate ownership.
        state.step = "ASK_PHONE";
        setFlow(conversationId, state);
        await sendChatwootMessage({ accountId, conversationId, content: "Para validar que el pedido sea tuyo, ¿me confirmas el teléfono con el que lo registraste?" });
        return;
      }

      const owned = await fetchOwnedOrder({ phone, order_id: state.draft.order_id });

      if (!owned.ok) {
        logger.info({ conversationId, order_id: state.draft.order_id, reason: owned.reason }, "Order ownership validation failed");

        // If we have multiple orders for the phone, offer pick.
        if (Array.isArray(owned.orders) && owned.orders.length > 1) {
          state.step = "PICK_ORDER";
          state.options = { orders: owned.orders };
          state.draft.order_id = null;
          state.order = null;
          setFlow(conversationId, state);

          const msg =
            "Para cuidarte tu información, solo puedo modificar pedidos asociados a tu número.\n" +
            "Encontré estos pedidos asociados. ¿Cuál quieres cambiar?\n" +
            formatNumberedList(owned.orders, (o) => `#${getOrderIdFromOrder(o)} — ${o?.status || ""} — ${o?.total_display || ""}`);

          await sendChatwootMessage({ accountId, conversationId, content: msg + "\n\nResponde con el número de la lista." });
          return;
        }

        // Otherwise ask again for order id
        state.step = "ASK_ORDER_ID";
        state.draft.order_id = null;
        setFlow(conversationId, state);
        await sendChatwootMessage({
          accountId,
          conversationId,
          content:
            "No pude validar ese pedido con tu número. ¿Me confirmas el # de pedido correcto? (solo números)\n\nSi no lo tienes a la mano, dime tu teléfono y te ayudo a ubicarlo.",
        });
        return;
      }

      state.order = owned.order;
      setFlow(conversationId, state);
    }

    // 3) Payment policy (optional)
    if (effective.require_paid) {
      const paid = isPaidEnough(state.order);
      if (paid === false) {
        clearFlow(conversationId);
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Veo que el pedido aún no está confirmado/pagado. Para poder hacer cambios necesito que primero quede confirmado. Si quieres, te apoyo a revisarlo.",
        });
        return;
      }
    }

    // 4) Ask for changes if missing
    if (!state.draft.new_fecha_text && !state.draft.new_sucursal_text) {
      state.step = "ASK_CHANGES";
      setFlow(conversationId, state);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content:
          "¿Qué necesitas cambiar? Puedes decirme la nueva *fecha* y/o la nueva *sucursal*.\nEj: \"Para el 6 de enero en Sonata\".",
      });
      return;
    }

    // 5) Parse target date & branch
    const items = getOrderItems(state.order);
    if (!items.length) {
      // Not enough context to validate stock safely.
      await maybeEscalateToHITL({
        enabled: !!hitlEnabled,
        branch_id: "HQ",
        accountId,
        conversationId,
        inboxId,
        inboxName,
        customer_text: `Order #${state.draft.order_id} — No items found for stock validation.`,
        staff_prompt: "Revisar pedido para cambio de entrega (no se obtuvo detalle de items)",
      });

      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content:
          "Para hacer el cambio con seguridad necesito revisar los productos del pedido, y ahorita no pude obtener ese detalle automáticamente. Ya lo canalicé con el equipo para que lo ajusten.\n\n¿Me confirmas la nueva fecha y sucursal en un solo mensaje?",
      });
      return;
    }

    // Branch
    const branchText = state.draft.new_sucursal_text;
    const branch = resolveBranchFromTextOrContext({ text: branchText, csInfo, order: state.order });

    // If user explicitly requested a branch change but policy forbids it.
    if (branchText && branch.branch_id && !effective.allow_branch_change) {
      state.draft.new_sucursal_text = null;
      state.step = "ASK_CHANGES";
      setFlow(conversationId, state);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content:
          "Por política, por ahora solo puedo ayudarte a cambiar la *fecha* (la sucursal se mantiene).\n\n¿Para qué fecha quieres tu pedido? (Ej: 6 de enero)",
      });
      return;
    }

    // Date
    const dateText = state.draft.new_fecha_text;
    const { fecha } = resolveDateFromText({ text: dateText, csInfo });

    if (dateText && !fecha) {
      // Ask for a valid date from list if we have it.
      const fechas = Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
      const shortList = fechas.slice(0, 8);
      const listText = shortList.length
        ? "\n\nOpciones:\n" + formatNumberedList(shortList, (f) => f?.nombre || f?.label || f?.slug || f?.fecha_iso)
        : "";

      state.step = "ASK_DATE";
      setFlow(conversationId, state);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "No logré identificar la fecha exacta. ¿Me dices el día? (Ej: '6 de enero')" + listText,
      });
      return;
    }

    // If reschedule not allowed but user requested date change
    if (fecha && !effective.allow_reschedule) {
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Por política, por ahora no puedo cambiar la fecha de entrega automáticamente. Si quieres, te canalizo con el equipo para revisarlo."
      });
      return;
    }

    // 6) Two-phase commit
    // 6a) If we already have a pending request, allow updating it with new message
    const now = Date.now();
    const pendingTtlMs = Math.max(30_000, (effective.confirmation_ttl_seconds || 300) * 1000);

    if (state.pending && (now - state.pending.created_at) > pendingTtlMs) {
      // Pending expired -> clear
      state.pending = null;
    }

    // 6b) Pre-check stock
    await sendChatwootMessage({ accountId, conversationId, content: "Dame un momento, valido disponibilidad para el cambio..." });

    const availability = await checkAvailabilityForItems({ items, fecha, branch_id: branch.branch_id });

    if (!availability.ok) {
      const alternatives = await findAlternativeDates({ items, csInfo, branch_id: branch.branch_id, excludeDates: [fecha] });

      state.pending = null;
      state.step = "ASK_CHANGES";
      state.draft.new_fecha_text = null;
      setFlow(conversationId, state);

      let msg = `En este momento ya no veo disponibilidad para *${fecha}* en *${branch.branch_id || "esa sucursal"}*.`;
      if (alternatives.length) {
        msg += "\n\nPuedo ofrecerte estas fechas con disponibilidad:";
        msg += "\n" + formatNumberedList(alternatives, (f) => f.nombre || f.slug);
        msg += "\n\nRespóndeme con el número de la lista o con la fecha exacta.";
      } else {
        msg += "\n\n¿Quieres que revisemos otra fecha?";
      }

      await sendChatwootMessage({ accountId, conversationId, content: msg });
      return;
    }

    // 6c) Ask confirm (store pending)
    state.pending = {
      created_at: now,
      order_id: state.draft.order_id,
      fecha,
      branch_id: branch.branch_id,
      // Unique per commit attempt. Used end-to-end (Node → WP) to avoid
      // double-writes due to webhook retries.
      idempotency_key: randomUUID(),
    };

    state.step = "AWAIT_CONFIRM";
    setFlow(conversationId, state);

    const summaryLines = [];
    summaryLines.push(`Pedido: #${state.draft.order_id}`);
    summaryLines.push(`Nueva fecha: ${fecha}`);
    if (branch.branch_id) summaryLines.push(`Sucursal: ${branch.branch_id}`);

    await sendChatwootMessage({
      accountId,
      conversationId,
      content:
        "Listo. En este momento veo disponibilidad para *intentar* el cambio (la confirmación final ocurre al aplicarlo en el sistema):\n" +
        summaryLines.map(l => `- ${l}`).join("\n") +
        "\n\nPara aplicarlo, responde: *CONFIRMAR CAMBIO*\n" +
        "Si quieres ajustar algo (otra fecha o sucursal), dímelo y lo reviso.",
    });
  }

  async function _handleInternal({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    // Cancel / human request always wins
    if (detectsCancel(messageText)) {
      clearFlow(conversationId);
      await sendChatwootMessage({ accountId, conversationId, content: "De acuerdo, cancelé el cambio. Si necesitas algo más, aquí estoy." });
      return true;
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
        staff_prompt: "Cliente solicita apoyo humano para modificación de pedido",
      });

      clearFlow(conversationId);
      await sendChatwootMessage({ accountId, conversationId, content: "Claro. Te canalizo con el equipo para ayudarte con el cambio." });
      return true;
    }

    if (state.step === "PICK_ORDER") {
      const orders = state.options?.orders || [];
      let order = pickByNumber(messageText, orders);
      if (!order) {
        const maybeId = parseIntSafe(messageText);
        if (maybeId) order = orders.find(o => String(getOrderIdFromOrder(o)) === String(maybeId)) || null;
      }
      if (!order) {
        await sendChatwootMessage({ accountId, conversationId, content: "No identifiqué cuál. ¿Me dices el número de la lista o el # de pedido?" });
        return true;
      }

      state.draft.order_id = getOrderIdFromOrder(order);
      state.order = order; // We already have it
      state.options = {};
      state.step = "ASK_CHANGES";
      setFlow(conversationId, state);
      await advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }

    if (state.step === "ASK_ORDER_ID") {
      const maybeId = parseIntSafe(messageText);
      if (!maybeId) {
        await sendChatwootMessage({ accountId, conversationId, content: "¿Me compartes el # de pedido? (solo números)" });
        return true;
      }
      state.draft.order_id = maybeId;
      state.order = null;
      state.options = {};
      setFlow(conversationId, state);
      await advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }

    if (state.step === "ASK_PHONE") {
      // Best-effort: treat the message as the phone, but also allow continuing if contact already has it.
      const digits = String(messageText || "").replace(/\D/g, "");
      if (digits.length < 8) {
        await sendChatwootMessage({ accountId, conversationId, content: "¿Me confirmas tu teléfono completo (solo números)?" });
        return true;
      }
      // We cannot mutate Chatwoot contact, but we can stash in state.
      state.draft.phone_override = digits;
      setFlow(conversationId, state);
      await advance({ state, assistant, csInfo, accountId, conversationId, contact: { ...contact, phone_number: digits }, messageText, inboxId, inboxName });
      return true;
    }

    if (state.step === "ASK_DATE") {
      state.draft.new_fecha_text = messageText;
      setFlow(conversationId, state);
      await advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }

    if (state.step === "ASK_CHANGES") {
      // Store raw text; parsing happens in advance()
      state.draft.new_fecha_text = state.draft.new_fecha_text || messageText;
      state.draft.new_sucursal_text = state.draft.new_sucursal_text || messageText;
      setFlow(conversationId, state);
      await advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }

    if (state.step === "AWAIT_CONFIRM") {
      if (detectsConfirm(messageText)) {
        // Execute write
        const pending = state.pending;
        if (!pending?.order_id || !pending?.fecha) {
          state.pending = null;
          state.step = "ASK_CHANGES";
          setFlow(conversationId, state);
          await sendChatwootMessage({ accountId, conversationId, content: "Se me perdió el contexto del cambio. ¿Me repites la nueva fecha y sucursal?" });
          return true;
        }

        await sendChatwootMessage({ accountId, conversationId, content: "Perfecto. Aplico el cambio..." });

        // Attempt the update (Woo has the final word).
        // Defense-in-depth: provide customer identity so the WP endpoint
        // can validate order ownership server-side.
        const identity = buildIdentity(contact);
        const customerPhone = state?.draft?.phone_override || identity.phone || null;

        const r = await csCambiarEntregaSafe({
          order_id: pending.order_id,
          nueva_fecha: pending.fecha,
          nueva_sucursal: pending.branch_id || undefined,
          // Ownership proof (server-side validation)
          customer_phone: customerPhone || undefined,
          customer_email: identity.email || undefined,
          // Idempotency to protect against webhook retries
          idempotency_key: pending.idempotency_key || undefined,
        }).catch((e) => ({
          success: false,
          http_status: 0,
          error_code: "network_error",
          mensaje: String(e?.message || e || "network_error"),
        }));

        if (!r || !r.success) {
          // Authorization / ownership failure: escalate instead of looping.
          if (r?.http_status === 403 || r?.error_code === "forbidden") {
            await maybeEscalateToHITL({
              enabled: !!hitlEnabled,
              branch_id: pending.branch_id || "HQ",
              accountId,
              conversationId,
              inboxId,
              inboxName,
              customer_text: `Order #${pending.order_id} — attempted reschedule to ${pending.fecha} (${pending.branch_id || ""}). Authorization failed.`,
              staff_prompt: "Validar identidad/propiedad de pedido y apoyar cambio solicitado por cliente",
            });

            state.pending = null;
            state.step = "ASK_CHANGES";
            setFlow(conversationId, state);

            await sendChatwootMessage({
              accountId,
              conversationId,
              content:
                "Por seguridad, no pude validar que este pedido te pertenezca para aplicar el cambio automáticamente. Ya lo canalicé con el equipo para que te apoyen.\n\nSi me confirmas el teléfono y/o correo con el que registraste el pedido, lo resolvemos más rápido.",
            });
            return true;
          }

          // Race condition or validation failure. Provide honest explanation + alternatives.
          const items = state.order ? getOrderItems(state.order) : [];
          const alternatives = items.length
            ? await findAlternativeDates({ items, csInfo, branch_id: pending.branch_id, excludeDates: [pending.fecha] })
            : [];

          state.pending = null;
          state.step = "ASK_CHANGES";
          state.draft.new_fecha_text = null;
          setFlow(conversationId, state);

          let msg =
            "Acabo de intentar aplicar el cambio, pero en este instante ya no fue posible confirmarlo (la disponibilidad cambió en tiempo real).";

          if (alternatives.length) {
            msg += "\n\nPuedo ofrecerte estas fechas con disponibilidad:";
            msg += "\n" + formatNumberedList(alternatives, (f) => f.nombre || f.slug);
            msg += "\n\nRespóndeme con el número o la fecha exacta.";
          } else {
            msg += "\n\n¿Quieres que revisemos otra fecha?";
          }

          // Include WP message if short and safe
          const wpMsg = r?.mensaje ? String(r.mensaje) : null;
          if (wpMsg && wpMsg.length < 140) {
            msg += `\n\nDetalle: ${wpMsg}`;
          }

          await sendChatwootMessage({ accountId, conversationId, content: msg });
          return true;
        }

        // Success
        const changedItems = Array.isArray(r.changed_items)
          ? r.changed_items.length
          : (Number.isFinite(Number(r.items_cambiados)) ? Number(r.items_cambiados) : 0);

        let msg = `Listo. Apliqué el cambio al pedido #${pending.order_id}.`;
        if (changedItems) msg += `\nProductos actualizados: ${changedItems}.`;
        msg += "\n\nSi necesitas algo más, aquí estoy.";

        await sendChatwootMessage({ accountId, conversationId, content: msg });
        clearFlow(conversationId);
        return true;
      }

      // Not a confirmation: treat as change request update
      state.pending = null;
      state.draft.new_fecha_text = messageText;
      state.draft.new_sucursal_text = messageText;
      state.step = "ASK_CHANGES";
      setFlow(conversationId, state);
      await advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return true;
    }

    // Default: keep advancing
    await advance({ state, assistant, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
    return true;
  }
  
  // Wrapped version with LangSmith tracing
  async function handle(params) {
    const { conversationId, state } = params;
    const traced = wrapWithTrace(
      _handleInternal,
      "secure-flow/order-modify",
      {
        conversation_id: String(conversationId),
        step: state?.step || "unknown",
        task: "order_modify_flow",
      }
    );
    return traced(params);
  }

  return {
    advanceOrderModifySecureFlow: advance,
    handleOrderModifySecureFlow: handle,
  };
}

export default {
  isSecureOrderModifyEnabled,
  createSecureOrderModifyState,
  makeSecureOrderModifyHandlers,
};
