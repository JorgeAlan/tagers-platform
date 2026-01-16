/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DISTRIBUTED RATE LIMITER - Control de tráfico con Redis
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Implementa rate limiting y deduplicación distribuida usando Redis.
 * Esto permite escalar horizontalmente (múltiples réplicas) sin perder
 * la consistencia del control de tráfico.
 * 
 * Características:
 * - Rate limiting por sliding window
 * - Deduplicación de mensajes
 * - Fallback a memoria si Redis no disponible
 * - Operaciones atómicas con Lua scripts
 * 
 * @version 1.0.0
 */

import { getRedisClient, isRedisAvailable } from "./redis.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const config = {
  // Prefijos para keys en Redis
  keyPrefix: {
    rateLimit: "tania:rate:",
    dedupe: "tania:dedupe:",
  },
  
  // Rate limiting
  rateLimit: {
    windowMs: 60 * 1000, // 1 minuto
    maxRequests: parseInt(process.env.GOVERNOR_MAX_MESSAGES_PER_MINUTE || "10", 10),
  },
  
  // Deduplicación
  dedupe: {
    windowMs: parseInt(process.env.GOVERNOR_DEDUPE_WINDOW_MS || "5000", 10),
  },
  
  // TTLs en segundos
  ttl: {
    rateLimit: 120,  // 2 minutos (extra buffer)
    dedupe: 30,      // 30 segundos
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK EN MEMORIA (cuando Redis no está disponible)
// ═══════════════════════════════════════════════════════════════════════════

const memoryFallback = {
  rates: new Map(),    // conversationId -> { count, windowStart }
  dedupes: new Map(),  // conversationId -> { hash, timestamp }
};

// Limpiar memoria cada 5 minutos
setInterval(() => {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;
  
  for (const [key, value] of memoryFallback.rates) {
    if (value.windowStart < fiveMinutesAgo) memoryFallback.rates.delete(key);
  }
  
  for (const [key, value] of memoryFallback.dedupes) {
    if (value.timestamp < fiveMinutesAgo) memoryFallback.dedupes.delete(key);
  }
}, 5 * 60 * 1000);

// ═══════════════════════════════════════════════════════════════════════════
// LUA SCRIPTS PARA OPERACIONES ATÓMICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Lua script para rate limiting con sliding window
 * Args: key, windowMs, maxRequests, ttl
 * Returns: [allowed (0/1), currentCount, windowStart]
 */
const RATE_LIMIT_SCRIPT = `
local key = KEYS[1]
local windowMs = tonumber(ARGV[1])
local maxRequests = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'count', 'windowStart')
local count = tonumber(data[1]) or 0
local windowStart = tonumber(data[2]) or 0

-- Si la ventana expiró, reiniciar
if (now - windowStart) > windowMs then
  count = 1
  windowStart = now
  redis.call('HMSET', key, 'count', count, 'windowStart', windowStart)
  redis.call('EXPIRE', key, ttl)
  return {1, count, windowStart}
end

-- Incrementar contador
count = count + 1
redis.call('HSET', key, 'count', count)

-- Verificar límite
if count > maxRequests then
  return {0, count, windowStart}
end

return {1, count, windowStart}
`;

/**
 * Lua script para deduplicación
 * Args: key, hash, windowMs, ttl
 * Returns: [isDuplicate (0/1), storedHash]
 */
const DEDUPE_SCRIPT = `
local key = KEYS[1]
local newHash = ARGV[1]
local windowMs = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'hash', 'timestamp')
local storedHash = data[1]
local timestamp = tonumber(data[2]) or 0

-- Verificar si es duplicado dentro de la ventana
if storedHash == newHash and (now - timestamp) < windowMs then
  return {1, storedHash}
end

-- Guardar nuevo hash
redis.call('HMSET', key, 'hash', newHash, 'timestamp', now)
redis.call('EXPIRE', key, ttl)
return {0, newHash}
`;

// ═══════════════════════════════════════════════════════════════════════════
// RATE LIMITING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si una conversación ha excedido el rate limit
 * 
 * @param {string} conversationId - ID de la conversación
 * @returns {Promise<Object>} { allowed: boolean, count: number, limit: number }
 */
export async function checkRateLimit(conversationId) {
  const key = `${config.keyPrefix.rateLimit}${conversationId}`;
  const now = Date.now();
  
  // Intentar con Redis
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      const result = await redis.eval(
        RATE_LIMIT_SCRIPT,
        1,
        key,
        config.rateLimit.windowMs,
        config.rateLimit.maxRequests,
        config.ttl.rateLimit,
        now
      );
      
      const [allowed, count, windowStart] = result;
      
      return {
        allowed: allowed === 1,
        count: count,
        limit: config.rateLimit.maxRequests,
        remaining: Math.max(0, config.rateLimit.maxRequests - count),
        resetAt: windowStart + config.rateLimit.windowMs,
        source: "redis",
      };
    } catch (err) {
      logger.warn({ err: err?.message, conversationId }, "Redis rate limit failed, using fallback");
    }
  }
  
  // Fallback a memoria
  return checkRateLimitMemory(conversationId);
}

