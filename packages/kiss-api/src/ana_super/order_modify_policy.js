/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ANA SUPER — ORDER MODIFY POLICY (Sheet/Config Hub)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * - Read "soft rules" (permissions / cutoffs / copy) from Config Hub (Google Sheets).
 * - Conservative defaults: if policy is unknown, do NOT execute write.
 * - Support multiple key aliases so Marketing can rename columns without code deploy.
 *
 * IMPORTANT:
 * - This module is READ-ONLY. It must never mutate config.
 */

import { getConfig, getConfigHealth } from "../config-hub/sync-service.js";

function parseBool(val, def = false) {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const s = val.trim().toLowerCase();
    if (["true", "1", "yes", "y", "si", "sí", "on", "activo", "active"].includes(s)) return true;
    if (["false", "0", "no", "n", "off", "inactivo", "inactive"].includes(s)) return false;
  }
  return def;
}

function parseIntSafe(val, def = 0) {
  if (typeof val === "number" && Number.isFinite(val)) return Math.trunc(val);
  if (typeof val === "string") {
    const n = parseInt(val.trim(), 10);
    if (Number.isFinite(n)) return n;
  }
  return def;
}

function pickFirst(meta, keys = []) {
  if (!meta || typeof meta !== "object") return undefined;

  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(meta, k)) return meta[k];

    // Case-insensitive fallback
    const match = Object.keys(meta).find(x => x.toLowerCase() === String(k).toLowerCase());
    if (match) return meta[match];
  }

  return undefined;
}

export function getOrderModifyPolicy() {
  const cfg = getConfig();
  const health = getConfigHealth();
  const isFallback = !cfg || !!cfg.is_fallback || !!health?.is_fallback;
  const meta = cfg?.meta || {};

  // Allow high-risk actions in fallback ONLY if explicitly enabled.
  const allowInFallback = parseBool(
    pickFirst(meta, [
      "ORDER_ACTIONS_ALLOWED_IN_FALLBACK",
      "order_actions_allowed_in_fallback",
      "ALLOW_ACTIONS_IN_FALLBACK",
      "allow_actions_in_fallback",
    ]),
    false
  );

  // Conservative: require explicit allow via Sheet.
  const defaultAllow = false;

  const allowReschedule = parseBool(
    pickFirst(meta, [
      "ORDER_RESCHEDULE_ALLOWED",
      "order_reschedule_allowed",
      "RESCHEDULE_ALLOWED",
      "reschedule_allowed",
      "CAMBIOS_PERMITIDOS",
      "cambios_permitidos",
    ]),
    defaultAllow
  );

  const allowBranchChange = parseBool(
    pickFirst(meta, [
      "ORDER_BRANCH_CHANGE_ALLOWED",
      "order_branch_change_allowed",
      "BRANCH_CHANGE_ALLOWED",
      "branch_change_allowed",
      "CAMBIO_SUCURSAL_PERMITIDO",
      "cambio_sucursal_permitido",
    ]),
    // If Marketing explicitly allows reschedule, branch-change can default to same.
    allowReschedule
  );

  const requirePaid = parseBool(
    pickFirst(meta, [
      "ORDER_MODIFY_REQUIRE_PAID",
      "order_modify_require_paid",
      "ORDER_RESCHEDULE_REQUIRE_PAID",
      "order_reschedule_require_paid",
      "REQUIRE_PAID_TO_MODIFY",
      "require_paid_to_modify",
    ]),
    true
  );

  const cutoffHours = parseIntSafe(
    pickFirst(meta, [
      "ORDER_MODIFY_CUTOFF_HOURS",
      "order_modify_cutoff_hours",
      "ORDER_RESCHEDULE_CUTOFF_HOURS",
      "order_reschedule_cutoff_hours",
      "CUTOFF_HOURS",
      "cutoff_hours",
    ]),
    0
  );

  const confirmationTtlSeconds = parseIntSafe(
    pickFirst(meta, [
      "ORDER_MODIFY_CONFIRM_TTL_SECONDS",
      "order_modify_confirm_ttl_seconds",
      "CONFIRM_TTL_SECONDS",
      "confirm_ttl_seconds",
    ]),
    300
  );

  const policy = {
    allow_reschedule: allowReschedule,
    allow_branch_change: allowBranchChange,
    require_paid: requirePaid,
    cutoff_hours: cutoffHours,
    confirmation_ttl_seconds: confirmationTtlSeconds,
    allow_actions_in_fallback: allowInFallback,
  };

  // Effective policy: deny actions in fallback unless allowInFallback=true.
  const effective = { ...policy };
  if (isFallback && !allowInFallback) {
    effective.allow_reschedule = false;
    effective.allow_branch_change = false;
  }

  return {
    source: isFallback ? "fallback" : "config_hub",
    health,
    policy,
    effective,
    meta_keys_present: Object.keys(meta || {}).sort(),
  };
}

export default {
  getOrderModifyPolicy,
};
