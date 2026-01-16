/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPENTELEMETRY TELEMETRY MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Unified exports for all telemetry functionality.
 * 
 * IMPORTANT: For auto-instrumentation to work correctly,
 * initTelemetry() must be called FIRST in server.js:
 * 
 *   // server.js
 *   import { initTelemetry } from "./telemetry/index.js";
 *   initTelemetry(); // MUST BE FIRST
 *   
 *   // Then other imports...
 *   import express from "express";
 * 
 * @version 1.0.0
 */

// ═══════════════════════════════════════════════════════════════════════════
// INSTRUMENTATION - SDK initialization (call first!)
// ═══════════════════════════════════════════════════════════════════════════
export {
  initTelemetry,
  shutdownTelemetry,
  isOtelEnabled,
  getOtelConfig,
} from "./instrumentation.js";

// ═══════════════════════════════════════════════════════════════════════════
// TRACER - Manual span creation
// ═══════════════════════════════════════════════════════════════════════════
export {
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
} from "./tracer.js";

// ═══════════════════════════════════════════════════════════════════════════
// PROPAGATION - Context across async boundaries (BullMQ)
// ═══════════════════════════════════════════════════════════════════════════
export {
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
} from "./propagation.js";

// ═══════════════════════════════════════════════════════════════════════════
// METRICS - Custom metrics
// ═══════════════════════════════════════════════════════════════════════════
export {
  metrics,
  messageReceived,
  messageProcessed,
  messageErrored,
  messageSkipped,
  cacheHit,
  cacheMiss,
  llmCalls,
  llmErrors,
  handoffs,
  ordersCreated,
  ordersModified,
  voiceTranscribed,
  webhookLatency,
  queueWaitTime,
  workerProcessingTime,
  llmLatency,
  governorLatency,
  dispatcherLatency,
  e2eLatency,
  chatwootLatency,
  woocommerceLatency,
  whisperLatency,
  queueSizeGauge,
  activeWorkersGauge,
  cacheSizeGauge,
  registerQueueSizeCallback,
  registerActiveWorkersCallback,
  registerCacheSizeCallback,
  createTimer,
  withMetricTiming,
} from "./metrics.js";

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT - Most commonly used functions
// ═══════════════════════════════════════════════════════════════════════════
import { initTelemetry, shutdownTelemetry, isOtelEnabled, getOtelConfig } from "./instrumentation.js";
import { withSpan, addSpanAttributes, getTraceId, getCurrentSpan } from "./tracer.js";
import { extractTraceContext, withWorkerTraceContext, traceContextMiddleware } from "./propagation.js";
import { metrics, createTimer } from "./metrics.js";

export default {
  // Lifecycle
  initTelemetry,
  shutdownTelemetry,
  isOtelEnabled,
  getOtelConfig,
  
  // Spans
  withSpan,
  addSpanAttributes,
  getTraceId,
  getCurrentSpan,
  
  // Propagation
  extractTraceContext,
  withWorkerTraceContext,
  traceContextMiddleware,
  
  // Metrics
  metrics,
  createTimer,
};
