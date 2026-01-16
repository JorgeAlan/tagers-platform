/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHECKPOINT MANAGER - Persistencia y Time Travel
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Guarda snapshots del estado en cada transición para:
 * 1. Debugging visual (ver dónde se quedó el usuario)
 * 2. Time Travel (volver a un estado anterior)
 * 3. Recuperación en caso de crash
 * 
 * @version 3.0.0 - LangGraph State Machine
 */

import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// STORAGE
// ═══════════════════════════════════════════════════════════════════════════

const checkpointStore = new Map();
const TTL_MS = 24 * 60 * 60 * 1000; // 24 horas

/**
 * @typedef {Object} Checkpoint
 * @property {string} id - ID único del checkpoint
 * @property {string} conversationId - ID de la conversación
 * @property {string} graphId - ID del grafo (ej: ORDER_CREATE)
 * @property {string} node - Nodo actual
 * @property {Object} state - Estado completo
 * @property {string} timestamp - ISO timestamp
 * @property {string} trigger - Qué causó el checkpoint (message, timeout, etc.)
 */

// ═══════════════════════════════════════════════════════════════════════════
// API
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guarda un checkpoint del estado actual
 */
export function saveCheckpoint({ conversationId, graphId, node, state, trigger = "message" }) {
  const id = `${conversationId}_${Date.now()}`;
  
  const checkpoint = {
    id,
    conversationId,
    graphId,
    node,
    state: structuredClone(state),
    timestamp: new Date().toISOString(),
    trigger,
  };
  
  // Obtener o crear lista de checkpoints para esta conversación
  const key = `${graphId}:${conversationId}`;
  let checkpoints = checkpointStore.get(key) || [];
  
  // Agregar nuevo checkpoint
  checkpoints.push(checkpoint);
  
  // Mantener máximo 50 checkpoints por conversación
  if (checkpoints.length > 50) {
    checkpoints = checkpoints.slice(-50);
  }
  
  checkpointStore.set(key, checkpoints);
  
  logger.debug({
    conversationId,
    graphId,
    node,
    checkpointId: id,
  }, "Checkpoint saved");
  
  return checkpoint;
}

/**
 * Obtiene todos los checkpoints de una conversación
 */
export function getCheckpoints(conversationId, graphId) {
  const key = `${graphId}:${conversationId}`;
  return checkpointStore.get(key) || [];
}

/**
 * Obtiene el último checkpoint
 */
export function getLatestCheckpoint(conversationId, graphId) {
  const checkpoints = getCheckpoints(conversationId, graphId);
  return checkpoints[checkpoints.length - 1] || null;
}

/**
 * Obtiene un checkpoint específico por ID
 */
export function getCheckpointById(conversationId, graphId, checkpointId) {
  const checkpoints = getCheckpoints(conversationId, graphId);
  return checkpoints.find(c => c.id === checkpointId) || null;
}

/**
 * Time Travel: Restaura el estado a un checkpoint específico
 */
export function restoreCheckpoint(conversationId, graphId, checkpointId) {
  const checkpoint = getCheckpointById(conversationId, graphId, checkpointId);
  
  if (!checkpoint) {
    logger.warn({ conversationId, graphId, checkpointId }, "Checkpoint not found");
    return null;
  }
  
  // Crear nuevo checkpoint marcando el restore
  saveCheckpoint({
    conversationId,
    graphId,
    node: checkpoint.node,
    state: checkpoint.state,
    trigger: `restored_from_${checkpointId}`,
  });
  
  logger.info({
    conversationId,
    graphId,
    restoredTo: checkpoint.node,
    originalCheckpoint: checkpointId,
  }, "State restored from checkpoint");
  
  return structuredClone(checkpoint.state);
}

/**
 * Elimina todos los checkpoints de una conversación
 */
export function clearCheckpoints(conversationId, graphId) {
  const key = `${graphId}:${conversationId}`;
  checkpointStore.delete(key);
  logger.debug({ conversationId, graphId }, "Checkpoints cleared");
}

// ═══════════════════════════════════════════════════════════════════════════
// VISUALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera una visualización del historial de checkpoints
 */
