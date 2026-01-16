/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA MIGRATIONS - Sistema de migraciones de base de datos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecuta migraciones SQL en orden.
 * 
 * @version 0.1.0
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
  
  // Ensure migrations table exists
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
      continue;
    }
    
    logger.info({ file }, "Running migration");
    
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    
    // Split by semicolon and run each statement
    const statements = sql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(Boolean)
      .filter(s => !s.startsWith("--"));
    
    for (const stmt of statements) {
      if (stmt.length > 0) {
        await query(stmt);
      }
    }
    
    // Mark as executed
    await query(
      "INSERT INTO luca_migrations (filename) VALUES ($1)",
      [file]
    );
    
    logger.info({ file }, "Migration completed");
  }
}

// If run directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      logger.info("All migrations completed");
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err: err?.message }, "Migration failed");
      process.exit(1);
    });
}

export default { runMigrations };
