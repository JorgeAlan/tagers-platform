/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - CONFIG STORE v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Persistencia de configuración en PostgreSQL
 * - Guarda config completa
 * - Guarda hash para Smart Sync
 * - Mantiene historial de versiones
 */

import pg from 'pg';
const { Pool } = pg;
import { getPoolConfig } from '../db/poolConfig.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONEXIÓN
// ═══════════════════════════════════════════════════════════════════════════

let pool = null;

function getPool() {
  if (pool) return pool;
  
  const connectionString = process.env.DATABASE_URL;
  
  if (!connectionString) {
    console.warn('[CONFIG-STORE] DATABASE_URL not configured, using memory only');
    return null;
  }
  
  // Railway internal connections don't support SSL
  const isRailwayInternal = connectionString.includes('.railway.internal');
  const sslConfig = isRailwayInternal ? false : 
    (process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false);
  
  pool = new Pool({
    ...getPoolConfig(connectionString),
    ssl: sslConfig,
  });
  
  return pool;
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea las tablas necesarias si no existen
 */
export async function initializeTables() {
  const db = getPool();
  if (!db) return false;
  
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ana_config (
        id SERIAL PRIMARY KEY,
        version INTEGER NOT NULL,
        config_hash VARCHAR(64) NOT NULL,
        config_data JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        published_by VARCHAR(100),
        notes TEXT
      );
      
      CREATE INDEX IF NOT EXISTS idx_ana_config_hash ON ana_config(config_hash);
      CREATE INDEX IF NOT EXISTS idx_ana_config_version ON ana_config(version);
      CREATE INDEX IF NOT EXISTS idx_ana_config_created ON ana_config(created_at DESC);
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS ana_config_state (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    
    console.log('[CONFIG-STORE] Tables initialized');
    return true;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to initialize tables:', error.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// OPERACIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Guarda configuración en la base de datos
 */
export async function saveConfig(config, hash) {
  const db = getPool();
  if (!db) {
    console.warn('[CONFIG-STORE] No database, config not persisted');
    return false;
  }
  
  try {
    await db.query(
      `INSERT INTO ana_config (version, config_hash, config_data, published_by, notes)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        config.version || 1,
        hash,
        JSON.stringify(config),
        config.published_by || 'system',
        `Synced at ${new Date().toISOString()}`,
      ]
    );
    
    // Limpiar versiones antiguas (mantener últimas 50)
    await db.query(`
      DELETE FROM ana_config 
      WHERE id NOT IN (
        SELECT id FROM ana_config 
        ORDER BY created_at DESC 
        LIMIT 50
      )
    `);
    
    return true;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to save config:', error.message);
    return false;
  }
}

/**
 * Obtiene la última configuración válida
 */
export async function getLastConfig() {
  const db = getPool();
  if (!db) return null;
  
  try {
    const result = await db.query(`
      SELECT config_data 
      FROM ana_config 
      ORDER BY created_at DESC 
      LIMIT 1
    `);
    
    if (result.rows.length === 0) return null;
    
    return result.rows[0].config_data;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to get last config:', error.message);
    return null;
  }
}

/**
 * Obtiene configuración por versión específica
 */
export async function getConfigByVersion(version) {
  const db = getPool();
  if (!db) return null;
  
  try {
    const result = await db.query(
      `SELECT config_data FROM ana_config WHERE version = $1 ORDER BY created_at DESC LIMIT 1`,
      [version]
    );
    
    return result.rows[0]?.config_data || null;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to get config by version:', error.message);
    return null;
  }
}

/**
 * Guarda el hash actual para Smart Sync
 */
export async function saveHash(hash) {
  const db = getPool();
  if (!db) return false;
  
  try {
    await db.query(`
      INSERT INTO ana_config_state (key, value, updated_at)
      VALUES ('current_hash', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [hash]);
    
    return true;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to save hash:', error.message);
    return false;
  }
}

/**
 * Obtiene el último hash guardado
 */
export async function getLastHash() {
  const db = getPool();
  if (!db) return null;
  
  try {
    const result = await db.query(
      `SELECT value FROM ana_config_state WHERE key = 'current_hash'`
    );
    
    return result.rows[0]?.value || null;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to get hash:', error.message);
    return null;
  }
}

/**
 * Obtiene historial de versiones
 */
export async function getVersionHistory(limit = 20) {
  const db = getPool();
  if (!db) return [];
  
  try {
    const result = await db.query(`
      SELECT version, config_hash, created_at, published_by, notes
      FROM ana_config
      ORDER BY created_at DESC
      LIMIT $1
    `, [limit]);
    
    return result.rows;
    
  } catch (error) {
    console.error('[CONFIG-STORE] Failed to get version history:', error.message);
    return [];
  }
}

export default {
  initializeTables,
  saveConfig,
  getLastConfig,
  getConfigByVersion,
  saveHash,
  getLastHash,
  getVersionHistory,
};
