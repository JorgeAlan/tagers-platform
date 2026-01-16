/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAN • IA — SECURE ORDER MODIFY FLOW v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Flow para modificar pedidos existentes con validación de identidad.
 * 
 * REGLAS DE SEGURIDAD:
 * - Requiere número de pedido
 * - Requiere verificación de teléfono O email
 * - Respeta fechas bloqueadas para modificación (Sheet)
 * - No permite modificaciones para fechas SOLO_POS
 *
 * Flow steps:
 * ASK_ORDER_NUMBER → ASK_VERIFICATION → VERIFY → SHOW_ORDER → ASK_CHANGE → PROCESS_CHANGE → CONFIRM → DONE
 */

import { logger } from "../../utils/logger.js";
import { randomUUID } from "crypto";
import { 
  csConsultarPedido, 
  csCambiarEntrega,
  csConsultaDisponibilidad,
} from "../../integrations/wp_cs_client.js";
import { matchBranchFromText, listBranches } from "../../hitl/branch_registry.js";
import { matchDateFromText } from "../../helpers/date_normalizer.js";
import { getConfig as getConfigHub } from "../../config-hub/sync-service.js";
import { createHitlAdhocSearchRequestForChatwoot } from "../../hitl/hitl_service.js";

// Season Rules
import { 
  validateOrderDate,
  validateOrderModificationAccess,
  canModifyOrderForDate,
  getBotMessageForRule,
  getBranchesForDateSuggestion,
  formatBranchesMessage,
  getOrderModifyPolicy,
  RULE_TYPES,
} from "../../season/season-rules.js";

// LangSmith
import { traceable } from "langsmith/traceable";

function isLangSmithEnabled() {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY;
}

