/**
 * ═══════════════════════════════════════════════════════════════════════════
 * A/B TESTING SERVICE - Experimentación de prompts y respuestas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Permite probar diferentes versiones de:
 * - System prompts
 * - Respuestas enlatadas
 * - Tonos de voz
 * - Estrategias de respuesta
 * 
 * Almacena resultados en Postgres para análisis posterior.
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { getPool } from "../db/repo.js";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const abConfig = {
  enabled: process.env.AB_TESTING_ENABLED !== "false",
  defaultTrafficSplit: parseFloat(process.env.AB_DEFAULT_SPLIT || "0.5"),
  minSampleSize: parseInt(process.env.AB_MIN_SAMPLE_SIZE || "100", 10),
  tableName: "ab_experiments",
  resultsTable: "ab_results",
};

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN DE TABLAS
// ═══════════════════════════════════════════════════════════════════════════

let _initialized = false;

async function ensureTables() {
  if (_initialized) return;
  
  const pool = getPool();
  if (!pool) return;
  
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${abConfig.tableName} (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL, -- 'prompt', 'canned', 'tone', 'strategy'
        variant_a JSONB NOT NULL,
        variant_b JSONB NOT NULL,
        traffic_split REAL DEFAULT 0.5,
        status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed'
        winner TEXT, -- 'a', 'b', null
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        ends_at TIMESTAMPTZ
      )
    `);
    
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${abConfig.resultsTable} (
        id SERIAL PRIMARY KEY,
        experiment_id TEXT REFERENCES ${abConfig.tableName}(id),
        conversation_id TEXT NOT NULL,
        contact_id TEXT,
        variant TEXT NOT NULL, -- 'a' or 'b'
        outcome TEXT, -- 'success', 'failure', 'neutral'
        metrics JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ab_results_experiment 
      ON ${abConfig.resultsTable}(experiment_id)
    `);
    
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_ab_results_conversation 
      ON ${abConfig.resultsTable}(conversation_id)
    `);
    
    _initialized = true;
    logger.info("[AB-TESTING] Tables initialized");
    
  } catch (error) {
    logger.error({ err: error.message }, "[AB-TESTING] Failed to initialize tables");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GESTIÓN DE EXPERIMENTOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un nuevo experimento A/B
 * 
 * @param {Object} experiment
 * @param {string} experiment.name - Nombre del experimento
 * @param {string} experiment.type - Tipo: 'prompt', 'canned', 'tone', 'strategy'
 * @param {Object} experiment.variantA - Configuración variante A (control)
 * @param {Object} experiment.variantB - Configuración variante B (tratamiento)
 * @param {number} [experiment.trafficSplit=0.5] - % de tráfico para variante B
 * @param {string} [experiment.description] - Descripción
 * @param {Date} [experiment.endsAt] - Fecha de fin opcional
 */
