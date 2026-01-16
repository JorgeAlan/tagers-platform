/**
 * ═══════════════════════════════════════════════════════════════════════════
 * QUICK RESPONSES - Respuestas Rápidas sin IA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Respuestas predefinidas para casos comunes que no necesitan IA.
 * 
 * IMPORTANTE: Usa Config Hub para datos dinámicos.
 * NO tiene datos hardcodeados de sucursales/horarios para evitar errores.
 * 
 * @version 2.0.0 - Config Hub Integration
 */

import { getConfig } from "../config-hub/sync-service.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS - Obtener datos del Config Hub
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene respuesta predefinida (canned) del Config Hub
 */
function getCannedResponse(trigger) {
  try {
    const config = getConfig();
    if (!config?.canned) return null;
    
    const canned = config.canned.find(c => 
      c.enabled && 
      c.trigger?.toLowerCase() === trigger.toLowerCase()
    );
    
    return canned?.response || null;
  } catch {
    return null;
  }
}

/**
 * Busca FAQ en el Config Hub
 */
function getFAQFromHub(query) {
  try {
    const config = getConfig();
    if (!config?.faq) return null;
    
    const q = query.toLowerCase();
    
    // Buscar por keywords o por categoría
    const match = config.faq.find(f => {
      if (!f.enabled) return false;
      
      // Match por keywords
      if (f.keywords) {
        const keywords = f.keywords.toLowerCase().split(',').map(k => k.trim());
        if (keywords.some(k => q.includes(k) || k.includes(q))) return true;
      }
      
      // Match por categoría
      if (f.category?.toLowerCase() === q) return true;
      
      return false;
    });
    
    return match?.answer || null;
  } catch {
    return null;
  }
}

/**
 * Genera resumen de horarios desde Config Hub
 */
function getHoursFromHub() {
  try {
    const config = getConfig();
    if (!config?.branches || !config?.branch_hours) return null;
    
    const enabledBranches = config.branches.filter(b => b.enabled);
    if (enabledBranches.length === 0) return null;
    
    let response = "📍 **Horarios:**\n\n";
    
    for (const branch of enabledBranches) {
      // Buscar horarios de esta sucursal
      const hours = config.branch_hours.filter(h => 
        h.branch_id === branch.branch_id && h.enabled
      );
      
      if (hours.length > 0) {
        // Simplificar: mostrar horario de Lun-Dom si son iguales
        const mainHour = hours[0];
        response += `• **${branch.short_name || branch.name}**: ${mainHour.open || '?'} - ${mainHour.close || '?'}\n`;
      } else {
        response += `• **${branch.short_name || branch.name}**: Consultar en sucursal\n`;
      }
    }
    
    response += "\n¿Te gustaría saber la dirección de alguna sucursal?";
    
    return response;
  } catch {
    return null;
  }
}

/**
 * Genera resumen de ubicaciones desde Config Hub
 */
function getLocationsFromHub() {
  try {
    const config = getConfig();
    if (!config?.branches) return null;
    
    const enabledBranches = config.branches.filter(b => b.enabled);
    if (enabledBranches.length === 0) return null;
    
    let response = "📍 **Nuestras sucursales:**\n\n";
    
    for (const branch of enabledBranches) {
      response += `• **${branch.short_name || branch.name}**`;
      if (branch.city) response += ` (${branch.city})`;
      if (branch.address) response += ` - ${branch.address}`;
      response += "\n";
    }
    
    response += "\n¿Quieres que te comparta la ubicación de alguna?";
    
    return response;
  } catch {
    return null;
  }
}

/**
 * Genera resumen de formas de pago desde Config Hub
 */
function getPaymentMethodsFromHub() {
  try {
    const config = getConfig();
    if (!config?.branches) return null;
    
    // Obtener métodos de pago de la primera sucursal (asumiendo que son iguales)
    const branch = config.branches.find(b => b.enabled && b.payment_methods);
    if (!branch?.payment_methods) return null;
    
    let response = "💳 **Formas de pago:**\n\n";
    response += branch.payment_methods;
    response += "\n\n¿Algo más en que te pueda ayudar?";
    
    return response;
  } catch {
    return null;
  }
}

/**
 * Genera menú de productos desde Config Hub
 * Usado para responder "menu", "carta", "productos", "precios"
 */
