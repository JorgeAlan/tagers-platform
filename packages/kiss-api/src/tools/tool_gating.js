/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TOOL GATING - Control de herramientas por etapa del flujo
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Implementa el patrón "allowed_tools" de GPT-5.2:
 * - EXPLORATION: Solo herramientas READ
 * - CONFIRMATION: Solo issue_order_write_capability + reserve_stock
 * - COMMIT: Solo execute_* herramientas
 * 
 * Esto garantiza que el modelo NO PUEDE ejecutar escrituras antes de tiempo,
 * incluso si el prompt se degrada o hay prompt injection.
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Cargar schemas
let readToolsSchema = [];
let writeToolsSchema = [];

try {
  readToolsSchema = JSON.parse(readFileSync(join(__dirname, "../ana_super/tool_schemas/read_tools.json"), "utf-8"));
  writeToolsSchema = JSON.parse(readFileSync(join(__dirname, "../ana_super/tool_schemas/write_tools.json"), "utf-8"));
} catch (e) {
  console.warn("[tool_gating] Could not load schemas:", e.message);
}

// ═══════════════════════════════════════════════════════════════════════════
// ETAPAS DEL FLUJO
// ═══════════════════════════════════════════════════════════════════════════

export const FLOW_STAGES = {
  EXPLORATION: "EXPLORATION",      // Lecturas, verificaciones
  CONFIRMATION: "CONFIRMATION",    // Esperando "CONFIRMAR CAMBIO"
  COMMIT: "COMMIT",                // Ejecutando escritura
  DONE: "DONE",                    // Completado
};

// ═══════════════════════════════════════════════════════════════════════════
// HERRAMIENTAS PERMITIDAS POR ETAPA
// ═══════════════════════════════════════════════════════════════════════════