export async function createExperiment(experiment) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return null;
  
  const id = `exp_${crypto.randomBytes(8).toString("hex")}`;
  
  try {
    const result = await pool.query(`
      INSERT INTO ${abConfig.tableName} 
      (id, name, description, type, variant_a, variant_b, traffic_split, ends_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [
      id,
      experiment.name,
      experiment.description || null,
      experiment.type,
      JSON.stringify(experiment.variantA),
      JSON.stringify(experiment.variantB),
      experiment.trafficSplit || abConfig.defaultTrafficSplit,
      experiment.endsAt || null,
    ]);
    
    logger.info({ experimentId: id, name: experiment.name }, "[AB-TESTING] Experiment created");
    return result.rows[0];
    
  } catch (error) {
    logger.error({ err: error.message }, "[AB-TESTING] Failed to create experiment");
    return null;
  }
}

/**
 * Obtiene un experimento por ID
 */
export async function getExperiment(experimentId) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return null;
  
  try {
    const result = await pool.query(`
      SELECT * FROM ${abConfig.tableName} WHERE id = $1
    `, [experimentId]);
    
    return result.rows[0] || null;
    
  } catch (error) {
    logger.error({ err: error.message, experimentId }, "[AB-TESTING] Failed to get experiment");
    return null;
  }
}

/**
 * Lista experimentos activos
 */
export async function getActiveExperiments(type = null) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return [];
  
  try {
    let query = `
      SELECT * FROM ${abConfig.tableName} 
      WHERE status = 'active'
      AND (ends_at IS NULL OR ends_at > NOW())
    `;
    const params = [];
    
    if (type) {
      query += ` AND type = $1`;
      params.push(type);
    }
    
    query += ` ORDER BY created_at DESC`;
    
    const result = await pool.query(query, params);
    return result.rows;
    
  } catch (error) {
    logger.error({ err: error.message }, "[AB-TESTING] Failed to list experiments");
    return [];
  }
}

/**
 * Actualiza estado de un experimento
 */
export async function updateExperimentStatus(experimentId, status, winner = null) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      UPDATE ${abConfig.tableName} 
      SET status = $2, winner = $3, updated_at = NOW()
      WHERE id = $1
    `, [experimentId, status, winner]);
    
    logger.info({ experimentId, status, winner }, "[AB-TESTING] Experiment status updated");
    return true;
    
  } catch (error) {
    logger.error({ err: error.message, experimentId }, "[AB-TESTING] Failed to update status");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ASIGNACIÓN DE VARIANTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determina qué variante usar para una conversación
 * Usa hash del conversationId para consistencia
 * 
 * @param {string} experimentId - ID del experimento
 * @param {string} conversationId - ID de la conversación
 * @returns {Promise<{variant: 'a'|'b', config: Object}|null>}
 */
export async function getVariantForConversation(experimentId, conversationId) {
  if (!abConfig.enabled) return null;
  
  const experiment = await getExperiment(experimentId);
  if (!experiment || experiment.status !== "active") return null;
  
  // Usar hash para asignación determinística
  const hash = crypto
    .createHash("md5")
    .update(`${experimentId}:${conversationId}`)
    .digest("hex");
  
  // Convertir primeros 8 chars del hash a número entre 0 y 1
  const hashValue = parseInt(hash.substring(0, 8), 16) / 0xffffffff;
  
  // Asignar variante basado en traffic_split
  const variant = hashValue < experiment.traffic_split ? "b" : "a";
  const config = variant === "a" ? experiment.variant_a : experiment.variant_b;
  
  return { variant, config };
}

/**
 * Obtiene la variante de prompt para un experimento de tipo 'prompt'
 */
export async function getPromptVariant(experimentId, conversationId) {
  const result = await getVariantForConversation(experimentId, conversationId);
  if (!result) return null;
  
  return {
    variant: result.variant,
    systemPrompt: result.config.systemPrompt || result.config.prompt,
    instructions: result.config.instructions,
    tone: result.config.tone,
  };
}

/**
 * Obtiene la variante de respuesta enlatada
 */
export async function getCannedVariant(experimentId, conversationId, cannedId) {
  const result = await getVariantForConversation(experimentId, conversationId);
  if (!result) return null;
  
  // Buscar la respuesta enlatada específica en la variante
  const cannedResponses = result.config.cannedResponses || {};
  
  return {
    variant: result.variant,
    message: cannedResponses[cannedId] || result.config.message,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// REGISTRO DE RESULTADOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra el resultado de una interacción en un experimento
 * 
 * @param {Object} result
 * @param {string} result.experimentId
 * @param {string} result.conversationId
 * @param {string} result.variant - 'a' or 'b'
 * @param {string} result.outcome - 'success', 'failure', 'neutral'
 * @param {Object} [result.metrics] - Métricas adicionales
 * @param {string} [result.contactId]
 */
export async function recordResult(result) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      INSERT INTO ${abConfig.resultsTable}
      (experiment_id, conversation_id, contact_id, variant, outcome, metrics)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [
      result.experimentId,
      result.conversationId,
      result.contactId || null,
      result.variant,
      result.outcome,
      JSON.stringify(result.metrics || {}),
    ]);
    
    return true;
    
  } catch (error) {
    logger.error({ err: error.message }, "[AB-TESTING] Failed to record result");
    return false;
  }
}

