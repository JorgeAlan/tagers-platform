/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANGSMITH TRACING HELPERS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Wrappers y utilidades para tracing consistente en todo el proyecto.
 * 
 * Características:
 * - Wrappers type-safe para diferentes tipos de runs
 * - Soporte para nested traces
 * - Metadata automática
 * - Manejo graceful de errores
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { 
  isLangSmithEnabled, 
  shouldTrace, 
  getBaseMetadata, 
  generateRunId,
  getTraceable,
} from "./index.js";

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPERS DE TRACEABLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrapper para tracing de llamadas LLM
 * 
 * @param {Function} fn - Función a tracear
 * @param {Object} options
 * @param {string} options.name - Nombre del trace
 * @param {Object} options.metadata - Metadata adicional
 * @returns {Function} - Función wrapeada (o original si tracing deshabilitado)
 */
export async function traceableLLM(fn, { name, metadata = {} }) {
  if (!shouldTrace()) {
    return fn;
  }
  
  const traceable = await getTraceable();
  if (!traceable) {
    return fn;
  }
  
  return traceable(fn, {
    name,
    run_type: "llm",
    metadata: {
      ...getBaseMetadata(),
      ...metadata,
    },
  });
}

/**
 * Wrapper para tracing de chains/pipelines
 * 
 * @param {Function} fn - Función a tracear
 * @param {Object} options
 * @param {string} options.name - Nombre del trace
 * @param {Object} options.metadata - Metadata adicional
 * @returns {Function} - Función wrapeada
 */
export async function traceableChain(fn, { name, metadata = {} }) {
  if (!shouldTrace()) {
    return fn;
  }
  
  const traceable = await getTraceable();
  if (!traceable) {
    return fn;
  }
  
  return traceable(fn, {
    name,
    run_type: "chain",
    metadata: {
      ...getBaseMetadata(),
      ...metadata,
    },
  });
}

/**
 * Wrapper para tracing de tool calls
 * 
 * @param {Function} fn - Función a tracear
 * @param {Object} options
 * @param {string} options.name - Nombre del tool
 * @param {Object} options.metadata - Metadata adicional
 * @returns {Function} - Función wrapeada
 */
export async function traceableTool(fn, { name, metadata = {} }) {
  if (!shouldTrace()) {
    return fn;
  }
  
  const traceable = await getTraceable();
  if (!traceable) {
    return fn;
  }
  
  return traceable(fn, {
    name,
    run_type: "tool",
    metadata: {
      ...getBaseMetadata(),
      ...metadata,
    },
  });
}

/**
 * Wrapper para tracing de retrievers/búsquedas
 * 
 * @param {Function} fn - Función a tracear
 * @param {Object} options
 * @param {string} options.name - Nombre del retriever
 * @param {Object} options.metadata - Metadata adicional
 * @returns {Function} - Función wrapeada
 */
export async function traceableRetriever(fn, { name, metadata = {} }) {
  if (!shouldTrace()) {
    return fn;
  }
  
  const traceable = await getTraceable();
  if (!traceable) {
    return fn;
  }
  
  return traceable(fn, {
    name,
    run_type: "retriever",
    metadata: {
      ...getBaseMetadata(),
      ...metadata,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// HIGHER-ORDER WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un wrapper de tracing que puede usarse como decorador
 * 
 * @example
 * const tracedFn = withTracing(myFunction, {
 *   name: "my-function",
 *   runType: "chain",
 *   metadata: { task: "classification" }
 * });
 */
export function withTracing(fn, { name, runType = "chain", metadata = {} }) {
  return async (...args) => {
    if (!shouldTrace()) {
      return fn(...args);
    }
    
    const runId = generateRunId();
    const startTime = Date.now();
    
    const enrichedMetadata = {
      ...getBaseMetadata(),
      ...metadata,
      run_id: runId,
    };
    
    try {
      const traceable = await getTraceable();
      
      if (!traceable) {
        return fn(...args);
      }
      
      const traced = traceable(fn, {
        name,
        run_type: runType,
        metadata: enrichedMetadata,
      });
      
      const result = await traced(...args);
      
      logger.debug({
        trace: name,
        runId,
        durationMs: Date.now() - startTime,
        success: true,
      });
      
      return result;
    } catch (error) {
      logger.error({
        trace: name,
        runId,
        durationMs: Date.now() - startTime,
        error: error.message,
      });
      throw error;
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTO DE TRACING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un contexto de tracing para agrupar múltiples operaciones
 * 
 * @example
 * const ctx = createTracingContext("order-flow", { orderId: "123" });
 * await ctx.trace("validate", async () => { ... });
 * await ctx.trace("process", async () => { ... });
 * ctx.end();
 */
export function createTracingContext(name, metadata = {}) {
  const contextId = generateRunId();
  const startTime = Date.now();
  const traces = [];
  
  return {
    id: contextId,
    
    /**
     * Ejecuta una función dentro del contexto de tracing
     */
    async trace(stepName, fn) {
      const stepStart = Date.now();
      try {
        const result = await withTracing(fn, {
          name: `${name}/${stepName}`,
          metadata: {
            ...metadata,
            contextId,
            step: stepName,
          },
        })();
        
        traces.push({
          step: stepName,
          duration: Date.now() - stepStart,
          success: true,
        });
        
        return result;
      } catch (error) {
        traces.push({
          step: stepName,
          duration: Date.now() - stepStart,
          success: false,
          error: error.message,
        });
        throw error;
      }
    },
    
    /**
     * Finaliza el contexto y logea el resumen
     */
    end() {
      const totalDuration = Date.now() - startTime;
      logger.info({
        context: name,
        contextId,
        totalDurationMs: totalDuration,
        steps: traces.length,
        successful: traces.filter(t => t.success).length,
        failed: traces.filter(t => !t.success).length,
      });
      
      return {
        contextId,
        duration: totalDuration,
        traces,
      };
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES ESPECÍFICAS PARA TAGERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrapper específico para clasificadores (chatwoot_intent, order_step, etc.)
 */
export async function traceableClassifier(fn, { schemaKey, model, metadata = {} }) {
  return traceableLLM(fn, {
    name: `classifier/${schemaKey}`,
    metadata: {
      schemaKey,
      model,
      task: "classification",
      ...metadata,
    },
  });
}

/**
 * Wrapper específico para generación de respuestas (tania_reply, hitl_reply)
 */
export async function traceableGenerator(fn, { schemaKey, model, metadata = {} }) {
  return traceableLLM(fn, {
    name: `generator/${schemaKey}`,
    metadata: {
      schemaKey,
      model,
      task: "generation",
      ...metadata,
    },
  });
}

/**
 * Wrapper para flows agénticos (Tania, Ana Super)
 */
export async function traceableAgenticFlow(fn, { flowName, conversationId, metadata = {} }) {
  return traceableChain(fn, {
    name: `agentic/${flowName}`,
    metadata: {
      flowName,
      conversationId,
      task: "agentic_flow",
      ...metadata,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  traceableLLM,
  traceableChain,
  traceableTool,
  traceableRetriever,
  withTracing,
  createTracingContext,
  traceableClassifier,
  traceableGenerator,
  traceableAgenticFlow,
};
