/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPENTELEMETRY TRACER UTILITIES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Manual span creation utilities for business logic tracing.
 * Use these to trace operations that aren't auto-instrumented.
 * 
 * Usage:
 *   import { withSpan, withGovernorSpan, addSpanAttributes } from "./telemetry/tracer.js";
 *   
 *   const result = await withSpan("my.operation", async (span) => {
 *     span.setAttribute("my.attribute", "value");
 *     return await doSomething();
 *   });
 * 
 * @version 1.0.0
 */

import { trace, SpanKind, SpanStatusCode, context } from "@opentelemetry/api";

// ═══════════════════════════════════════════════════════════════════════════
// TRACER INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

const TRACER_NAME = "tagers-kiss-api";
const TRACER_VERSION = "1.0.0";

/**
 * Get the tracer instance
 */
export function getTracer() {
  return trace.getTracer(TRACER_NAME, TRACER_VERSION);
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERIC SPAN WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Execute a function within a span
 * @param {string} name - Span name
 * @param {Function} fn - Function to execute (receives span as argument)
 * @param {Object} options - Span options
 * @returns {Promise<any>} - Result of function
 */
export async function withSpan(name, fn, options = {}) {
  const tracer = getTracer();
  const span = tracer.startSpan(name, {
    kind: options.kind || SpanKind.INTERNAL,
    attributes: options.attributes || {},
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
}

/**
 * Execute a synchronous function within a span
 */
export function withSpanSync(name, fn, options = {}) {
  const tracer = getTracer();
  const span = tracer.startSpan(name, {
    kind: options.kind || SpanKind.INTERNAL,
    attributes: options.attributes || {},
  });
  
  try {
    const result = context.with(trace.setSpan(context.active(), span), () => {
      return fn(span);
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
}

// ═══════════════════════════════════════════════════════════════════════════
// TYPED SPAN WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * HTTP server span (incoming request)
 */
export async function withHttpSpan(name, fn, { method, route, attributes = {} } = {}) {
  return withSpan(name, fn, {
    kind: SpanKind.SERVER,
    attributes: {
      "http.method": method,
      "http.route": route,
      ...attributes,
    },
  });
}

/**
 * Queue producer span (enqueue operation)
 */
export async function withQueueProducerSpan(name, fn, { queueName, jobType, attributes = {} } = {}) {
  return withSpan(name, fn, {
    kind: SpanKind.PRODUCER,
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination": queueName,
      "messaging.operation": "publish",
      "job.type": jobType,
      ...attributes,
    },
  });
}

/**
 * Queue consumer span (process job)
 */
export async function withQueueConsumerSpan(name, fn, { queueName, jobId, jobType, attributes = {} } = {}) {
  return withSpan(name, fn, {
    kind: SpanKind.CONSUMER,
    attributes: {
      "messaging.system": "bullmq",
      "messaging.destination": queueName,
      "messaging.operation": "process",
      "messaging.message_id": jobId,
      "job.type": jobType,
      ...attributes,
    },
  });
}

/**
 * LLM call span
 */
export async function withLLMSpan(name, fn, { model, provider = "openai", attributes = {} } = {}) {
  return withSpan(name, fn, {
    kind: SpanKind.CLIENT,
    attributes: {
      "llm.provider": provider,
      "llm.model": model,
      "llm.request_type": "chat",
      ...attributes,
    },
  });
}

/**
 * Database span
 */
export async function withDbSpan(name, fn, { system = "postgresql", operation, table, attributes = {} } = {}) {
  return withSpan(name, fn, {
    kind: SpanKind.CLIENT,
    attributes: {
      "db.system": system,
      "db.operation": operation,
      "db.sql.table": table,
      ...attributes,
    },
  });
}

/**
 * External HTTP client span
 */
export async function withClientSpan(name, fn, { url, method, service, attributes = {} } = {}) {
  return withSpan(name, fn, {
    kind: SpanKind.CLIENT,
    attributes: {
      "http.url": url,
      "http.method": method,
      "peer.service": service,
      ...attributes,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TAGERS-SPECIFIC SPAN WRAPPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Governor evaluation span
 */
export async function withGovernorSpan(fn, { conversationId, channel, attributes = {} } = {}) {
  return withSpan("tagers.governor.evaluate", fn, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tagers.component": "governor",
      "tagers.conversation_id": conversationId,
      "tagers.channel": channel,
      ...attributes,
    },
  });
}

/**
 * Dispatcher routing span
 */
export async function withDispatcherSpan(fn, { conversationId, attributes = {} } = {}) {
  return withSpan("tagers.dispatcher.route", fn, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tagers.component": "dispatcher",
      "tagers.conversation_id": conversationId,
      ...attributes,
    },
  });
}

/**
 * Worker processing span
 */
export async function withWorkerSpan(fn, { jobId, conversationId, route, attributes = {} } = {}) {
  return withSpan("tagers.worker.process", fn, {
    kind: SpanKind.CONSUMER,
    attributes: {
      "tagers.component": "worker",
      "tagers.job_id": jobId,
      "tagers.conversation_id": conversationId,
      "tagers.route": route,
      ...attributes,
    },
  });
}

/**
 * Agentic flow span
 */
export async function withAgenticFlowSpan(fn, { conversationId, flowType, attributes = {} } = {}) {
  return withSpan("tagers.agentic.flow", fn, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tagers.component": "agentic_flow",
      "tagers.conversation_id": conversationId,
      "tagers.flow_type": flowType || "tania",
      ...attributes,
    },
  });
}

/**
 * Secure flow span (order create, modify, status)
 */
export async function withSecureFlowSpan(flowType, fn, { conversationId, step, attributes = {} } = {}) {
  return withSpan(`tagers.flow.${flowType}`, fn, {
    kind: SpanKind.INTERNAL,
    attributes: {
      "tagers.component": "secure_flow",
      "tagers.flow_type": flowType,
      "tagers.conversation_id": conversationId,
      "tagers.flow_step": step,
      ...attributes,
    },
  });
}

/**
 * Chatwoot client span
 */
export async function withChatwootSpan(operation, fn, { conversationId, attributes = {} } = {}) {
  return withSpan(`chatwoot.${operation}`, fn, {
    kind: SpanKind.CLIENT,
    attributes: {
      "peer.service": "chatwoot",
      "tagers.conversation_id": conversationId,
      ...attributes,
    },
  });
}

/**
 * WooCommerce client span
 */
export async function withWooCommerceSpan(operation, fn, { attributes = {} } = {}) {
  return withSpan(`woocommerce.${operation}`, fn, {
    kind: SpanKind.CLIENT,
    attributes: {
      "peer.service": "woocommerce",
      ...attributes,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXT UTILITIES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get current active span
 */
export function getCurrentSpan() {
  return trace.getActiveSpan();
}

/**
 * Add attributes to current span
 */
export function addSpanAttributes(attributes) {
  const span = getCurrentSpan();
  if (span) {
    Object.entries(attributes).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        span.setAttribute(key, value);
      }
    });
  }
}

/**
 * Add event to current span
 */
export function addSpanEvent(name, attributes = {}) {
  const span = getCurrentSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Record exception on current span
 */
export function recordException(error) {
  const span = getCurrentSpan();
  if (span) {
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

/**
 * Set span status to error
 */
export function setSpanError(message) {
  const span = getCurrentSpan();
  if (span) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message,
    });
  }
}

/**
 * Get current trace ID (for logging correlation)
 */
export function getTraceId() {
  const span = getCurrentSpan();
  if (span) {
    return span.spanContext().traceId;
  }
  return null;
}

/**
 * Get current span ID
 */
export function getSpanId() {
  const span = getCurrentSpan();
  if (span) {
    return span.spanContext().spanId;
  }
  return null;
}

/**
 * Get trace context for logging
 */
export function getTraceContext() {
  const span = getCurrentSpan();
  if (!span) return {};
  
  const ctx = span.spanContext();
  return {
    traceId: ctx.traceId,
    spanId: ctx.spanId,
    traceFlags: ctx.traceFlags,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  getTracer,
  withSpan,
  withSpanSync,
  withHttpSpan,
  withQueueProducerSpan,
  withQueueConsumerSpan,
  withLLMSpan,
  withDbSpan,
  withClientSpan,
  withGovernorSpan,
  withDispatcherSpan,
  withWorkerSpan,
  withAgenticFlowSpan,
  withSecureFlowSpan,
  withChatwootSpan,
  withWooCommerceSpan,
  getCurrentSpan,
  addSpanAttributes,
  addSpanEvent,
  recordException,
  setSpanError,
  getTraceId,
  getSpanId,
  getTraceContext,
};
