/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONVERSATION LOCK - Lock Distribuido por Conversación
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Garantiza que solo UN worker procese mensajes de una conversación a la vez.
 * Usa Redis con SET NX EX para lock atómico y auto-expiración.
 * 
 * PROBLEMA RESUELTO:
 * Sin este lock, si un usuario envía 2 mensajes rápidos:
 * - Ambos jobs se procesan en paralelo
 * - Ambos leen el mismo historial
 * - Ambos generan respuestas (duplicadas o fuera de contexto)
 * 
 * CON este lock:
 * - Job 1 adquiere lock
 * - Job 2 espera (o se reencola)
 * - Job 1 termina, libera lock
 * - Job 2 procesa con historial actualizado
 * 
 * @version 1.0.0
 */

import { getRedisClient, isRedisAvailable } from "./redis.js";
import { logger } from "../utils/logger.js";

// NOTA: Este archivo va en src/core/conversationLock.js
// Los imports asumen esa ubicación

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const LOCK_PREFIX = "lock:conv:";
const DEFAULT_LOCK_TTL_MS = parseInt(process.env.CONVERSATION_LOCK_TTL_MS || "30000", 10); // 30s
const DEFAULT_WAIT_TIMEOUT_MS = parseInt(process.env.CONVERSATION_LOCK_WAIT_MS || "10000", 10); // 10s
const RETRY_INTERVAL_MS = 100; // Reintentar cada 100ms

// Fallback local para cuando Redis no está disponible
const localLocks = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// CORE LOCK FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Intenta adquirir un lock para una conversación
 * 
 * @param {string} conversationId - ID de la conversación
 * @param {Object} options
 * @param {number} options.ttlMs - TTL del lock en ms (default: 30s)
 * @param {string} options.ownerId - ID único del owner (job ID)
 * @returns {Promise<{acquired: boolean, ownerId: string}>}
 */
