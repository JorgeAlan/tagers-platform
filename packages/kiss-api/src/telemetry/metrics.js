/**
 * ═══════════════════════════════════════════════════════════════════════════
 * OPENTELEMETRY CUSTOM METRICS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Custom metrics for Tagers operations:
 * - Counters: messages, cache hits, LLM calls, errors
 * - Histograms: latencies, processing times
 * - Gauges: queue size, active workers
 * 
 * Usage:
 *   import { metrics } from "./telemetry/metrics.js";
 *   
 *   metrics.messageReceived.add(1, { channel: "whatsapp" });
 *   metrics.webhookLatency.record(45);
 * 
 * @version 1.0.0
 */

import { metrics as otelMetrics, ValueType } from "@opentelemetry/api";

// ═══════════════════════════════════════════════════════════════════════════
// METER INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

const METER_NAME = "tagers-kiss-api";
const METER_VERSION = "1.0.0";

function getMeter() {
  return otelMetrics.getMeter(METER_NAME, METER_VERSION);
}

// ═══════════════════════════════════════════════════════════════════════════
// COUNTERS - Monotonically increasing values
// ═══════════════════════════════════════════════════════════════════════════

const meter = getMeter();

/**
 * Total messages received
 * Labels: channel (whatsapp, facebook, instagram, web)
 */
export const messageReceived = meter.createCounter("tagers.messages.received", {
  description: "Total messages received by webhook",
  unit: "1",
});

/**
 * Total messages successfully processed
 * Labels: channel, route
 */
export const messageProcessed = meter.createCounter("tagers.messages.processed", {
  description: "Total messages successfully processed by worker",
  unit: "1",
});

/**
 * Total messages that errored during processing
 * Labels: channel, error_type
 */
export const messageErrored = meter.createCounter("tagers.messages.errored", {
  description: "Total messages that failed processing",
  unit: "1",
});

/**
 * Messages skipped by governor
 * Labels: reason (duplicate, bot, outside_hours, etc)
 */
export const messageSkipped = meter.createCounter("tagers.messages.skipped", {
  description: "Messages skipped by governor",
  unit: "1",
});

/**
 * Semantic cache hits
 * Labels: category
 */
export const cacheHit = meter.createCounter("tagers.cache.hit", {
  description: "Semantic cache hits",
  unit: "1",
});

/**
 * Semantic cache misses
 */
export const cacheMiss = meter.createCounter("tagers.cache.miss", {
  description: "Semantic cache misses",
  unit: "1",
});

/**
 * LLM API calls
 * Labels: model, provider, role (classifier, responder, etc)
 */
export const llmCalls = meter.createCounter("tagers.llm.calls", {
  description: "Total LLM API calls",
  unit: "1",
});

/**
 * LLM API errors
 * Labels: model, error_type
 */
export const llmErrors = meter.createCounter("tagers.llm.errors", {
  description: "LLM API errors",
  unit: "1",
});

/**
 * Handoffs to human agents
 * Labels: reason, channel
 */
export const handoffs = meter.createCounter("tagers.handoffs", {
  description: "Handoffs to human agents",
  unit: "1",
});

/**
 * Orders created
 * Labels: channel, branch
 */
export const ordersCreated = meter.createCounter("tagers.orders.created", {
  description: "Orders successfully created",
  unit: "1",
});

/**
 * Orders modified
 * Labels: operation (add_item, remove_item, change_quantity)
 */
export const ordersModified = meter.createCounter("tagers.orders.modified", {
  description: "Orders modified",
  unit: "1",
});

/**
 * Voice notes transcribed
 * Labels: success (true/false)
 */
export const voiceTranscribed = meter.createCounter("tagers.voice.transcribed", {
  description: "Voice notes transcribed via Whisper",
  unit: "1",
});

// ═══════════════════════════════════════════════════════════════════════════
// HISTOGRAMS - Distribution of values (latencies, durations)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Webhook handler latency (until queue)
 * This is the time from HTTP request to job enqueued
 */
export const webhookLatency = meter.createHistogram("tagers.webhook.latency", {
  description: "Webhook handler latency in milliseconds",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  },
});

/**
 * Time job spends waiting in queue
 */
export const queueWaitTime = meter.createHistogram("tagers.queue.wait_time", {
  description: "Time message waits in queue before processing",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  },
});

/**
 * Worker processing time
 */
export const workerProcessingTime = meter.createHistogram("tagers.worker.processing_time", {
  description: "Worker job processing time",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000],
  },
});

/**
 * LLM response latency
 * Labels: model, role
 */
export const llmLatency = meter.createHistogram("tagers.llm.latency", {
  description: "LLM API response latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [100, 250, 500, 1000, 2000, 3000, 5000, 10000, 20000],
  },
});

/**
 * Governor evaluation time
 */
export const governorLatency = meter.createHistogram("tagers.governor.latency", {
  description: "Governor evaluation latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [1, 2, 5, 10, 25, 50, 100],
  },
});

/**
 * Dispatcher routing time
 */
export const dispatcherLatency = meter.createHistogram("tagers.dispatcher.latency", {
  description: "Dispatcher routing latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [1, 2, 5, 10, 25, 50, 100, 250, 500],
  },
});

/**
 * End-to-end latency (webhook receive to response sent)
 */
