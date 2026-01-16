/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANGSMITH CUSTOM CALLBACKS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Callbacks personalizados para métricas, logging y alertas.
 * 
 * Estos callbacks se integran con LangSmith para:
 * - Métricas de latencia y tokens
 * - Alertas en errores críticos
 * - Logging estructurado
 * - Integración con Prometheus/Grafana
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { isLangSmithEnabled } from "./index.js";

// ═══════════════════════════════════════════════════════════════════════════
// MÉTRICAS INTERNAS
// ═══════════════════════════════════════════════════════════════════════════

const metrics = {
  llmCalls: 0,
  llmErrors: 0,
  totalTokens: 0,
  totalLatencyMs: 0,
  callsByModel: new Map(),
  callsByTask: new Map(),
};

/**
 * Obtiene las métricas acumuladas
 */
export function getMetrics() {
  return {
    llmCalls: metrics.llmCalls,
    llmErrors: metrics.llmErrors,
    totalTokens: metrics.totalTokens,
    averageLatencyMs: metrics.llmCalls > 0 
      ? Math.round(metrics.totalLatencyMs / metrics.llmCalls) 
      : 0,
    callsByModel: Object.fromEntries(metrics.callsByModel),
    callsByTask: Object.fromEntries(metrics.callsByTask),
  };
}

/**
 * Resetea las métricas (útil para tests)
 */
export function resetMetrics() {
  metrics.llmCalls = 0;
  metrics.llmErrors = 0;
  metrics.totalTokens = 0;
  metrics.totalLatencyMs = 0;
  metrics.callsByModel.clear();
  metrics.callsByTask.clear();
}

// ═══════════════════════════════════════════════════════════════════════════
// CALLBACK HANDLERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Callback para cuando inicia una llamada LLM
 */
export function onLLMStart({ model, task, inputs }) {
  logger.debug({
    event: "llm_start",
    model,
    task,
    inputLength: typeof inputs === "string" ? inputs.length : JSON.stringify(inputs).length,
  });
  
  return {
    startTime: Date.now(),
    model,
    task,
  };
}

/**
 * Callback para cuando termina una llamada LLM exitosamente
 */
export function onLLMEnd({ startTime, model, task, usage, output }) {
  const latencyMs = Date.now() - startTime;
  
  // Actualizar métricas
  metrics.llmCalls++;
  metrics.totalLatencyMs += latencyMs;
  
  if (usage?.total_tokens) {
    metrics.totalTokens += usage.total_tokens;
  }
  
  metrics.callsByModel.set(
    model, 
    (metrics.callsByModel.get(model) || 0) + 1
  );
  
  if (task) {
    metrics.callsByTask.set(
      task, 
      (metrics.callsByTask.get(task) || 0) + 1
    );
  }
  
  logger.info({
    event: "llm_end",
    model,
    task,
    latencyMs,
    tokens: usage?.total_tokens || null,
    tokensIn: usage?.prompt_tokens || null,
    tokensOut: usage?.completion_tokens || null,
  });
  
  // Alerta si la latencia es muy alta
  if (latencyMs > 10000) {
    logger.warn({
      event: "llm_slow",
      model,
      task,
      latencyMs,
      threshold: 10000,
    });
  }
}

/**
 * Callback para cuando falla una llamada LLM
 */
