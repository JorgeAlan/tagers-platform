/**
 * ═══════════════════════════════════════════════════════════════════════════
 * POSTGRES POOL CONFIG - Configuración optimizada de conexiones
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Configuración compartida para todos los pools de Postgres en la app.
 * Optimizado para Railway con límites de conexiones.
 * 
 * @version 1.0.0
 */

/**
 * Configuración del pool de conexiones
 * 
 * Railway Postgres tiene límites de conexiones según plan:
 * - Hobby: 20 conexiones max
 * - Pro: 100 conexiones max
 * 
 * Con múltiples pools (repo + vectorStore + flowState + configStore),
 * dividimos el límite entre ellos.
 */
export const poolConfig = {
  // Límite de conexiones por pool
  // Con 4 pools, cada uno tiene max 5 conexiones = 20 total
  max: parseInt(process.env.PG_POOL_MAX || "5", 10),
  
  // Mínimo de conexiones idle a mantener
  min: parseInt(process.env.PG_POOL_MIN || "1", 10),
  
  // Tiempo máximo (ms) que una conexión puede estar idle antes de cerrarse
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || "30000", 10),
  
  // Tiempo máximo (ms) para obtener una conexión del pool
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || "5000", 10),
  
  // Permitir salir del proceso si el pool tiene conexiones idle
  allowExitOnIdle: process.env.PG_ALLOW_EXIT_ON_IDLE !== "false",
};

/**
 * Construye configuración completa del pool
 * @param {string} connectionString - DATABASE_URL
 * @param {Object} overrides - Opciones específicas para este pool
 */
export function getPoolConfig(connectionString, overrides = {}) {
  return {
    connectionString,
    ...poolConfig,
    ...overrides,
  };
}

/**
 * Configuración específica para vectorStore (puede necesitar más conexiones)
 */
export function getVectorPoolConfig(connectionString) {
  return getPoolConfig(connectionString, {
    // Vector store hace más queries paralelas
    max: parseInt(process.env.PG_VECTOR_POOL_MAX || "8", 10),
  });
}

export default {
  poolConfig,
  getPoolConfig,
  getVectorPoolConfig,
};
