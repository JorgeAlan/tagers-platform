/**
 * ═══════════════════════════════════════════════════════════════════════════
 * RUNNABLE CONFIGURATION FOR LANGGRAPH
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Configuración y utilidades para LangGraph state machines.
 * Incluye fallback implementation cuando LangGraph no está disponible.
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import { isLangGraphAvailable, getLangGraph, getLangChainMessages } from "./index.js";

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK STATE MACHINE (sin dependencias externas)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Implementación simple de máquina de estados sin LangGraph
 * Útil cuando @langchain/langgraph no está instalado
 */
export class SimpleStateMachine {
  constructor({ name, initialState, nodes, edges, conditionalEdges }) {
    this.name = name;
    this.state = { ...initialState };
    this.nodes = new Map();
    this.edges = new Map();
    this.conditionalEdges = new Map();
    this.entryPoint = null;
    this.history = [];
    
    // Registrar nodos
    if (nodes) {
      for (const [nodeName, handler] of Object.entries(nodes)) {
        this.addNode(nodeName, handler);
      }
    }
    
    // Registrar edges simples
    if (edges) {
      for (const [from, to] of Object.entries(edges)) {
        this.addEdge(from, to);
      }
    }
    
    // Registrar edges condicionales
    if (conditionalEdges) {
      for (const [from, condition] of Object.entries(conditionalEdges)) {
        this.addConditionalEdges(from, condition);
      }
    }
  }
  
  addNode(name, handler) {
    this.nodes.set(name, handler);
    return this;
  }
  
  addEdge(from, to) {
    this.edges.set(from, to);
    return this;
  }
  
  addConditionalEdges(from, condition) {
    this.conditionalEdges.set(from, condition);
    return this;
  }
  
  setEntryPoint(nodeName) {
    this.entryPoint = nodeName;
    return this;
  }
  
  compile() {
    return {
      invoke: async (initialState) => {
        let state = { ...this.state, ...initialState };
        let currentNode = this.entryPoint || "START";
        let iterations = 0;
        const maxIterations = 100;
        
        while (currentNode && currentNode !== "END" && iterations < maxIterations) {
          iterations++;
          
          // Ejecutar nodo
          const handler = this.nodes.get(currentNode);
          if (handler) {
            try {
              state = await handler(state);
              this.history.push({
                node: currentNode,
                timestamp: new Date().toISOString(),
              });
            } catch (error) {
              logger.error({
                machine: this.name,
                node: currentNode,
                error: error.message,
              });
              state.error = error.message;
              break;
            }
          }
          
          // Determinar siguiente nodo
          const conditionalFn = this.conditionalEdges.get(currentNode);
          if (conditionalFn) {
            currentNode = conditionalFn(state);
          } else {
            currentNode = this.edges.get(currentNode) || "END";
          }
          
          // Check for WAIT_INPUT (pause machine)
          if (currentNode === "WAIT_INPUT") {
            break;
          }
        }
        
        if (iterations >= maxIterations) {
          logger.warn({
            machine: this.name,
            iterations,
          }, "State machine hit max iterations");
        }
        
        return state;
      },
      
      getHistory: () => [...this.history],
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// LANGGRAPH WRAPPER (cuando está disponible)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un grafo de estados usando LangGraph si está disponible,
 * o fallback a SimpleStateMachine si no.
 * 
 * @param {Object} config
 * @param {string} config.name - Nombre del grafo
 * @param {Object} config.channels - Definición de canales/estado
 * @param {Object} config.nodes - Mapa de nodos y handlers
 * @param {Object} config.edges - Mapa de transiciones simples
 * @param {Object} config.conditionalEdges - Mapa de transiciones condicionales
 * @param {string} config.entryPoint - Nodo inicial
 */
export async function createStateGraph(config) {
  const { name, channels, nodes, edges, conditionalEdges, entryPoint } = config;
  
  // Intentar usar LangGraph
  const langGraph = await getLangGraph();
  
  if (langGraph) {
    logger.debug({ graph: name }, "Creating LangGraph state machine");
    
    const { StateGraph, END } = langGraph;
    
    const graph = new StateGraph({ channels });
    
    // Agregar nodos
    for (const [nodeName, handler] of Object.entries(nodes)) {
      graph.addNode(nodeName, handler);
    }
    
    // Agregar edges simples
    for (const [from, to] of Object.entries(edges || {})) {
      if (to === "END") {
        graph.addEdge(from, END);
      } else {
        graph.addEdge(from, to);
      }
    }
    
    // Agregar edges condicionales
    for (const [from, condition] of Object.entries(conditionalEdges || {})) {
      graph.addConditionalEdges(from, condition);
    }
    
    // Entry point
    if (entryPoint) {
      graph.setEntryPoint(entryPoint);
    }
    
    return graph.compile();
  }
  
  // Fallback a SimpleStateMachine
  logger.debug({ graph: name }, "Using fallback SimpleStateMachine");
  
  const machine = new SimpleStateMachine({
    name,
    initialState: Object.fromEntries(
      Object.entries(channels || {}).map(([k, v]) => [k, v.value])
    ),
    nodes,
    edges,
    conditionalEdges,
  });
  
  if (entryPoint) {
    machine.setEntryPoint(entryPoint);
  }
  
  return machine.compile();
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES DE ESTADO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un checkpoint del estado actual
 */
export function createCheckpoint(state, metadata = {}) {
  return {
    id: `ckpt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    state: JSON.parse(JSON.stringify(state)), // Deep clone
    metadata,
  };
}

/**
 * Restaura estado desde un checkpoint
 */
export function restoreFromCheckpoint(checkpoint) {
  if (!checkpoint?.state) {
    throw new Error("Invalid checkpoint");
  }
  return JSON.parse(JSON.stringify(checkpoint.state));
}

/**
 * Genera visualización ASCII del estado actual
 */
export function visualizeState(state, options = {}) {
  const { showHistory = true, showDraft = true } = options;
  
  let viz = "";
  viz += "┌─────────────────────────────────────┐\n";
  viz += `│ Current Node: ${(state.currentNode || "?").padEnd(20)} │\n`;
  
  if (showDraft && state.draft) {
    viz += "├─────────────────────────────────────┤\n";
    viz += "│ Draft:                              │\n";
    for (const [key, value] of Object.entries(state.draft)) {
      if (value !== null && value !== undefined) {
        const valStr = String(value).slice(0, 25);
        viz += `│   ${key}: ${valStr.padEnd(24)} │\n`;
      }
    }
  }
  
  if (showHistory && state.history?.length) {
    viz += "├─────────────────────────────────────┤\n";
    viz += "│ History:                            │\n";
    const recent = state.history.slice(-5);
    for (const entry of recent) {
      viz += `│   → ${(entry.node || "?").padEnd(30)} │\n`;
    }
  }
  
  viz += "└─────────────────────────────────────┘";
  
  return viz;
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE HELPERS (compatibles con o sin LangChain Core)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Crea un mensaje de usuario
 */
export async function createHumanMessage(content) {
  const { HumanMessage } = await getLangChainMessages();
  return new HumanMessage(content);
}

/**
 * Crea un mensaje de AI
 */
export async function createAIMessage(content) {
  const { AIMessage } = await getLangChainMessages();
  return new AIMessage(content);
}

/**
 * Crea un mensaje de sistema
 */
export async function createSystemMessage(content) {
  const { SystemMessage } = await getLangChainMessages();
  return new SystemMessage(content);
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  SimpleStateMachine,
  createStateGraph,
  createCheckpoint,
  restoreFromCheckpoint,
  visualizeState,
  createHumanMessage,
  createAIMessage,
  createSystemMessage,
};
