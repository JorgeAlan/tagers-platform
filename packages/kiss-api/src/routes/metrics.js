/**
 * KISS Metrics (MVP in-memory)
 * For production, consider using Prometheus client or similar.
 */

const counters = {
  ingest_total: 0,
  ingest_by_model: {},
  ingest_by_signal_source: {},
  ingest_fallback_total: 0,
  latency_sum_ms: 0,
  latency_count: 0,
  errors_total: 0,
  instructions_by_target: {},
  instructions_by_priority: {},
};

export function incrementIngest({ model, fallback, signal_source }) {
  counters.ingest_total++;
  
  if (model) {
    counters.ingest_by_model[model] = (counters.ingest_by_model[model] || 0) + 1;
  }
  
  if (signal_source) {
    counters.ingest_by_signal_source[signal_source] = (counters.ingest_by_signal_source[signal_source] || 0) + 1;
  }
  
  if (fallback) {
    counters.ingest_fallback_total++;
  }
}

export function addLatency(ms) {
  if (typeof ms === "number" && ms >= 0) {
    counters.latency_sum_ms += ms;
    counters.latency_count++;
  }
}

export function incrementError() {
  counters.errors_total++;
}

export function recordInstruction({ target_app, priority }) {
  if (target_app) {
    counters.instructions_by_target[target_app] = (counters.instructions_by_target[target_app] || 0) + 1;
  }
  if (priority) {
    counters.instructions_by_priority[priority] = (counters.instructions_by_priority[priority] || 0) + 1;
  }
}

export function getMetrics() {
  const avgLatency = counters.latency_count > 0
    ? (counters.latency_sum_ms / counters.latency_count).toFixed(2)
    : 0;

  return {
    ingest_total: counters.ingest_total,
    ingest_by_model: { ...counters.ingest_by_model },
    ingest_by_signal_source: { ...counters.ingest_by_signal_source },
    ingest_fallback_total: counters.ingest_fallback_total,
    avg_latency_ms: parseFloat(avgLatency),
    latency_count: counters.latency_count,
    errors_total: counters.errors_total,
    instructions_by_target: { ...counters.instructions_by_target },
    instructions_by_priority: { ...counters.instructions_by_priority },
    uptime_seconds: Math.floor(process.uptime()),
  };
}

export function resetMetrics() {
  counters.ingest_total = 0;
  counters.ingest_by_model = {};
  counters.ingest_by_signal_source = {};
  counters.ingest_fallback_total = 0;
  counters.latency_sum_ms = 0;
  counters.latency_count = 0;
  counters.errors_total = 0;
  counters.instructions_by_target = {};
  counters.instructions_by_priority = {};
}

export function metricsHandler(req, res) {
  res.json(getMetrics());
}
