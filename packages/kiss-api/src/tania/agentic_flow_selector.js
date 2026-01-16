/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENTIC FLOW SELECTOR - Permite cambiar entre viejo y optimizado
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * USO:
 * - OPTIMIZED_AGENTIC_FLOW=true → Usa flujo optimizado (1 AI call)
 * - OPTIMIZED_AGENTIC_FLOW=false → Usa flujo viejo (3-9 AI calls)
 * 
 * Esto permite hacer rollback fácil si hay problemas de calidad.
 * 
 * MÉTRICAS A MONITOREAR:
 * - ai_calls_per_message: Debería bajar de 3-9 a ~0.2
 * - response_quality: Medido por thumbs up/down
 * - latency_ms: Debería bajar de 2-5s a <500ms
 * - cost_per_message: Debería bajar 95%+
 */

import { runAgenticFlow as runOldFlow } from "./agentic_flow.js";
import { runOptimizedFlow as runNewFlow, getOptimizedFlowStats } from "./agentic_flow_optimized.js";
import { logger } from "../utils/logger.js";

// Re-export history functions para compatibilidad con imports existentes
export { 
  getConversationHistory, 
  setConversationHistory, 
  addToConversationHistory,
  getMemoryStats,
} from "./agentic_flow.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const USE_OPTIMIZED = process.env.OPTIMIZED_AGENTIC_FLOW !== "false"; // Default: true

// A/B testing (optional)
const AB_RATIO = parseFloat(process.env.AB_OPTIMIZED_RATIO || "1.0"); // 1.0 = 100% optimized

// ═══════════════════════════════════════════════════════════════════════════
// FLOW SELECTOR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Selecciona y ejecuta el flujo agéntico apropiado
 * 
 * @param {Object} params - Parámetros del flujo
 * @returns {Promise<Object>} Resultado del flujo
 */
export async function runAgenticFlowSmart(params) {
  const { conversationId } = params;
  
  // Determinar qué flujo usar
  const useOptimized = USE_OPTIMIZED && Math.random() < AB_RATIO;
  
  logger.debug({
    conversationId,
    useOptimized,
    abRatio: AB_RATIO,
  }, "Selecting agentic flow");
  
  if (useOptimized) {
    // ─────────────────────────────────────────────────────────────────────────
    // FLUJO OPTIMIZADO (1 AI call máximo)
    // ─────────────────────────────────────────────────────────────────────────
    try {
      const result = await runNewFlow(params);
      
      logger.info({
        conversationId,
        flow: "optimized",
        aiCalls: result.aiCalls,
        source: result.source,
        durationMs: result.durationMs,
      }, "⚡ Optimized flow completed");
      
      return {
        response: { customer_message: result.response },
        analysis: null, // No analyzer in optimized flow
        retrievedData: null,
        wasRevised: false,
        flowType: "optimized",
        aiCalls: result.aiCalls,
      };
    } catch (err) {
      logger.error({ err: err.message, conversationId }, "Optimized flow failed, falling back");
      // Fall through to old flow
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // FLUJO VIEJO (3-9 AI calls)
  // ─────────────────────────────────────────────────────────────────────────
  const result = await runOldFlow(params);
  
  logger.info({
    conversationId,
    flow: "legacy",
    wasRevised: result.wasRevised,
  }, "Legacy flow completed");
  
  return {
    ...result,
    flowType: "legacy",
    aiCalls: result.wasRevised ? 5 : 3, // Estimate
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════════════════════

export function getFlowStats() {
  return {
    mode: USE_OPTIMIZED ? "optimized" : "legacy",
    abRatio: AB_RATIO,
    optimizedStats: USE_OPTIMIZED ? getOptimizedFlowStats() : null,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT - Compatible con uso existente
// ═══════════════════════════════════════════════════════════════════════════

export { runAgenticFlowSmart as runAgenticFlow };

export default {
  runAgenticFlow: runAgenticFlowSmart,
  getFlowStats,
};
