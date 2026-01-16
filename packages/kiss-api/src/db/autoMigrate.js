/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTO-MIGRATE - Ejecuta migraciones SQL automáticamente al iniciar
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecuta todas las migraciones pendientes en orden numérico.
 * Mantiene registro de migraciones ejecutadas en tabla `_migrations`.
 * 
 * @version 1.0.0
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../utils/logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

/**
 * Ejecuta todas las migraciones pendientes
 * @param {import('pg').Pool} pool - Pool de PostgreSQL
 * @returns {Promise<{executed: string[], skipped: string[], errors: string[]}>}
 */
export async function runMigrations(pool) {
  if (!pool) {
    logger.warn({ msg: "AutoMigrate: No database pool provided, skipping migrations" });
    return { executed: [], skipped: [], errors: [] };
  }

  const results = { executed: [], skipped: [], errors: [] };

  try {
    // 1. Crear tabla de control de migraciones si no existe
    await pool.query(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        checksum VARCHAR(64)
      );
    `);

    // 2. Obtener migraciones ya ejecutadas
    const { rows: executedMigrations } = await pool.query(
      "SELECT name FROM _migrations ORDER BY name"
    );
    const executedSet = new Set(executedMigrations.map(r => r.name));

    // 3. Leer archivos de migración
    if (!fs.existsSync(MIGRATIONS_DIR)) {
      logger.info({ msg: "AutoMigrate: No migrations directory found" });
      return results;
    }

    const migrationFiles = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith(".sql"))
      .sort(); // Orden alfabético = numérico si usas 001_, 002_, etc.

    logger.info({ 
      msg: "AutoMigrate: Checking migrations",
      total: migrationFiles.length,
      executed: executedSet.size
    });

    // 4. Ejecutar migraciones pendientes
    for (const file of migrationFiles) {
      if (executedSet.has(file)) {
        results.skipped.push(file);
        continue;
      }

      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, "utf-8");
      
      // Calcular checksum simple
      const checksum = Buffer.from(sql).toString("base64").slice(0, 64);

      try {
        logger.info({ msg: `AutoMigrate: Running migration ${file}` });
        
        // Ejecutar migración en transacción
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(sql);
          await client.query(
            "INSERT INTO _migrations (name, checksum) VALUES ($1, $2)",
            [file, checksum]
          );
          await client.query("COMMIT");
          
          results.executed.push(file);
          logger.info({ msg: `AutoMigrate: ✓ Migration ${file} completed` });
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      } catch (err) {
        results.errors.push(`${file}: ${err.message}`);
        logger.error({ 
          msg: `AutoMigrate: ✗ Migration ${file} failed`,
          error: err.message 
        });
        // Continuar con otras migraciones o parar?
        // Por seguridad, paramos si una falla
        break;
      }
    }

    // 5. Resumen
    if (results.executed.length > 0) {
      logger.info({ 
        msg: "AutoMigrate: Migrations completed",
        executed: results.executed,
        skipped: results.skipped.length,
        errors: results.errors.length
      });
    } else if (results.errors.length === 0) {
      logger.debug({ msg: "AutoMigrate: All migrations already applied" });
    }

    return results;

  } catch (err) {
    logger.error({ 
      msg: "AutoMigrate: Failed to run migrations",
      error: err.message 
    });
    results.errors.push(err.message);
    return results;
  }
}

/**
 * Obtiene estado de migraciones
 * @param {import('pg').Pool} pool
 */
export async function getMigrationStatus(pool) {
  if (!pool) return { available: [], executed: [], pending: [] };

  try {
    // Migraciones en disco
    const available = fs.existsSync(MIGRATIONS_DIR)
      ? fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith(".sql")).sort()
      : [];

    // Migraciones ejecutadas
    const { rows } = await pool.query(
      "SELECT name, executed_at FROM _migrations ORDER BY name"
    ).catch(() => ({ rows: [] }));
    
    const executed = rows.map(r => r.name);
    const executedSet = new Set(executed);
    
    // Pendientes
    const pending = available.filter(f => !executedSet.has(f));

    return { available, executed, pending };
  } catch (err) {
    return { available: [], executed: [], pending: [], error: err.message };
  }
}

export default { runMigrations, getMigrationStatus };