function getMenuFromHub() {
  try {
    const config = getConfig();
    
    // Intentar obtener de roscas primero, luego products
    const products = config?.roscas?.length ? config.roscas : config?.products;
    if (!products?.length) return null;
    
    // Filtrar productos habilitados
    const enabledProducts = products.filter(p => p.enabled !== false);
    if (enabledProducts.length === 0) return null;
    
    let response = "🥐 **Nuestros Productos:**\n\n";
    
    for (const product of enabledProducts) {
      const name = product.name || product.title;
      const price = product.price || product.base_price;
      const description = product.description || product.short_description;
      const portions = product.portions || product.servings;
      
      response += `• **${name}**`;
      if (price) response += ` - $${price} MXN`;
      response += "\n";
      
      if (description) {
        response += `  ${description}`;
        if (portions) response += ` (${portions} porciones)`;
        response += "\n";
      }
      response += "\n";
    }
    
    response += "¿Te gustaría ordenar alguna? Solo dime cuál y la cantidad 😊";
    
    return response;
  } catch {
    return null;
  }
}

/**
 * Genera información de delivery/envío desde Config Hub
 * Usado para responder "envio", "delivery", "a domicilio"
 */
function getDeliveryFromHub() {
  try {
    const config = getConfig();
    
    // Buscar en FAQ por delivery/envio
    if (config?.faq) {
      const deliveryFaq = config.faq.find(f => 
        f.enabled && 
        (f.category?.toLowerCase() === 'envio' || 
         f.category?.toLowerCase() === 'delivery' ||
         f.keywords?.toLowerCase().includes('envio') ||
         f.keywords?.toLowerCase().includes('delivery'))
      );
      if (deliveryFaq?.answer) return deliveryFaq.answer;
    }
    
    // Buscar en branches por delivery_policy
    if (config?.branches) {
      const branchWithDelivery = config.branches.find(b => 
        b.enabled && (b.delivery_policy || b.delivery || b.has_delivery)
      );
      
      if (branchWithDelivery) {
        const policy = branchWithDelivery.delivery_policy || branchWithDelivery.delivery;
        if (policy) {
          let response = "🚚 **Envío a domicilio:**\n\n";
          response += policy;
          response += "\n\n¿Te gustaría hacer un pedido?";
          return response;
        }
      }
    }
    
    // Fallback genérico (sin inventar datos)
    return "📍 Actualmente solo manejamos recolección en sucursal. ¿Te gustaría saber nuestras ubicaciones?";
    
  } catch {
    return null;
  }
}

/**
 * Genera lista de promociones activas desde Config Hub
 * Usado para responder "promociones", "ofertas", "descuentos"
 */
