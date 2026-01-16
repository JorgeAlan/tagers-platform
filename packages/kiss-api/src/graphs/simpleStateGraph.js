/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SIMPLE STATE GRAPH - Máquina de Estados sin dependencias externas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Implementación simplificada de un grafo de estados que NO requiere LangGraph.
 * Usa el mismo concepto pero con código vanilla.
 * 
 * Ventajas:
 * - Zero dependencies adicionales
 * - Fácil de debuggear
 * - Misma funcionalidad que LangGraph para este caso de uso
 * 
 * Si quieres la versión completa de LangGraph, usa orderCreateGraph.js
 * 
 * @version 3.0.0 - Simple State Machine
 */

import { logger } from "../utils/logger.js";
import { checkpointManager } from "../state/checkpointManager.js";

// ═══════════════════════════════════════════════════════════════════════════
// DEFINICIÓN DE NODOS Y TRANSICIONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} GraphNode
 * @property {string} id - ID del nodo
 * @property {Function} handler - Función que procesa el nodo
 * @property {Object.<string, string>} transitions - Mapa de resultado -> siguiente nodo
 */

/**
 * @typedef {Object} GraphState
 * @property {string} currentNode - Nodo actual
 * @property {Object} data - Datos acumulados
 * @property {Array<Object>} history - Historial de transiciones
 * @property {string|null} pendingResponse - Respuesta pendiente para el usuario
 */

// ═══════════════════════════════════════════════════════════════════════════
// CLASE SIMPLE STATE GRAPH
// ═══════════════════════════════════════════════════════════════════════════

export class SimpleStateGraph {
  constructor(graphId) {
    this.graphId = graphId;
    this.nodes = new Map();
    this.entryPoint = null;
    this.endNodes = new Set();
  }
  
  /**
   * Agrega un nodo al grafo
   * @param {string} nodeId - ID del nodo
   * @param {Function} handler - async (state, input) => { result, updates }
   * @param {Object} transitions - { resultValue: nextNodeId }
   */
  addNode(nodeId, handler, transitions = {}) {
    this.nodes.set(nodeId, {
      id: nodeId,
      handler,
      transitions,
    });
    return this;
  }
  
  /**
   * Define el punto de entrada
   */
  setEntry(nodeId) {
    this.entryPoint = nodeId;
    return this;
  }
  
  /**
   * Define nodos finales
   */
  addEndNode(nodeId) {
    this.endNodes.add(nodeId);
    return this;
  }
  
  /**
   * Ejecuta el grafo desde un estado dado
   * @param {GraphState} state - Estado actual
   * @param {string} input - Input del usuario
   * @returns {Promise<{state: GraphState, response: string|null, ended: boolean}>}
   */
  async run(state, input) {
    let currentState = { ...state };
    let iterations = 0;
    const MAX_ITERATIONS = 20; // Prevenir loops infinitos
    
    while (iterations < MAX_ITERATIONS) {
      iterations++;
      
      const nodeId = currentState.currentNode;
      const node = this.nodes.get(nodeId);
      
      if (!node) {
        logger.error({ nodeId, graphId: this.graphId }, "Node not found in graph");
        break;
      }
      
      // Ejecutar handler del nodo
      const { result, updates, response } = await node.handler(currentState, input);
      
      // Guardar checkpoint
      checkpointManager.saveCheckpoint({
        conversationId: currentState.conversationId,
        graphId: this.graphId,
        node: nodeId,
        state: currentState,
        trigger: "node_executed",
      });
      
      // Aplicar updates al estado
      if (updates) {
        currentState = {
          ...currentState,
          data: { ...currentState.data, ...updates.data },
          history: [
            ...currentState.history,
            {
              node: nodeId,
              result,
              timestamp: new Date().toISOString(),
            },
          ],
        };
      }
      
      // Guardar respuesta pendiente
      if (response) {
        currentState.pendingResponse = response;
      }
      
      // Determinar siguiente nodo
      const nextNodeId = node.transitions[result] || node.transitions["*"];
      
      // Si no hay siguiente nodo o es un end node, terminar
      if (!nextNodeId || this.endNodes.has(nodeId)) {
        return {
          state: currentState,
          response: currentState.pendingResponse,
          ended: this.endNodes.has(nodeId),
        };
      }
      
      // Si el siguiente nodo requiere input del usuario, pausar
      if (nextNodeId === "WAIT_INPUT") {
        return {
          state: { ...currentState, currentNode: node.transitions["_after_wait"] || nodeId },
          response: currentState.pendingResponse,
          ended: false,
        };
      }
      
      // Continuar al siguiente nodo
      currentState.currentNode = nextNodeId;
      input = null; // Solo usar input en el primer nodo
    }
    
    logger.warn({ graphId: this.graphId, iterations }, "Graph reached max iterations");
    return {
      state: currentState,
      response: "Algo salió mal. ¿Empezamos de nuevo?",
      ended: true,
    };
  }
  
