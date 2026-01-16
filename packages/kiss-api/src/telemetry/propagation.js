/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPENTELEMETRY TRACE PROPAGATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Propagates trace context across async boundaries (BullMQ queues).
 * Uses W3C Trace Context format (traceparent, tracestate, baggage).
 * 
 * Usage:
 * 
 * // PRODUCER (webhook/chatwoot.js):
 * const traceContext = extractTraceContext();
 * await aiQueue.add("process_message", {
 *   ...jobData,
 *   _traceContext: traceContext,  // <-- Add to job data
 * });
 * 
 * // CONSUMER (workers/aiWorker.js):
 * await withWorkerTraceContext(job, async (span) => {
 *   // Your processing code here
 *   // span is the worker span with restored parent context
 * });
 * 
 * @version 1.0.0
 */

import { 
  trace, 
  context, 
  propagation, 
  SpanKind, 
  SpanStatusCode,
  ROOT_CONTEXT,
} from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";

// ═══════════════════════════════════════════════════════════════════════════
// PROPAGATOR
// ═══════════════════════════════════════════════════════════════════════════

// W3C Trace Context propagator (standard format)
const propagator = new W3CTraceContextPropagator();

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACT CONTEXT (Producer Side - Before Enqueue)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract current trace context for propagation through queue
 * Call this in the webhook handler before enqueuing
 * 
 * @returns {Object} Serializable trace context
 */
export function extractTraceContext() {
  const carrier = {};
  
  try {
    // Inject current context into carrier using W3C format
    propagation.inject(context.active(), carrier);
  } catch (error) {
    // Fail silently - tracing shouldn't break business logic
    console.warn("[OTEL] Failed to extract trace context:", error.message);
  }
  
  return carrier;
}

/**
 * Extract trace context with additional metadata
 * Includes baggage for business context propagation
 * 
 * @param {Object} metadata - Additional metadata to propagate
 * @returns {Object} Trace context with metadata
 */
export function extractTraceContextWithMetadata(metadata = {}) {
  const carrier = extractTraceContext();
  
  // Add metadata as baggage (propagated with context)
  if (Object.keys(metadata).length > 0) {
    carrier._baggage = metadata;
  }
  
  return carrier;
}

// ═══════════════════════════════════════════════════════════════════════════
// INJECT CONTEXT (Consumer Side - After Dequeue)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Restore trace context from job data
 * Creates a new context linked to the original trace
 * 
 * @param {Object} traceContext - The _traceContext from job data
 * @returns {Object} OpenTelemetry context
 */
export function injectTraceContext(traceContext) {
  if (!traceContext || typeof traceContext !== "object") {
    return ROOT_CONTEXT;
  }
  
  try {
    // Extract context from carrier using W3C format
    return propagation.extract(ROOT_CONTEXT, traceContext);
  } catch (error) {
    console.warn("[OTEL] Failed to inject trace context:", error.message);
    return ROOT_CONTEXT;
  }
}

/**
 * Get baggage metadata from trace context
 * 
 * @param {Object} traceContext - The _traceContext from job data
 * @returns {Object} Baggage metadata
 */
export function getBaggageFromContext(traceContext) {
  return traceContext?._baggage || {};
}

// ═══════════════════════════════════════════════════════════════════════════
// WORKER CONTEXT WRAPPER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute worker job with restored trace context
 * This is the main function to use in the worker
 * 
 * @param {Object} job - BullMQ job object
 * @param {Function} fn - Function to execute (receives span as argument)
 * @param {Object} options - Additional options
 * @returns {Promise<any>} - Result of function
 * 
 * @example
 * async function processMessageJob(job) {
 *   return await withWorkerTraceContext(job, async (span) => {
 *     span.setAttribute("custom.attr", "value");
 *     // ... your processing logic
 *   });
 * }
 */
