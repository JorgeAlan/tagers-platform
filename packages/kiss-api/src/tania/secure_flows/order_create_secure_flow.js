/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAN • IA — SECURE ORDER CREATE FLOW v2.0 (CORREGIDO)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * CORRECCIONES APLICADAS:
 * ✅ BUG #1: variation_id ahora se guarda al agregar items al carrito
 * ✅ BUG #2: variation_id se pasa al generar link de checkout
 * ✅ BUG #3: Integración con reglas de temporada (season-rules.js)
 * ✅ BUG #4: Manejo de fechas SOLO_POS (5-6 enero)
 * ✅ BUG #5: Notas privadas para visibilidad de agentes
 *
 * Design principles:
 * 1) Sheet (Config Hub) defines PERMISSIONS, PRODUCTS, and SEASON RULES.
 * 2) WooCommerce (via WP CS endpoints) defines PHYSICAL AVAILABILITY.
 * 3) No checkout link without explicit customer confirmation (two-phase commit).
 * 4) Always handle race conditions (stock can disappear between check and commit).
 * 5) Tool gating by step (only expose relevant actions per state).
 * 6) Respect season rules for date validation.
 *
 * Flow steps:
 * INIT → ASK_PRODUCT → ASK_BRANCH → ASK_DATE → ASK_QTY → ASK_ADD_MORE → CONFIRM → GENERATE_LINK → DONE
 */

import { logger } from "../../utils/logger.js";
import { randomUUID } from "crypto";
import { csConsultaDisponibilidad, csGenerarLinkCompra } from "../../integrations/wp_cs_client.js";
import { matchBranchFromText, listBranches } from "../../hitl/branch_registry.js";
import { matchDateFromText } from "../../helpers/date_normalizer.js";
import { getConfig as getConfigHub } from "../../config-hub/sync-service.js";
import { createHitlAdhocSearchRequestForChatwoot } from "../../hitl/hitl_service.js";

