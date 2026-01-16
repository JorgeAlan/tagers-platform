/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LOCAL QUEUE - Control de Tráfico con p-queue
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PROBLEMA QUE RESUELVE:
 * - Sin control: 20 usuarios escriben → 20 llamadas OpenAI simultáneas → CRASH
 * - Con p-queue: 20 usuarios escriben → Cola ordena → 3 a la vez → Estable
 * 
 * CUÁNDO SE USA:
 * - Siempre que Redis no esté disponible
 * - Como rate limiter local incluso CON Redis
 * 
 * USO:
 * ```js
 * import { localQueue } from './core/resilience/localQueue.js';
 * 
 * const response = await localQueue.add(async () => {
 *   return await openai.chat.completions.create({...});
 * }, { name: 'generate-response' });
 * ```
 * 
 * @version 1.0.0 - Production-Grade Lite
 */

import PQueue from 'p-queue';
import { logger } from '../../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Cuántas tareas de IA pueden ejecutarse simultáneamente
  concurrency: parseInt(process.env.LOCAL_QUEUE_CONCURRENCY || '3', 10),
  
  // Timeout por tarea (evita que una tarea bloqueada detenga todo)
  timeoutMs: parseInt(process.env.LOCAL_QUEUE_TIMEOUT_MS || '60000', 10),
  
  // Intervalo mínimo entre tareas (rate limiting suave)
  intervalMs: parseInt(process.env.LOCAL_QUEUE_INTERVAL_MS || '100', 10),
  
  // Tamaño máximo de cola antes de rechazar
  maxQueueSize: parseInt(process.env.LOCAL_QUEUE_MAX_SIZE || '100', 10),
};

// ═══════════════════════════════════════════════════════════════════════════
// COLA PRINCIPAL DE IA
// ═══════════════════════════════════════════════════════════════════════════

const aiQueue = new PQueue({
  concurrency: CONFIG.concurrency,
  interval: CONFIG.intervalMs,
  intervalCap: CONFIG.concurrency,
  carryoverConcurrencyCount: true,
  timeout: CONFIG.timeoutMs,
  throwOnTimeout: true,
});

// Métricas
const metrics = {
  added: 0,
  completed: 0,
  failed: 0,
  timeouts: 0,
  rejected: 0,
  totalProcessingTimeMs: 0,
};

// Eventos de monitoreo
aiQueue.on('active', () => {
  logger.debug({
    pending: aiQueue.pending,
    active: aiQueue.size,
  }, 'LocalQueue: Task started');
});

aiQueue.on('idle', () => {
  logger.debug('LocalQueue: All tasks completed (idle)');
});

aiQueue.on('error', (error) => {
  metrics.failed++;
  logger.warn({ err: error?.message }, 'LocalQueue: Task error');
});

// ═══════════════════════════════════════════════════════════════════════════
// API PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encola una tarea de IA para procesamiento controlado
 * 
 * @param {Function} fn - Función async a ejecutar
 * @param {Object} [options] - Opciones
 * @param {string} [options.name] - Nombre identificador
 * @param {number} [options.priority] - Prioridad (mayor = primero)
 * @param {number} [options.timeout] - Timeout específico
 * @returns {Promise<any>} Resultado de la función
 */
async function add(fn, options = {}) {
  // Protección contra sobrecarga
  if (aiQueue.pending >= CONFIG.maxQueueSize) {
    metrics.rejected++;
    logger.warn({
      pending: aiQueue.pending,
      maxSize: CONFIG.maxQueueSize,
    }, 'LocalQueue: Rejecting task (queue full)');
    throw new Error('Queue is at capacity. Please try again later.');
  }
  
  metrics.added++;
  const startTime = Date.now();
  const taskName = options.name || `task_${metrics.added}`;
  
  logger.debug({
    task: taskName,
    pending: aiQueue.pending,
    active: aiQueue.size,
  }, 'LocalQueue: Task enqueued');
  
  try {
    const result = await aiQueue.add(fn, {
      priority: options.priority || 0,
      timeout: options.timeout || CONFIG.timeoutMs,
    });
    
    metrics.completed++;
    const duration = Date.now() - startTime;
    metrics.totalProcessingTimeMs += duration;
    
    logger.debug({
      task: taskName,
      durationMs: duration,
    }, 'LocalQueue: Task completed');
    
    return result;
    
  } catch (error) {
    if (error.name === 'TimeoutError') {
      metrics.timeouts++;
      logger.warn({
        task: taskName,
        timeout: options.timeout || CONFIG.timeoutMs,
      }, 'LocalQueue: Task timeout');
    } else {
      metrics.failed++;
    }
    throw error;
  }
}

