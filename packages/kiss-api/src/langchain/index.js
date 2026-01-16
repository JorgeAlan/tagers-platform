/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANGCHAIN/LANGSMITH CONFIGURATION MODULE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Módulo central para configuración y estado de LangChain/LangSmith.
 * 
 * Proporciona:
 * - Detección automática de configuración
 * - Lazy loading de dependencias opcionales
 * - Fallbacks cuando las deps no están instaladas
 * - Exportaciones unificadas para todo el proyecto
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Configuración de LangSmith basada en variables de entorno
 */
export const langsmithConfig = {
  enabled: process.env.LANGCHAIN_TRACING_V2 === "true",
  apiKey: process.env.LANGCHAIN_API_KEY || "",
  project: process.env.LANGCHAIN_PROJECT || "tagers-kiss-api",
  endpoint: process.env.LANGCHAIN_ENDPOINT || "https://api.smith.langchain.com",
  // Sampling rate para reducir costos (0.0-1.0, default 1.0 = 100%)
  sampleRate: parseFloat(process.env.LANGCHAIN_TRACING_SAMPLE_RATE || "1.0"),
  // Background tracing para reducir latencia
  background: process.env.LANGCHAIN_TRACING_BACKGROUND === "true",
};

/**
 * Verifica si LangSmith está habilitado y configurado correctamente
 */
export function isLangSmithEnabled() {
  return langsmithConfig.enabled && Boolean(langsmithConfig.apiKey);
}

/**
 * Verifica si debe tracear esta llamada (respeta sampling rate)
 */
export function shouldTrace() {
  if (!isLangSmithEnabled()) return false;
  if (langsmithConfig.sampleRate >= 1.0) return true;
  return Math.random() < langsmithConfig.sampleRate;
}

// ═══════════════════════════════════════════════════════════════════════════
// LAZY LOADING DE DEPENDENCIAS
// ═══════════════════════════════════════════════════════════════════════════

let _traceable = null;
let _langGraphAvailable = null;
let _langsmithLogged = false;

/**
 * Obtiene la función traceable de langsmith (lazy loaded)
 * @returns {Function|null} - traceable function o null si no está disponible
 */
export async function getTraceable() {
  if (_traceable !== null) return _traceable;
  
  try {
    const { traceable } = await import("langsmith/traceable");
    _traceable = traceable;
    
    if (!_langsmithLogged) {
      _langsmithLogged = true;
      if (isLangSmithEnabled()) {
        logger.info({
          msg: "LangSmith traceable loaded",
          project: langsmithConfig.project,
          sampleRate: langsmithConfig.sampleRate,
          background: langsmithConfig.background,
        });
      }
    }
    
    return _traceable;
  } catch (err) {
    logger.warn({ err: err.message }, "langsmith not available, tracing disabled");
    _traceable = false; // Mark as unavailable
    return null;
  }
}

/**
 * Verifica si LangGraph está disponible (sin importarlo aún)
 */
export async function isLangGraphAvailable() {
  if (_langGraphAvailable !== null) return _langGraphAvailable;
  
  try {
    await import("@langchain/langgraph");
    _langGraphAvailable = true;
    logger.debug({ msg: "LangGraph available" });
    return true;
  } catch (err) {
    logger.debug({ msg: "LangGraph not installed, using fallback state machine" });
    _langGraphAvailable = false;
    return false;
  }
}

/**
 * Importa LangGraph dinámicamente
 * @returns {Object|null} - { StateGraph, END } o null
 */
export async function getLangGraph() {
  if (!(await isLangGraphAvailable())) return null;
  
  try {
    const { StateGraph, END, START } = await import("@langchain/langgraph");
    return { StateGraph, END, START };
  } catch (err) {
    logger.error({ err: err.message }, "Failed to import LangGraph");
    return null;
  }
}

/**
 * Importa mensajes de LangChain Core dinámicamente
 * @returns {Object|null} - { HumanMessage, AIMessage, SystemMessage } o null
 */
export async function getLangChainMessages() {
  try {
    const { 
      HumanMessage, 
      AIMessage, 
      SystemMessage, 
      BaseMessage 
    } = await import("@langchain/core/messages");
    return { HumanMessage, AIMessage, SystemMessage, BaseMessage };
  } catch (err) {
    logger.debug({ msg: "LangChain core messages not available, using plain objects" });
    // Fallback: retornar clases simples
    return {
      HumanMessage: class { constructor(content) { this.content = content; this.type = "human"; }},
      AIMessage: class { constructor(content) { this.content = content; this.type = "ai"; }},
      SystemMessage: class { constructor(content) { this.content = content; this.type = "system"; }},
      BaseMessage: class { constructor(content) { this.content = content; }},
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES DE METADATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera metadata base para tracing
 */
export function getBaseMetadata(additionalMetadata = {}) {
  return {
    service: "tagers-kiss-api",
    version: process.env.npm_package_version || "unknown",
    environment: process.env.NODE_ENV || "development",
    timestamp: new Date().toISOString(),
    ...additionalMetadata,
  };
}

/**
 * Genera un run_id único para correlacionar traces
 */
export function generateRunId() {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIONES SINCRÓNAS (para compatibilidad)
// ═══════════════════════════════════════════════════════════════════════════

// Re-exportar traceable síncronamente si ya está cargado
export { traceable } from "langsmith/traceable";

// ═══════════════════════════════════════════════════════════════════════════
// STATUS REPORT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un reporte del estado de LangChain/LangSmith
 */
export async function getStatusReport() {
  return {
    langsmith: {
      enabled: isLangSmithEnabled(),
      project: langsmithConfig.project,
      sampleRate: langsmithConfig.sampleRate,
    },
    dependencies: {
      langsmith: _traceable !== false,
      langgraph: await isLangGraphAvailable(),
    },
    config: {
      tracing: langsmithConfig.enabled,
      background: langsmithConfig.background,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export default {
  langsmithConfig,
  isLangSmithEnabled,
  shouldTrace,
  getTraceable,
  getLangGraph,
  getLangChainMessages,
  getBaseMetadata,
  generateRunId,
  getStatusReport,
};
