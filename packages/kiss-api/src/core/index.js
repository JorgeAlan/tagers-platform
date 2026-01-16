/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CORE - Arquitectura Governor/Dispatcher/Queue/Cache
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Módulos centrales para arquitectura asíncrona:
 * 
 * - Governor: Decide SI procesar (reglas de negocio, rate limit distribuido)
 * - Dispatcher: Decide CÓMO procesar (routing, intent detection)
 * - Queue: Cola BullMQ/Redis para procesamiento async con DLQ
 * - SemanticCache: Caché inteligente para respuestas frecuentes
 * - DistributedRateLimiter: Rate limiting y deduplicación con Redis
 * - DLQProcessor: Gestión de Dead Letter Queue
 * - AsyncProcessor: [Legacy] Procesamiento in-memory (usar Queue en producción)
 * - AIRunner: Llamadas a IA con self-healing
 * 
 * @version 2.1.0 - Distributed Rate Limiting + DLQ
 */

// Core decision making
export { governor, GOVERNOR_DECISIONS, getGovernorStats } from "./governor.js";
export { dispatcher, ROUTE_TYPES } from "./dispatcher.js";

// Distributed infrastructure (Redis)
export { distributedRateLimiter, checkRateLimit, checkDuplicate } from "./distributedRateLimiter.js";
export { dlqProcessor, moveToDeadLetter, getDLQStats, getDLQJobs } from "./dlqProcessor.js";

// Async infrastructure (BullMQ/Redis)
export { aiQueue } from "./queue.js";
export { semanticCache } from "./semanticCache.js";

// Legacy (in-memory fallback)
export { asyncProcessor } from "./async_processor.js";

// AI execution
export { aiRunner } from "./ai_runner.js";
