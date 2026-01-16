/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDER CREATE FLOW - Flujo de creación de pedidos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Máquina de estados para el flujo de pedidos de rosca:
 * INIT → ASK_PRODUCT → ASK_BRANCH → ASK_DATE → ASK_QUANTITY → CONFIRM → CHECKOUT
 * 
 * Cada paso valida y acumula datos en el draft.
 * 
 * @version 3.1.0 - Analytics tracking + Multi-idioma
 */

import { logger } from "../utils/logger.js";
import { flowStateService, ORDER_CREATE_STEPS } from "../services/flowStateService.js";
import { classifyOrderStep } from "../openai_client_tania.js";
import KnowledgeHub from "../knowledge-hub/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// FASE 4: GROWTH INTEGRATIONS
// ═══════════════════════════════════════════════════════════════════════════
import { createPaymentLink, generatePaymentMessage, isPaymentsEnabled } from "../services/payments.js";
import { proactiveService } from "../services/proactive.js";
import { abTestingService } from "../services/abTesting.js";

// ═══════════════════════════════════════════════════════════════════════════
// ANALYTICS & MULTILANG
// ═══════════════════════════════════════════════════════════════════════════
import { analyticsService } from "../services/analytics.js";
import { multilangService } from "../services/multilang.js";

// ═══════════════════════════════════════════════════════════════════════════
// HANDLER PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Maneja un mensaje dentro del flujo ORDER_CREATE
 * 
 * @param {Object} ctx - Contexto del mensaje
 * @param {Object} state - Estado actual del flujo
 * @returns {Promise<{message: string}|null>}
 */