// ═══════════════════════════════════════════════════════════════════════════
// SEASON RULES INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════
import { 
  validateOrderDate, 
  checkDateAvailability,
  getBotMessageForRule,
  getBranchesForDateSuggestion,
  RULE_TYPES,
} from "../../season/season-rules.js";

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
      flow: "order_create_secure",
      ...metadata,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow steps enum
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_CREATE_STEPS = {
  INIT: "INIT",
  ASK_PRODUCT: "ASK_PRODUCT",
  ASK_BRANCH: "ASK_BRANCH",
  ASK_DATE: "ASK_DATE",
  ASK_QTY: "ASK_QTY",
  ASK_ADD_MORE: "ASK_ADD_MORE",
  CONFIRM_CART: "CONFIRM_CART",
  GENERATE_LINK: "GENERATE_LINK",
  DONE: "DONE",
  // Special states
  PICK_PRODUCT: "PICK_PRODUCT",
  PICK_BRANCH: "PICK_BRANCH",
  PICK_DATE: "PICK_DATE",
  ESCAPE_MENU: "ESCAPE_MENU",
  // NEW: Estados para fechas bloqueadas
  DATE_BLOCKED_INFO: "DATE_BLOCKED_INFO",
  SUGGEST_BRANCH: "SUGGEST_BRANCH",
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

function detectsConfirm(text) {
  const t = normalizeText(text);
  if (t.includes("confirmar pedido") || t.includes("generar link") || t.includes("genera el link")) return true;
  if (t === "confirmar" || t === "confirmo" || t === "si" || t === "sí" || t === "dale" || t === "ok") return true;
  return false;
}

function detectsAddMore(text) {
  const t = normalizeText(text);
  if (/\b(agregar|otra|otro|mas|más|adicional)\b/.test(t)) return true;
  return false;
}

function detectsNoMore(text) {
  const t = normalizeText(text);
  if (/\b(no|es todo|solo eso|nada mas|ya|listo)\b/.test(t)) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Policy helpers
// ─────────────────────────────────────────────────────────────────────────────

function getOrderCreatePolicy() {
  try {
    const hub = getConfigHub();
    const policy = hub?.order_policy || hub?.pedidos_policy || {};
    
    return {
      enabled: policy.enabled !== false,
      require_availability_check: policy.require_availability_check !== false,
      max_items_per_order: policy.max_items_per_order || 10,
      max_quantity_per_item: policy.max_quantity_per_item || 50,
      allow_multiple_dates: policy.allow_multiple_dates === true,
      single_delivery_context: policy.single_delivery_context !== false,
      source: "config_hub",
    };
  } catch {
    return {
      enabled: true,
      require_availability_check: true,
      max_items_per_order: 10,
      max_quantity_per_item: 50,
      allow_multiple_dates: false,
      single_delivery_context: true,
      source: "fallback",
    };
  }
}

function getAvailableProducts() {
  try {
    const hub = getConfigHub();
    const roscas = hub?.roscas || [];
    return roscas
      .filter(r => r.enabled && r.available)
      .map((r, idx) => ({
        key: r.sku || r.product_id || `rosca-${idx + 1}`,
        name: r.name,
        price: r.price,
        wc_product_id: r.product_id,
        description: r.description || null,
        category: r.category || 'roscas',
      }));
  } catch {
    return [];
  }
}

function getAvailableBranches() {
  try {
    const branches = listBranches();
    return branches.filter(b => b.enabled !== false);
  } catch {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Availability check (CORREGIDO: ahora retorna variation_id)
// ─────────────────────────────────────────────────────────────────────────────

async function checkItemAvailability({ product, fecha, branch, quantity }) {
  try {
    const result = await csConsultaDisponibilidad({
      producto: product.name,
      producto_id: product.wc_product_id,
      producto_key: product.key,
      fecha: fecha,
      sucursal: branch,
      cantidad: quantity,
    });
    
    return {
      ok: result?.success && result?.disponible,
      stock: result?.stock_disponible || null,
      message: result?.mensaje || null,
      // ═══════════════════════════════════════════════════════════════════════
      // CORRECCIÓN: Capturar variation_id de la respuesta
      // ═══════════════════════════════════════════════════════════════════════
      variation_id: result?.variation_id || null,
      price: result?.resumen?.precio_unitario || product.price || null,
    };
  } catch (e) {
    logger.warn({ err: e?.message || String(e), product: product.key, fecha, branch }, "Availability check failed");
    return { ok: false, error: e?.message || String(e), variation_id: null };
  }
}

async function checkCartAvailability({ items, fecha, branch }) {
  const results = [];
  
  for (const item of items) {
    const availability = await checkItemAvailability({
      product: item.product,
      fecha,
      branch,
      quantity: item.quantity,
    });
    
    results.push({
      product: item.product,
      quantity: item.quantity,
      variation_id: item.variation_id, // Usar el que ya tenía el item
      ...availability,
    });
    
    if (!availability.ok) {
      return { ok: false, results, failedItem: item };
    }
  }
  
  return { ok: true, results };
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
  cart_summary,
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
      query_category: "order_create",
      staff_prompt: staff_prompt || "Apoyar a cliente con pedido nuevo",
      chatwoot_context,
      customer_text: customer_text || "",
      object_description: cart_summary || null,
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
// State factory
// ─────────────────────────────────────────────────────────────────────────────

export function createSecureOrderCreateState({ order_context, initial_product, initial_branch }) {
  const oc = order_context || {};
  
  return {
    flow: "ORDER_CREATE",
    secure: true,
    step: ORDER_CREATE_STEPS.INIT,
    started_at: Date.now(),
    draft: {
      // Cart items (committed) - AHORA INCLUYEN variation_id
      items: [],
      // Current item being built
      current_product: initial_product || null,
      current_quantity: oc?.quantity || null,
      // Delivery context (shared for all items)
      branch_id: initial_branch || oc?.branch_id || null,
      branch_name: null,
      fecha_slug: null,
      fecha_name: oc?.delivery_date_text || null,
      // Pending inputs (not yet validated)
      pending_product_text: oc?.product_query || null,
      pending_branch_text: oc?.branch_text || null,
      pending_fecha_text: oc?.delivery_date_text || null,
      // Season rule validation result
      date_validation: null,
    },
    // Pending confirmation before checkout
    pending_confirmation: null,
    // Options shown to user
    options: {},
    // Idempotency
    idempotency_key: randomUUID(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handlers factory
// ─────────────────────────────────────────────────────────────────────────────

export function makeSecureOrderCreateHandlers({ setFlow, clearFlow, sendChatwootMessage, sendPrivateNote, hitlEnabled }) {
  if (typeof setFlow !== "function" || typeof clearFlow !== "function" || typeof sendChatwootMessage !== "function") {
    throw new Error("makeSecureOrderCreateHandlers: missing required deps");
  }

  // Helper para enviar nota privada si está disponible
  const maybeSendPrivateNote = async (params) => {
    if (typeof sendPrivateNote === "function") {
      try {
        await sendPrivateNote(params);
      } catch {}
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ADVANCE: Main state machine logic
  // ─────────────────────────────────────────────────────────────────────────
  
  async function advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    const d = state.draft;
    const policy = getOrderCreatePolicy();
    
    // ─────────────────────────────────────────────────────────────────────
    // Global escape routes (always checked first)
    // ─────────────────────────────────────────────────────────────────────
    
    if (detectsCancel(messageText)) {
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "De acuerdo, cancelé el pedido. Si necesitas algo más, aquí estoy.",
      });
      return;
    }
    
    if (detectsHuman(messageText)) {
      const cartSummary = formatCartSummary(d);
      await maybeEscalateToHITL({
        enabled: !!hitlEnabled,
        branch_id: d.branch_id || "HQ",
        accountId,
        conversationId,
        inboxId,
        inboxName,
        customer_text: messageText,
        staff_prompt: "Cliente solicita apoyo humano para pedido nuevo",
        cart_summary: cartSummary,
      });
      
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Claro. Te canalizo con el equipo para ayudarte con tu pedido.",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Policy gate
    // ─────────────────────────────────────────────────────────────────────
    
    if (!policy.enabled) {
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "En este momento no puedo procesar pedidos automáticamente. ¿Te canalizo con el equipo?",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: INIT - Determine what we need
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.INIT) {
      // Try to resolve pending inputs
      await tryResolvePendingInputs({ state, csInfo });
      
      // Determine next step based on what's missing
      const nextStep = determineNextStep(state);
      state.step = nextStep;
      setFlow(conversationId, state);
      
      // Recurse to handle the new step
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_PRODUCT
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.ASK_PRODUCT) {
      const products = getAvailableProducts();
      
      if (products.length === 0) {
        clearFlow(conversationId);
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Lo siento, en este momento no tengo productos disponibles configurados. ¿Te canalizo con el equipo?",
        });
        return;
      }
      
      state.options.products = products;
      setFlow(conversationId, state);
      
      const productList = formatNumberedList(products, p => `${p.name}${p.price ? ` - $${p.price}` : ""}`);
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `¿Qué producto te gustaría?\n\n${productList}\n\n(Responde con el número o el nombre)`,
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: PICK_PRODUCT (user responded to ASK_PRODUCT)
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.PICK_PRODUCT) {
      const products = state.options.products || getAvailableProducts();
      
      // Try by number first
      let product = pickByNumber(messageText, products);
      
      // Try by name match
      if (!product) {
        const normalized = normalizeText(messageText);
        product = products.find(p => 
          normalizeText(p.name).includes(normalized) || 
          normalized.includes(normalizeText(p.name))
        );
      }
      
      if (!product) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No encontré ese producto. ¿Me dices el número o el nombre del producto que quieres?",
        });
        return;
      }
      
      d.current_product = product;
      state.step = determineNextStep(state);
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_BRANCH
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.ASK_BRANCH) {
      const branches = getAvailableBranches();
      
      if (branches.length === 0) {
        clearFlow(conversationId);
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No tengo sucursales configuradas. ¿Te canalizo con el equipo?",
        });
        return;
      }
      
      state.options.branches = branches;
      setFlow(conversationId, state);
      
      const branchList = formatNumberedList(branches, b => `${b.name || b.short_name}${b.city ? ` (${b.city})` : ""}`);
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `¿En qué sucursal quieres recoger?\n\n${branchList}\n\n(Responde con el número o el nombre)`,
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: PICK_BRANCH
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.PICK_BRANCH) {
      const branches = state.options.branches || getAvailableBranches();
      
      // Try by number
      let branch = pickByNumber(messageText, branches);
      
      // Try by name match
      if (!branch) {
        const match = matchBranchFromText(messageText);
        if (match?.branch_id) {
          branch = branches.find(b => b.branch_id === match.branch_id);
        }
      }
      
      if (!branch) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No encontré esa sucursal. ¿Me dices el número o el nombre?",
        });
        return;
      }
      
      d.branch_id = branch.branch_id;
      d.branch_name = branch.name || branch.short_name;
      state.step = determineNextStep(state);
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_DATE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.ASK_DATE) {
      const fechas = Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
      
      if (fechas.length === 0) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "¿Para qué fecha necesitas tu rosca? (ej: 6 de enero, mañana, pasado mañana)",
        });
      } else {
        // Filtrar fechas según reglas de temporada
        const validFechas = fechas.filter(f => {
          const validation = validateOrderDate({
            dateSlug: f.slug,
            branchId: d.branch_id,
            channel: 'bot',
            productCategory: d.current_product?.category || 'roscas',
            action: 'create',
          });
          return validation.allowed;
        }).slice(0, 7); // Máximo 7 opciones
        
        if (validFechas.length === 0) {
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: "En este momento no hay fechas disponibles para pedido en línea. ¿Te gustaría que te diga cómo conseguir tu rosca directamente en sucursal?",
          });
          state.step = ORDER_CREATE_STEPS.SUGGEST_BRANCH;
          setFlow(conversationId, state);
          return;
        }
        
        state.options.fechas = validFechas;
        setFlow(conversationId, state);
        
        const fechaList = formatNumberedList(validFechas, f => f.nombre || f.slug);
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: `¿Para qué fecha?\n\n${fechaList}\n\n(Responde con el número o escribe la fecha)`,
        });
      }
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: PICK_DATE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.PICK_DATE) {
      const fechas = state.options.fechas || Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
      
      // Try by number
      let fecha = pickByNumber(messageText, fechas);
      
      // Try by text match
      if (!fecha) {
        const match = matchDateFromText(messageText, fechas, { timeZone: "America/Mexico_City" });
        if (match) {
          fecha = match;
        }
      }
      
      if (!fecha) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No encontré esa fecha. ¿Me dices el número o escribes la fecha? (ej: 6 de enero)",
        });
        return;
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // NUEVO: Validar fecha contra reglas de temporada
      // ═══════════════════════════════════════════════════════════════════
      const dateValidation = validateOrderDate({
        dateSlug: fecha.slug || fecha.fecha_iso,
        branchId: d.branch_id,
        channel: 'bot',
        productCategory: d.current_product?.category || 'roscas',
        action: 'create',
      });
      
      d.date_validation = dateValidation;
      
      if (!dateValidation.allowed) {
        // Fecha no permitida para bot
        const botMessage = getBotMessageForRule(dateValidation);
        
        if (dateValidation.rule_type === RULE_TYPES.SOLO_POS) {
          // Caso especial: SOLO_POS - sugerir ir a sucursal
          state.step = ORDER_CREATE_STEPS.SUGGEST_BRANCH;
          state.options.blocked_date = fecha;
          setFlow(conversationId, state);
          
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: botMessage + "\n\n¿Quieres que te diga qué sucursales tienen disponibilidad?",
          });
          return;
        } else {
          // Otros casos: pedir otra fecha
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: botMessage + "\n\n¿Quieres elegir otra fecha?",
          });
          state.step = ORDER_CREATE_STEPS.ASK_DATE;
          setFlow(conversationId, state);
          return;
        }
      }
      
      d.fecha_slug = fecha.slug || fecha.fecha_iso;
      d.fecha_name = fecha.nombre || fecha.label || fecha.slug;
      state.step = determineNextStep(state);
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: SUGGEST_BRANCH (para fechas SOLO_POS)
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.SUGGEST_BRANCH) {
      const t = normalizeText(messageText);
      
      if (t === "si" || t === "sí" || t === "dale" || t === "ok" || t.includes("cual")) {
        // Mostrar sucursales disponibles
        const branches = getBranchesForDateSuggestion();
        
        if (branches.length === 0) {
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: "Lo siento, no tengo información de sucursales disponible. Por favor llámanos al WhatsApp para más información.",
          });
          clearFlow(conversationId);
          return;
        }
        
        const branchInfo = branches.map(b => 
          `📍 *${b.name}*${b.city ? ` (${b.city})` : ""}\n` +
          `   ${b.address || ''}\n` +
          `   📞 ${b.phone || 'Ver en tienda'}`
        ).join("\n\n");
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: `Aquí están nuestras sucursales donde puedes conseguir tu rosca:\n\n${branchInfo}\n\n` +
            `Te recomiendo llamar antes para confirmar disponibilidad. ¿Te ayudo con algo más?`,
        });
        
        clearFlow(conversationId);
        return;
      }
      
      if (detectsNoMore(messageText) || t.includes("no")) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Entendido. Si necesitas otra cosa, aquí estoy. 😊",
        });
        clearFlow(conversationId);
        return;
      }
      
      // Si dice otra fecha, volver a ASK_DATE
      if (t.includes("otra fecha") || t.includes("cambiar")) {
        state.step = ORDER_CREATE_STEPS.ASK_DATE;
        setFlow(conversationId, state);
        await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "¿Quieres que te diga qué sucursales tienen disponibilidad? (Sí/No)",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_QTY
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.ASK_QTY) {
      const productName = d.current_product?.name || "el producto";
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `¿Cuántas de ${productName} necesitas?`,
      });
      return;
    }
    
    // Handle quantity response
    if (state.step === "AWAIT_QTY") {
      const qty = parseIntSafe(messageText);
      
      if (!qty || qty < 1) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Por favor dime un número válido. ¿Cuántas necesitas?",
        });
        return;
      }
      
      if (qty > policy.max_quantity_per_item) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: `El máximo por producto es ${policy.max_quantity_per_item}. ¿Cuántas necesitas?`,
        });
        return;
      }
      
      d.current_quantity = qty;
      
      // ═══════════════════════════════════════════════════════════════════
      // CORRECCIÓN: Verificar disponibilidad y obtener variation_id ANTES de agregar
      // ═══════════════════════════════════════════════════════════════════
      const availability = await checkItemAvailability({
        product: d.current_product,
        fecha: d.fecha_slug,
        branch: d.branch_id,
        quantity: qty,
      });
      
      if (!availability.ok) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: `Lo siento, no hay suficiente stock de ${d.current_product.name} para esa fecha/sucursal. ${availability.message || ''}\n\n¿Quieres cambiar la cantidad o elegir otro producto?`,
        });
        d.current_quantity = null;
        setFlow(conversationId, state);
        return;
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // CORRECCIÓN: Guardar variation_id junto con el item
      // ═══════════════════════════════════════════════════════════════════
      if (d.current_product && d.current_quantity) {
        d.items.push({
          product: d.current_product,
          quantity: d.current_quantity,
          variation_id: availability.variation_id, // ✅ AHORA SE GUARDA
          stock_at_add: availability.stock,
          price_at_add: availability.price,
        });
        
        // Nota privada para agentes
        await maybeSendPrivateNote({
          accountId,
          conversationId,
          content: `🛒 Item agregado al carrito:\n` +
            `- Producto: ${d.current_product.name}\n` +
            `- Cantidad: ${d.current_quantity}\n` +
            `- Variation ID: ${availability.variation_id || 'N/A'}\n` +
            `- Stock disponible: ${availability.stock || 'N/A'}`,
        });
        
        d.current_product = null;
        d.current_quantity = null;
      }
      
      state.step = ORDER_CREATE_STEPS.ASK_ADD_MORE;
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_ADD_MORE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.ASK_ADD_MORE) {
      const itemCount = d.items.length;
      const lastItem = d.items[itemCount - 1];
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `¡Perfecto! Agregué ${lastItem?.quantity || 1} ${lastItem?.product?.name || 'producto'}.\n\n¿Quieres agregar otro producto o generamos el link de pago?`,
      });
      return;
    }
    
    // Handle add more response
    if (state.step === "AWAIT_ADD_MORE") {
      if (detectsAddMore(messageText)) {
        // Want to add more
        state.step = ORDER_CREATE_STEPS.ASK_PRODUCT;
        setFlow(conversationId, state);
        
        await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      if (detectsNoMore(messageText) || detectsConfirm(messageText)) {
        // Ready to checkout
        state.step = ORDER_CREATE_STEPS.CONFIRM_CART;
        setFlow(conversationId, state);
        
        await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      // Check if user mentioned a product
      const products = getAvailableProducts();
      const normalized = normalizeText(messageText);
      const product = products.find(p => 
        normalizeText(p.name).includes(normalized) || 
        normalized.includes(normalizeText(p.name))
      );
      
      if (product) {
        d.current_product = product;
        state.step = ORDER_CREATE_STEPS.ASK_QTY;
        setFlow(conversationId, state);
        
        await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "¿Quieres agregar otro producto o generamos el link?",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: CONFIRM_CART (two-phase commit)
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.CONFIRM_CART) {
      // Check availability for all items
      if (policy.require_availability_check) {
        const availability = await checkCartAvailability({
          items: d.items,
          fecha: d.fecha_slug,
          branch: d.branch_id,
        });
        
        if (!availability.ok) {
          const failedItem = availability.failedItem;
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: 
              `Lo siento, al verificar disponibilidad encontré que "${failedItem.product.name}" no está disponible para la fecha/sucursal seleccionada.\n\n` +
              `¿Quieres cambiar la fecha, la sucursal o quitar ese producto del carrito?`,
          });
          
          state.step = ORDER_CREATE_STEPS.ESCAPE_MENU;
          setFlow(conversationId, state);
          return;
        }
      }
      
      // ═══════════════════════════════════════════════════════════════════
      // CORRECCIÓN: Preservar variation_id en pending_confirmation
      // ═══════════════════════════════════════════════════════════════════
      state.pending_confirmation = {
        items: d.items.map(item => ({
          product: item.product,
          quantity: item.quantity,
          variation_id: item.variation_id, // ✅ PRESERVAR
          price_at_add: item.price_at_add,
        })),
        branch_id: d.branch_id,
        branch_name: d.branch_name,
        fecha_slug: d.fecha_slug,
        fecha_name: d.fecha_name,
        confirmed_at: null,
        idempotency_key: state.idempotency_key,
      };
      
      setFlow(conversationId, state);
      
      const cartSummary = formatCartSummary(d);
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content:
          `Listo para generar tu link de pago:\n\n` +
          `${cartSummary}\n` +
          `📍 Sucursal: ${d.branch_name || d.branch_id}\n` +
          `📅 Fecha: ${d.fecha_name || d.fecha_slug}\n\n` +
          `En este momento veo disponibilidad. Para generar el link, responde: *CONFIRMAR PEDIDO*\n\n` +
          `Si quieres cambiar algo, dímelo.`,
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Handle confirmation response
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === "AWAIT_CONFIRM" && state.pending_confirmation) {
      if (!detectsConfirm(messageText)) {
        // User wants to change something
        state.pending_confirmation = null;
        
        // Try to detect what they want to change
        const t = normalizeText(messageText);
        
        if (t.includes("fecha") || t.includes("dia") || t.includes("cuando")) {
          d.fecha_slug = null;
          d.fecha_name = null;
          state.step = ORDER_CREATE_STEPS.ASK_DATE;
        } else if (t.includes("sucursal") || t.includes("donde") || t.includes("recoger")) {
          d.branch_id = null;
          d.branch_name = null;
          state.step = ORDER_CREATE_STEPS.ASK_BRANCH;
        } else if (t.includes("producto") || t.includes("rosca") || t.includes("quitar")) {
          state.step = ORDER_CREATE_STEPS.ESCAPE_MENU;
        } else {
          state.step = ORDER_CREATE_STEPS.INIT;
        }
        
        setFlow(conversationId, state);
        await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
      }
      
      // User confirmed - generate link
      state.pending_confirmation.confirmed_at = new Date().toISOString();
      state.step = ORDER_CREATE_STEPS.GENERATE_LINK;
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: GENERATE_LINK
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.GENERATE_LINK) {
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Generando tu link de pago...",
      });
      
      try {
        const pending = state.pending_confirmation;
        
        // ═══════════════════════════════════════════════════════════════════
        // CORRECCIÓN: Incluir variation_id en el payload
        // ═══════════════════════════════════════════════════════════════════
        const cartItems = pending.items.map(item => ({
          product_id: item.product.wc_product_id,
          product_key: item.product.key,
          quantity: item.quantity,
          variation_id: item.variation_id || null, // ✅ AHORA SE INCLUYE
        }));
        
        logger.info({ cartItems, fecha: pending.fecha_slug, sucursal: pending.branch_id }, "Generating checkout link");
        
        const result = await csGenerarLinkCompra({
          items: cartItems,
          sucursal: pending.branch_id,
          fecha: pending.fecha_slug,
          idempotency_key: pending.idempotency_key,
        });
        
        if (!result?.success || !result?.checkout_url) {
          // Generation failed - might be race condition
          const errorMsg = result?.mensaje || "No pude generar el link";
          
          await sendChatwootMessage({
            accountId,
            conversationId,
            content:
              `Ups, hubo un problema al generar el link: ${errorMsg}\n\n` +
              `Es posible que la disponibilidad haya cambiado. ¿Quieres que revise otras opciones?`,
          });
          
          state.pending_confirmation = null;
          state.step = ORDER_CREATE_STEPS.ESCAPE_MENU;
          setFlow(conversationId, state);
          return;
        }
        
        // Success!
        state.step = ORDER_CREATE_STEPS.DONE;
        clearFlow(conversationId);
        
        // Nota privada con detalles del link generado
        await maybeSendPrivateNote({
          accountId,
          conversationId,
          content: `✅ Link de pago generado:\n` +
            `- URL: ${result.checkout_url}\n` +
            `- Total: ${result.total_display || result.total}\n` +
            `- Items: ${cartItems.length}\n` +
            `- Sucursal: ${pending.branch_name}\n` +
            `- Fecha: ${pending.fecha_name}`,
        });
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content:
            `¡Listo! Aquí está tu link de pago:\n\n${result.checkout_url}\n\n` +
            `📍 Sucursal: ${pending.branch_name || pending.branch_id}\n` +
            `📅 Fecha de entrega: ${pending.fecha_name || pending.fecha_slug}\n` +
            `💰 Total: ${result.total_display || ''}\n\n` +
            `El link es válido por 24 horas. Si necesitas algo más, aquí estoy.`,
        });
        
      } catch (e) {
        logger.error({ err: e?.message || String(e), conversationId }, "Link generation failed");
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content:
            `Lo siento, hubo un error técnico al generar el link.\n\n` +
            `¿Te canalizo con el equipo para completar tu pedido?`,
        });
        
        state.step = ORDER_CREATE_STEPS.ESCAPE_MENU;
        setFlow(conversationId, state);
      }
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ESCAPE_MENU
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_CREATE_STEPS.ESCAPE_MENU) {
      await sendChatwootMessage({
        accountId,
        conversationId,
        content:
          `¿Qué prefieres?\n\n` +
          `1. Cambiar la fecha\n` +
          `2. Cambiar la sucursal\n` +
          `3. Modificar productos del carrito\n` +
          `4. Hablar con alguien del equipo\n` +
          `5. Cancelar el pedido`,
      });
      
      state.step = "AWAIT_ESCAPE_CHOICE";
      setFlow(conversationId, state);
      return;
    }
    
    // Handle escape menu choice
    if (state.step === "AWAIT_ESCAPE_CHOICE") {
      const choice = parseIntSafe(messageText);
      
      switch (choice) {
        case 1:
          d.fecha_slug = null;
          d.fecha_name = null;
          state.step = ORDER_CREATE_STEPS.ASK_DATE;
          break;
        case 2:
          d.branch_id = null;
          d.branch_name = null;
          state.step = ORDER_CREATE_STEPS.ASK_BRANCH;
          break;
        case 3:
          // Reset cart and start over
          d.items = [];
          d.current_product = null;
          d.current_quantity = null;
          state.step = ORDER_CREATE_STEPS.ASK_PRODUCT;
          break;
        case 4:
          await maybeEscalateToHITL({
            enabled: !!hitlEnabled,
            branch_id: d.branch_id || "HQ",
            accountId,
            conversationId,
            inboxId,
            inboxName,
            customer_text: "Cliente solicitó apoyo desde menú de escape",
            staff_prompt: "Apoyar a cliente con pedido",
            cart_summary: formatCartSummary(d),
          });
          clearFlow(conversationId);
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: "Te canalizo con el equipo. En breve te contactan.",
          });
          return;
        case 5:
          clearFlow(conversationId);
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: "De acuerdo, cancelé el pedido. Si necesitas algo más, aquí estoy.",
          });
          return;
        default:
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: "No entendí. ¿Me dices el número de la opción?",
          });
          return;
      }
      
      setFlow(conversationId, state);
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Default: unknown step, reset to INIT
    // ─────────────────────────────────────────────────────────────────────
    
    logger.warn({ step: state.step, conversationId }, "Unknown ORDER_CREATE step, resetting to INIT");
    state.step = ORDER_CREATE_STEPS.INIT;
    setFlow(conversationId, state);
    await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLE: Entry point from chatwoot.js (with LangSmith tracing)
  // ─────────────────────────────────────────────────────────────────────────
  
  async function _handleInternal({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    // Update step based on previous step (state machine transition)
    const transitionedStep = getTransitionStep(state.step);
    if (transitionedStep !== state.step) {
      state.step = transitionedStep;
      setFlow(conversationId, state);
    }
    
    await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
    return true;
  }
  
  // Wrapped version with LangSmith tracing
  async function handle(params) {
    const { conversationId, state } = params;
    const traced = wrapWithTrace(
      _handleInternal,
      "secure-flow/order-create",
      {
        conversation_id: String(conversationId),
        step: state?.step || "unknown",
        task: "order_create_flow",
      }
    );
    return traced(params);
  }

  return {
    advanceSecureOrderCreateFlow: advance,
    handleSecureOrderCreateFlow: handle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: determine next step
// ─────────────────────────────────────────────────────────────────────────────

function determineNextStep(state) {
  const d = state.draft;
  
  // Need product?
  if (!d.current_product && d.items.length === 0) {
    return ORDER_CREATE_STEPS.ASK_PRODUCT;
  }
  
  // Need branch?
  if (!d.branch_id) {
    return ORDER_CREATE_STEPS.ASK_BRANCH;
  }
  
  // Need date?
  if (!d.fecha_slug) {
    return ORDER_CREATE_STEPS.ASK_DATE;
  }
  
  // Need quantity for current product?
  if (d.current_product && !d.current_quantity) {
    return ORDER_CREATE_STEPS.ASK_QTY;
  }
  
  // Have complete item, ask if want more
  if (d.current_product && d.current_quantity) {
    return ORDER_CREATE_STEPS.ASK_ADD_MORE;
  }
  
  // Have items in cart, go to confirm
  if (d.items.length > 0) {
    return ORDER_CREATE_STEPS.CONFIRM_CART;
  }
  
  // Default: ask for product
  return ORDER_CREATE_STEPS.ASK_PRODUCT;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: get transition step (from question to await answer)
// ─────────────────────────────────────────────────────────────────────────────

function getTransitionStep(currentStep) {
  const transitions = {
    [ORDER_CREATE_STEPS.ASK_PRODUCT]: ORDER_CREATE_STEPS.PICK_PRODUCT,
    [ORDER_CREATE_STEPS.ASK_BRANCH]: ORDER_CREATE_STEPS.PICK_BRANCH,
    [ORDER_CREATE_STEPS.ASK_DATE]: ORDER_CREATE_STEPS.PICK_DATE,
    [ORDER_CREATE_STEPS.ASK_QTY]: "AWAIT_QTY",
    [ORDER_CREATE_STEPS.ASK_ADD_MORE]: "AWAIT_ADD_MORE",
    [ORDER_CREATE_STEPS.CONFIRM_CART]: "AWAIT_CONFIRM",
    [ORDER_CREATE_STEPS.ESCAPE_MENU]: "AWAIT_ESCAPE_CHOICE",
    [ORDER_CREATE_STEPS.SUGGEST_BRANCH]: ORDER_CREATE_STEPS.SUGGEST_BRANCH,
  };
  
  return transitions[currentStep] || currentStep;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: try to resolve pending inputs
// ─────────────────────────────────────────────────────────────────────────────

async function tryResolvePendingInputs({ state, csInfo }) {
  const d = state.draft;
  
  // Try to resolve pending product
  if (d.pending_product_text && !d.current_product) {
    const products = getAvailableProducts();
    const normalized = normalizeText(d.pending_product_text);
    const product = products.find(p => 
      normalizeText(p.name).includes(normalized) || 
      normalized.includes(normalizeText(p.name))
    );
    if (product) {
      d.current_product = product;
      d.pending_product_text = null;
    }
  }
  
  // Try to resolve pending branch
  if (d.pending_branch_text && !d.branch_id) {
    const match = matchBranchFromText(d.pending_branch_text);
    if (match?.branch_id) {
      const branches = getAvailableBranches();
      const branch = branches.find(b => b.branch_id === match.branch_id);
      if (branch) {
        d.branch_id = branch.branch_id;
        d.branch_name = branch.name || branch.short_name;
        d.pending_branch_text = null;
      }
    }
  }
  
  // Try to resolve pending date
  if (d.pending_fecha_text && !d.fecha_slug) {
    const fechas = Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
    const match = matchDateFromText(d.pending_fecha_text, fechas, { timeZone: "America/Mexico_City" });
    if (match) {
      d.fecha_slug = match.slug || match.fecha_iso;
      d.fecha_name = match.nombre || match.label || match.slug;
      d.pending_fecha_text = null;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: format cart summary
// ─────────────────────────────────────────────────────────────────────────────

function formatCartSummary(draft) {
  const items = draft.items || [];
  const current = draft.current_product && draft.current_quantity
    ? [{ product: draft.current_product, quantity: draft.current_quantity }]
    : [];
  
  const allItems = [...items, ...current];
  
  if (allItems.length === 0) {
    return "(carrito vacío)";
  }
  
  // Calcular total estimado
  let totalEstimado = 0;
  
  const itemLines = allItems
    .map((item, idx) => {
      const name = item.product?.name || item.product_name || "Producto";
      const qty = item.quantity || 1;
      const price = item.price_at_add || item.product?.price;
      const subtotal = price ? price * qty : 0;
      totalEstimado += subtotal;
      
      // NO mostrar variation_id al cliente (solo en logs/notas privadas)
      // El variation_id se mantiene en el item para uso interno
      const subtotalStr = price ? ` - $${subtotal}` : "";
      return `${idx + 1}. ${name} x${qty}${subtotalStr}`;
    })
    .join("\n");
  
  // Agregar total estimado si hay precios
  if (totalEstimado > 0) {
    return `${itemLines}\n\n💰 Total estimado: $${totalEstimado.toLocaleString('es-MX')} MXN`;
  }
  
  return itemLines;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createSecureOrderCreateState,
  makeSecureOrderCreateHandlers,
  ORDER_CREATE_STEPS,
};
