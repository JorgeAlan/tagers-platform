/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MODEL ROUTER v2.0 - Con Model Registry Integration
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Enruta tareas a modelos usando configuración dinámica.
 * 
 * PRIORIDAD DE CONFIGURACIÓN:
 * 1. Google Sheet (pestaña AI_MODELS) - máxima flexibilidad
 * 2. model_policy.json - configuración de archivo
 * 3. Defaults hardcoded - siempre funciona
 * 
 * CAMBIO vs v1: Ya no depende solo de model_policy.json
 * 
 * @version 2.0.0
 */

import { 
  routeTask as registryRouteTask, 
  fallbackModel as registryFallbackModel,
  getModelConfig,
  modelRegistry 
} from "../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PRINCIPALES (ahora son wrappers del Registry)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene configuración de modelo para una tarea
 * 
 * @param {string} taskName - Nombre de la tarea
 * @returns {Object} Configuración del modelo
 */
export function routeTask(taskName) {
  return registryRouteTask(taskName);
}

/**
 * Obtiene modelo de fallback
 * 
 * @param {string} model - Modelo original
 * @returns {string|null} Modelo de fallback
 */
export function fallbackModel(model) {
  return registryFallbackModel(model);
}

/**
 * Obtiene la política completa (para debugging)
 * Ahora incluye info del Registry
 */
export function getPolicy() {
  return {
    source: "model_registry",
    summary: modelRegistry.getRegistrySummary(),
    roles: modelRegistry.listRoles(),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export { modelRegistry };

export default {
  routeTask,
  fallbackModel,
  getPolicy,
  modelRegistry,
};