function wrapWithTrace(fn, name, metadata = {}) {
  if (!isLangSmithEnabled()) return fn;
  return traceable(fn, {
    name,
    run_type: "chain",
    metadata: { service: "tagers-kiss-api", flow: "order_modify_secure", ...metadata },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Flow steps enum
// ─────────────────────────────────────────────────────────────────────────────

export const ORDER_MODIFY_STEPS = {
  INIT: "INIT",
  ASK_ORDER_NUMBER: "ASK_ORDER_NUMBER",
  ASK_VERIFICATION: "ASK_VERIFICATION",
  VERIFY_PHONE: "VERIFY_PHONE",
  VERIFY_EMAIL: "VERIFY_EMAIL",
  SHOW_ORDER: "SHOW_ORDER",
  ASK_CHANGE_TYPE: "ASK_CHANGE_TYPE",
  ASK_NEW_DATE: "ASK_NEW_DATE",
  ASK_NEW_BRANCH: "ASK_NEW_BRANCH",
  CONFIRM_CHANGE: "CONFIRM_CHANGE",
  PROCESS_CHANGE: "PROCESS_CHANGE",
  DONE: "DONE",
  // Special states
  BLOCKED_DATE: "BLOCKED_DATE",
  SUGGEST_BRANCH: "SUGGEST_BRANCH",
  ESCALATE: "ESCALATE",
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractOrderNumber(text) {
  // Extraer número de pedido (formato: #1234, 1234, TAGERS-1234, etc.)
  const patterns = [
    /#?(\d{4,6})\b/,           // #1234 o 1234
    /pedido\s*#?(\d{4,6})/i,   // pedido 1234
    /orden\s*#?(\d{4,6})/i,    // orden 1234
    /TAGERS-?(\d{4,6})/i,      // TAGERS-1234
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  
  // Si es solo números
  const numOnly = text.replace(/\D/g, '');
  if (numOnly.length >= 4 && numOnly.length <= 6) {
    return numOnly;
  }
  
  return null;
}

function extractPhone(text) {
  // Extraer teléfono (10 dígitos)
  const cleaned = text.replace(/\D/g, '');
  if (cleaned.length >= 10) {
    return cleaned.slice(-10);
  }
  return null;
}

function extractEmail(text) {
  // Extraer email
  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const match = text.match(emailRegex);
  return match ? match[0].toLowerCase() : null;
}

function detectsCancel(text) {
  const t = normalizeText(text);
  return /\b(cancelar|cancela|ya no|no quiero|olvidalo|dejalo|nada)\b/.test(t);
}

function detectsHuman(text) {
  const t = normalizeText(text);
  return /\b(humano|persona|agente|alguien|real)\b/.test(t);
}

function detectsConfirm(text) {
  const t = normalizeText(text);
  return t === "si" || t === "sí" || t === "confirmar" || t === "dale" || t === "ok";
}

function formatOrderSummary(orderData) {
  if (!orderData) return "(sin información)";
  
  const items = orderData.items || orderData.line_items || [];
  const itemsText = items.map(i => `• ${i.name || i.product_name} x${i.quantity || 1}`).join("\n");
  
  return `📦 Pedido #${orderData.order_id || orderData.id}
📅 Entrega: ${orderData.delivery_date || orderData.fecha_entrega || 'No especificada'}
📍 Sucursal: ${orderData.branch_name || orderData.sucursal || 'No especificada'}
🛒 Productos:
${itemsText || '(sin productos)'}
💰 Total: $${orderData.total || '0'}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// State factory
// ─────────────────────────────────────────────────────────────────────────────

export function createSecureOrderModifyState({ order_context }) {
  const oc = order_context || {};
  
  return {
    flow: "ORDER_MODIFY",
    secure: true,
    step: ORDER_MODIFY_STEPS.INIT,
    started_at: Date.now(),
    
    // Datos del pedido
    order_number: oc.order_number || null,
    order_data: null,
    
    // Verificación
    verification_method: null, // 'phone' o 'email'
    verification_attempts: 0,
    verified: false,
    
    // Cambio solicitado
    change_type: null, // 'date', 'branch', 'cancel', 'other'
    new_date: null,
    new_branch: null,
    
    // Validación de fecha
    date_validation: null,
    
    // Opciones mostradas
    options: {},
    
    // Idempotency
    idempotency_key: randomUUID(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main handlers factory
// ─────────────────────────────────────────────────────────────────────────────

export function makeSecureOrderModifyHandlers({ setFlow, clearFlow, sendChatwootMessage, sendPrivateNote, hitlEnabled }) {
  if (typeof setFlow !== "function" || typeof clearFlow !== "function" || typeof sendChatwootMessage !== "function") {
    throw new Error("makeSecureOrderModifyHandlers: missing required deps");
  }

  const maybeSendPrivateNote = async (params) => {
    if (typeof sendPrivateNote === "function") {
      try { await sendPrivateNote(params); } catch {}
    }
  };

  // ─────────────────────────────────────────────────────────────────────────
  // ADVANCE: Main state machine
  // ─────────────────────────────────────────────────────────────────────────
  
  async function advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName }) {
    const policy = getOrderModifyPolicy();
    
    // ─────────────────────────────────────────────────────────────────────
    // Global escape routes
    // ─────────────────────────────────────────────────────────────────────
    
    if (detectsCancel(messageText)) {
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "De acuerdo, cancelé la solicitud de cambio. Si necesitas algo más, aquí estoy.",
      });
      return;
    }
    
    if (detectsHuman(messageText)) {
      await maybeSendPrivateNote({
        accountId,
        conversationId,
        content: `🔔 Cliente solicita apoyo humano para modificar pedido.\nPedido: ${state.order_number || 'No identificado'}\nVerificado: ${state.verified ? 'Sí' : 'No'}`,
      });
      
      clearFlow(conversationId);
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Te canalizo con el equipo para ayudarte con el cambio de tu pedido.",
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
        content: "En este momento las modificaciones de pedido están pausadas. ¿Te canalizo con el equipo?",
      });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: INIT
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.INIT) {
      // Ver si ya tenemos número de pedido del contexto
      if (state.order_number) {
        state.step = ORDER_MODIFY_STEPS.ASK_VERIFICATION;
      } else {
        state.step = ORDER_MODIFY_STEPS.ASK_ORDER_NUMBER;
      }
      setFlow(conversationId, state);
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_ORDER_NUMBER
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.ASK_ORDER_NUMBER) {
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Para poder ayudarte con un cambio en tu pedido, necesito el número de pedido. ¿Me lo puedes dar? (Ej: #1234)",
      });
      state.step = "AWAIT_ORDER_NUMBER";
      setFlow(conversationId, state);
      return;
    }
    
    if (state.step === "AWAIT_ORDER_NUMBER") {
      const orderNum = extractOrderNumber(messageText);
      
      if (!orderNum) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No encontré un número de pedido en tu mensaje. Por favor escribe el número (ej: 1234 o #1234)",
        });
        return;
      }
      
      state.order_number = orderNum;
      state.step = ORDER_MODIFY_STEPS.ASK_VERIFICATION;
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_VERIFICATION
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.ASK_VERIFICATION) {
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `Para verificar que eres el titular del pedido #${state.order_number}, necesito que me proporciones:\n\n📱 El número de celular con el que hiciste el pedido\nO\n📧 El correo electrónico del pedido\n\n¿Cuál prefieres darme?`,
      });
      state.step = "AWAIT_VERIFICATION";
      setFlow(conversationId, state);
      return;
    }
    
    if (state.step === "AWAIT_VERIFICATION") {
      const phone = extractPhone(messageText);
      const email = extractEmail(messageText);
      
      if (!phone && !email) {
        state.verification_attempts++;
        
        if (state.verification_attempts >= 3) {
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: "No pude identificar un teléfono o email válido. Te canalizo con el equipo para ayudarte.",
          });
          clearFlow(conversationId);
          return;
        }
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No encontré un teléfono o email válido. Por favor escribe tu número de 10 dígitos o tu correo electrónico.",
        });
        return;
      }
      
      // Buscar pedido en WooCommerce
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Verificando tu información...",
      });
      
      try {
        const orderData = await csConsultarPedido({ order_id: state.order_number });
        
        if (!orderData || !orderData.success) {
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: `No encontré el pedido #${state.order_number}. ¿Puedes verificar el número?`,
          });
          state.step = ORDER_MODIFY_STEPS.ASK_ORDER_NUMBER;
          state.order_number = null;
          setFlow(conversationId, state);
          return;
        }
        
        state.order_data = orderData.pedido || orderData;
        
        // Validar acceso
        const accessValidation = validateOrderModificationAccess({
          orderId: state.order_number,
          customerPhone: phone,
          customerEmail: email,
          orderData: state.order_data,
        });
        
        if (!accessValidation.authorized) {
          state.verification_attempts++;
          
          if (state.verification_attempts >= 3) {
            await maybeSendPrivateNote({
              accountId,
              conversationId,
              content: `⚠️ Múltiples intentos fallidos de verificación para pedido #${state.order_number}`,
            });
            
            await sendChatwootMessage({
              accountId,
              conversationId,
              content: "Los datos no coinciden con el pedido. Por seguridad, te canalizo con el equipo.",
            });
            clearFlow(conversationId);
            return;
          }
          
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: accessValidation.message + "\n\n" + (accessValidation.hint || ""),
          });
          return;
        }
        
        // Verificación exitosa
        state.verified = true;
        state.verification_method = accessValidation.verified_by;
        
        await maybeSendPrivateNote({
          accountId,
          conversationId,
          content: `✅ Verificación exitosa para pedido #${state.order_number} (${state.verification_method})`,
        });
        
        state.step = ORDER_MODIFY_STEPS.SHOW_ORDER;
        setFlow(conversationId, state);
        
        await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
        return;
        
      } catch (err) {
        logger.error({ err: err?.message, orderId: state.order_number }, "Error fetching order");
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Hubo un problema al buscar tu pedido. ¿Te canalizo con el equipo?",
        });
        clearFlow(conversationId);
        return;
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: SHOW_ORDER
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.SHOW_ORDER) {
      const orderSummary = formatOrderSummary(state.order_data);
      
      // Verificar si la fecha actual del pedido permite modificaciones
      const currentDateSlug = state.order_data?.delivery_date_slug || state.order_data?.fecha_slug;
      const dateCheck = canModifyOrderForDate(currentDateSlug);
      
      if (!dateCheck.can_modify) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: `${orderSummary}\n\n⚠️ ${dateCheck.message}\n\n¿Te canalizo con el equipo para ayudarte?`,
        });
        
        state.step = ORDER_MODIFY_STEPS.BLOCKED_DATE;
        setFlow(conversationId, state);
        return;
      }
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `${orderSummary}\n\n¿Qué cambio necesitas hacer?\n\n1. 📅 Cambiar fecha de entrega\n2. 📍 Cambiar sucursal\n3. ❌ Cancelar pedido\n4. 🤷 Otro cambio`,
      });
      
      state.step = ORDER_MODIFY_STEPS.ASK_CHANGE_TYPE;
      setFlow(conversationId, state);
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: BLOCKED_DATE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.BLOCKED_DATE) {
      const t = normalizeText(messageText);
      
      if (t === "si" || t === "sí" || t.includes("equipo") || t.includes("humano")) {
        await maybeSendPrivateNote({
          accountId,
          conversationId,
          content: `🔔 Cliente necesita modificar pedido #${state.order_number} pero la fecha está bloqueada.\nFecha: ${state.order_data?.delivery_date || 'N/A'}`,
        });
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Te canalizo con el equipo. En breve te contactan.",
        });
        clearFlow(conversationId);
        return;
      }
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "¿Necesitas algo más?",
      });
      clearFlow(conversationId);
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_CHANGE_TYPE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.ASK_CHANGE_TYPE) {
      const t = normalizeText(messageText);
      const num = parseInt(messageText);
      
      if (num === 1 || t.includes("fecha") || t.includes("dia") || t.includes("cuando")) {
        state.change_type = "date";
        state.step = ORDER_MODIFY_STEPS.ASK_NEW_DATE;
      } else if (num === 2 || t.includes("sucursal") || t.includes("donde") || t.includes("recoger")) {
        state.change_type = "branch";
        state.step = ORDER_MODIFY_STEPS.ASK_NEW_BRANCH;
      } else if (num === 3 || t.includes("cancelar")) {
        state.change_type = "cancel";
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Para cancelaciones, necesito canalizarte con el equipo. ¿Está bien?",
        });
        state.step = ORDER_MODIFY_STEPS.ESCALATE;
        setFlow(conversationId, state);
        return;
      } else if (num === 4 || t.includes("otro")) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Para ese tipo de cambio te canalizo con el equipo. ¿Está bien?",
        });
        state.step = ORDER_MODIFY_STEPS.ESCALATE;
        setFlow(conversationId, state);
        return;
      } else {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No entendí. ¿Qué tipo de cambio necesitas? (1=Fecha, 2=Sucursal, 3=Cancelar, 4=Otro)",
        });
        return;
      }
      
      setFlow(conversationId, state);
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_NEW_DATE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.ASK_NEW_DATE) {
      const fechas = Array.isArray(csInfo?.fechas_disponibles) ? csInfo.fechas_disponibles : [];
      
      // Filtrar fechas válidas para modificación
      const validFechas = fechas.filter(f => {
        const validation = validateOrderDate({
          dateSlug: f.slug,
          branchId: state.order_data?.branch_id,
          channel: 'bot',
          action: 'modify',
        });
        return validation.allowed || validation.can_modify !== false;
      }).slice(0, 7);
      
      if (validFechas.length === 0) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No hay fechas disponibles para cambio en este momento. ¿Te canalizo con el equipo?",
        });
        state.step = ORDER_MODIFY_STEPS.ESCALATE;
        setFlow(conversationId, state);
        return;
      }
      
      state.options.fechas = validFechas;
      
      const fechaList = validFechas.map((f, i) => `${i + 1}. ${f.nombre || f.slug}`).join("\n");
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `¿Para qué nueva fecha?\n\n${fechaList}\n\n(Responde con el número o escribe la fecha)`,
      });
      
      state.step = "AWAIT_NEW_DATE";
      setFlow(conversationId, state);
      return;
    }
    
    if (state.step === "AWAIT_NEW_DATE") {
      const fechas = state.options.fechas || [];
      const num = parseInt(messageText);
      
      let fecha = null;
      if (num >= 1 && num <= fechas.length) {
        fecha = fechas[num - 1];
      } else {
        fecha = matchDateFromText(messageText, fechas, { timeZone: "America/Mexico_City" });
      }
      
      if (!fecha) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No encontré esa fecha. ¿Me dices el número o escribes la fecha?",
        });
        return;
      }
      
      // Validar fecha
      const dateValidation = validateOrderDate({
        dateSlug: fecha.slug,
        branchId: state.order_data?.branch_id,
        channel: 'bot',
        action: 'modify',
      });
      
      if (!dateValidation.allowed && dateValidation.can_modify === false) {
        const message = getBotMessageForRule(dateValidation);
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: message + "\n\n¿Quieres elegir otra fecha?",
        });
        state.step = ORDER_MODIFY_STEPS.ASK_NEW_DATE;
        setFlow(conversationId, state);
        return;
      }
      
      state.new_date = fecha;
      state.date_validation = dateValidation;
      state.step = ORDER_MODIFY_STEPS.CONFIRM_CHANGE;
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ASK_NEW_BRANCH
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.ASK_NEW_BRANCH) {
      const branches = listBranches().filter(b => b.enabled !== false);
      
      if (branches.length === 0) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "No hay sucursales disponibles. Te canalizo con el equipo.",
        });
        clearFlow(conversationId);
        return;
      }
      
      state.options.branches = branches;
      
      const branchList = branches.map((b, i) => `${i + 1}. ${b.name || b.short_name}${b.city ? ` (${b.city})` : ""}`).join("\n");
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `¿A qué sucursal quieres cambiar?\n\n${branchList}\n\n(Responde con el número o el nombre)`,
      });
      
      state.step = "AWAIT_NEW_BRANCH";
      setFlow(conversationId, state);
      return;
    }
    
    if (state.step === "AWAIT_NEW_BRANCH") {
      const branches = state.options.branches || [];
      const num = parseInt(messageText);
      
      let branch = null;
      if (num >= 1 && num <= branches.length) {
        branch = branches[num - 1];
      } else {
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
      
      state.new_branch = branch;
      state.step = ORDER_MODIFY_STEPS.CONFIRM_CHANGE;
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: CONFIRM_CHANGE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.CONFIRM_CHANGE) {
      let changeDescription = "";
      
      if (state.change_type === "date" && state.new_date) {
        changeDescription = `📅 Nueva fecha: ${state.new_date.nombre || state.new_date.slug}`;
      } else if (state.change_type === "branch" && state.new_branch) {
        changeDescription = `📍 Nueva sucursal: ${state.new_branch.name || state.new_branch.short_name}`;
      }
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: `Por favor confirma el cambio:\n\n📦 Pedido #${state.order_number}\n${changeDescription}\n\n¿Confirmas el cambio? (Sí/No)`,
      });
      
      state.step = "AWAIT_CONFIRM";
      setFlow(conversationId, state);
      return;
    }
    
    if (state.step === "AWAIT_CONFIRM") {
      if (!detectsConfirm(messageText)) {
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "De acuerdo, no se realizó ningún cambio. ¿Necesitas algo más?",
        });
        clearFlow(conversationId);
        return;
      }
      
      state.step = ORDER_MODIFY_STEPS.PROCESS_CHANGE;
      setFlow(conversationId, state);
      
      await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: PROCESS_CHANGE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.PROCESS_CHANGE) {
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "Procesando el cambio...",
      });
      
      try {
        const result = await csCambiarEntrega({
          order_id: state.order_number,
          nueva_fecha: state.new_date?.slug || null,
          nueva_sucursal: state.new_branch?.branch_id || null,
        });
        
        if (!result?.success) {
          const errorMsg = result?.mensaje || "No se pudo procesar el cambio";
          await sendChatwootMessage({
            accountId,
            conversationId,
            content: `Hubo un problema: ${errorMsg}\n\n¿Te canalizo con el equipo?`,
          });
          state.step = ORDER_MODIFY_STEPS.ESCALATE;
          setFlow(conversationId, state);
          return;
        }
        
        // Éxito
        await maybeSendPrivateNote({
          accountId,
          conversationId,
          content: `✅ Cambio exitoso en pedido #${state.order_number}\n` +
            `Tipo: ${state.change_type}\n` +
            `Nueva fecha: ${state.new_date?.nombre || 'Sin cambio'}\n` +
            `Nueva sucursal: ${state.new_branch?.name || 'Sin cambio'}`,
        });
        
        let successMsg = `¡Listo! Tu pedido #${state.order_number} ha sido actualizado.\n\n`;
        
        if (state.change_type === "date") {
          successMsg += `📅 Nueva fecha de entrega: ${state.new_date.nombre || state.new_date.slug}`;
        } else if (state.change_type === "branch") {
          successMsg += `📍 Nueva sucursal: ${state.new_branch.name || state.new_branch.short_name}`;
        }
        
        successMsg += "\n\n¿Necesitas algo más?";
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: successMsg,
        });
        
        clearFlow(conversationId);
        return;
        
      } catch (err) {
        logger.error({ err: err?.message, orderId: state.order_number }, "Error processing order change");
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Hubo un error técnico al procesar el cambio. Te canalizo con el equipo.",
        });
        clearFlow(conversationId);
        return;
      }
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Step: ESCALATE
    // ─────────────────────────────────────────────────────────────────────
    
    if (state.step === ORDER_MODIFY_STEPS.ESCALATE) {
      const t = normalizeText(messageText);
      
      if (t === "si" || t === "sí" || t === "dale" || t === "ok") {
        await maybeSendPrivateNote({
          accountId,
          conversationId,
          content: `🔔 Escalación de cambio de pedido\n` +
            `Pedido: #${state.order_number}\n` +
            `Tipo cambio: ${state.change_type || 'No especificado'}\n` +
            `Verificado: ${state.verified ? 'Sí' : 'No'}`,
        });
        
        await sendChatwootMessage({
          accountId,
          conversationId,
          content: "Te canalizo con el equipo. En breve te contactan.",
        });
        clearFlow(conversationId);
        return;
      }
      
      await sendChatwootMessage({
        accountId,
        conversationId,
        content: "De acuerdo. ¿Necesitas algo más?",
      });
      clearFlow(conversationId);
      return;
    }
    
    // ─────────────────────────────────────────────────────────────────────
    // Default: unknown step
    // ─────────────────────────────────────────────────────────────────────
    
    logger.warn({ step: state.step, conversationId }, "Unknown ORDER_MODIFY step, resetting to INIT");
    state.step = ORDER_MODIFY_STEPS.INIT;
    setFlow(conversationId, state);
    await advance({ state, csInfo, accountId, conversationId, contact, messageText, inboxId, inboxName });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HANDLE: Entry point (with LangSmith tracing)
  // ─────────────────────────────────────────────────────────────────────────
  
  async function _handleInternal(params) {
    await advance(params);
    return true;
  }
  
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
    advanceSecureOrderModifyFlow: advance,
    handleSecureOrderModifyFlow: handle,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  createSecureOrderModifyState,
  makeSecureOrderModifyHandlers,
  ORDER_MODIFY_STEPS,
};
