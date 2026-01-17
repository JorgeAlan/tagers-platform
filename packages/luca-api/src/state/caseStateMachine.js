/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASE STATE MACHINE - Estados y transiciones de casos LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Flujo típico de un caso:
 * OPEN → INVESTIGATING → DIAGNOSED → RECOMMENDED → APPROVED → EXECUTING → EXECUTED → CLOSED
 * 
 * Con salidas anticipadas:
 * - CLOSE_AS_NOISE desde OPEN
 * - CLOSE_AS_FALSE_POSITIVE desde INVESTIGATING
 * - CLOSE_NO_ACTION_NEEDED desde DIAGNOSED
 */

import { logger } from "@tagers/shared";

/**
 * Definición de estados y transiciones válidas
 */
export const CASE_STATES = {
  OPEN: "OPEN",
  INVESTIGATING: "INVESTIGATING",
  DIAGNOSED: "DIAGNOSED",
  RECOMMENDED: "RECOMMENDED",
  APPROVED: "APPROVED",
  EXECUTING: "EXECUTING",
  EXECUTED: "EXECUTED",
  MEASURING: "MEASURING",
  MEASURED: "MEASURED",
  CLOSED: "CLOSED",
};

export const CASE_EVENTS = {
  START_INVESTIGATION: "START_INVESTIGATION",
  CLOSE_AS_NOISE: "CLOSE_AS_NOISE",
  ADD_EVIDENCE: "ADD_EVIDENCE",
  DIAGNOSE: "DIAGNOSE",
  NEED_MORE_INFO: "NEED_MORE_INFO",
  CLOSE_AS_FALSE_POSITIVE: "CLOSE_AS_FALSE_POSITIVE",
  RECOMMEND_ACTION: "RECOMMEND_ACTION",
  CLOSE_NO_ACTION_NEEDED: "CLOSE_NO_ACTION_NEEDED",
  APPROVE_ACTION: "APPROVE_ACTION",
  REJECT_ACTION: "REJECT_ACTION",
  MODIFY_RECOMMENDATION: "MODIFY_RECOMMENDATION",
  START_EXECUTION: "START_EXECUTION",
  CANCEL: "CANCEL",
  EXECUTION_SUCCESS: "EXECUTION_SUCCESS",
  EXECUTION_FAILED: "EXECUTION_FAILED",
  START_MEASUREMENT: "START_MEASUREMENT",
  SKIP_MEASUREMENT: "SKIP_MEASUREMENT",
  MEASUREMENT_COMPLETE: "MEASUREMENT_COMPLETE",
  CLOSE_WITH_LEARNINGS: "CLOSE_WITH_LEARNINGS",
  REOPEN: "REOPEN",
};

/**
 * State machine definition
 */
