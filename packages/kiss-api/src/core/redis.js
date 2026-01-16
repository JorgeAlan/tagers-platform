/**
 * ═══════════════════════════════════════════════════════════════════════════
 * REDIS CLIENT - Cliente compartido para toda la aplicación
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Singleton de Redis para usar en:
 * - Deduplicación de mensajes
 * - Blacklist
 * - Cache de embeddings
 * - Rate limiting distribuido
 * 
 * @version 1.0.0
 */

import Redis from "ioredis";
import { logger } from "../utils/logger.js";

const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

let redisClient = null;
let isConnected = false;

/**
 * Obtiene el cliente Redis compartido
 * @returns {Redis|null}
 */
export function getRedisClient() {
  if (redisClient) return isConnected ? redisClient : null;
  
  try {
    redisClient = new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) return null; // Stop retrying
        return Math.min(times * 100, 3000);
      },
      lazyConnect: false,
      enableReadyCheck: true,
    });
    
    redisClient.on("connect", () => {
      isConnected = true;
      logger.info("Redis client connected");
    });
    
    redisClient.on("error", (err) => {
      isConnected = false;
      logger.warn({ err: err?.message }, "Redis client error");
    });
    
    redisClient.on("close", () => {
      isConnected = false;
    });
    
    return redisClient;
  } catch (err) {
    logger.warn({ err: err?.message }, "Failed to create Redis client");
    return null;
  }
}

/**
 * Verifica si Redis está disponible
 */
export function isRedisAvailable() {
  return isConnected && redisClient !== null;
}

/**
 * Cierra la conexión Redis
 */
export async function closeRedis() {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    isConnected = false;
  }
}

// Auto-inicializar al importar
getRedisClient();

export default {
  getRedisClient,
  isRedisAvailable,
  closeRedis,
};
