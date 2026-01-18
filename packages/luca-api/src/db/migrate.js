/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA MIGRATIONS - Sistema de migraciones de base de datos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecuta migraciones SQL en orden con soporte de transacciones.
 * Cada migración corre en una transacción - si falla, hace rollback.
 * 
 * @version 0.2.0
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger, query, getPool } from "@tagers/shared";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Ejecuta todas las migraciones pendientes
 */
export async function runMigrations() {
  const pool = getPool();
  if (!pool) {
    logger.warn("DATABASE_URL not set, skipping migrations");
    return;
  }
  
  // Ensure migrations table exists (outside transaction)
  await query(`
    CREATE TABLE IF NOT EXISTS luca_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  
  // Get list of migration files
  const migrationsDir = path.join(__dirname, "migrations");
  
  if (!fs.existsSync(migrationsDir)) {
    logger.info("No migrations directory found");
    return;
  }
  
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith(".sql"))
    .sort();
  
  // Get already executed migrations
  const executed = await query("SELECT filename FROM luca_migrations");
  const executedSet = new Set(executed.rows.map(r => r.filename));
  
  // Run pending migrations
  for (const file of files) {
    if (executedSet.has(file)) {
      logger.info({ file }, "Migration already executed, skipping");
      continue;
    }
    
    logger.info({ file }, "Running migration");
    
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    
    // Get a client from pool for transaction
    const client = await pool.connect();
    
    try {
      // Start transaction
      await client.query("BEGIN");
      
      // Run the entire SQL file as one statement
      // PostgreSQL handles multiple statements in one query
      await client.query(sql);
      
      // Mark as executed
      await client.query(
        "INSERT INTO luca_migrations (filename) VALUES ($1)",
        [file]
      );
      
      // Commit transaction
      await client.query("COMMIT");
      
      logger.info({ file }, "Migration completed");
      
    } catch (err) {
      // Rollback on error
      await client.query("ROLLBACK");
      logger.error({ file, err: err?.message }, "Migration failed, rolled back");
      throw err;
      
    } finally {
      // Release client back to pool
      client.release();
    }
  }
  
  logger.info("All migrations completed successfully");
}

/**
 * Reset migrations (for development only)
 * WARNING: This will drop all LUCA tables!
 */
export async function resetMigrations() {
  const pool = getPool();
  if (!pool) {
    logger.warn("DATABASE_URL not set, cannot reset");
    return;
  }
  
  logger.warn("Resetting all LUCA migrations...");
  
  // Drop all LUCA tables
  const tables = [
    "luca_migrations",
    "luca_audit_log",
    "luca_cases",
    "luca_alerts", 
    "luca_actions",
    "luca_memory_episodes",
    "luca_playbooks",
    "detector_findings",
    "detector_runs",
    "finding_labels",
    "registry_detectors",
    "registry_metrics",
    "registry_data_products",
    "registry_datasets",
    "registry_sources",
    "tower_users",
    "tower_sessions",
    "case_evidence",
    "case_hypotheses",
    "case_diagnoses",
    "case_actions",
    "case_transitions",
  ];
  
  // Drop views first
  const views = [
    "v_recent_runs",
    "v_open_findings",
    "v_detector_performance",
  ];
  
  for (const view of views) {
    try {
      await query(`DROP VIEW IF EXISTS ${view} CASCADE`);
    } catch (err) {
      // Ignore errors
    }
  }
  
  for (const table of tables) {
    try {
      await query(`DROP TABLE IF EXISTS ${table} CASCADE`);
      logger.info({ table }, "Dropped table");
    } catch (err) {
      // Ignore errors for non-existent tables
    }
  }
  
  logger.info("Reset complete. Run migrations again to recreate schema.");
}

// If run directly
const isMainModule = process.argv[1] === fileURLToPath(import.meta.url);

if (isMainModule) {
  const command = process.argv[2];
  
  if (command === "reset") {
    resetMigrations()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err: err?.message }, "Reset failed");
        process.exit(1);
      });
  } else {
    runMigrations()
      .then(() => process.exit(0))
      .catch((err) => {
        logger.error({ err: err?.message }, "Migration failed");
        process.exit(1);
      });
  }
}

export default { runMigrations, resetMigrations };