const STAGE_ALLOWED_TOOLS = {
  [FLOW_STAGES.EXPLORATION]: [
    // Todas las READ
    "get_sheet_policy",
    "get_order_details",
    "verify_order_ownership",
    "list_customer_orders",
    "check_variation_stock",
    "list_available_delivery_dates",
    "get_order_reschedule_context",
    "list_branches",
  ],
  
  [FLOW_STAGES.CONFIRMATION]: [
    // Preparación para commit
    "issue_order_write_capability",
    "reserve_stock_for_reschedule",
    // Lecturas para re-verificar si es necesario
    "check_variation_stock",
    "list_available_delivery_dates",
    // Escalación siempre disponible
    "escalate_to_human",
  ],
  
  [FLOW_STAGES.COMMIT]: [
    // Solo ejecución
    "execute_reschedule",
    "execute_branch_change",
    "execute_order_cancel",
    // Escalación de emergencia
    "escalate_to_human",
  ],
  
  [FLOW_STAGES.DONE]: [
    // Solo lecturas post-commit
    "get_order_details",
    "list_customer_orders",
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PRINCIPALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene herramientas permitidas para una etapa (schemas completos)
 */
export function getAllowedTools(stage) {
  const allowedNames = STAGE_ALLOWED_TOOLS[stage] || STAGE_ALLOWED_TOOLS[FLOW_STAGES.EXPLORATION];
  const allTools = [...readToolsSchema, ...writeToolsSchema];
  
  return allTools.filter(tool => 
    allowedNames.includes(tool.function.name)
  );
}

/**
 * Obtiene nombres de herramientas permitidas (para logging)
 */
export function getAllowedToolNames(stage) {
  return STAGE_ALLOWED_TOOLS[stage] || STAGE_ALLOWED_TOOLS[FLOW_STAGES.EXPLORATION];
}

/**
 * Verifica si una herramienta está permitida
 */
export function isToolAllowed(toolName, stage) {
  const allowed = STAGE_ALLOWED_TOOLS[stage] || [];
  return allowed.includes(toolName);
}

/**
 * Obtiene configuración completa para OpenAI API call
 * Incluye parallel_tool_calls: false para flujos WRITE
 */
export function getToolConfig(stage, options = {}) {
  const tools = getAllowedTools(stage);
  
  // Para etapas de escritura, forzar una tool por turno (más seguro, más auditable)
  const isWriteStage = stage === FLOW_STAGES.CONFIRMATION || stage === FLOW_STAGES.COMMIT;
  
  return {
    tools,
    tool_choice: options.forceToolChoice || "auto",
    parallel_tool_calls: isWriteStage ? false : true,
  };
}

/**
 * Determina la etapa basada en el estado del flujo ORDER_MODIFY
 */
export function getStageFromFlowState(flowState) {
  if (!flowState) return FLOW_STAGES.EXPLORATION;
  
  const { step, pending, capability_token, reservation_id } = flowState;
  
  // Si tiene capability token activo, está en COMMIT
  if (capability_token || step === "EXECUTING") {
    return FLOW_STAGES.COMMIT;
  }
  
  // Si está esperando confirmación
  if (step === "AWAIT_CONFIRM" || step === "CONFIRMING" || pending) {
    return FLOW_STAGES.CONFIRMATION;
  }
  
  // Si completó o canceló
  if (step === "DONE" || step === "CANCELLED" || step === "COMPLETED") {
    return FLOW_STAGES.DONE;
  }
  
  // Default: exploración
  return FLOW_STAGES.EXPLORATION;
}

/**
 * Determina si el flujo está en una etapa de escritura
 */
export function isWriteStage(stage) {
  return stage === FLOW_STAGES.CONFIRMATION || stage === FLOW_STAGES.COMMIT;
}

/**
 * Determina si se debe usar GPT-5.2 (modelo más inteligente) para esta etapa
 * Prioridad: inteligencia > costo
 */
export function shouldUseSmartModel(stage, context = {}) {
  // Siempre usar modelo inteligente para etapas críticas
  if (isWriteStage(stage)) return true;
  
  // Usar modelo inteligente si hay frustración detectada
  if (context.frustration_level >= 2) return true;
  
  // Usar modelo inteligente si es ambiguo
  if (context.intent_confidence < 0.7) return true;
  
  // Para exploración simple, modelo rápido está bien
  return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE TOOL CALLS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valida que una llamada a herramienta esté permitida
 */
export function validateToolCall(toolName, stage, args = {}) {
  // 1) Verificar si está en la lista permitida
  if (!isToolAllowed(toolName, stage)) {
    return {
      allowed: false,
      reason: `Tool "${toolName}" no permitida en etapa "${stage}"`,
      suggestedStage: getSuggestedStageForTool(toolName),
    };
  }
  
  // 2) Validaciones específicas por tool
  if (toolName.startsWith("execute_")) {
    // WRITE tools requieren capability_token
    if (!args.capability_token) {
      return {
        allowed: false,
        reason: "capability_token requerido para ejecutar esta acción",
      };
    }
    
    // WRITE tools requieren idempotency_key
    if (!args.idempotency_key) {
      return {
        allowed: false,
        reason: "idempotency_key requerido para ejecutar esta acción",
      };
    }
  }
  
  // 3) Validar fechas ISO
  const dateField = args.delivery_date || args.new_delivery_date;
  if (dateField && !/^\d{4}-\d{2}-\d{2}$/.test(dateField)) {
    return {
      allowed: false,
      reason: "Fecha debe estar en formato ISO (YYYY-MM-DD)",
    };
  }
  
  return { allowed: true };
}

function getSuggestedStageForTool(toolName) {
  for (const [stage, tools] of Object.entries(STAGE_ALLOWED_TOOLS)) {
    if (tools.includes(toolName)) {
      return stage;
    }
  }
  return FLOW_STAGES.EXPLORATION;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSICIONES
// ═══════════════════════════════════════════════════════════════════════════

const VALID_TRANSITIONS = {
  [FLOW_STAGES.EXPLORATION]: [FLOW_STAGES.CONFIRMATION, FLOW_STAGES.DONE],
  [FLOW_STAGES.CONFIRMATION]: [FLOW_STAGES.COMMIT, FLOW_STAGES.EXPLORATION, FLOW_STAGES.DONE],
  [FLOW_STAGES.COMMIT]: [FLOW_STAGES.DONE, FLOW_STAGES.EXPLORATION],
  [FLOW_STAGES.DONE]: [FLOW_STAGES.EXPLORATION],
};

export function canTransition(from, to) {
  return (VALID_TRANSITIONS[from] || []).includes(to);
}

export function getNextStage(current, success = true) {
  if (current === FLOW_STAGES.EXPLORATION) return FLOW_STAGES.CONFIRMATION;
  if (current === FLOW_STAGES.CONFIRMATION) return success ? FLOW_STAGES.COMMIT : FLOW_STAGES.EXPLORATION;
  if (current === FLOW_STAGES.COMMIT) return FLOW_STAGES.DONE;
  return FLOW_STAGES.EXPLORATION;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  FLOW_STAGES,
  getAllowedTools,
  getAllowedToolNames,
  isToolAllowed,
  getToolConfig,
  getStageFromFlowState,
  isWriteStage,
  shouldUseSmartModel,
  validateToolCall,
  canTransition,
  getNextStage,
};
