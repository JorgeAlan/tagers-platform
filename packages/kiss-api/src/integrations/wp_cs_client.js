import { config } from "../config.js";
import { fetchWithTimeout } from "../utils/fetch_with_timeout.js";

// WordPress CS client (Tagers CS API).
// NOTE: This client is scoped to the CS namespace only (tagers-cs/v1)
// and uses the CS token. It must NEVER be used to reach OPS endpoints.

let cache = {
  ts: 0,
  data: null,
};

function base() {
  const b = (config.wp?.baseUrl || "").trim();

  // Normalize common misconfigurations:
  // - WP_BASE_URL should be the *site root* (e.g. https://tagers.com or https://tagers.com/wp)
  // - Do NOT include `/wp-json` or any namespace.
  //
  // If someone configures WP_BASE_URL like:
  //   https://tagers.com/wp-json
  //   https://tagers.com/wp-json/tagers-cs/v1
  // we strip it safely.
  let out = b.replace(/\/$/, "");

  const wpJsonIdx = out.indexOf("/wp-json");
  if (wpJsonIdx !== -1) {
    out = out.substring(0, wpJsonIdx);
  }

  return out.replace(/\/$/, "");
}

async function csFetch(path, { method = "GET", query = null, body = null } = {}) {
  const b = base();
  if (!b) throw new Error("WP_BASE_URL not configured");

  const url = new URL(`${b}/wp-json/tagers-cs/v1${path}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = { "Accept": "application/json" };
  if (config.wp?.csToken) headers["X-Tagers-CS-Token"] = config.wp.csToken;
  if (body) headers["Content-Type"] = "application/json";

  const resp = await fetchWithTimeout(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await resp.text().catch(() => "");
  if (!resp.ok) {
    throw new Error(`WP CS ${path} failed: ${resp.status} ${resp.statusText} (url=${url.toString()}) ${text}`);
  }
  try {
    return JSON.parse(text || "{}");
  } catch {
    return {};
  }
}

/**
 * Detailed fetch variant.
 *
 * - Never throws on non-2xx.
 * - Returns HTTP status + best-effort parsed JSON (WordPress WP_Error is JSON).
 *
 * This is useful for high-risk write operations where we need to
 * differentiate between authorization/ownership errors and stock/validation errors.
 */
async function csFetchDetailed(path, { method = "GET", query = null, body = null } = {}) {
  const b = base();
  if (!b) throw new Error("WP_BASE_URL not configured");

  const url = new URL(`${b}/wp-json/tagers-cs/v1${path}`);
  if (query && typeof query === "object") {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      url.searchParams.set(k, String(v));
    }
  }

  const headers = { "Accept": "application/json" };
  if (config.wp?.csToken) headers["X-Tagers-CS-Token"] = config.wp.csToken;
  if (body) headers["Content-Type"] = "application/json";

  const resp = await fetchWithTimeout(url.toString(), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const rawText = await resp.text().catch(() => "");
  let data = null;
  try {
    data = JSON.parse(rawText || "{}");
  } catch {
    data = null;
  }

  return {
    ok: resp.ok,
    status: resp.status,
    statusText: resp.statusText,
    url: url.toString(),
    data: data && typeof data === "object" ? data : null,
    rawText,
  };
}

export async function fetchCSInfoCompleta() {
  const b = base();
  if (!b) {
    throw new Error("WP_BASE_URL not configured");
  }

  const ttl = Number(config.wp?.infoCacheMs || 0);
  const now = Date.now();
  if (ttl > 0 && cache.data && (now - cache.ts) < ttl) {
    return cache.data;
  }

  const data = await csFetch("/info-completa");

  // Derive convenience structures for Tania.
  const sucursales = Array.isArray(data?.sucursales) ? data.sucursales : [];
  const amenities_by_branch = {};
  for (const s of sucursales) {
    if (!s?.branch_id) continue;
    if (s?.amenities) amenities_by_branch[s.branch_id] = s.amenities;
  }

  const normalized = {
    ...data,
    sucursales,
    amenities_by_branch,
    promo: data?.promo || null,
    productos: Array.isArray(data?.productos) ? data.productos : [],
    assistant: data?.assistant || null,
  };

  cache = { ts: now, data: normalized };
  return normalized;
}

export async function fetchCSAssistantConfig() {
  return csFetch("/assistant-config");
}

export async function csProductSearch({ q, limit = 5 } = {}) {
  return csFetch("/product-search", { query: { q, limit } });
}

export async function csConsultaDisponibilidad(payload) {
  return csFetch("/consulta-disponibilidad", { method: "POST", body: payload });
}

export async function csGenerarLinkCompra(payload) {
  return csFetch("/generar-link-compra", { method: "POST", body: payload });
}

export async function csCrearPedido(payload) {
  return csFetch("/crear-pedido", { method: "POST", body: payload });
}

export async function csBuscarPedido({ phone, order_id } = {}) {
  // SECURITY: WordPress /buscar-pedido prioritizes order_id over phone.
  // If we pass both, the server will return the order by id without filtering by phone.
  // To preserve phone-scoped lookups, query by phone-only and filter locally.
  const query = {};
  if (phone) query.phone = phone;
  if (order_id && !phone) query.order_id = order_id;

  const raw = await csFetch("/buscar-pedido", { query });

  // Normalize legacy shapes to the canonical contract:
  // { success: boolean, orders: Array<OrderLike>, mensaje?: string }
  //
  // Legacy shapes seen in older plugins:
  // - { encontrado: false, mensaje }
  // - { encontrado: true, pedidos: [ ... ] }
  // - { encontrado: true, order_id, ... } (single order)
  const out = typeof raw === "object" && raw ? { ...raw } : {};

  const normalizeOrder = (o) => {
    if (!o || typeof o !== "object") return o;
    const id = o.id || o.order_id || o.orderId || null;
    const items = Array.isArray(o.items) ? o.items : [];
    const normItems = items.map((it) => {
      if (!it || typeof it !== "object") return it;
      const name = it.name || it.nombre || it.title || it.product_name || null;
      const quantity =
        it.quantity ?? it.cantidad ?? it.qty ?? it.count ?? 1;
      return { ...it, name, quantity };
    });
    return {
      ...o,
      id: id || o.id || null,
      order_id: o.order_id || id || null,
      items: normItems,
    };
  };

  let success = typeof out.success === "boolean" ? out.success : null;
  let orders = Array.isArray(out.orders) ? out.orders : null;

  if (!orders) {
    // Try legacy: pedidos[]
    if (Array.isArray(out.pedidos)) {
      orders = out.pedidos;
      if (success === null) success = !!out.encontrado;
    } else if (out.encontrado && (out.order_id || out.id)) {
      orders = [out];
      if (success === null) success = true;
    } else {
      orders = [];
      if (success === null) success = !!out.encontrado;
    }
  }

  out.orders = orders.map(normalizeOrder);
  out.success = !!success && out.orders.length > 0;

  // If caller provided phone + order_id, filter to the requested order id.
  if (phone && order_id) {
    const target = String(order_id);
    const filtered = out.orders.filter((o) => String(o?.id || o?.order_id || o?.orderId) === target);
    out.orders = filtered;
    out.success = filtered.length > 0;
    // Keep both envelopes reasonably consistent.
    if (Array.isArray(out.pedidos)) out.pedidos = filtered;
    if (typeof out.total_encontrados === "number") out.total_encontrados = filtered.length;
  }

  // Keep encontrado in sync when present.
  if (typeof out.encontrado === "boolean") {
    out.encontrado = out.success;
  }

  return out;
}

export async function csCambiarEntrega(payload) {
  return csFetch("/cambiar-entrega", { method: "POST", body: payload });
}

/**
 * Safe variant for high-risk writes.
 *
 * Normalizes WordPress REST WP_Error shapes to a stable error contract:
 * {
 *   success: false,
 *   http_status: number,
 *   error_code: string,
 *   mensaje: string
 * }
 */
export async function csCambiarEntregaSafe(payload) {
  const r = await csFetchDetailed("/cambiar-entrega", { method: "POST", body: payload });
  if (r.ok) {
    return r.data && typeof r.data === "object" ? r.data : {};
  }

  const data = r.data && typeof r.data === "object" ? r.data : {};
  const httpStatus = Number(data?.data?.status || r.status || 0) || r.status;
  const errorCode = String(data?.code || data?.error_code || data?.error || "http_error");
  const msg = String(data?.message || data?.mensaje || r.rawText || `HTTP ${httpStatus}`);

  return {
    success: false,
    http_status: httpStatus,
    error_code: errorCode,
    mensaje: msg,
  };
}

export async function csClienteHistorial({ phone } = {}) {
  return csFetch("/cliente-historial", { query: { phone } });
}
