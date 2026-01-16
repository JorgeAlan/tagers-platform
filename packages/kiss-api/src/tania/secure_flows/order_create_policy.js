/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAN • IA — ORDER CREATE POLICY
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Lee permisos y configuración desde Config Hub (Google Sheets).
 * Patrón: Sheet define permisos, WooCommerce define disponibilidad.
 */

import { logger } from "../../utils/logger.js";
import { getConfig as getConfigHub } from "../../config-hub/sync-service.js";

// ─────────────────────────────────────────────────────────────────────────────
// Default policy (fallback)
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_POLICY = {
  enabled: true,
  require_availability_check: true,
  max_items_per_order: 10,
  max_quantity_per_item: 50,
  allow_multiple_dates: false,
  single_delivery_context: true,
  require_confirmation: true,
  link_expiration_hours: 24,
  allowed_payment_methods: ["card", "oxxo", "transfer"],
  min_lead_time_hours: 2,
  cutoff_time: "18:00",
  source: "fallback",
};

// ─────────────────────────────────────────────────────────────────────────────
// Policy reader
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lee la política de creación de pedidos desde Config Hub.
 * 
 * @returns {Object} Política efectiva con todos los campos necesarios
 */
export function getOrderCreatePolicy() {
  try {
    const hub = getConfigHub();
    
    if (!hub) {
      logger.warn("Config Hub not available, using fallback policy");
      return { ...DEFAULT_POLICY, source: "fallback" };
    }
    
    // Buscar en varias ubicaciones posibles
    const policy = hub.order_policy 
      || hub.pedidos_policy 
      || hub.order_create_policy
      || hub.policies?.order_create
      || {};
    
    // Merge con defaults
    const effective = {
      enabled: policy.enabled !== false,
      require_availability_check: policy.require_availability_check !== false,
      max_items_per_order: policy.max_items_per_order || DEFAULT_POLICY.max_items_per_order,
      max_quantity_per_item: policy.max_quantity_per_item || DEFAULT_POLICY.max_quantity_per_item,
      allow_multiple_dates: policy.allow_multiple_dates === true,
      single_delivery_context: policy.single_delivery_context !== false,
      require_confirmation: policy.require_confirmation !== false,
      link_expiration_hours: policy.link_expiration_hours || DEFAULT_POLICY.link_expiration_hours,
      allowed_payment_methods: policy.allowed_payment_methods || DEFAULT_POLICY.allowed_payment_methods,
      min_lead_time_hours: policy.min_lead_time_hours ?? DEFAULT_POLICY.min_lead_time_hours,
      cutoff_time: policy.cutoff_time || DEFAULT_POLICY.cutoff_time,
      source: "config_hub",
    };
    
    return effective;
    
  } catch (e) {
    logger.warn({ err: e?.message || String(e) }, "Failed to read order create policy, using fallback");
    return { ...DEFAULT_POLICY, source: "fallback" };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Product policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Obtiene la lista de productos disponibles para pedidos.
 * 
 * @returns {Array} Lista de productos con su configuración
 */
export function getAvailableProducts() {
  try {
    const hub = getConfigHub();
    
    if (!hub) {
      return [];
    }
    
    // Buscar productos en Config Hub
    const roscas = hub.roscas || hub.products || [];
    
    return roscas
      .filter(r => r.enabled !== false && r.available !== false)
      .map((r, idx) => ({
        key: r.sku || r.product_id || r.key || `product-${idx + 1}`,
        name: r.name || r.nombre,
        short_name: r.short_name || r.nombre_corto || r.name,
        price: r.price || r.precio,
        wc_product_id: r.product_id || r.wc_product_id,
        description: r.description || r.descripcion || null,
        category: r.category || r.categoria || "rosca",
        min_quantity: r.min_quantity || 1,
        max_quantity: r.max_quantity || 50,
        lead_time_hours: r.lead_time_hours || null,
        image_url: r.image_url || null,
      }));
      
  } catch (e) {
    logger.warn({ err: e?.message || String(e) }, "Failed to get available products");
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Date policy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Filtra fechas según política (cutoff, lead time, etc.)
 * 
 * @param {Array} fechas - Lista de fechas disponibles
 * @param {Object} options - Opciones de filtrado
 * @returns {Array} Fechas filtradas
 */
export function filterDatesByPolicy(fechas, options = {}) {
  const policy = getOrderCreatePolicy();
  const now = new Date();
  const timezone = options.timezone || "America/Mexico_City";
  
  return fechas.filter(fecha => {
    // Parse fecha
    const fechaDate = fecha.fecha_iso 
      ? new Date(fecha.fecha_iso) 
      : (fecha.date ? new Date(fecha.date) : null);
    
    if (!fechaDate || isNaN(fechaDate.getTime())) {
      return true; // Keep if we can't parse (let WooCommerce validate)
    }
    
    // Check minimum lead time
    const hoursUntil = (fechaDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    if (hoursUntil < policy.min_lead_time_hours) {
      return false;
    }
    
    // Check cutoff time for same-day or next-day
    if (hoursUntil < 24 && policy.cutoff_time) {
      const [cutoffHour, cutoffMin] = policy.cutoff_time.split(":").map(Number);
      const nowLocal = new Date(now.toLocaleString("en-US", { timeZone: timezone }));
      const currentHour = nowLocal.getHours();
      const currentMin = nowLocal.getMinutes();
      
      if (currentHour > cutoffHour || (currentHour === cutoffHour && currentMin > cutoffMin)) {
        return false;
      }
    }
    
    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Valida que un carrito cumple con la política.
 * 
 * @param {Object} cart - Carrito a validar
 * @returns {Object} Resultado de validación
 */
export function validateCartAgainstPolicy(cart) {
  const policy = getOrderCreatePolicy();
  const errors = [];
  
  // Check enabled
  if (!policy.enabled) {
    errors.push({
      code: "ORDER_CREATE_DISABLED",
      message: "La creación de pedidos está deshabilitada temporalmente.",
    });
  }
  
  // Check item count
  const items = cart.items || [];
  if (items.length > policy.max_items_per_order) {
    errors.push({
      code: "TOO_MANY_ITEMS",
      message: `El máximo de productos por pedido es ${policy.max_items_per_order}.`,
    });
  }
  
  // Check quantity per item
  for (const item of items) {
    if (item.quantity > policy.max_quantity_per_item) {
      errors.push({
        code: "QUANTITY_EXCEEDED",
        message: `La cantidad máxima por producto es ${policy.max_quantity_per_item}.`,
        item: item.product?.name || item.product_key,
      });
    }
  }
  
  // Check single delivery context
  if (policy.single_delivery_context && !policy.allow_multiple_dates) {
    // All items must have same date/branch - this is handled at flow level
  }
  
  return {
    valid: errors.length === 0,
    errors,
    policy,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  getOrderCreatePolicy,
  getAvailableProducts,
  filterDatesByPolicy,
  validateCartAgainstPolicy,
  DEFAULT_POLICY,
};