export async function acquireLock(conversationId, options = {}) {
  const convId = String(conversationId || "").trim();
  if (!convId) {
    return { acquired: false, reason: "invalid_conversation_id" };
  }
  
  const ttlMs = options.ttlMs || DEFAULT_LOCK_TTL_MS;
  const ttlSeconds = Math.ceil(ttlMs / 1000);
  const ownerId = options.ownerId || `owner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  const redis = getRedisClient();
  
  if (redis && isRedisAvailable()) {
    try {
      const key = `${LOCK_PREFIX}${convId}`;
      
      // SET key ownerId EX ttl NX
      // NX = solo setea si NO existe
      const result = await redis.set(key, ownerId, "EX", ttlSeconds, "NX");
      
      if (result === "OK") {
        logger.debug({ conversationId: convId, ownerId, ttlMs }, "Lock acquired (Redis)");
        return { acquired: true, ownerId, storage: "redis" };
      } else {
        // Lock ya existe - alguien más lo tiene
        const currentOwner = await redis.get(key);
        logger.debug({ conversationId: convId, currentOwner }, "Lock busy (Redis)");
        return { acquired: false, currentOwner, storage: "redis" };
      }
    } catch (err) {
      logger.warn({ err: err?.message, conversationId: convId }, "Redis lock failed, using fallback");
      return acquireLockLocal(convId, ownerId, ttlMs);
    }
  }
  
  // Fallback a memoria local
  return acquireLockLocal(convId, ownerId, ttlMs);
}

/**
 * Fallback local cuando Redis no está disponible
 */
function acquireLockLocal(conversationId, ownerId, ttlMs) {
  const now = Date.now();
  const existing = localLocks.get(conversationId);
  
  // Verificar si lock existente expiró
  if (existing && now < existing.expiresAt) {
    return { acquired: false, currentOwner: existing.ownerId, storage: "memory" };
  }
  
  // Lock disponible (o expiró)
  localLocks.set(conversationId, {
    ownerId,
    expiresAt: now + ttlMs,
  });
  
  logger.debug({ conversationId, ownerId, ttlMs }, "Lock acquired (memory fallback)");
  return { acquired: true, ownerId, storage: "memory" };
}

/**
 * Libera un lock de conversación
 * 
 * @param {string} conversationId
 * @param {string} ownerId - Solo el owner puede liberar el lock
 * @returns {Promise<{released: boolean}>}
 */
export async function releaseLock(conversationId, ownerId) {
  const convId = String(conversationId || "").trim();
  if (!convId || !ownerId) {
    return { released: false, reason: "invalid_params" };
  }
  
  const redis = getRedisClient();
  
  if (redis && isRedisAvailable()) {
    try {
      const key = `${LOCK_PREFIX}${convId}`;
      
      // Script Lua para liberar solo si somos el owner
      // Esto es atómico y evita race conditions
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await redis.eval(script, 1, key, ownerId);
      
      if (result === 1) {
        logger.debug({ conversationId: convId, ownerId }, "Lock released (Redis)");
        return { released: true, storage: "redis" };
      } else {
        logger.debug({ conversationId: convId, ownerId }, "Lock not owned by us (Redis)");
        return { released: false, reason: "not_owner", storage: "redis" };
      }
    } catch (err) {
      logger.warn({ err: err?.message, conversationId: convId }, "Redis release failed, using fallback");
      return releaseLockLocal(convId, ownerId);
    }
  }
  
  return releaseLockLocal(convId, ownerId);
}

/**
 * Fallback local para liberar lock
 */
function releaseLockLocal(conversationId, ownerId) {
  const existing = localLocks.get(conversationId);
  
  if (!existing) {
    return { released: false, reason: "no_lock", storage: "memory" };
  }
  
  if (existing.ownerId !== ownerId) {
    return { released: false, reason: "not_owner", storage: "memory" };
  }
  
  localLocks.delete(conversationId);
  logger.debug({ conversationId, ownerId }, "Lock released (memory fallback)");
  return { released: true, storage: "memory" };
}

/**
 * Espera a adquirir un lock con timeout
 * 
 * @param {string} conversationId
 * @param {Object} options
 * @param {number} options.waitTimeoutMs - Tiempo máximo de espera
 * @param {number} options.ttlMs - TTL del lock una vez adquirido
 * @param {string} options.ownerId - ID del owner
 * @returns {Promise<{acquired: boolean, waited: number, ownerId?: string}>}
 */
export async function waitForLock(conversationId, options = {}) {
  const waitTimeoutMs = options.waitTimeoutMs || DEFAULT_WAIT_TIMEOUT_MS;
  const startTime = Date.now();
  
  while (Date.now() - startTime < waitTimeoutMs) {
    const result = await acquireLock(conversationId, options);
    
    if (result.acquired) {
      return {
        ...result,
        waited: Date.now() - startTime,
      };
    }
    
    // Esperar antes de reintentar
    await new Promise(resolve => setTimeout(resolve, RETRY_INTERVAL_MS));
  }
  
  // Timeout
  logger.warn({
    conversationId,
    waited: Date.now() - startTime,
  }, "Lock wait timeout");
  
  return {
    acquired: false,
    reason: "timeout",
    waited: Date.now() - startTime,
  };
}

/**
 * Ejecuta una función con lock automático
 * 
 * @param {string} conversationId
 * @param {Function} fn - Función a ejecutar
 * @param {Object} options
 * @returns {Promise<any>} Resultado de fn
 */
export async function withLock(conversationId, fn, options = {}) {
  const ownerId = options.ownerId || `owner_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  
  // Intentar adquirir lock (con espera si se configura)
  const lockResult = options.wait 
    ? await waitForLock(conversationId, { ...options, ownerId })
    : await acquireLock(conversationId, { ...options, ownerId });
  
  if (!lockResult.acquired) {
    throw new Error(`Could not acquire lock for conversation ${conversationId}: ${lockResult.reason || 'busy'}`);
  }
  
  try {
    return await fn();
  } finally {
    await releaseLock(conversationId, ownerId);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si una conversación está bloqueada
 */
export async function isLocked(conversationId) {
  const convId = String(conversationId || "").trim();
  if (!convId) return false;
  
  const redis = getRedisClient();
  
  if (redis && isRedisAvailable()) {
    try {
      const key = `${LOCK_PREFIX}${convId}`;
      const exists = await redis.exists(key);
      return exists === 1;
    } catch {
      // Fallback
    }
  }
  
  const existing = localLocks.get(convId);
  return existing && Date.now() < existing.expiresAt;
}

/**
 * Extiende el TTL de un lock (para operaciones largas)
 */
export async function extendLock(conversationId, ownerId, additionalMs) {
  const convId = String(conversationId || "").trim();
  if (!convId || !ownerId) return { extended: false };
  
  const redis = getRedisClient();
  
  if (redis && isRedisAvailable()) {
    try {
      const key = `${LOCK_PREFIX}${convId}`;
      const additionalSeconds = Math.ceil(additionalMs / 1000);
      
      // Script para extender solo si somos el owner
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("EXPIRE", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;
      
      const result = await redis.eval(script, 1, key, ownerId, additionalSeconds);
      return { extended: result === 1 };
    } catch {
      // Fallback
    }
  }
  
  // Fallback local
  const existing = localLocks.get(convId);
  if (existing && existing.ownerId === ownerId) {
    existing.expiresAt += additionalMs;
    return { extended: true };
  }
  
  return { extended: false };
}

// Limpieza periódica de locks locales expirados
setInterval(() => {
  const now = Date.now();
  for (const [convId, lock] of localLocks.entries()) {
    if (now >= lock.expiresAt) {
      localLocks.delete(convId);
    }
  }
}, 60 * 1000); // cada minuto

export default {
  acquireLock,
  releaseLock,
  waitForLock,
  withLock,
  isLocked,
  extendLock,
};