function checkRateLimitMemory(conversationId) {
  const now = Date.now();
  let rate = memoryFallback.rates.get(conversationId);
  
  if (!rate || (now - rate.windowStart) > config.rateLimit.windowMs) {
    rate = { count: 1, windowStart: now };
    memoryFallback.rates.set(conversationId, rate);
    
    return {
      allowed: true,
      count: 1,
      limit: config.rateLimit.maxRequests,
      remaining: config.rateLimit.maxRequests - 1,
      resetAt: now + config.rateLimit.windowMs,
      source: "memory",
    };
  }
  
  rate.count++;
  
  return {
    allowed: rate.count <= config.rateLimit.maxRequests,
    count: rate.count,
    limit: config.rateLimit.maxRequests,
    remaining: Math.max(0, config.rateLimit.maxRequests - rate.count),
    resetAt: rate.windowStart + config.rateLimit.windowMs,
    source: "memory",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEDUPLICACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si un mensaje es duplicado
 * 
 * @param {string} conversationId - ID de la conversación
 * @param {string} messageText - Texto del mensaje
 * @returns {Promise<Object>} { isDuplicate: boolean, hash: string }
 */
export async function checkDuplicate(conversationId, messageText) {
  const key = `${config.keyPrefix.dedupe}${conversationId}`;
  const hash = simpleHash(messageText);
  const now = Date.now();
  
  // Intentar con Redis
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      const result = await redis.eval(
        DEDUPE_SCRIPT,
        1,
        key,
        hash,
        config.dedupe.windowMs,
        config.ttl.dedupe,
        now
      );
      
      const [isDuplicate, storedHash] = result;
      
      return {
        isDuplicate: isDuplicate === 1,
        hash,
        source: "redis",
      };
    } catch (err) {
      logger.warn({ err: err?.message, conversationId }, "Redis dedupe failed, using fallback");
    }
  }
  
  // Fallback a memoria
  return checkDuplicateMemory(conversationId, hash);
}

function checkDuplicateMemory(conversationId, hash) {
  const now = Date.now();
  const recent = memoryFallback.dedupes.get(conversationId);
  
  if (recent && recent.hash === hash && (now - recent.timestamp) < config.dedupe.windowMs) {
    return {
      isDuplicate: true,
      hash,
      source: "memory",
    };
  }
  
  // Guardar este mensaje
  memoryFallback.dedupes.set(conversationId, { hash, timestamp: now });
  
  return {
    isDuplicate: false,
    hash,
    source: "memory",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Hash simple para deduplicación
 */
function simpleHash(str) {
  let hash = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    const char = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString(36);
}

/**
 * Obtiene estadísticas del rate limiter
 */
export async function getStats() {
  const stats = {
    redisAvailable: isRedisAvailable(),
    memoryFallback: {
      ratesCount: memoryFallback.rates.size,
      dedupesCount: memoryFallback.dedupes.size,
    },
    config: {
      maxRequestsPerMinute: config.rateLimit.maxRequests,
      dedupeWindowMs: config.dedupe.windowMs,
    },
  };
  
  // Intentar obtener stats de Redis
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      const [rateKeys, dedupeKeys] = await Promise.all([
        redis.keys(`${config.keyPrefix.rateLimit}*`),
        redis.keys(`${config.keyPrefix.dedupe}*`),
      ]);
      
      stats.redis = {
        activeRateLimitKeys: rateKeys.length,
        activeDedupeKeys: dedupeKeys.length,
      };
    } catch (err) {
      stats.redis = { error: err?.message };
    }
  }
  
  return stats;
}

/**
 * Resetea el rate limit para una conversación (útil para testing)
 */
export async function resetRateLimit(conversationId) {
  const key = `${config.keyPrefix.rateLimit}${conversationId}`;
  
  // Limpiar memoria
  memoryFallback.rates.delete(conversationId);
  
  // Limpiar Redis
  if (isRedisAvailable()) {
    try {
      const redis = getRedisClient();
      await redis.del(key);
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to reset rate limit in Redis");
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const distributedRateLimiter = {
  checkRateLimit,
  checkDuplicate,
  getStats,
  resetRateLimit,
};

export default distributedRateLimiter;