  /**
   * Crea un nuevo estado inicial
   */
  createInitialState(conversationId, initialData = {}) {
    return {
      conversationId,
      currentNode: this.entryPoint,
      data: initialData,
      history: [],
      pendingResponse: null,
    };
  }
  
  /**
   * Visualiza el grafo como texto
   */
  visualize() {
    let viz = `\n┌─── Graph: ${this.graphId} ───┐\n`;
    
    for (const [nodeId, node] of this.nodes) {
      const isEntry = nodeId === this.entryPoint ? " (ENTRY)" : "";
      const isEnd = this.endNodes.has(nodeId) ? " (END)" : "";
      
      viz += `│\n`;
      viz += `├─▶ [${nodeId}]${isEntry}${isEnd}\n`;
      
      for (const [result, target] of Object.entries(node.transitions)) {
        if (result !== "_after_wait") {
          viz += `│     └─(${result})─▶ ${target}\n`;
        }
      }
    }
    
    viz += `│\n└────────────────────────┘\n`;
    
    return viz;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// GRAFO DE ORDER_CREATE
// ═══════════════════════════════════════════════════════════════════════════

export function createOrderCreateGraph() {
  const graph = new SimpleStateGraph("ORDER_CREATE");
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: INIT - Analiza el mensaje inicial
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("INIT", async (state, input) => {
    const intent = detectBasicIntent(input);
    
    if (intent === "cancel") {
      return { result: "cancel", updates: { data: { error: "cancelled" } } };
    }
    
    // Intentar extraer producto del mensaje inicial
    const product = matchProduct(input);
    if (product) {
      return {
        result: "has_product",
        updates: {
          data: {
            product_key: product.key,
            product_name: product.name,
            product_id: product.id,
          },
        },
      };
    }
    
    return { result: "need_product" };
  }, {
    "cancel": "EXIT",
    "has_product": "CHECK_BRANCH",
    "need_product": "ASK_PRODUCT",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: ASK_PRODUCT - Pide selección de producto
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("ASK_PRODUCT", async (state, input) => {
    const products = state.data.products || getDefaultProducts();
    const productList = products.map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    
    const retries = (state.data._productRetries || 0);
    
    const response = retries > 0
      ? `No identifiqué el producto. ¿Cuál prefieres?\n\n${productList}`
      : `¡Perfecto! Estas son nuestras roscas:\n\n${productList}\n\n¿Cuál te gustaría?`;
    
    return {
      result: "wait",
      response,
      updates: { data: { _productRetries: retries + 1 } },
    };
  }, {
    "wait": "WAIT_INPUT",
    "_after_wait": "PROCESS_PRODUCT",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: PROCESS_PRODUCT - Procesa selección de producto
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("PROCESS_PRODUCT", async (state, input) => {
    const intent = detectBasicIntent(input);
    if (intent === "cancel") {
      return { result: "cancel" };
    }
    
    const product = matchProduct(input);
    
    if (product) {
      return {
        result: "success",
        updates: {
          data: {
            product_key: product.key,
            product_name: product.name,
            product_id: product.id,
            _productRetries: 0,
          },
        },
      };
    }
    
    const retries = state.data._productRetries || 0;
    if (retries >= 3) {
      return { result: "max_retries" };
    }
    
    return { result: "retry" };
  }, {
    "cancel": "EXIT",
    "success": "CHECK_BRANCH",
    "retry": "ASK_PRODUCT",
    "max_retries": "EXIT",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: CHECK_BRANCH - Verifica si ya tiene sucursal
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("CHECK_BRANCH", async (state, input) => {
    if (state.data.branch_id) {
      return { result: "has_branch" };
    }
    
    // Intentar extraer del input
    const branch = matchBranch(input);
    if (branch) {
      return {
        result: "has_branch",
        updates: {
          data: {
            branch_id: branch.branch_id,
            branch_name: branch.name,
          },
        },
      };
    }
    
    return { result: "need_branch" };
  }, {
    "has_branch": "CHECK_DATE",
    "need_branch": "ASK_BRANCH",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: ASK_BRANCH - Pide selección de sucursal
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("ASK_BRANCH", async (state, input) => {
    const branches = state.data.branches || getDefaultBranches();
    const branchList = branches.map((b, i) => `${i + 1}. ${b.name}`).join("\n");
    
    const response = `Excelente, ${state.data.product_name}. ¿En qué sucursal?\n\n${branchList}`;
    
    return { result: "wait", response };
  }, {
    "wait": "WAIT_INPUT",
    "_after_wait": "PROCESS_BRANCH",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: PROCESS_BRANCH
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("PROCESS_BRANCH", async (state, input) => {
    const intent = detectBasicIntent(input);
    if (intent === "cancel") return { result: "cancel" };
    
    const branch = matchBranch(input);
    if (branch) {
      return {
        result: "success",
        updates: {
          data: {
            branch_id: branch.branch_id,
            branch_name: branch.name,
          },
        },
      };
    }
    
    return { result: "retry" };
  }, {
    "cancel": "EXIT",
    "success": "CHECK_DATE",
    "retry": "ASK_BRANCH",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: CHECK_DATE
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("CHECK_DATE", async (state, input) => {
    if (state.data.date_slug) {
      return { result: "has_date" };
    }
    
    const date = matchDate(input);
    if (date) {
      return {
        result: "has_date",
        updates: { data: { date_slug: date.slug, date_label: date.label } },
      };
    }
    
    return { result: "need_date" };
  }, {
    "has_date": "CHECK_QUANTITY",
    "need_date": "ASK_DATE",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: ASK_DATE
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("ASK_DATE", async (state, input) => {
    const response = `Perfecto, ${state.data.branch_name}. ¿Para qué fecha?\n\nDisponibilidad: 2-11 de enero.`;
    return { result: "wait", response };
  }, {
    "wait": "WAIT_INPUT",
    "_after_wait": "PROCESS_DATE",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: PROCESS_DATE
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("PROCESS_DATE", async (state, input) => {
    const intent = detectBasicIntent(input);
    if (intent === "cancel") return { result: "cancel" };
    
    const date = matchDate(input);
    if (date) {
      return {
        result: "success",
        updates: { data: { date_slug: date.slug, date_label: date.label } },
      };
    }
    
    return { result: "retry" };
  }, {
    "cancel": "EXIT",
    "success": "CHECK_QUANTITY",
    "retry": "ASK_DATE",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: CHECK_QUANTITY
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("CHECK_QUANTITY", async (state, input) => {
    if (state.data.quantity && state.data.quantity > 0) {
      return { result: "has_quantity" };
    }
    
    // Default a 1
    return {
      result: "has_quantity",
      updates: { data: { quantity: 1 } },
    };
  }, {
    "has_quantity": "CONFIRM",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: CONFIRM - Muestra resumen y pide confirmación
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("CONFIRM", async (state, input) => {
    const d = state.data;
    
    const summary = `📋 *Resumen de tu pedido:*

• Producto: ${d.product_name}
• Sucursal: ${d.branch_name}
• Fecha: ${d.date_label}
• Cantidad: ${d.quantity || 1}

¿Confirmas tu pedido?`;
    
    return { result: "wait", response: summary };
  }, {
    "wait": "WAIT_INPUT",
    "_after_wait": "PROCESS_CONFIRM",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: PROCESS_CONFIRM
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("PROCESS_CONFIRM", async (state, input) => {
    const confirmation = detectConfirmation(input);
    
    if (confirmation === "yes") {
      return { result: "confirmed" };
    }
    
    if (confirmation === "no") {
      const changeTarget = detectChangeTarget(input);
      return {
        result: changeTarget || "ask_change",
        updates: { data: { _changeTarget: changeTarget } },
      };
    }
    
    return { result: "unclear" };
  }, {
    "confirmed": "CHECKOUT",
    "product": "ASK_PRODUCT",
    "branch": "ASK_BRANCH",
    "date": "ASK_DATE",
    "ask_change": "ASK_CHANGE",
    "unclear": "CONFIRM",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: ASK_CHANGE
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("ASK_CHANGE", async (state, input) => {
    const response = `¿Qué te gustaría cambiar?\n\n1. Producto\n2. Sucursal\n3. Fecha\n4. Cantidad`;
    return { result: "wait", response };
  }, {
    "wait": "WAIT_INPUT",
    "_after_wait": "PROCESS_CHANGE",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: PROCESS_CHANGE
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("PROCESS_CHANGE", async (state, input) => {
    const target = detectChangeTarget(input);
    return { result: target || "product" };
  }, {
    "product": "ASK_PRODUCT",
    "branch": "ASK_BRANCH",
    "date": "ASK_DATE",
    "quantity": "CHECK_QUANTITY",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: CHECKOUT - Genera link de pago
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("CHECKOUT", async (state, input) => {
    const d = state.data;
    
    const checkoutUrl = `https://tagers.com/checkout/?product=${d.product_key}&branch=${d.branch_id}&date=${d.date_slug}&qty=${d.quantity || 1}`;
    
    const response = `¡Excelente! Tu pedido está listo. 🎉\n\nLink de pago:\n${checkoutUrl}\n\n¡Gracias por tu preferencia!`;
    
    return {
      result: "done",
      response,
      updates: { data: { checkout_url: checkoutUrl, completed: true } },
    };
  }, {
    "done": "END",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: EXIT - Salida por cancelación
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("EXIT", async (state, input) => {
    const response = "Listo, cancelamos el pedido. ¿Te ayudo con algo más?";
    return { result: "done", response };
  }, {
    "done": "END",
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  // NODO: END
  // ─────────────────────────────────────────────────────────────────────────
  graph.addNode("END", async (state, input) => {
    return { result: "end" };
  }, {});
  
  // Configurar
  graph.setEntry("INIT");
  graph.addEndNode("END");
  
  return graph;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function detectBasicIntent(text) {
  const n = (text || "").toLowerCase();
  if (/\b(cancel|cancelar?|ya no|olvida)\b/.test(n)) return "cancel";
  if (/\b(humano|persona|agente)\b/.test(n)) return "handoff";
  return "continue";
}

function detectConfirmation(text) {
  const n = (text || "").toLowerCase();
  if (/\b(s[ií]|correcto|confirmo|dale|va|ok|listo|perfecto)\b/.test(n)) return "yes";
  if (/\b(no|cambiar?|modificar?|otro)\b/.test(n)) return "no";
  return "unclear";
}

function detectChangeTarget(text) {
  const n = (text || "").toLowerCase();
  if (/\b(producto|rosca|sabor|1)\b/.test(n)) return "product";
  if (/\b(sucursal|lugar|2)\b/.test(n)) return "branch";
  if (/\b(fecha|d[ií]a|3)\b/.test(n)) return "date";
  if (/\b(cantidad|cu[aá]ntas?|4)\b/.test(n)) return "quantity";
  return null;
}

function matchProduct(text) {
  const products = getDefaultProducts();
  const n = (text || "").toLowerCase();
  
  const num = parseInt(text);
  if (num >= 1 && num <= products.length) return products[num - 1];
  
  return products.find(p => n.includes(p.key) || p.name.toLowerCase().includes(n)) || null;
}

function matchBranch(text) {
  const branches = getDefaultBranches();
  const n = (text || "").toLowerCase();
  
  const num = parseInt(text);
  if (num >= 1 && num <= branches.length) return branches[num - 1];
  
  return branches.find(b => n.includes(b.branch_id.toLowerCase().replace("_", " ")) || b.name.toLowerCase().includes(n)) || null;
}

function matchDate(text) {
  const n = (text || "").toLowerCase();
  
  if (/\b6\b|seis|reyes/.test(n)) return { slug: "enero-06", label: "6 de enero" };
  if (/mañana/.test(n)) return { slug: "tomorrow", label: "mañana" };
  if (/hoy/.test(n)) return { slug: "today", label: "hoy" };
  
  const match = n.match(/\b(\d{1,2})\b/);
  if (match) {
    const day = parseInt(match[1]);
    if (day >= 2 && day <= 11) return { slug: `enero-${day.toString().padStart(2, "0")}`, label: `${day} de enero` };
  }
  
  return null;
}

function getDefaultProducts() {
  return [
    { key: "clasica", name: "Rosca Clásica", id: 1 },
    { key: "nutella", name: "Rosca de Nutella", id: 2 },
    { key: "lotus", name: "Rosca Lotus", id: 3 },
    { key: "dulce_de_leche", name: "Rosca Dulce de Leche", id: 4 },
  ];
}

function getDefaultBranches() {
  return [
    { branch_id: "SAN_ANGEL", name: "San Ángel (CDMX)" },
    { branch_id: "ANGELOPOLIS", name: "Angelópolis (Puebla)" },
    { branch_id: "SONATA", name: "Sonata (Puebla)" },
    { branch_id: "ZAVALETA", name: "Zavaleta (Puebla)" },
    { branch_id: "5_SUR", name: "5 Sur (Puebla)" },
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export { SimpleStateGraph, createOrderCreateGraph };
export default SimpleStateGraph;
