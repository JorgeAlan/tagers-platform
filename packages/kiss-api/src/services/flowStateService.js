/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FLOW STATE SERVICE - Máquina de estados para flujos de conversación
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja el estado de flujos estructurados (ORDER_CREATE, ORDER_STATUS, etc.)
 * con persistencia opcional en Postgres.
 * 
 * Conceptualmente es una máquina de estados simplificada:
 * - Estado actual (flow + step)
 * - Datos acumulados (draft)
 * - TTL para expiración
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TTL_MS = 12 * 60 * 60 * 1000; // 12 horas

// Postgres persistence (opcional - lazy import)
let dbRepo = null;
async function getDbRepo() {
  if (dbRepo === null) {
    try {
      const module = await import("../db/repo.js");
      dbRepo = module;
    } catch {
      dbRepo = false; // No disponible
    }
  }
  return dbRepo || null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STORE EN MEMORIA
// ═══════════════════════════════════════════════════════════════════════════

const flowStore = new Map();

/**
 * @typedef {Object} FlowState
 * @property {string} flow - Nombre del flujo (ORDER_CREATE, ORDER_STATUS, etc.)
 * @property {string} step - Paso actual dentro del flujo
 * @property {Object} draft - Datos acumulados del flujo
 * @property {Object} [metadata] - Metadata adicional
 */

/**
 * @typedef {Object} FlowEntry
 * @property {FlowState} state
 * @property {number} updatedAt
 * @property {number} ttlMs
 */

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene el estado de flujo de una conversación
 * @param {string} conversationId
 * @returns {FlowState|null}
 */
export function getFlow(conversationId) {
  const key = String(conversationId);
  const entry = flowStore.get(key);
  
  if (!entry) {
    return null;
  }
  
  // Verificar TTL
  if (Date.now() - entry.updatedAt > entry.ttlMs) {
    flowStore.delete(key);
    logger.debug({ conversationId: key }, "Flow expired");
    return null;
  }
  
  return entry.state;
}

/**
 * Establece el estado de flujo de una conversación
 * @param {string} conversationId
 * @param {FlowState} state
 * @param {number} [ttlMs=DEFAULT_TTL_MS]
 */
export function setFlow(conversationId, state, ttlMs = DEFAULT_TTL_MS) {
  const key = String(conversationId);
  
  flowStore.set(key, {
    state,
    updatedAt: Date.now(),
    ttlMs,
  });
  
  // Persistir en Postgres (best-effort, no bloquea)
  persistFlowAsync(key, state, ttlMs);
  
  logger.debug({
    conversationId: key,
    flow: state?.flow,
    step: state?.step,
  }, "Flow state updated");
}

/**
 * Limpia el estado de flujo de una conversación
 * @param {string} conversationId
 */
export function clearFlow(conversationId) {
  const key = String(conversationId);
  flowStore.delete(key);
  
  // Eliminar de Postgres (best-effort)
  deleteFlowAsync(key);
  
  logger.debug({ conversationId: key }, "Flow cleared");
}

/**
 * Actualiza parcialmente el estado de flujo
 * @param {string} conversationId
 * @param {Partial<FlowState>} updates
 */
export function updateFlow(conversationId, updates) {
  const key = String(conversationId);
  const entry = flowStore.get(key);
  
  if (!entry) {
    logger.warn({ conversationId: key }, "Cannot update non-existent flow");
    return null;
  }
  
  const newState = {
    ...entry.state,
    ...updates,
    draft: {
      ...entry.state?.draft,
      ...updates?.draft,
    },
  };
  
  setFlow(key, newState, entry.ttlMs);
  return newState;
}

/**
 * Verifica si hay un flujo activo
 * @param {string} conversationId
 * @returns {boolean}
 */
export function hasActiveFlow(conversationId) {
  return getFlow(conversationId) !== null;
}

/**
 * Hidrata el estado de flujo desde Postgres (al inicio)
 * @param {string} conversationId
 */
export async function hydrateFromDb(conversationId) {
  const key = String(conversationId);
  
  // Si ya hay estado en memoria, no sobrescribir
  if (flowStore.has(key)) {
    return;
  }
  
  const repo = await getDbRepo();
  if (!repo?.getChatwootFlow) {
    return;
  }
  
  try {
    const dbState = await repo.getChatwootFlow(key);
    if (dbState) {
      flowStore.set(key, {
        state: dbState,
        updatedAt: Date.now(),
        ttlMs: DEFAULT_TTL_MS,
      });
      logger.info({ conversationId: key }, "Flow hydrated from Postgres");
    }
  } catch (error) {
    logger.warn({ err: error?.message, conversationId: key }, "Failed to hydrate flow from Postgres");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCIA ASYNC (Postgres)
// ═══════════════════════════════════════════════════════════════════════════

async function persistFlowAsync(conversationId, state, ttlMs) {
  const repo = await getDbRepo();
  if (!repo?.upsertChatwootFlow) {
    return;
  }
  
  try {
    await repo.upsertChatwootFlow({
      conversation_id: conversationId,
      state,
      ttl_ms: ttlMs,
    });
  } catch (error) {
    logger.warn({ err: error?.message, conversationId }, "Failed to persist flow state");
  }
}

async function deleteFlowAsync(conversationId) {
  const repo = await getDbRepo();
  if (!repo?.deleteChatwootFlow) {
    return;
  }
  
  try {
    await repo.deleteChatwootFlow(conversationId);
  } catch (error) {
    logger.warn({ err: error?.message, conversationId }, "Failed to delete flow state");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FLUJOS DISPONIBLES
// ═══════════════════════════════════════════════════════════════════════════

export const FLOWS = {
  ORDER_CREATE: "ORDER_CREATE",
  ORDER_STATUS: "ORDER_STATUS",
  ORDER_MODIFY: "ORDER_MODIFY",
  LEAD: "LEAD",
  RESERVATION: "RESERVATION",
};

export const ORDER_CREATE_STEPS = {
  INIT: "INIT",
  ASK_PRODUCT: "ASK_PRODUCT",
  ASK_BRANCH: "ASK_BRANCH",
  ASK_DATE: "ASK_DATE",
  ASK_QUANTITY: "ASK_QUANTITY",
  CONFIRM: "CONFIRM",
  CHECKOUT: "CHECKOUT",
  DONE: "DONE",
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un estado inicial para ORDER_CREATE
 */
export function createOrderCreateInitialState(options = {}) {
  return {
    flow: FLOWS.ORDER_CREATE,
    step: ORDER_CREATE_STEPS.INIT,
    draft: {
      product_key: null,
      product_name: null,
      product_id: null,
      branch_id: null,
      branch_name: null,
      date_slug: null,
      date_label: null,
      quantity: 1,
      items: [],
      checkout_ready: false,
      ...options.draft,
    },
    metadata: {
      started_at: new Date().toISOString(),
      ...options.metadata,
    },
  };
}

/**
 * Estadísticas del store
 */
export function getStats() {
  return {
    activeFlows: flowStore.size,
    byType: Array.from(flowStore.values()).reduce((acc, entry) => {
      const flow = entry.state?.flow || "unknown";
      acc[flow] = (acc[flow] || 0) + 1;
      return acc;
    }, {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const flowStateService = {
  getFlow,
  setFlow,
  clearFlow,
  updateFlow,
  hasActiveFlow,
  hydrateFromDb,
  createOrderCreateInitialState,
  getStats,
  FLOWS,
  ORDER_CREATE_STEPS,
};

export default flowStateService;
