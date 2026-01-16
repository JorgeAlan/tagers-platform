/**
 * ═══════════════════════════════════════════════════════════════════════════
 * @tagers/shared - Módulos compartidos entre KISS y LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Este paquete contiene código reutilizable:
 * - db: Conexión a PostgreSQL
 * - redis: Cliente Redis singleton
 * - config: Configuración base y Google Sheets loader
 * - utils: Logger, helpers
 * - integrations: Chatwoot, WhatsApp clients
 * 
 * @version 1.0.0
 */

export * from './db/index.js';
export * from './redis/index.js';
export * from './config/index.js';
export * from './utils/index.js';
export * from './integrations/index.js';