export async function withWorkerTraceContext(job, fn, options = {}) {
  const tracer = trace.getTracer("tagers-kiss-api", "1.0.0");
  const traceContext = job.data?._traceContext;
  
  // Restore parent context from job data
  const parentContext = injectTraceContext(traceContext);
  
  // Calculate queue wait time if webhook timestamp available
  const webhookStartTime = job.data?._webhookStartTime;
  const queueWaitMs = webhookStartTime ? Date.now() - webhookStartTime : null;
  
  // Create span attributes
  const attributes = {
    "messaging.system": "bullmq",
    "messaging.operation": "process",
    "messaging.message_id": job.id,
    "messaging.destination": job.queueName || "ai-queue",
    "job.name": job.name,
    "job.attempt": job.attemptsMade,
    "tagers.conversation_id": job.data?.conversationId,
    "tagers.route": job.data?.routing?.route,
    ...options.attributes,
  };
  
  if (queueWaitMs !== null) {
    attributes["tagers.queue_wait_ms"] = queueWaitMs;
  }
  
  // Start span as child of propagated context
  return context.with(parentContext, async () => {
    const span = tracer.startSpan("tagers.worker.process", {
      kind: SpanKind.CONSUMER,
      attributes,
    });
    
    try {
      const result = await context.with(trace.setSpan(context.active(), span), async () => {
        return await fn(span);
      });
      
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });
      span.recordException(error);
      throw error;
    } finally {
      span.end();
    }
  });
}

/**
 * Simplified wrapper that doesn't expose span to callback
 * 
 * @param {Object} job - BullMQ job object
 * @param {Function} fn - Function to execute
 * @returns {Promise<any>} - Result of function
 */
export async function withRestoredContext(job, fn) {
  return withWorkerTraceContext(job, async () => fn());
}

// ═══════════════════════════════════════════════════════════════════════════
// HTTP HEADER UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extract trace context from HTTP headers
 * Use when receiving requests from other services
 * 
 * @param {Object} headers - HTTP headers object
 * @returns {Object} OpenTelemetry context
 */
export function extractFromHeaders(headers) {
  if (!headers || typeof headers !== "object") {
    return ROOT_CONTEXT;
  }
  
  try {
    return propagation.extract(ROOT_CONTEXT, headers);
  } catch (error) {
    console.warn("[OTEL] Failed to extract from headers:", error.message);
    return ROOT_CONTEXT;
  }
}

/**
 * Inject trace context into outgoing HTTP headers
 * Use when calling other services
 * 
 * @param {Object} headers - Headers object to modify
 * @returns {Object} Headers with trace context
 */
export function injectIntoHeaders(headers = {}) {
  try {
    propagation.inject(context.active(), headers);
  } catch (error) {
    console.warn("[OTEL] Failed to inject into headers:", error.message);
  }
  return headers;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRACE ID UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get trace ID from context carrier
 * 
 * @param {Object} carrier - W3C trace context carrier
 * @returns {string|null} Trace ID or null
 */
export function getTraceIdFromCarrier(carrier) {
  if (!carrier?.traceparent) return null;
  
  // traceparent format: version-traceId-spanId-flags
  // Example: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01
  const parts = carrier.traceparent.split("-");
  return parts[1] || null;
}

/**
 * Get span ID from context carrier
 * 
 * @param {Object} carrier - W3C trace context carrier
 * @returns {string|null} Span ID or null
 */
export function getSpanIdFromCarrier(carrier) {
  if (!carrier?.traceparent) return null;
  
  const parts = carrier.traceparent.split("-");
  return parts[2] || null;
}

/**
 * Check if carrier has valid trace context
 * 
 * @param {Object} carrier - W3C trace context carrier
 * @returns {boolean}
 */
export function hasValidTraceContext(carrier) {
  if (!carrier?.traceparent) return false;
  
  const parts = carrier.traceparent.split("-");
  return parts.length === 4 && parts[1]?.length === 32 && parts[2]?.length === 16;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPRESS MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Express middleware to add trace ID to request/response
 * Useful for logging correlation
 */
export function traceContextMiddleware(req, res, next) {
  const span = trace.getActiveSpan();
  
  if (span) {
    const ctx = span.spanContext();
    req.traceId = ctx.traceId;
    req.spanId = ctx.spanId;
    
    // Add trace ID to response header for debugging
    res.setHeader("X-Trace-Id", ctx.traceId);
  }
  
  next();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  extractTraceContext,
  extractTraceContextWithMetadata,
  injectTraceContext,
  getBaggageFromContext,
  withWorkerTraceContext,
  withRestoredContext,
  extractFromHeaders,
  injectIntoHeaders,
  getTraceIdFromCarrier,
  getSpanIdFromCarrier,
  hasValidTraceContext,
  traceContextMiddleware,
};