export const e2eLatency = meter.createHistogram("tagers.e2e.latency", {
  description: "End-to-end message processing latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [500, 1000, 2000, 3000, 5000, 10000, 20000, 30000, 60000],
  },
});

/**
 * Chatwoot API latency
 */
export const chatwootLatency = meter.createHistogram("tagers.chatwoot.latency", {
  description: "Chatwoot API call latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2000, 5000],
  },
});

/**
 * WooCommerce API latency
 */
export const woocommerceLatency = meter.createHistogram("tagers.woocommerce.latency", {
  description: "WooCommerce API call latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [100, 250, 500, 1000, 2000, 5000, 10000],
  },
});

/**
 * Whisper transcription latency
 */
export const whisperLatency = meter.createHistogram("tagers.whisper.latency", {
  description: "Whisper transcription latency",
  unit: "ms",
  advice: {
    explicitBucketBoundaries: [500, 1000, 2000, 3000, 5000, 10000, 20000],
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// OBSERVABLE GAUGES - Async values (polled periodically)
// ═══════════════════════════════════════════════════════════════════════════

// These need callbacks to be registered
const gaugeCallbacks = {
  queueSize: null,
  activeWorkers: null,
  cacheSize: null,
};

/**
 * Queue size gauge
 * Register callback to provide current queue sizes
 */
export const queueSizeGauge = meter.createObservableGauge("tagers.queue.size", {
  description: "Current queue size",
  unit: "1",
});

/**
 * Active workers gauge
 */
export const activeWorkersGauge = meter.createObservableGauge("tagers.workers.active", {
  description: "Number of active workers",
  unit: "1",
});

/**
 * Cache size gauge
 */
export const cacheSizeGauge = meter.createObservableGauge("tagers.cache.size", {
  description: "Number of entries in semantic cache",
  unit: "1",
});

/**
 * Register callback for queue size gauge
 * @param {Function} callback - Function that returns { waiting, active, completed, failed }
 */
export function registerQueueSizeCallback(callback) {
  gaugeCallbacks.queueSize = callback;
  queueSizeGauge.addCallback(async (observableResult) => {
    try {
      const stats = await callback();
      if (stats) {
        observableResult.observe(stats.waiting || 0, { state: "waiting" });
        observableResult.observe(stats.active || 0, { state: "active" });
        observableResult.observe(stats.completed || 0, { state: "completed" });
        observableResult.observe(stats.failed || 0, { state: "failed" });
      }
    } catch (error) {
      // Silently fail - metrics shouldn't break the app
    }
  });
}

/**
 * Register callback for active workers gauge
 * @param {Function} callback - Function that returns number of active workers
 */
export function registerActiveWorkersCallback(callback) {
  gaugeCallbacks.activeWorkers = callback;
  activeWorkersGauge.addCallback(async (observableResult) => {
    try {
      const count = await callback();
      observableResult.observe(count || 0);
    } catch (error) {
      // Silently fail
    }
  });
}

/**
 * Register callback for cache size gauge
 * @param {Function} callback - Function that returns cache stats
 */
export function registerCacheSizeCallback(callback) {
  gaugeCallbacks.cacheSize = callback;
  cacheSizeGauge.addCallback((observableResult) => {
    try {
      const stats = callback();
      observableResult.observe(stats?.entries || 0);
    } catch (error) {
      // Silently fail
    }
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// TIMING HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a timer that records to a histogram when stopped
 * @param {Object} histogram - The histogram to record to
 * @returns {Object} Timer with stop() method
 * 
 * @example
 * const timer = createTimer(webhookLatency);
 * // ... do work ...
 * timer.stop({ channel: "whatsapp" }); // Records duration with labels
 */
export function createTimer(histogram) {
  const startTime = Date.now();
  
  return {
    startTime,
    
    /**
     * Stop timer and record duration
     * @param {Object} attributes - Labels/attributes for the metric
     * @returns {number} Duration in milliseconds
     */
    stop(attributes = {}) {
      const duration = Date.now() - startTime;
      histogram.record(duration, attributes);
      return duration;
    },
    
    /**
     * Get elapsed time without recording
     * @returns {number} Elapsed milliseconds
     */
    elapsed() {
      return Date.now() - startTime;
    },
  };
}

/**
 * Wrap an async function with timing
 * @param {Object} histogram - The histogram to record to
 * @param {Function} fn - Function to wrap
 * @param {Object} attributes - Static attributes for the metric
 * @returns {Function} Wrapped function
 * 
 * @example
 * const timedFetch = withMetricTiming(chatwootLatency, fetchMessages, { operation: "fetch" });
 * await timedFetch(args);
 */
export function withMetricTiming(histogram, fn, attributes = {}) {
  return async (...args) => {
    const timer = createTimer(histogram);
    try {
      return await fn(...args);
    } finally {
      timer.stop(attributes);
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CONVENIENCE OBJECT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * All metrics in one object for easy import
 */
export const metrics = {
  // Counters
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
  
  // Histograms
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
  
  // Gauges
  queueSizeGauge,
  activeWorkersGauge,
  cacheSizeGauge,
  
  // Registration functions
  registerQueueSizeCallback,
  registerActiveWorkersCallback,
  registerCacheSizeCallback,
  
  // Helpers
  createTimer,
  withMetricTiming,
};

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default metrics;