export const CaseStateMachine = {
  initial: CASE_STATES.OPEN,
  
  states: {
    [CASE_STATES.OPEN]: {
      on: {
        [CASE_EVENTS.START_INVESTIGATION]: CASE_STATES.INVESTIGATING,
        [CASE_EVENTS.CLOSE_AS_NOISE]: CASE_STATES.CLOSED,
      },
      metadata: {
        description: "Caso recién creado, pendiente de investigación",
        allowedActions: ["start_investigation", "close"],
      },
    },
    
    [CASE_STATES.INVESTIGATING]: {
      on: {
        [CASE_EVENTS.ADD_EVIDENCE]: CASE_STATES.INVESTIGATING,
        [CASE_EVENTS.DIAGNOSE]: CASE_STATES.DIAGNOSED,
        [CASE_EVENTS.NEED_MORE_INFO]: CASE_STATES.INVESTIGATING,
        [CASE_EVENTS.CLOSE_AS_FALSE_POSITIVE]: CASE_STATES.CLOSED,
      },
      metadata: {
        description: "En investigación activa",
        allowedActions: ["add_evidence", "diagnose", "close"],
      },
    },
    
    [CASE_STATES.DIAGNOSED]: {
      on: {
        [CASE_EVENTS.RECOMMEND_ACTION]: CASE_STATES.RECOMMENDED,
        [CASE_EVENTS.CLOSE_NO_ACTION_NEEDED]: CASE_STATES.CLOSED,
      },
      metadata: {
        description: "Diagnóstico completado, pendiente de recomendación",
        allowedActions: ["recommend_action", "close"],
      },
    },
    
    [CASE_STATES.RECOMMENDED]: {
      on: {
        [CASE_EVENTS.APPROVE_ACTION]: CASE_STATES.APPROVED,
        [CASE_EVENTS.REJECT_ACTION]: CASE_STATES.DIAGNOSED,
        [CASE_EVENTS.MODIFY_RECOMMENDATION]: CASE_STATES.RECOMMENDED,
      },
      metadata: {
        description: "Acción recomendada, pendiente de aprobación",
        allowedActions: ["approve", "reject", "modify"],
        requiresApproval: true,
      },
    },
    
    [CASE_STATES.APPROVED]: {
      on: {
        [CASE_EVENTS.START_EXECUTION]: CASE_STATES.EXECUTING,
        [CASE_EVENTS.CANCEL]: CASE_STATES.CLOSED,
      },
      metadata: {
        description: "Acción aprobada, pendiente de ejecución",
        allowedActions: ["execute", "cancel"],
      },
    },
    
    [CASE_STATES.EXECUTING]: {
      on: {
        [CASE_EVENTS.EXECUTION_SUCCESS]: CASE_STATES.EXECUTED,
        [CASE_EVENTS.EXECUTION_FAILED]: CASE_STATES.APPROVED,
      },
      metadata: {
        description: "Acción en ejecución",
        allowedActions: [],
        isExecuting: true,
      },
    },
    
    [CASE_STATES.EXECUTED]: {
      on: {
        [CASE_EVENTS.START_MEASUREMENT]: CASE_STATES.MEASURING,
        [CASE_EVENTS.SKIP_MEASUREMENT]: CASE_STATES.CLOSED,
      },
      metadata: {
        description: "Acción ejecutada, pendiente de medición",
        allowedActions: ["measure", "close"],
      },
    },
    
    [CASE_STATES.MEASURING]: {
      on: {
        [CASE_EVENTS.MEASUREMENT_COMPLETE]: CASE_STATES.MEASURED,
      },
      metadata: {
        description: "Midiendo impacto de la acción",
        allowedActions: [],
        isMeasuring: true,
      },
    },
    
    [CASE_STATES.MEASURED]: {
      on: {
        [CASE_EVENTS.CLOSE_WITH_LEARNINGS]: CASE_STATES.CLOSED,
      },
      metadata: {
        description: "Medición completada, pendiente de cierre",
        allowedActions: ["close"],
      },
    },
    
    [CASE_STATES.CLOSED]: {
      on: {
        [CASE_EVENTS.REOPEN]: CASE_STATES.INVESTIGATING,
      },
      metadata: {
        description: "Caso cerrado",
        allowedActions: ["reopen"],
        isFinal: true,
      },
    },
  },
};

/**
 * Valida si una transición es permitida
 */
export function canTransition(currentState, event) {
  const stateConfig = CaseStateMachine.states[currentState];
  
  if (!stateConfig) {
    logger.warn({ currentState }, "Unknown state");
    return false;
  }
  
  return stateConfig.on && stateConfig.on[event] !== undefined;
}

/**
 * Obtiene el siguiente estado dada una transición
 */
export function getNextState(currentState, event) {
  if (!canTransition(currentState, event)) {
    return null;
  }
  
  return CaseStateMachine.states[currentState].on[event];
}

/**
 * Obtiene las transiciones disponibles desde un estado
 */
export function getAvailableTransitions(currentState) {
  const stateConfig = CaseStateMachine.states[currentState];
  
  if (!stateConfig || !stateConfig.on) {
    return [];
  }
  
  return Object.keys(stateConfig.on);
}