export function onLLMError({ startTime, model, task, error }) {
  const latencyMs = Date.now() - startTime;
  
  metrics.llmErrors++;
  metrics.totalLatencyMs += latencyMs;
  
  logger.error({
    event: "llm_error",
    model,
    task,
    latencyMs,
    error: error?.message || String(error),
    errorType: error?.constructor?.name || "Error",
  });
  
  // Detectar errores críticos
  const isCritical = 
    error?.message?.includes("rate_limit") ||
    error?.message?.includes("insufficient_quota") ||
    error?.message?.includes("invalid_api_key");
  
  if (isCritical) {
    logger.fatal({
      event: "llm_critical_error",
      model,
      task,
      error: error?.message,
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CALLBACK FACTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un objeto de callbacks para usar con llamadas LLM
 * 
 * @example
 * const callbacks = createCallbacks({ model: "gpt-5-nano", task: "intent" });
 * const ctx = callbacks.onStart({ inputs: userMessage });
 * try {
 *   const result = await llmCall();
 *   callbacks.onEnd({ ...ctx, output: result, usage: result.usage });
 * } catch (error) {
 *   callbacks.onError({ ...ctx, error });
 * }
 */
export function createCallbacks({ model, task }) {
  return {
    onStart: ({ inputs }) => onLLMStart({ model, task, inputs }),
    onEnd: ({ startTime, output, usage }) => onLLMEnd({ startTime, model, task, output, usage }),
    onError: ({ startTime, error }) => onLLMError({ startTime, model, task, error }),
  };
}

/**
 * Wrapper que aplica callbacks automáticamente
 * 
 * @example
 * const result = await withCallbacks(
 *   () => openai.chat.completions.create({ ... }),
 *   { model: "gpt-5-nano", task: "classification", inputs: userMessage }
 * );
 */
export async function withCallbacks(fn, { model, task, inputs }) {
  const callbacks = createCallbacks({ model, task });
  const ctx = callbacks.onStart({ inputs });
  
  try {
    const result = await fn();
    callbacks.onEnd({ 
      ...ctx, 
      output: result, 
      usage: result?.usage || null,
    });
    return result;
  } catch (error) {
    callbacks.onError({ ...ctx, error });
    throw error;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROMETHEUS-COMPATIBLE METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera métricas en formato Prometheus
 */
export function getPrometheusMetrics() {
  const lines = [];
  
  // LLM Calls Total
  lines.push("# HELP tagers_llm_calls_total Total number of LLM calls");
  lines.push("# TYPE tagers_llm_calls_total counter");
  lines.push(`tagers_llm_calls_total ${metrics.llmCalls}`);
  
  // LLM Errors Total
  lines.push("# HELP tagers_llm_errors_total Total number of LLM errors");
  lines.push("# TYPE tagers_llm_errors_total counter");
  lines.push(`tagers_llm_errors_total ${metrics.llmErrors}`);
  
  // Tokens Total
  lines.push("# HELP tagers_llm_tokens_total Total tokens used");
  lines.push("# TYPE tagers_llm_tokens_total counter");
  lines.push(`tagers_llm_tokens_total ${metrics.totalTokens}`);
  
  // Average Latency
  lines.push("# HELP tagers_llm_latency_avg_ms Average LLM latency in milliseconds");
  lines.push("# TYPE tagers_llm_latency_avg_ms gauge");
  const avgLatency = metrics.llmCalls > 0 
    ? Math.round(metrics.totalLatencyMs / metrics.llmCalls) 
    : 0;
  lines.push(`tagers_llm_latency_avg_ms ${avgLatency}`);
  
  // Calls by Model
  lines.push("# HELP tagers_llm_calls_by_model LLM calls by model");
  lines.push("# TYPE tagers_llm_calls_by_model counter");
  for (const [model, count] of metrics.callsByModel) {
    lines.push(`tagers_llm_calls_by_model{model="${model}"} ${count}`);
  }
  
  // Calls by Task
  lines.push("# HELP tagers_llm_calls_by_task LLM calls by task");
  lines.push("# TYPE tagers_llm_calls_by_task counter");
  for (const [task, count] of metrics.callsByTask) {
    lines.push(`tagers_llm_calls_by_task{task="${task}"} ${count}`);
  }
  
  // LangSmith Status
  lines.push("# HELP tagers_langsmith_enabled LangSmith tracing enabled");
  lines.push("# TYPE tagers_langsmith_enabled gauge");
  lines.push(`tagers_langsmith_enabled ${isLangSmithEnabled() ? 1 : 0}`);
  
  return lines.join("\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  getMetrics,
  resetMetrics,
  createCallbacks,
  withCallbacks,
  getPrometheusMetrics,
  onLLMStart,
  onLLMEnd,
  onLLMError,
};
