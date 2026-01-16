/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAN • IA — SECURE FLOWS INDEX
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Punto de entrada único para todos los flujos seguros.
 * 
 * Uso:
 * ```javascript
 * import { 
 *   // ORDER_CREATE
 *   createSecureOrderCreateState,
 *   makeSecureOrderCreateHandlers,
 *   
 *   // ORDER_STATUS  
 *   createOrderStatusState,
 *   makeOrderStatusHandlers,
 *   
 *   // Helpers
 *   flowHelpers,
 * } from "../tania/secure_flows/index.js";
 * ```
 */

// ─────────────────────────────────────────────────────────────────────────────
// ORDER_CREATE
// ─────────────────────────────────────────────────────────────────────────────

export {
  createSecureOrderCreateState,
  makeSecureOrderCreateHandlers,
  ORDER_CREATE_STEPS,
} from "./order_create_secure_flow.js";

export {
  getOrderCreatePolicy,
  getAvailableProducts,
  filterDatesByPolicy,
  validateCartAgainstPolicy,
} from "./order_create_policy.js";

// ─────────────────────────────────────────────────────────────────────────────
// ORDER_STATUS
// ─────────────────────────────────────────────────────────────────────────────

export {
  createOrderStatusState,
  makeOrderStatusHandlers,
  ORDER_STATUS_STEPS,
} from "./order_status_secure_flow.js";

// ─────────────────────────────────────────────────────────────────────────────
// SHARED HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export * as flowHelpers from "./flow_helpers.js";

export {
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
} from "./flow_helpers.js";

// ─────────────────────────────────────────────────────────────────────────────
// NOTE: ORDER_MODIFY
// ─────────────────────────────────────────────────────────────────────────────
// ORDER_MODIFY lives in src/ana_super/ for historical reasons.
// Import directly:
//
// import { 
//   isSecureOrderModifyEnabled,
//   createSecureOrderModifyState, 
//   makeSecureOrderModifyHandlers 
// } from "../ana_super/order_modify_secure_flow.js";