/**
 * Obtiene metadata de un estado
 */
export function getStateMetadata(state) {
  const stateConfig = CaseStateMachine.states[state];
  return stateConfig?.metadata || {};
}

/**
 * Ejecuta una transición y retorna el nuevo estado
 * Lanza error si la transición no es válida
 */
export function transition(currentState, event, context = {}) {
  if (!canTransition(currentState, event)) {
    const available = getAvailableTransitions(currentState);
    throw new Error(
      `Invalid transition: ${event} from ${currentState}. ` +
      `Available transitions: ${available.join(", ") || "none"}`
    );
  }
  
  const nextState = getNextState(currentState, event);
  
  logger.info({
    from: currentState,
    to: nextState,
    event,
    context,
  }, "Case state transition");
  
  return {
    previousState: currentState,
    currentState: nextState,
    event,
    timestamp: new Date().toISOString(),
    context,
  };
}

/**
 * Mapea eventos a nombres amigables para UI
 */
export const EVENT_LABELS = {
  [CASE_EVENTS.START_INVESTIGATION]: "Iniciar Investigación",
  [CASE_EVENTS.CLOSE_AS_NOISE]: "Cerrar como Ruido",
  [CASE_EVENTS.ADD_EVIDENCE]: "Agregar Evidencia",
  [CASE_EVENTS.DIAGNOSE]: "Diagnosticar",
  [CASE_EVENTS.NEED_MORE_INFO]: "Necesita Más Info",
  [CASE_EVENTS.CLOSE_AS_FALSE_POSITIVE]: "Cerrar como Falso Positivo",
  [CASE_EVENTS.RECOMMEND_ACTION]: "Recomendar Acción",
  [CASE_EVENTS.CLOSE_NO_ACTION_NEEDED]: "Cerrar sin Acción",
  [CASE_EVENTS.APPROVE_ACTION]: "Aprobar Acción",
  [CASE_EVENTS.REJECT_ACTION]: "Rechazar Acción",
  [CASE_EVENTS.MODIFY_RECOMMENDATION]: "Modificar Recomendación",
  [CASE_EVENTS.START_EXECUTION]: "Iniciar Ejecución",
  [CASE_EVENTS.CANCEL]: "Cancelar",
  [CASE_EVENTS.EXECUTION_SUCCESS]: "Ejecución Exitosa",
  [CASE_EVENTS.EXECUTION_FAILED]: "Ejecución Fallida",
  [CASE_EVENTS.START_MEASUREMENT]: "Iniciar Medición",
  [CASE_EVENTS.SKIP_MEASUREMENT]: "Omitir Medición",
  [CASE_EVENTS.MEASUREMENT_COMPLETE]: "Medición Completada",
  [CASE_EVENTS.CLOSE_WITH_LEARNINGS]: "Cerrar con Aprendizajes",
  [CASE_EVENTS.REOPEN]: "Reabrir",
};

/**
 * Mapea estados a colores para UI
 */
export const STATE_COLORS = {
  [CASE_STATES.OPEN]: "#3B82F6",         // blue
  [CASE_STATES.INVESTIGATING]: "#F59E0B", // amber
  [CASE_STATES.DIAGNOSED]: "#8B5CF6",     // purple
  [CASE_STATES.RECOMMENDED]: "#EC4899",   // pink
  [CASE_STATES.APPROVED]: "#10B981",      // green
  [CASE_STATES.EXECUTING]: "#F97316",     // orange
  [CASE_STATES.EXECUTED]: "#14B8A6",      // teal
  [CASE_STATES.MEASURING]: "#6366F1",     // indigo
  [CASE_STATES.MEASURED]: "#06B6D4",      // cyan
  [CASE_STATES.CLOSED]: "#6B7280",        // gray
};

export default {
  CASE_STATES,
  CASE_EVENTS,
  CaseStateMachine,
  canTransition,
  getNextState,
  getAvailableTransitions,
  getStateMetadata,
  transition,
  EVENT_LABELS,
  STATE_COLORS,
};