export function visualizeCheckpointHistory(conversationId, graphId) {
  const checkpoints = getCheckpoints(conversationId, graphId);
  
  if (checkpoints.length === 0) {
    return "No checkpoints found";
  }
  
  let viz = `\n╔═══════════════════════════════════════════════════════════════╗\n`;
  viz += `║  TIME TRAVEL DEBUG - ${graphId}                              ║\n`;
  viz += `║  Conversation: ${conversationId.slice(0, 20).padEnd(20)}                     ║\n`;
  viz += `╠═══════════════════════════════════════════════════════════════╣\n`;
  
  checkpoints.forEach((cp, i) => {
    const time = new Date(cp.timestamp).toLocaleTimeString();
    const nodeStr = cp.node.padEnd(15);
    const triggerStr = cp.trigger.slice(0, 15).padEnd(15);
    
    const isFirst = i === 0;
    const isLast = i === checkpoints.length - 1;
    
    if (isFirst) {
      viz += `║  ┌─[${time}]─ ${nodeStr} │ ${triggerStr}      ║\n`;
    } else if (isLast) {
      viz += `║  └─[${time}]─ ${nodeStr} │ ${triggerStr} ← NOW ║\n`;
    } else {
      viz += `║  ├─[${time}]─ ${nodeStr} │ ${triggerStr}      ║\n`;
    }
  });
  
  viz += `╚═══════════════════════════════════════════════════════════════╝\n`;
  
  return viz;
}

/**
 * Genera un resumen del estado actual para debugging
 */
export function getDebugSummary(conversationId, graphId) {
  const checkpoints = getCheckpoints(conversationId, graphId);
  const latest = checkpoints[checkpoints.length - 1];
  
  if (!latest) {
    return { found: false };
  }
  
  const nodesVisited = checkpoints.map(c => c.node);
  const uniqueNodes = [...new Set(nodesVisited)];
  
  return {
    found: true,
    conversationId,
    graphId,
    currentNode: latest.node,
    totalCheckpoints: checkpoints.length,
    nodesVisited,
    uniqueNodes,
    startedAt: checkpoints[0]?.timestamp,
    lastUpdated: latest.timestamp,
    draft: latest.state?.draft || {},
    canRestore: checkpoints.length > 1,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCIA (opcional - Postgres)
// ═══════════════════════════════════════════════════════════════════════════

let dbEnabled = false;
let dbRepo = null;

/**
 * Habilita persistencia en Postgres
 */
export async function enablePersistence() {
  try {
    const module = await import("../db/repo.js");
    dbRepo = module;
    dbEnabled = true;
    logger.info({}, "Checkpoint persistence enabled (Postgres)");
  } catch (e) {
    logger.warn({ err: e?.message }, "Postgres persistence not available");
    dbEnabled = false;
  }
}

/**
 * Persiste checkpoints a Postgres (async, best-effort)
 */
async function persistToDb(conversationId, graphId, checkpoint) {
  if (!dbEnabled || !dbRepo?.upsertCheckpoint) {
    return;
  }
  
  try {
    await dbRepo.upsertCheckpoint({
      conversation_id: conversationId,
      graph_id: graphId,
      checkpoint_id: checkpoint.id,
      node: checkpoint.node,
      state: checkpoint.state,
      timestamp: checkpoint.timestamp,
    });
  } catch (e) {
    logger.warn({ err: e?.message }, "Failed to persist checkpoint");
  }
}

/**
 * Carga checkpoints desde Postgres
 */
export async function hydrateFromDb(conversationId, graphId) {
  if (!dbEnabled || !dbRepo?.getCheckpoints) {
    return;
  }
  
  try {
    const dbCheckpoints = await dbRepo.getCheckpoints(conversationId, graphId);
    if (dbCheckpoints?.length) {
      const key = `${graphId}:${conversationId}`;
      checkpointStore.set(key, dbCheckpoints);
      logger.info({ conversationId, graphId, count: dbCheckpoints.length }, "Checkpoints hydrated from Postgres");
    }
  } catch (e) {
    logger.warn({ err: e?.message }, "Failed to hydrate checkpoints");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLEANUP
// ═══════════════════════════════════════════════════════════════════════════

function cleanupExpired() {
  const now = Date.now();
  let cleaned = 0;
  
  for (const [key, checkpoints] of checkpointStore.entries()) {
    if (!checkpoints.length) continue;
    
    const lastTimestamp = new Date(checkpoints[checkpoints.length - 1].timestamp).getTime();
    
    if (now - lastTimestamp > TTL_MS) {
      checkpointStore.delete(key);
      cleaned++;
    }
  }
  
  if (cleaned > 0) {
    logger.debug({ cleaned }, "Expired checkpoints cleaned");
  }
}

// Cleanup cada 30 minutos
setInterval(cleanupExpired, 30 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const checkpointManager = {
  saveCheckpoint,
  getCheckpoints,
  getLatestCheckpoint,
  getCheckpointById,
  restoreCheckpoint,
  clearCheckpoints,
  visualizeCheckpointHistory,
  getDebugSummary,
  enablePersistence,
  hydrateFromDb,
};

export default checkpointManager;
