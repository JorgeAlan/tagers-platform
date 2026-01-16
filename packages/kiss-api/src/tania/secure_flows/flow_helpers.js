/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAN • IA — FLOW HELPERS (Shared utilities)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Utilidades comunes para todos los flujos seguros.
 * Evita duplicación de código entre ORDER_CREATE, ORDER_STATUS, ORDER_MODIFY.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Text normalization
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Number parsing
// ─────────────────────────────────────────────────────────────────────────────

export function parseIntSafe(v) {
  const n = parseInt(String(v || "").trim(), 10);
  return Number.isFinite(n) ? n : null;
}

export function pickByNumber(text, list) {
  const n = parseIntSafe(text);
  if (!n || !Array.isArray(list)) return null;
  if (n < 1 || n > list.length) return null;
  return list[n - 1] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

export function formatNumberedList(items, renderFn) {
  if (!Array.isArray(items) || items.length === 0) return "";
  return items
    .map((it, idx) => {
      const line = renderFn ? renderFn(it) : String(it);
      return `${idx + 1}. ${line}`;
    })
    .join("\n");
}

export function formatDate(dateStr, options = {}) {
  if (!dateStr) return "";
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const defaultOptions = {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: options.timeZone || "America/Mexico_City",
    };
    
    return date.toLocaleDateString("es-MX", { ...defaultOptions, ...options });
  } catch {
    return dateStr;
  }
}

export function formatCurrency(amount, currency = "MXN") {
  if (!amount && amount !== 0) return "";
  
  try {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return `$${amount}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection
// ─────────────────────────────────────────────────────────────────────────────

export function detectsCancel(text) {
  const t = normalizeText(text);
  return (
    /\b(cancelar|cancela|ya no|no quiero|olvidalo|dejalo|nada|olvida)\b/.test(t) ||
    /\b(adios|bye|chao|hasta luego)\b/.test(t)
  );
}

export function detectsHuman(text) {
  const t = normalizeText(text);
  return (
    /\b(humano|persona|agente|alguien|real|asesor|ejecutivo)\b/.test(t) ||
    /\b(hablar con|pasame|comunicar)\b/.test(t)
  );
}

export function detectsConfirm(text, phrases = []) {
  const t = normalizeText(text);
  
  // Check custom phrases first
  for (const phrase of phrases) {
    if (t.includes(normalizeText(phrase))) return true;
  }
  
  // Generic confirmations
  if (/^(si|sí|ok|dale|claro|confirmo|confirmar|listo|va|sale)$/.test(t)) return true;
  if (t.includes("si confirmo") || t.includes("sí confirmo")) return true;
  
  return false;
}

export function detectsNegation(text) {
  const t = normalizeText(text);
  return /^(no|nop|nope|nel|negativo|para nada)$/.test(t) ||
         /\b(no quiero|no gracias|no necesito)\b/.test(t);
}

// ─────────────────────────────────────────────────────────────────────────────
// Contact helpers
// ─────────────────────────────────────────────────────────────────────────────

export function extractContactInfo(contact) {
  return {
    phone: contact?.phone_number || contact?.phone || null,
    email: contact?.email || null,
    name: contact?.name || null,
    // Custom attributes (for authenticated widgets)
    jwt: contact?.custom_attributes?.jwt || contact?.custom_attributes?.token || null,
    customer_id: contact?.custom_attributes?.customer_id || 
                 contact?.custom_attributes?.woocommerce_customer_id || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Order helpers
// ─────────────────────────────────────────────────────────────────────────────

export function getOrderId(order) {
  return order?.id || order?.order_id || order?.number || null;
}

export function getOrderStatus(order) {
  return order?.status || order?.estado || null;
}

export function getOrderItems(order) {
  const candidates = [order?.items, order?.line_items, order?.productos, order?.products];
  const arr = candidates.find(a => Array.isArray(a));
  if (!Array.isArray(arr)) return [];

  return arr
    .map((it) => ({
      name: it?.name || it?.nombre || it?.product_name || null,
      product_id: it?.product_id || it?.producto_id || null,
      product_key: it?.product_key || it?.key || null,
      quantity: Number(it?.quantity) || Number(it?.qty) || 1,
    }))
    .filter(x => x.name || x.product_id || x.product_key);
}

export function formatOrderStatus(status) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

export default {
  normalizeText,
  parseIntSafe,
  pickByNumber,
  formatNumberedList,
  formatDate,
  formatCurrency,
  detectsCancel,
  detectsHuman,
  detectsConfirm,
  detectsNegation,
  extractContactInfo,
  getOrderId,
  getOrderStatus,
  getOrderItems,
  formatOrderStatus,
};
