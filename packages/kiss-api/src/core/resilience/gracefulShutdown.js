/**
 * ═══════════════════════════════════════════════════════════════════════════
 * GRACEFUL SHUTDOWN - Apagado Elegante Centralizado
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEMA QUE RESUELVE:
 * - Sin esto: Deploy mata proceso → Usuario esperando eternamente (ghosting)
 * - Con esto: Deploy señala apagado → Sistema termina tareas → Usuario recibe respuesta
 * 
 * CÓMO FUNCIONA:
 * 1. Railway envía SIGTERM al contenedor (tienes ~10 segundos)
 * 2. Este módulo captura la señal
 * 3. Ejecuta handlers de cleanup en orden de prioridad
 * 4. Cierra conexiones gracefully
 * 5. Termina el proceso
 * 
 * USO:
 * ```js
 * import { gracefulShutdown } from './core/resilience/gracefulShutdown.js';
 * 
 * // Inicializar (una vez al arrancar)
 * gracefulShutdown.init();
 * 
 * // Registrar componentes
 * gracefulShutdown.register('database', async () => {
 *   await pool.end();
 * }, { priority: 10 });
 * 
 * gracefulShutdown.register('http', gracefulShutdown.wrapHttpServer(server), {
 *   priority: 1
 * });
 * ```
 * 
 * @version 1.0.0 - Production-Grade Lite
 */

import { logger } from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Tiempo máximo para shutdown (Railway da ~10s)
  timeoutMs: parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '10000', 10),
  
  // Exit codes
  successExitCode: 0,
  forcedExitCode: 1,
};

// ═══════════════════════════════════════════════════════════════════════════
// ESTADO
// ═══════════════════════════════════════════════════════════════════════════

const handlers = [];
let isShuttingDown = false;
let isRegistered = false;

// ═══════════════════════════════════════════════════════════════════════════
// API DE REGISTRO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Registra un handler de shutdown
 * 
 * @param {string} name - Nombre del componente
 * @param {Function} handler - Función async de cleanup
 * @param {Object} [options]
 * @param {number} [options.priority=0] - Mayor = se ejecuta primero
 * @param {number} [options.timeout] - Timeout específico
 */
function register(name, handler, options = {}) {
  // Actualizar si ya existe
  const existing = handlers.findIndex(h => h.name === name);
  if (existing >= 0) {
    handlers[existing] = {
      name,
      handler,
      priority: options.priority ?? handlers[existing].priority,
      timeout: options.timeout ?? handlers[existing].timeout,
    };
  } else {
    handlers.push({
      name,
      handler,
      priority: options.priority || 0,
      timeout: options.timeout || CONFIG.timeoutMs,
    });
  }
  
  // Ordenar por prioridad (mayor primero)
  handlers.sort((a, b) => b.priority - a.priority);
  
  logger.debug({ name, priority: options.priority || 0 }, 'Shutdown handler registered');
}

/**
 * Desregistra un handler
 */
function unregister(name) {
  const index = handlers.findIndex(h => h.name === name);
  if (index >= 0) {
    handlers.splice(index, 1);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EJECUCIÓN DE SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════

async function executeShutdown(signal, exitCode = CONFIG.successExitCode) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress');
    return;
  }
  
  isShuttingDown = true;
  const startTime = Date.now();
  
  console.log('');
  logger.info({
    signal,
    handlers: handlers.map(h => h.name),
    timeout: CONFIG.timeoutMs,
  }, '🛑 Initiating graceful shutdown...');
  
  // Timer de seguridad
  const forceExitTimer = setTimeout(() => {
    logger.error('⚠️ Shutdown timeout exceeded - forcing exit');
    process.exit(CONFIG.forcedExitCode);
  }, CONFIG.timeoutMs);
  
  const results = [];
  
  // Ejecutar handlers en orden
  for (const { name, handler, timeout } of handlers) {
    try {
      logger.info(`  ├─ Closing: ${name}`);
      
      const handlerStart = Date.now();
      
      await Promise.race([
        handler(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error(`Timeout`)), timeout)
        ),
      ]);
      
      const duration = Date.now() - handlerStart;
      results.push({ name, success: true, durationMs: duration });
      logger.info(`  │  ✓ ${name} (${duration}ms)`);
      
    } catch (error) {
      results.push({ name, success: false, error: error?.message });
      logger.warn({ err: error?.message }, `  │  ✗ ${name} failed`);
    }
  }
  
  clearTimeout(forceExitTimer);
  
  const totalDuration = Date.now() - startTime;
  const allSuccessful = results.every(r => r.success);
  
  logger.info({
    durationMs: totalDuration,
    success: allSuccessful,
  }, allSuccessful 
    ? '  └─ ✅ Graceful shutdown complete'
    : '  └─ ⚠️ Shutdown completed with errors'
  );
  
  process.exit(allSuccessful ? exitCode : CONFIG.forcedExitCode);
}

// ═══════════════════════════════════════════════════════════════════════════
// INICIALIZACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Inicia el sistema de graceful shutdown
 * Llamar una vez al arrancar la app
 */
function init() {
  if (isRegistered) {
    return;
  }
  
  // SIGTERM: Railway/Docker/Kubernetes
  process.on('SIGTERM', () => executeShutdown('SIGTERM'));
  
  // SIGINT: Ctrl+C
  process.on('SIGINT', () => executeShutdown('SIGINT'));
  
  // Excepciones no manejadas
  process.on('uncaughtException', (error) => {
    console.error('💥 UNCAUGHT EXCEPTION:', error);
    logger.error({ err: error?.message, stack: error?.stack }, 'Uncaught exception');
    executeShutdown('uncaughtException', 1);
  });
  
  // Promesas rechazadas (solo log, no shutdown)
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection');
  });
  
  isRegistered = true;
  logger.info('Graceful shutdown initialized');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Verifica si está en proceso de shutdown
 */
function isInProgress() {
  return isShuttingDown;
}

/**
 * Lista handlers registrados
 */
function listHandlers() {
  return handlers.map(h => ({
    name: h.name,
    priority: h.priority,
  }));
}

/**
 * Wrapper para HTTP server
 */
function wrapHttpServer(server) {
  return () => {
    return new Promise((resolve) => {
      server.close((err) => {
        if (err && err.code !== 'ERR_SERVER_NOT_RUNNING') {
          logger.warn({ err: err?.message }, 'Error closing HTTP server');
        }
        resolve();
      });
      
      // Dar tiempo a conexiones activas
      setTimeout(resolve, 2000);
    });
  };
}

/**
 * Wrapper para Socket.io
 */
function wrapSocketIO(io) {
  return async () => {
    try {
      const sockets = await io.fetchSockets();
      for (const socket of sockets) {
        socket.disconnect(true);
      }
      io.close();
    } catch {
      // Ignorar errores
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const gracefulShutdown = {
  init,
  register,
  unregister,
  isInProgress,
  listHandlers,
  wrapHttpServer,
  wrapSocketIO,
};

export default gracefulShutdown;