async function handle(ctx, state) {
  const { conversationId, contactId, messageText } = ctx;
  const { step, draft } = state;
  
  // Detectar idioma del cliente
  const lang = multilangService.getConversationLanguage(conversationId);
  
  logger.info({
    conversationId,
    step,
    lang,
    draftProduct: draft?.product_key,
    draftBranch: draft?.branch_id,
  }, "OrderCreate: handling step");
  
  // Track paso del flujo
  analyticsService.trackOrderFlowStep(conversationId, step, {
    product: draft?.product_name,
    branch: draft?.branch_name,
    language: lang,
  }).catch(() => {});
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 4: Cancelar mensajes proactivos pendientes (el usuario respondió)
  // ═══════════════════════════════════════════════════════════════════════════
  try {
    await proactiveService.cancelScheduledMessages(conversationId, "cart_abandoned");
  } catch (err) {
    // Ignorar errores de cancelación
  }
  
  // Clasificar la intención del mensaje dentro del flujo
  const classification = await classifyStepMessage(ctx, state);
  
  // Manejar cancelación
  if (classification?.intent === "cancel") {
    // Track abandono por cancelación
    analyticsService.trackOrderFlowAbandoned(conversationId, step, {
      product: draft?.product_name,
      branch: draft?.branch_name,
      reason: "user_cancelled",
    }).catch(() => {});
    
    flowStateService.clearFlow(conversationId);
    return { message: multilangService.getTranslation("cancelled", lang) };
  }
  
  // Router por paso actual
  let result;
  switch (step) {
    case ORDER_CREATE_STEPS.INIT:
    case ORDER_CREATE_STEPS.ASK_PRODUCT:
      result = await handleProductSelection(ctx, state, classification);
      break;
    
    case ORDER_CREATE_STEPS.ASK_BRANCH:
      result = await handleBranchSelection(ctx, state, classification);
      break;
    
    case ORDER_CREATE_STEPS.ASK_DATE:
      result = await handleDateSelection(ctx, state, classification);
      break;
    
    case ORDER_CREATE_STEPS.ASK_QUANTITY:
      result = await handleQuantitySelection(ctx, state, classification);
      break;
    
    case ORDER_CREATE_STEPS.CONFIRM:
      result = await handleConfirmation(ctx, state, classification);
      break;
    
    default:
      logger.warn({ step, conversationId }, "Unknown order create step");
      result = await handleProductSelection(ctx, state, classification);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FASE 4: Programar carrito abandonado si no estamos en checkout
  // ═══════════════════════════════════════════════════════════════════════════
  const currentState = flowStateService.getFlow(conversationId);
  if (currentState && currentState.step !== ORDER_CREATE_STEPS.CHECKOUT) {
    try {
      await proactiveService.triggerCartAbandoned(conversationId, contactId, {
        customerName: ctx.senderName,
        items: draft?.product_name,
        step: currentState.step,
      });
    } catch (err) {
      logger.debug({ err: err.message }, "Failed to schedule cart abandoned message");
    }
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASIFICACIÓN DE MENSAJE
// ═══════════════════════════════════════════════════════════════════════════

async function classifyStepMessage(ctx, state) {
  const { messageText, conversationId } = ctx;
  const { step, draft } = state;
  
  const instructions = `Eres un experto clasificando intenciones en un flujo de pedidos de roscas.

Paso actual: ${step}
Producto seleccionado: ${draft?.product_name || "ninguno"}
Sucursal seleccionada: ${draft?.branch_name || "ninguna"}
Fecha seleccionada: ${draft?.date_label || "ninguna"}

Analiza el mensaje y clasifica la intención del usuario.`;
  
  try {
    return await classifyOrderStep({
      instructions,
      inputObject: {
        step,
        message_text: messageText,
        draft: {
          product: draft?.product_name,
          branch: draft?.branch_name,
          date: draft?.date_label,
          quantity: draft?.quantity || 1,
        },
        options: {
          products: [], // TODO: cargar dinámicamente
          branches: [],
          fechas: [],
        },
      },
    });
  } catch (error) {
    logger.warn({ err: error?.message, conversationId }, "Order step classification failed");
    return { intent: "unknown", confidence: 0 };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HANDLERS POR PASO
// ═══════════════════════════════════════════════════════════════════════════

async function handleProductSelection(ctx, state, classification) {
  const { conversationId } = ctx;
  const { draft } = state;
  
  // Si hay producto en la clasificación
  if (classification?.product_text) {
    // TODO: Buscar producto en catálogo
    const productMatch = matchProduct(classification.product_text);
    
    if (productMatch) {
      draft.product_key = productMatch.key;
      draft.product_name = productMatch.name;
      draft.product_id = productMatch.id;
      draft.product_price = productMatch.price || 450; // Precio para cálculo de total
      
      // Avanzar a siguiente paso
      state.step = ORDER_CREATE_STEPS.ASK_BRANCH;
      flowStateService.setFlow(conversationId, state);
      
      return {
        message: `Perfecto, ${productMatch.name}. ¿En qué sucursal te gustaría recogerla?\n\n1. San Ángel (CDMX)\n2. Angelópolis (Puebla)\n3. Sonata (Puebla)\n4. Zavaleta (Puebla)\n5. 5 Sur (Puebla)`,
      };
    }
  }
  
  // Preguntar producto
  state.step = ORDER_CREATE_STEPS.ASK_PRODUCT;
  flowStateService.setFlow(conversationId, state);
  
  return {
    message: `¡Claro! ${KnowledgeHub.getProductListForCustomer('roscas')}`,
  };
}

async function handleBranchSelection(ctx, state, classification) {
  const { conversationId } = ctx;
  const { draft } = state;
  
  // Si hay sucursal en la clasificación
  if (classification?.branch_text || classification?.selection_number) {
    const branchMatch = matchBranch(classification.branch_text || classification.selection_number);
    
    if (branchMatch) {
      draft.branch_id = branchMatch.branch_id;
      draft.branch_name = branchMatch.name;
      
      state.step = ORDER_CREATE_STEPS.ASK_DATE;
      flowStateService.setFlow(conversationId, state);
      
      return {
        message: `Excelente, ${branchMatch.name}. ¿Para qué fecha lo necesitas?\n\nTenemos disponibilidad del 2 al 11 de enero.`,
      };
    }
  }
  
  return {
    message: `No identifiqué la sucursal. ¿Cuál prefieres?\n\n1. San Ángel (CDMX)\n2. Angelópolis (Puebla)\n3. Sonata (Puebla)\n4. Zavaleta (Puebla)\n5. 5 Sur (Puebla)`,
  };
}

async function handleDateSelection(ctx, state, classification) {
  const { conversationId } = ctx;
  const { draft } = state;
  
  // Si hay fecha en la clasificación
  if (classification?.date_text) {
    const dateMatch = matchDate(classification.date_text);
    
    if (dateMatch) {
      draft.date_slug = dateMatch.slug;
      draft.date_label = dateMatch.label;
      
      state.step = ORDER_CREATE_STEPS.ASK_QUANTITY;
      flowStateService.setFlow(conversationId, state);
      
      return {
        message: `Perfecto, para el ${dateMatch.label}. ¿Cuántas roscas necesitas?`,
      };
    }
  }
  
  return {
    message: `¿Para qué fecha necesitas tu rosca? Tenemos disponibilidad del 2 al 11 de enero.`,
  };
}

async function handleQuantitySelection(ctx, state, classification) {
  const { conversationId } = ctx;
  const { draft } = state;
  
  // Si hay cantidad en la clasificación
  const quantity = classification?.quantity || parseInt(ctx.messageText) || 1;
  
  if (quantity >= 1 && quantity <= 50) {
    draft.quantity = quantity;
    
    state.step = ORDER_CREATE_STEPS.CONFIRM;
    flowStateService.setFlow(conversationId, state);
    
    // Generar resumen
    const summary = formatOrderSummary(draft);
    
    return {
      message: `${summary}\n\n¿Confirmas tu pedido?`,
    };
  }
  
  return {
    message: `¿Cuántas roscas necesitas? (1-50)`,
  };
}

async function handleConfirmation(ctx, state, classification) {
  const { conversationId, contactId } = ctx;
  const { draft } = state;
  
  const confirmAnswer = classification?.confirm_answer;
  
  if (confirmAnswer === "yes") {
    state.step = ORDER_CREATE_STEPS.CHECKOUT;
    draft.checkout_ready = true;
    flowStateService.setFlow(conversationId, state);
    
    // Track orden completada
    analyticsService.trackOrderCompleted(conversationId, {
      productName: draft.product_name,
      productKey: draft.product_key,
      branchId: draft.branch_id,
      branchName: draft.branch_name,
      quantity: draft.quantity || 1,
      date: draft.date_label,
      amount: (draft.product_price || 450) * (draft.quantity || 1),
    }).catch(() => {});
    
    // ═══════════════════════════════════════════════════════════════════════
    // FASE 4: INTEGRACIÓN DE PAGOS
    // ═══════════════════════════════════════════════════════════════════════
    
    // Calcular precio total
    const unitPrice = draft.product_price || 450; // Precio por defecto si no está en draft
    const totalAmount = unitPrice * (draft.quantity || 1);
    
    // Generar ID de pedido temporal
    const orderId = `TMP-${Date.now().toString(36).toUpperCase()}`;
    draft.order_id = orderId;
    draft.total_amount = totalAmount;
    
    // Intentar crear link de pago si está habilitado
    if (isPaymentsEnabled()) {
      try {
        const paymentLink = await createPaymentLink({
          id: orderId,
          amount: totalAmount,
          title: `${draft.quantity}x ${draft.product_name}`,
          customer: {
            name: ctx.senderName || "Cliente",
            phone: ctx.senderPhone,
          },
          items: [{
            name: draft.product_name,
            quantity: draft.quantity || 1,
            price: unitPrice,
          }],
        });
        
        if (paymentLink) {
          draft.payment_link = paymentLink.url;
          draft.payment_provider = paymentLink.provider;
          draft.payment_id = paymentLink.preferenceId || paymentLink.sessionId;
          flowStateService.setFlow(conversationId, state);
          
          logger.info({
            conversationId,
            orderId,
            paymentProvider: paymentLink.provider,
            amount: totalAmount,
          }, "Payment link created for order");
          
          // Programar recordatorio de pago pendiente (30 min)
          await proactiveService.triggerPaymentPending(conversationId, contactId, {
            orderId,
            paymentLink: paymentLink.url,
          });
          
          return {
            message: generatePaymentMessage(paymentLink, {
              id: orderId,
              amount: totalAmount,
            }),
          };
        }
      } catch (error) {
        logger.warn({ err: error.message, conversationId }, "Failed to create payment link, using fallback");
      }
    }
    
    // Fallback: Link a checkout de WooCommerce
    return {
      message: `¡Excelente! Tu pedido #${orderId} está listo.

📋 *Resumen:*
• ${draft.quantity}x ${draft.product_name}
• Sucursal: ${draft.branch_name}
• Fecha: ${draft.date_label}
• Total: $${totalAmount.toLocaleString('es-MX')} MXN

💳 Paga en línea:
https://tagers.com/checkout/?order=${orderId}&rosca=${draft.product_key}&branch=${draft.branch_id}

O puedes pagar al recoger en sucursal.

¡Gracias por tu preferencia! 🥐🎉`,
    };
  }
  
  if (confirmAnswer === "no" || classification?.intent === "change") {
    const target = classification?.change_target;
    
    if (target === "product") {
      state.step = ORDER_CREATE_STEPS.ASK_PRODUCT;
    } else if (target === "branch") {
      state.step = ORDER_CREATE_STEPS.ASK_BRANCH;
    } else if (target === "date") {
      state.step = ORDER_CREATE_STEPS.ASK_DATE;
    } else if (target === "quantity") {
      state.step = ORDER_CREATE_STEPS.ASK_QUANTITY;
    }
    
    flowStateService.setFlow(conversationId, state);
    
    return {
      message: `Claro, ¿qué te gustaría cambiar?\n\n1. Producto\n2. Sucursal\n3. Fecha\n4. Cantidad`,
    };
  }
  
  return {
    message: `¿Confirmas tu pedido? Responde "sí" o "no".`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCHERS (TODO: Integrar con WordPress/Config Hub)
// ═══════════════════════════════════════════════════════════════════════════

function matchProduct(text) {
  const normalized = String(text || "").toLowerCase();
  
  // Usar productos del Knowledge Hub
  const products = KnowledgeHub.getAllProducts();
  
  if (products.length === 0) {
    // Fallback mínimo si no hay config
    return null;
  }
  
  // Por número
  const num = parseInt(text);
  if (num >= 1 && num <= products.length) {
    const p = products[num - 1];
    return { 
      key: p.sku || p.name, 
      name: p.name, 
      id: p.woo_id || num,
      price: p.price
    };
  }
  
  // Por nombre/keyword usando Knowledge Hub
  const match = KnowledgeHub.extractProduct(text);
  if (match && match.sku) {
    return {
      key: match.sku,
      name: match.name,
      id: match.woo_id,
      price: match.price
    };
  }
  
  return null;
}

function matchBranch(input) {
  const normalized = String(input || "").toLowerCase();
  
  // Usar sucursales del Knowledge Hub
  const branches = KnowledgeHub.getAllBranches();
  
  if (branches.length === 0) {
    // Fallback mínimo si no hay config
    return null;
  }
  
  // Por número
  const num = parseInt(input);
  if (num >= 1 && num <= branches.length) {
    const b = branches[num - 1];
    return { branch_id: b.branch_id, name: b.name };
  }
  
  // Por nombre/synonym usando Knowledge Hub
  const match = KnowledgeHub.extractBranch(input);
  if (match && match.branch_id) {
    return {
      branch_id: match.branch_id,
      name: match.name
    };
  }
  
  return null;
}

function matchDate(text) {
  const normalized = String(text || "").toLowerCase();
  
  // Simplificado - en producción usar Config Hub
  if (normalized.includes("6") || normalized.includes("seis") || normalized.includes("reyes")) {
    return { slug: "enero-06", label: "6 de enero (Día de Reyes)" };
  }
  if (normalized.includes("mañana")) {
    return { slug: "tomorrow", label: "mañana" };
  }
  if (normalized.includes("hoy")) {
    return { slug: "today", label: "hoy" };
  }
  
  // Buscar números del 2-11
  const match = normalized.match(/\b(\d{1,2})\b/);
  if (match) {
    const day = parseInt(match[1]);
    if (day >= 2 && day <= 11) {
      return { slug: `enero-${day.toString().padStart(2, "0")}`, label: `${day} de enero` };
    }
  }
  
  return null;
}

function formatOrderSummary(draft) {
  return `📋 *Resumen de tu pedido:*

• Producto: ${draft.product_name || "No seleccionado"}
• Sucursal: ${draft.branch_name || "No seleccionada"}
• Fecha: ${draft.date_label || "No seleccionada"}
• Cantidad: ${draft.quantity || 1}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const orderCreateFlow = {
  handle,
};

export default orderCreateFlow;