function getPromosFromHub() {
  try {
    const config = getConfig();
    
    // Buscar en FAQ por promos
    if (config?.faq) {
      const promosFaq = config.faq.find(f => 
        f.enabled && 
        (f.category?.toLowerCase() === 'promociones' ||
         f.category?.toLowerCase() === 'promos' ||
         f.keywords?.toLowerCase().includes('promo'))
      );
      if (promosFaq?.answer) return promosFaq.answer;
    }
    
    // Buscar en una posible sección de promos
    if (config?.promotions?.length) {
      const activePromos = config.promotions.filter(p => {
        if (!p.enabled) return false;
        if (p.end_date && new Date(p.end_date) < new Date()) return false;
        return true;
      });
      
      if (activePromos.length > 0) {
        let response = "🎉 **Promociones activas:**\n\n";
        
        for (const promo of activePromos) {
          response += `• **${promo.title || promo.name}**\n`;
          if (promo.description) response += `  ${promo.description}\n`;
          if (promo.code) response += `  Código: ${promo.code}\n`;
          if (promo.end_date) {
            const endDate = new Date(promo.end_date).toLocaleDateString('es-MX');
            response += `  Válido hasta: ${endDate}\n`;
          }
          response += "\n";
        }
        
        return response;
      }
    }
    
    return null;
  } catch {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SALUDOS
// ═══════════════════════════════════════════════════════════════════════════

export function getGreeting() {
  // Intentar canned response
  const canned = getCannedResponse('greeting');
  if (canned) return canned;
  
  // Intentar persona.greeting del Config Hub
  try {
    const config = getConfig();
    if (config?.persona?.greeting) {
      return config.persona.greeting;
    }
  } catch {}
  
  // Fallback genérico (sin datos específicos)
  return "¡Hola! 👋 Soy Tan • IA de Tagers. ¿En qué te puedo ayudar?";
}

// ═══════════════════════════════════════════════════════════════════════════
// FAQs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene respuesta FAQ por key/categoría
 * SIEMPRE intenta obtener datos del Config Hub primero
 */
export function getFAQAnswer(key) {
  const k = (key || "").toLowerCase();
  
  // Intentar FAQ del Config Hub
  const hubFaq = getFAQFromHub(k);
  if (hubFaq) return hubFaq;
  
  // Casos especiales que necesitan datos estructurados
  switch (k) {
    case 'horarios':
    case 'horario':
    case 'horas':
      const hours = getHoursFromHub();
      if (hours) return hours;
      break;
      
    case 'ubicacion':
    case 'ubicaciones':
    case 'direccion':
    case 'sucursales':
      const locations = getLocationsFromHub();
      if (locations) return locations;
      break;
      
    case 'pago':
    case 'pagos':
    case 'formas de pago':
      const payments = getPaymentMethodsFromHub();
      if (payments) return payments;
      break;
    
    // === NUEVOS HANDLERS ===
    case 'menu':
    case 'carta':
    case 'productos':
    case 'precios':
    case 'catalogo':
    case 'roscas':
      const menu = getMenuFromHub();
      if (menu) return menu;
      break;
      
    case 'envio':
    case 'envío':
    case 'delivery':
    case 'domicilio':
    case 'a domicilio':
    case 'entregan':
      const delivery = getDeliveryFromHub();
      if (delivery) return delivery;
      break;
      
    case 'promociones':
    case 'promos':
    case 'ofertas':
    case 'descuentos':
      const promos = getPromosFromHub();
      if (promos) return promos;
      break;
  }
  
  // Si no encontramos nada, NO inventar datos
  // Mejor decir que no tenemos la info
  return null;
}

export function getAllFAQKeys() {
  try {
    const config = getConfig();
    if (!config?.faq) return ['horarios', 'ubicacion', 'pago'];
    
    // Obtener categorías únicas del Config Hub
    const categories = [...new Set(
      config.faq
        .filter(f => f.enabled)
        .map(f => f.category?.toLowerCase() || 'general')
    )];
    
    return categories;
  } catch {
    return ['horarios', 'ubicacion', 'pago'];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MENSAJES DE SISTEMA
// ═══════════════════════════════════════════════════════════════════════════

export function getSystemMessage(key, vars = {}) {
  // Intentar obtener del Config Hub
  const canned = getCannedResponse(`system_${key}`);
  if (canned) {
    let message = canned;
    for (const [k, v] of Object.entries(vars)) {
      message = message.replace(`{${k}}`, v);
    }
    return message;
  }
  
  // Fallbacks genéricos (sin datos específicos de negocio)
  const SYSTEM_FALLBACKS = {
    error: "Disculpa, tuve un problema técnico. ¿Podrías repetir tu mensaje? 🙏",
    timeout: "Perdón por la demora. Estoy procesando tu solicitud...",
    handoff_pending: "Te estamos conectando con un agente. En breve te atienden.",
    outside_hours: "Gracias por escribirnos. Te responderemos lo antes posible.",
    rate_limited: "Estás enviando mensajes muy rápido. Por favor espera un momento.",
    maintenance: "Estamos en mantenimiento. Por favor intenta más tarde.",
  };
  
  let message = SYSTEM_FALLBACKS[key] || SYSTEM_FALLBACKS.error;
  
  for (const [k, v] of Object.entries(vars)) {
    message = message.replace(`{${k}}`, v);
  }
  
  return message;
}

// ═══════════════════════════════════════════════════════════════════════════
// RESPUESTAS CONTEXTUALES
// ═══════════════════════════════════════════════════════════════════════════

export function getContextualResponse(context) {
  const { messageText, hasActiveFlow } = context;
  const text = (messageText || "").toLowerCase();
  
  // Cancelar flujo
  if (hasActiveFlow && /\b(cancelar|salir|no\s+quiero|olvidalo|olvídalo)\b/.test(text)) {
    const canned = getCannedResponse('cancel');
    return {
      response: canned || "Entendido, cancelé el proceso. ¿Hay algo más en que te pueda ayudar?",
      action: "clear_flow",
    };
  }
  
  // Gracias
  if (/\b(gracias|thanks|thx)\b/i.test(text)) {
    const canned = getCannedResponse('thanks');
    return {
      response: canned || "¡Con gusto! ¿Algo más en que te pueda ayudar? 😊",
      action: null,
    };
  }
  
  // Adiós
  if (/\b(adios|bye|hasta\s+luego|nos\s+vemos)\b/i.test(text)) {
    const canned = getCannedResponse('farewell');
    return {
      response: canned || "¡Hasta pronto! Que tengas excelente día. 👋",
      action: "close_conversation",
    };
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const quickResponses = {
  getGreeting,
  getFAQAnswer,
  getAllFAQKeys,
  getSystemMessage,
  getContextualResponse,
};

export default quickResponses;
