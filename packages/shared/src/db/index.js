/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATABASE MODULE - Conexión compartida a PostgreSQL
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Pool de conexiones optimizado para Railway.
 * Usado por KISS y LUCA.
 * 
 * @version 1.0.0
 */

import { Pool } from "pg";
import { logger } from "../utils/index.js";

// ═══════════════════════════════════════════════════════════════════════════
// POOL CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuración del pool de conexiones
 * 
 * Railway Postgres tiene límites de conexiones según plan:
 * - Hobby: 20 conexiones max
 * - Pro: 100 conexiones max
 */
export const poolConfig = {
  max: parseInt(process.env.PG_POOL_MAX || "5", 10),
  min: parseInt(process.env.PG_POOL_MIN || "1", 10),
  idleTimeoutMillis: parseInt(process.env.PG_IDLE_TIMEOUT_MS || "30000", 10),
  connectionTimeoutMillis: parseInt(process.env.PG_CONNECTION_TIMEOUT_MS || "5000", 10),
  allowExitOnIdle: process.env.PG_ALLOW_EXIT_ON_IDLE !== "false",
};

/**
 * Construye configuración completa del pool
 */
export function getPoolConfig(connectionString, overrides = {}) {
  return {
    connectionString,
    ...poolConfig,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// POOL SINGLETON
// ═══════════════════════════════════════════════════════════════════════════

let pool = null;

/**
 * Obtiene o crea el pool de conexiones
 */
export function getPool(connectionString) {
  const connStr = connectionString || process.env.DATABASE_URL;
  
  if (!connStr) {
    logger.warn("DATABASE_URL not set");
    return null;
  }
  
  if (pool) return pool;
  
  pool = new Pool(getPoolConfig(connStr));
  
  pool.on("error", (err) => {
    logger.error({ err: err?.message }, "Postgres pool error");
  });
  
  pool.on("connect", () => {
    logger.debug("New Postgres connection established");
  });
  
  return pool;
}

/**
 * Ejecuta una query usando el pool
 */
export async function query(text, params) {
  const p = getPool();
  if (!p) {
    throw new Error("Database not configured");
  }
  return p.query(text, params);
}

/**
 * Ejecuta una transacción
 */
export async function transaction(callback) {
  const p = getPool();
  if (!p) {
    throw new Error("Database not configured");
  }
  
  const client = await p.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cierra el pool de conexiones
 */
export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Postgres pool closed");
  }
}

/**
 * Verifica si la base de datos está disponible
 */
export async function isDatabaseAvailable() {
  try {
    const p = getPool();
    if (!p) return false;
    await p.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

export default {
  getPool,
  getPoolConfig,
  poolConfig,
  query,
  transaction,
  closePool,
  isDatabaseAvailable,
};
