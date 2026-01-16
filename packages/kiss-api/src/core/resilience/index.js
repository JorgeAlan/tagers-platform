/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RESILIENCE MODULE - Production-Grade Lite
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Módulo de resiliencia optimizado para Railway + Postgres.
 * 
 * INCLUYE:
 * 1. LOCAL QUEUE (p-queue) - Control de concurrencia sin Redis
 * 2. GRACEFUL SHUTDOWN - Apagado elegante para deploys
 * 
 * NO INCLUYE (innecesario cuando ya tienes Postgres):
 * - SQLite para sesiones (usa Postgres via flowStateService)
 * 
 * INSTALACIÓN:
 * ```bash
 * npm install p-queue
 * ```
 * 
 * USO:
 * ```js
 * import { resilience } from './core/resilience/index.js';
 * 
 * // Inicializar al arrancar
 * resilience.init();
 * 
 * // Ejecutar tarea con control de concurrencia
 * await resilience.queue.add(async () => {
 *   return await callOpenAI(prompt);
 * });
 * ```
 * 
 * @version 1.0.0 - Production-Grade Lite
 */

import { localQueue } from './localQueue.js';
import { gracefulShutdown } from './gracefulShutdown.js';
import { logger } from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

let initialized = false;

/**
 * Inicializa el sistema de resiliencia
 */
function init() {
  if (initialized) {
    logger.debug('Resilience module already initialized');
    return;
  }
  
  logger.info('Initializing resilience module...');
  
  // 1. Inicializar graceful shutdown
  gracefulShutdown.init();
  
  // 2. Registrar cleanup de la cola local
  gracefulShutdown.register('localQueue', async () => {
    const stats = await localQueue.prepareShutdown(8000);
    if (!stats.completed) {
      logger.warn({ pending: stats.pendingTasks }, 'Some queue tasks may be lost');
    }
  }, { priority: 10, timeout: 10000 });
  
  initialized = true;
  
  const stats = localQueue.getStats();
  logger.info({
    concurrency: stats.concurrency,
    maxQueueSize: stats.maxQueueSize,
    timeoutMs: stats.timeoutMs,
  }, 'Resilience module initialized ✓');
}

// ═══════════════════════════════════════════════════════════════════════════
// API UNIFICADA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * API unificada de resiliencia
 */
export const resilience = {
  // Inicialización
  init,
  
  // Componentes
  queue: localQueue,
  shutdown: gracefulShutdown,
  
  // Estadísticas
  getStats() {
    return {
      initialized,
      queue: localQueue.getStats(),
      shutdownHandlers: gracefulShutdown.listHandlers(),
    };
  },
  
  // Estado
  isInitialized() {
    return initialized;
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { localQueue } from './localQueue.js';
export { gracefulShutdown } from './gracefulShutdown.js';

export default resilience;
