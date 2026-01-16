/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BLACKLIST SERVICE - Bloqueo de Usuarios Abusivos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Permite bloquear usuarios por:
 * - phone_number (WhatsApp)
 * - contact_id (Chatwoot)
 * - conversation_id (conversación específica)
 * - email
 * 
 * Fuentes de configuración (en orden de prioridad):
 * 1. Redis (para bloqueos dinámicos en runtime)
 * 2. Config Hub (Google Sheets)
 * 3. Variables de entorno
 * 
 * @version 1.0.0
 */

import { getRedisClient, isRedisAvailable } from "./redis.js";
import { getConfig } from "../config-hub/sync-service.js";
import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const BLACKLIST_PREFIX = "blacklist:";
const DEFAULT_BLOCK_TTL_SECONDS = parseInt(process.env.BLACKLIST_TTL_SECONDS || "86400", 10); // 24h

// Blacklist estática desde env (comma-separated)
const ENV_BLACKLIST = {
  phones: (process.env.BLACKLIST_PHONES || "").split(",").map(s => s.trim()).filter(Boolean),
  emails: (process.env.BLACKLIST_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean),
  contacts: (process.env.BLACKLIST_CONTACTS || "").split(",").map(s => s.trim()).filter(Boolean),
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function normalizePhone(phone) {
  if (!phone) return null;
  // Quitar todo excepto dígitos y +
  return String(phone).replace(/[^\d+]/g, "");
}

function normalizeEmail(email) {
  if (!email) return null;
  return String(email).trim().toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si un usuario está en blacklist
 * 
 * @param {Object} params
 * @param {string} [params.phone] - Número de teléfono
 * @param {string} [params.email] - Email
 * @param {string} [params.contactId] - ID de contacto en Chatwoot
 * @param {string} [params.conversationId] - ID de conversación
 * @returns {Promise<{blocked: boolean, reason?: string, source?: string}>}
 */
export async function isBlocked({ phone, email, contactId, conversationId }) {
  const normalizedPhone = normalizePhone(phone);
  const normalizedEmail = normalizeEmail(email);
  
  // 1. Verificar en Redis (bloqueos dinámicos)
  const redisResult = await checkRedisBlacklist({ 
    phone: normalizedPhone, 
    email: normalizedEmail, 
    contactId, 
    conversationId 
  });
  
  if (redisResult.blocked) {
    logger.info({
      phone: normalizedPhone,
      contactId,
      reason: redisResult.reason,
      source: "redis",
    }, "User blocked by Redis blacklist");
    return redisResult;
  }
  
  // 2. Verificar en Config Hub
  const configResult = checkConfigHubBlacklist({
    phone: normalizedPhone,
    email: normalizedEmail,
    contactId,
  });
  
  if (configResult.blocked) {
    logger.info({
      phone: normalizedPhone,
      contactId,
      reason: configResult.reason,
      source: "config_hub",
    }, "User blocked by Config Hub blacklist");
    return configResult;
  }
  
  // 3. Verificar en variables de entorno
  const envResult = checkEnvBlacklist({
    phone: normalizedPhone,
    email: normalizedEmail,
    contactId,
  });
  
  if (envResult.blocked) {
    logger.info({
      phone: normalizedPhone,
      contactId,
      reason: envResult.reason,
      source: "env",
    }, "User blocked by ENV blacklist");
    return envResult;
  }
  
  return { blocked: false };
}

/**
 * Agrega un usuario a la blacklist (en Redis)
 * 
 * @param {Object} params
 * @param {string} [params.phone]
 * @param {string} [params.email]
 * @param {string} [params.contactId]
 * @param {string} [params.conversationId]
 * @param {string} params.reason - Razón del bloqueo
 * @param {number} [params.ttlSeconds] - TTL en segundos (default: 24h)
 */
export async function addToBlacklist({ phone, email, contactId, conversationId, reason, ttlSeconds }) {
  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) {
    logger.warn("Cannot add to blacklist: Redis not available");
    return false;
  }
  
  const ttl = ttlSeconds || DEFAULT_BLOCK_TTL_SECONDS;
  const value = JSON.stringify({
    reason,
    blockedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
  });
  
  const keys = [];
  
  if (phone) keys.push(`${BLACKLIST_PREFIX}phone:${normalizePhone(phone)}`);
  if (email) keys.push(`${BLACKLIST_PREFIX}email:${normalizeEmail(email)}`);
  if (contactId) keys.push(`${BLACKLIST_PREFIX}contact:${contactId}`);
  if (conversationId) keys.push(`${BLACKLIST_PREFIX}conversation:${conversationId}`);
  
  try {
    for (const key of keys) {
      await redis.setex(key, ttl, value);
    }
    
    logger.info({
      phone: normalizePhone(phone),
      contactId,
      reason,
      ttl,
    }, "User added to blacklist");
    
    return true;
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to add to blacklist");
    return false;
  }
}

/**
 * Remueve un usuario de la blacklist (en Redis)
 */
export async function removeFromBlacklist({ phone, email, contactId, conversationId }) {
  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) {
    return false;
  }
  
  const keys = [];
  
  if (phone) keys.push(`${BLACKLIST_PREFIX}phone:${normalizePhone(phone)}`);
  if (email) keys.push(`${BLACKLIST_PREFIX}email:${normalizeEmail(email)}`);
  if (contactId) keys.push(`${BLACKLIST_PREFIX}contact:${contactId}`);
  if (conversationId) keys.push(`${BLACKLIST_PREFIX}conversation:${conversationId}`);
  
  try {
    for (const key of keys) {
      await redis.del(key);
    }
    
    logger.info({
      phone: normalizePhone(phone),
      contactId,
    }, "User removed from blacklist");
    
    return true;
  } catch (err) {
    logger.error({ err: err?.message }, "Failed to remove from blacklist");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICADORES INTERNOS
// ═══════════════════════════════════════════════════════════════════════════

async function checkRedisBlacklist({ phone, email, contactId, conversationId }) {
  const redis = getRedisClient();
  if (!redis || !isRedisAvailable()) {
    return { blocked: false };
  }
  
  const keysToCheck = [];
  
  if (phone) keysToCheck.push(`${BLACKLIST_PREFIX}phone:${phone}`);
  if (email) keysToCheck.push(`${BLACKLIST_PREFIX}email:${email}`);
  if (contactId) keysToCheck.push(`${BLACKLIST_PREFIX}contact:${contactId}`);
  if (conversationId) keysToCheck.push(`${BLACKLIST_PREFIX}conversation:${conversationId}`);
  
  if (keysToCheck.length === 0) {
    return { blocked: false };
  }
  
  try {
    for (const key of keysToCheck) {
      const value = await redis.get(key);
      if (value) {
        const data = JSON.parse(value);
        return {
          blocked: true,
          reason: data.reason || "blocked",
          source: "redis",
        };
      }
    }
  } catch (err) {
    logger.warn({ err: err?.message }, "Redis blacklist check failed");
  }
  
  return { blocked: false };
}

function checkConfigHubBlacklist({ phone, email, contactId }) {
  try {
    const config = getConfig();
    const blacklist = config?.blacklist || [];
    
    if (!Array.isArray(blacklist) || blacklist.length === 0) {
      return { blocked: false };
    }
    
    for (const entry of blacklist) {
      if (!entry.enabled) continue;
      
      // Verificar phone
      if (phone && entry.phone && normalizePhone(entry.phone) === phone) {
        return {
          blocked: true,
          reason: entry.reason || "blocked_by_config",
          source: "config_hub",
        };
      }
      
      // Verificar email
      if (email && entry.email && normalizeEmail(entry.email) === email) {
        return {
          blocked: true,
          reason: entry.reason || "blocked_by_config",
          source: "config_hub",
        };
      }
      
      // Verificar contactId
      if (contactId && entry.contact_id && String(entry.contact_id) === String(contactId)) {
        return {
          blocked: true,
          reason: entry.reason || "blocked_by_config",
          source: "config_hub",
        };
      }
    }
  } catch (err) {
    logger.warn({ err: err?.message }, "Config Hub blacklist check failed");
  }
  
  return { blocked: false };
}

function checkEnvBlacklist({ phone, email, contactId }) {
  // Verificar phones
  if (phone && ENV_BLACKLIST.phones.includes(phone)) {
    return {
      blocked: true,
      reason: "blocked_by_env",
      source: "env",
    };
  }
  
  // Verificar emails
  if (email && ENV_BLACKLIST.emails.includes(email)) {
    return {
      blocked: true,
      reason: "blocked_by_env",
      source: "env",
    };
  }
  
  // Verificar contacts
  if (contactId && ENV_BLACKLIST.contacts.includes(String(contactId))) {
    return {
      blocked: true,
      reason: "blocked_by_env",
      source: "env",
    };
  }
  
  return { blocked: false };
}

/**
 * Obtiene estadísticas del servicio
 */
export async function getStats() {
  const redis = getRedisClient();
  let redisEntries = 0;
  
  if (redis && isRedisAvailable()) {
    try {
      const keys = await redis.keys(`${BLACKLIST_PREFIX}*`);
      redisEntries = keys.length;
    } catch (_) {}
  }
  
  let configHubEntries = 0;
  try {
    const config = getConfig();
    configHubEntries = (config?.blacklist || []).filter(e => e.enabled).length;
  } catch (_) {}
  
  return {
    redis: isRedisAvailable(),
    redisEntries,
    configHubEntries,
    envPhones: ENV_BLACKLIST.phones.length,
    envEmails: ENV_BLACKLIST.emails.length,
    envContacts: ENV_BLACKLIST.contacts.length,
  };
}

export default {
  isBlocked,
  addToBlacklist,
  removeFromBlacklist,
  getStats,
};