/**
 * Espera a que la cola esté vacía
 * Útil para graceful shutdown
 */
async function onIdle() {
  return aiQueue.onIdle();
}

/**
 * Espera a que haya espacio para N tareas más
 */
async function onSizeLessThan(count) {
  return aiQueue.onSizeLessThan(count);
}

/**
 * Pausa la cola
 */
function pause() {
  aiQueue.pause();
  logger.info('LocalQueue: Paused');
}

/**
 * Reanuda la cola
 */
function resume() {
  aiQueue.start();
  logger.info('LocalQueue: Resumed');
}

/**
 * Limpia todas las tareas pendientes
 */
function clear() {
  aiQueue.clear();
  logger.warn('LocalQueue: Cleared all pending tasks');
}

// ═══════════════════════════════════════════════════════════════════════════
// ESTADÍSTICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene estadísticas de la cola
 */
function getStats() {
  const avgProcessingTime = metrics.completed > 0
    ? Math.round(metrics.totalProcessingTimeMs / metrics.completed)
    : 0;
  
  return {
    // Estado actual
    pending: aiQueue.pending,
    active: aiQueue.size,
    isPaused: aiQueue.isPaused,
    
    // Configuración
    concurrency: CONFIG.concurrency,
    maxQueueSize: CONFIG.maxQueueSize,
    timeoutMs: CONFIG.timeoutMs,
    
    // Métricas acumuladas
    totalAdded: metrics.added,
    totalCompleted: metrics.completed,
    totalFailed: metrics.failed,
    totalTimeouts: metrics.timeouts,
    totalRejected: metrics.rejected,
    
    // Rendimiento
    avgProcessingTimeMs: avgProcessingTime,
    successRate: metrics.added > 0
      ? ((metrics.completed / metrics.added) * 100).toFixed(1) + '%'
      : 'N/A',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN SUPPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Prepara la cola para shutdown
 * 
 * @param {number} [timeoutMs=10000] - Tiempo máximo de espera
 * @returns {Promise<Object>} Estado del shutdown
 */
async function prepareShutdown(timeoutMs = 10000) {
  const pending = aiQueue.pending;
  const active = aiQueue.size;
  
  logger.info({ pending, active }, 'LocalQueue: Preparing for shutdown...');
  
  // Pausar para no aceptar nuevas tareas
  aiQueue.pause();
  
  if (pending === 0 && active === 0) {
    return { completed: true, pendingTasks: 0, durationMs: 0 };
  }
  
  const startTime = Date.now();
  
  try {
    await Promise.race([
      aiQueue.onIdle(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Shutdown timeout')), timeoutMs)
      ),
    ]);
    
    const duration = Date.now() - startTime;
    logger.info({ durationMs: duration }, 'LocalQueue: Shutdown complete');
    
    return { completed: true, pendingTasks: 0, durationMs: duration };
    
  } catch {
    const remaining = aiQueue.pending;
    logger.warn({ remaining }, 'LocalQueue: Shutdown timeout - tasks may be lost');
    
    return {
      completed: false,
      pendingTasks: remaining,
      durationMs: timeoutMs,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const localQueue = {
  add,
  onIdle,
  onSizeLessThan,
  pause,
  resume,
  clear,
  getStats,
  prepareShutdown,
};

export default localQueue;