/**
 * Registra una conversión (outcome positivo)
 */
export async function recordConversion(experimentId, conversationId, variant, metrics = {}) {
  return recordResult({
    experimentId,
    conversationId,
    variant,
    outcome: "success",
    metrics,
  });
}

/**
 * Registra un abandono o fallo
 */
export async function recordFailure(experimentId, conversationId, variant, metrics = {}) {
  return recordResult({
    experimentId,
    conversationId,
    variant,
    outcome: "failure",
    metrics,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// ANÁLISIS DE RESULTADOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de un experimento
 */
export async function getExperimentStats(experimentId) {
  await ensureTables();
  const pool = getPool();
  if (!pool) return null;
  
  try {
    const result = await pool.query(`
      SELECT 
        variant,
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE outcome = 'success') as successes,
        COUNT(*) FILTER (WHERE outcome = 'failure') as failures,
        COUNT(*) FILTER (WHERE outcome = 'neutral') as neutral,
        ROUND(
          COUNT(*) FILTER (WHERE outcome = 'success')::numeric / 
          NULLIF(COUNT(*), 0) * 100, 2
        ) as success_rate
      FROM ${abConfig.resultsTable}
      WHERE experiment_id = $1
      GROUP BY variant
    `, [experimentId]);
    
    const stats = {
      experimentId,
      a: { total: 0, successes: 0, failures: 0, neutral: 0, successRate: 0 },
      b: { total: 0, successes: 0, failures: 0, neutral: 0, successRate: 0 },
      totalSamples: 0,
      isSignificant: false,
      winner: null,
    };
    
    for (const row of result.rows) {
      stats[row.variant] = {
        total: parseInt(row.total),
        successes: parseInt(row.successes),
        failures: parseInt(row.failures),
        neutral: parseInt(row.neutral),
        successRate: parseFloat(row.success_rate) || 0,
      };
    }
    
    stats.totalSamples = stats.a.total + stats.b.total;
    
    // Verificar significancia estadística (simplificado)
    if (stats.totalSamples >= abConfig.minSampleSize * 2) {
      const diff = Math.abs(stats.a.successRate - stats.b.successRate);
      
      // Si la diferencia es > 5% con suficientes muestras, considerar significativo
      if (diff > 5) {
        stats.isSignificant = true;
        stats.winner = stats.a.successRate > stats.b.successRate ? "a" : "b";
      }
    }
    
    return stats;
    
  } catch (error) {
    logger.error({ err: error.message, experimentId }, "[AB-TESTING] Failed to get stats");
    return null;
  }
}

/**
 * Lista todos los experimentos con sus estadísticas
 */
export async function getAllExperimentsWithStats() {
  const experiments = await getActiveExperiments();
  
  const results = await Promise.all(
    experiments.map(async (exp) => {
      const stats = await getExperimentStats(exp.id);
      return { ...exp, stats };
    })
  );
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si A/B testing está habilitado
 */
export function isEnabled() {
  return abConfig.enabled;
}

/**
 * Obtiene configuración
 */
export function getConfig() {
  return {
    enabled: abConfig.enabled,
    defaultTrafficSplit: abConfig.defaultTrafficSplit,
    minSampleSize: abConfig.minSampleSize,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const abTestingService = {
  createExperiment,
  getExperiment,
  getActiveExperiments,
  updateExperimentStatus,
  getVariantForConversation,
  getPromptVariant,
  getCannedVariant,
  recordResult,
  recordConversion,
  recordFailure,
  getExperimentStats,
  getAllExperimentsWithStats,
  isEnabled,
  getConfig,
};

export default abTestingService;
