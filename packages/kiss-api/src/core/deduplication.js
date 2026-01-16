/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEDUPLICATION SERVICE - Deduplicación Distribuida de Mensajes
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Reemplaza el Map local con Redis para soportar múltiples replicas.
 * Cada mensaje procesado se registra con TTL para evitar duplicados.
 * 
 * PROBLEMA RESUELTO:
 * Con 2+ replicas en Railway, el Map local causaba mensajes duplicados
 * porque cada instancia tenía su propia memoria.
 * 
 * @version 1.0.0
 */

import { getRedisClient, isRedisAvailable } from "./redis.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const DEDUPE_PREFIX = "dedupe:msg:";
const DEDUPE_TTL_SECONDS = parseInt(process.env.DEDUPE_TTL_SECONDS || "7200", 10); // 2 horas

// Fallback local (solo si Redis no está disponible)
const localFallback = new Map();
const LOCAL_TTL_MS = DEDUPE_TTL_SECONDS * 1000;

// Limpieza periódica del fallback local
setInterval(() => {
  const now = Date.now();
  for (const [key, timestamp] of localFallback.entries()) {
    if (now - timestamp > LOCAL_TTL_MS) {
      localFallback.delete(key);
    }
  }
}, 5 * 60 * 1000); // cada 5 minutos

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si un mensaje ya fue procesado
 * Si no existe, lo marca como procesado atómicamente (SET NX)
 * 
 * @param {string} messageId - ID único del mensaje
 * @returns {Promise<boolean>} true si es duplicado, false si es nuevo
 */
export async function isDuplicate(messageId) {
  const id = String(messageId || "").trim();
  if (!id) return false;
  
  const redis = getRedisClient();
  
  if (redis && isRedisAvailable()) {
    try {
      const key = `${DEDUPE_PREFIX}${id}`;
      
      // SET NX = solo setea si no existe, retorna OK si lo seteó
      const result = await redis.set(key, Date.now(), "EX", DEDUPE_TTL_SECONDS, "NX");
      
      if (result === "OK") {
        // Primera vez que vemos este mensaje
        return false;
      } else {
        // Ya existía = duplicado
        logger.debug({ messageId: id, store: "redis" }, "Duplicate message detected");
        return true;
      }
    } catch (err) {
      logger.warn({ err: err?.message, messageId: id }, "Redis dedupe failed, using fallback");
      // Fallback a local
      return checkLocalFallback(id);
    }
  }
  
  // Sin Redis disponible, usar fallback local
  return checkLocalFallback(id);
}

/**
 * Fallback local cuando Redis no está disponible
 */
function checkLocalFallback(messageId) {
  const now = Date.now();
  
  if (localFallback.has(messageId)) {
    const timestamp = localFallback.get(messageId);
    if (now - timestamp < LOCAL_TTL_MS) {
      logger.debug({ messageId, store: "local" }, "Duplicate message detected");
      return true;
    }
  }
  
  localFallback.set(messageId, now);
  return false;
}

/**
 * Obtiene estadísticas del servicio
 */
export async function getStats() {
  const redis = getRedisClient();
  
  let redisCount = 0;
  if (redis && isRedisAvailable()) {
    try {
      const keys = await redis.keys(`${DEDUPE_PREFIX}*`);
      redisCount = keys.length;
    } catch (_) {
      // Ignorar error
    }
  }
  
  return {
    redis: isRedisAvailable(),
    redisEntries: redisCount,
    localFallbackEntries: localFallback.size,
    ttlSeconds: DEDUPE_TTL_SECONDS,
  };
}

/**
 * Limpia manualmente un messageId (para testing)
 */
export async function clear(messageId) {
  const id = String(messageId || "").trim();
  if (!id) return;
  
  localFallback.delete(id);
  
  const redis = getRedisClient();
  if (redis && isRedisAvailable()) {
    try {
      await redis.del(`${DEDUPE_PREFIX}${id}`);
    } catch (_) {
      // Ignorar
    }
  }
}

export default {
  isDuplicate,
  getStats,
  clear,
};
