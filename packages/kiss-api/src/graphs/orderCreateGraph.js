/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDER CREATE GRAPH - Máquina de Estados con LangGraph
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Reemplaza los if/else gigantes por un grafo visual de estados.
 * 
 * GRAFO VISUAL:
 * 
 *     ┌─────────┐
 *     │  START  │
 *     └────┬────┘
 *          │
 *          ▼
 *     ┌─────────┐    cambio de tema    ┌─────────┐
 *     │ ANALYZE │──────────────────────►│  EXIT   │
 *     └────┬────┘                       └─────────┘
 *          │                                 ▲
 *          ▼                                 │
 *     ┌─────────┐    cancelar               │
 *     │ PRODUCT │───────────────────────────┤
 *     └────┬────┘                           │
 *          │                                │
 *          ▼                                │
 *     ┌─────────┐    cancelar               │
 *     │ BRANCH  │───────────────────────────┤
 *     └────┬────┘                           │
 *          │                                │
 *          ▼                                │
 *     ┌─────────┐    cancelar               │
 *     │  DATE   │───────────────────────────┤
 *     └────┬────┘                           │
 *          │                                │
 *          ▼                                │
 *     ┌─────────┐    cancelar               │
 *     │QUANTITY │───────────────────────────┤
 *     └────┬────┘                           │
 *          │                                │
 *          ▼                                │
 *     ┌─────────┐    no confirma            │
 *     │ CONFIRM │───────────────────────────┘
 *     └────┬────┘
 *          │ confirma
 *          ▼
 *     ┌─────────┐
 *     │CHECKOUT │
 *     └────┬────┘
 *          │
 *          ▼
 *     ┌─────────┐
 *     │   END   │
 *     └─────────┘
 * 
 * @version 3.1.0 - LangGraph State Machine with Fallback
 */

// ═══════════════════════════════════════════════════════════════════════════
// IMPORTS - Usando módulo langchain local con fallbacks
// ═══════════════════════════════════════════════════════════════════════════

import { logger } from "../utils/logger.js";
import { 
  getLangGraph, 
  getLangChainMessages,
  isLangGraphAvailable,
} from "../langchain/index.js";
import { 
  createStateGraph, 
  createHumanMessage, 
  createAIMessage,
  SimpleStateMachine,
} from "../langchain/runnable-config.js";

// Variables para lazy loading
let StateGraph = null;
let END = null;
let HumanMessage = null;
let AIMessage = null;
let BaseMessage = null;
let _initialized = false;

/**
 * Inicializa las dependencias de LangGraph (lazy)
 */
async function initDependencies() {
  if (_initialized) return;
  
  const langGraph = await getLangGraph();
  if (langGraph) {
    StateGraph = langGraph.StateGraph;
    END = langGraph.END;
  }
  
  const messages = await getLangChainMessages();
  HumanMessage = messages.HumanMessage;
  AIMessage = messages.AIMessage;
  BaseMessage = messages.BaseMessage;
  
  _initialized = true;
  logger.debug({ 
    langGraphAvailable: !!langGraph,
  }, "OrderCreateGraph dependencies initialized");
}

// ═══════════════════════════════════════════════════════════════════════════
// DEFINICIÓN DEL ESTADO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * @typedef {Object} OrderState
 * @property {string} conversationId - ID de la conversación
 * @property {string} currentNode - Nodo actual del grafo
 * @property {Array<BaseMessage>} messages - Historial de mensajes
 * @property {Object} draft - Datos del pedido en construcción
 * @property {Object} context - Contexto adicional (productos, sucursales, etc.)
 * @property {string|null} lastIntent - Última intención detectada
 * @property {number} retryCount - Contador de reintentos por nodo
 * @property {Array<Object>} history - Historial de nodos visitados (time travel)
 * @property {string|null} error - Error si existe
 */

const initialState = {
  conversationId: "",
  currentNode: "START",
  messages: [],
  draft: {
    product_key: null,
    product_name: null,
    product_id: null,
    branch_id: null,
    branch_name: null,
    date_slug: null,
    date_label: null,
    quantity: 1,
    items: [],
    checkout_ready: false,
  },
  context: {
    products: [],
    branches: [],
    dates: [],
  },
  lastIntent: null,
  retryCount: 0,
  history: [],
  error: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// NODOS DEL GRAFO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Nodo START: Punto de entrada, analiza el mensaje inicial
 */
async function startNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: START node");
  
  // Registrar en historial
  const history = [...state.history, {
    node: "START",
    timestamp: new Date().toISOString(),
    draft: { ...state.draft },
  }];
  
  return {
    ...state,
    currentNode: "ANALYZE",
    history,
  };
}

/**
 * Nodo ANALYZE: Clasifica la intención del mensaje
 */
async function analyzeNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: ANALYZE node");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const messageText = lastMessage?.content || "";
  
  // Detectar intención (simplificado - en prod usar classifyOrderStep)
  const intent = detectIntent(messageText, state);
  
  const history = [...state.history, {
    node: "ANALYZE",
    timestamp: new Date().toISOString(),
    intent,
    messageText: messageText.slice(0, 100),
  }];
  
  return {
    ...state,
    lastIntent: intent,
    currentNode: getNextNodeFromIntent(intent, state),
    history,
  };
}

/**
 * Nodo PRODUCT: Solicita/procesa selección de producto
 */
async function productNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: PRODUCT node");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const messageText = lastMessage?.content || "";
  
  // Intentar extraer producto
  const product = matchProduct(messageText, state.context.products);
  
  if (product) {
    const draft = {
      ...state.draft,
      product_key: product.key,
      product_name: product.name,
      product_id: product.id,
    };
    
    const history = [...state.history, {
      node: "PRODUCT",
      timestamp: new Date().toISOString(),
      action: "selected",
      product: product.name,
    }];
    
    return {
      ...state,
      draft,
      currentNode: "BRANCH",
      retryCount: 0,
      history,
    };
  }
  
  // No se encontró producto, pedir de nuevo
  const retryCount = state.retryCount + 1;
  
  if (retryCount >= 3) {
    return {
      ...state,
      currentNode: "EXIT",
      error: "max_retries_product",
      history: [...state.history, { node: "PRODUCT", action: "max_retries" }],
    };
  }
  
  return {
    ...state,
    currentNode: "PRODUCT_ASK",
    retryCount,
    history: [...state.history, { node: "PRODUCT", action: "ask_again", retry: retryCount }],
  };
}

/**
 * Nodo PRODUCT_ASK: Genera mensaje pidiendo producto
 */
async function productAskNode(state) {
  const products = state.context.products || [];
  const productList = products.length > 0
    ? products.map((p, i) => `${i + 1}. ${p.name}`).join("\n")
    : "1. Rosca Clásica\n2. Rosca de Nutella\n3. Rosca Lotus\n4. Rosca Dulce de Leche";
  
  const response = state.retryCount > 1
    ? `No identifiqué el producto. ¿Cuál te gustaría?\n\n${productList}`
    : `¡Perfecto! Estas son nuestras roscas disponibles:\n\n${productList}\n\n¿Cuál te gustaría?`;
  
  return {
    ...state,
    currentNode: "WAIT_INPUT",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    _nextNode: "PRODUCT",
  };
}

/**
 * Nodo BRANCH: Solicita/procesa selección de sucursal
 */
async function branchNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: BRANCH node");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const messageText = lastMessage?.content || "";
  
  const branch = matchBranch(messageText, state.context.branches);
  
  if (branch) {
    const draft = {
      ...state.draft,
      branch_id: branch.branch_id,
      branch_name: branch.name,
    };
    
    return {
      ...state,
      draft,
      currentNode: "DATE",
      retryCount: 0,
      history: [...state.history, { node: "BRANCH", action: "selected", branch: branch.name }],
    };
  }
  
  const retryCount = state.retryCount + 1;
  if (retryCount >= 3) {
    return { ...state, currentNode: "EXIT", error: "max_retries_branch" };
  }
  
  return { ...state, currentNode: "BRANCH_ASK", retryCount };
}

/**
 * Nodo BRANCH_ASK: Genera mensaje pidiendo sucursal
 */
async function branchAskNode(state) {
  const branches = state.context.branches || [];
  const branchList = branches.length > 0
    ? branches.map((b, i) => `${i + 1}. ${b.name}`).join("\n")
    : "1. San Ángel (CDMX)\n2. Angelópolis (Puebla)\n3. Sonata (Puebla)\n4. Zavaleta (Puebla)\n5. 5 Sur (Puebla)";
  
  const response = state.retryCount > 1
    ? `No identifiqué la sucursal. ¿Cuál prefieres?\n\n${branchList}`
    : `Excelente, ${state.draft.product_name}. ¿En qué sucursal te gustaría recogerla?\n\n${branchList}`;
  
  return {
    ...state,
    currentNode: "WAIT_INPUT",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    _nextNode: "BRANCH",
  };
}

/**
 * Nodo DATE: Solicita/procesa selección de fecha
 */
async function dateNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: DATE node");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const messageText = lastMessage?.content || "";
  
  const date = matchDate(messageText, state.context.dates);
  
  if (date) {
    const draft = {
      ...state.draft,
      date_slug: date.slug,
      date_label: date.label,
    };
    
    return {
      ...state,
      draft,
      currentNode: "QUANTITY",
      retryCount: 0,
      history: [...state.history, { node: "DATE", action: "selected", date: date.label }],
    };
  }
  
  const retryCount = state.retryCount + 1;
  if (retryCount >= 3) {
    return { ...state, currentNode: "EXIT", error: "max_retries_date" };
  }
  
  return { ...state, currentNode: "DATE_ASK", retryCount };
}

/**
 * Nodo DATE_ASK: Genera mensaje pidiendo fecha
 */
async function dateAskNode(state) {
  const response = state.retryCount > 1
    ? `¿Para qué fecha necesitas tu rosca? Tenemos disponibilidad del 2 al 11 de enero.`
    : `Perfecto, ${state.draft.branch_name}. ¿Para qué fecha lo necesitas?\n\nTenemos disponibilidad del 2 al 11 de enero.`;
  
  return {
    ...state,
    currentNode: "WAIT_INPUT",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    _nextNode: "DATE",
  };
}

/**
 * Nodo QUANTITY: Solicita/procesa cantidad
 */
async function quantityNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: QUANTITY node");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const messageText = lastMessage?.content || "";
  
  const quantity = extractQuantity(messageText);
  
  if (quantity && quantity >= 1 && quantity <= 50) {
    const draft = { ...state.draft, quantity };
    
    return {
      ...state,
      draft,
      currentNode: "CONFIRM",
      retryCount: 0,
      history: [...state.history, { node: "QUANTITY", action: "selected", quantity }],
    };
  }
  
  // Default a 1 si no se especifica
  if (!quantity && state.retryCount === 0) {
    return {
      ...state,
      draft: { ...state.draft, quantity: 1 },
      currentNode: "CONFIRM",
      history: [...state.history, { node: "QUANTITY", action: "default", quantity: 1 }],
    };
  }
  
  return { ...state, currentNode: "QUANTITY_ASK", retryCount: state.retryCount + 1 };
}

/**
 * Nodo QUANTITY_ASK: Genera mensaje pidiendo cantidad
 */
async function quantityAskNode(state) {
  const response = `Perfecto, para el ${state.draft.date_label}. ¿Cuántas roscas necesitas? (1-50)`;
  
  return {
    ...state,
    currentNode: "WAIT_INPUT",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    _nextNode: "QUANTITY",
  };
}

/**
 * Nodo CONFIRM: Muestra resumen y pide confirmación
 */
async function confirmNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: CONFIRM node");
  
  const lastMessage = state.messages[state.messages.length - 1];
  const messageText = lastMessage?.content || "";
  
  const confirmation = detectConfirmation(messageText);
  
  if (confirmation === "yes") {
    return {
      ...state,
      currentNode: "CHECKOUT",
      draft: { ...state.draft, checkout_ready: true },
      history: [...state.history, { node: "CONFIRM", action: "confirmed" }],
    };
  }
  
  if (confirmation === "no") {
    // Detectar qué quiere cambiar
    const changeTarget = detectChangeTarget(messageText);
    
    if (changeTarget === "product") {
      return { ...state, currentNode: "PRODUCT_ASK", retryCount: 0 };
    }
    if (changeTarget === "branch") {
      return { ...state, currentNode: "BRANCH_ASK", retryCount: 0 };
    }
    if (changeTarget === "date") {
      return { ...state, currentNode: "DATE_ASK", retryCount: 0 };
    }
    if (changeTarget === "quantity") {
      return { ...state, currentNode: "QUANTITY_ASK", retryCount: 0 };
    }
    
    // No específico, preguntar qué cambiar
    return { ...state, currentNode: "CHANGE_ASK" };
  }
  
  // Primera vez o no claro
  return { ...state, currentNode: "CONFIRM_ASK" };
}

/**
 * Nodo CONFIRM_ASK: Genera mensaje de confirmación
 */
async function confirmAskNode(state) {
  const { draft } = state;
  
  const summary = `📋 *Resumen de tu pedido:*

• Producto: ${draft.product_name}
• Sucursal: ${draft.branch_name}
• Fecha: ${draft.date_label}
• Cantidad: ${draft.quantity}

¿Confirmas tu pedido?`;
  
  return {
    ...state,
    currentNode: "WAIT_INPUT",
    messages: [...state.messages, new AIMessage(summary)],
    _response: summary,
    _nextNode: "CONFIRM",
  };
}

/**
 * Nodo CHANGE_ASK: Pregunta qué quiere cambiar
 */
async function changeAskNode(state) {
  const response = `Claro, ¿qué te gustaría cambiar?\n\n1. Producto\n2. Sucursal\n3. Fecha\n4. Cantidad`;
  
  return {
    ...state,
    currentNode: "WAIT_INPUT",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    _nextNode: "CONFIRM",
  };
}

/**
 * Nodo CHECKOUT: Genera link de pago
 */
async function checkoutNode(state) {
  logger.info({ conversationId: state.conversationId }, "Graph: CHECKOUT node");
  
  const { draft } = state;
  
  // TODO: Crear pedido en WooCommerce y obtener URL real
  const checkoutUrl = `https://tagers.com/checkout/?product=${draft.product_key}&branch=${draft.branch_id}&date=${draft.date_slug}&qty=${draft.quantity}`;
  
  const response = `¡Excelente! Tu pedido está listo. 🎉

Te envío el link de pago:
${checkoutUrl}

¡Gracias por tu preferencia!`;
  
  return {
    ...state,
    currentNode: "END",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    history: [...state.history, { node: "CHECKOUT", action: "completed", url: checkoutUrl }],
  };
}

/**
 * Nodo EXIT: Salida por cancelación o cambio de tema
 */
async function exitNode(state) {
  logger.info({ conversationId: state.conversationId, error: state.error }, "Graph: EXIT node");
  
  let response;
  
  if (state.error === "max_retries_product") {
    response = "Parece que no logro identificar el producto. ¿Te ayudo con algo más?";
  } else if (state.error === "cancel") {
    response = "Listo, cancelamos el pedido. ¿Te ayudo con algo más?";
  } else if (state.error === "topic_change") {
    response = "Entendido, cambio de tema.";
  } else {
    response = "¿Te ayudo con algo más?";
  }
  
  return {
    ...state,
    currentNode: "END",
    messages: [...state.messages, new AIMessage(response)],
    _response: response,
    history: [...state.history, { node: "EXIT", reason: state.error }],
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES DE ROUTING
// ═══════════════════════════════════════════════════════════════════════════

function detectIntent(text, state) {
  const normalized = text.toLowerCase();
  
  // Cancelación
  if (/\b(cancelar?|ya no|olvida|olvidalo)\b/.test(normalized)) {
    return "cancel";
  }
  
  // Cambio de tema
  if (/\b(otra cosa|cambio de tema|mejor|diferente)\b/.test(normalized)) {
    return "topic_change";
  }
  
  // Handoff a humano
  if (/\b(humano|persona|agente|asesor)\b/.test(normalized)) {
    return "handoff";
  }
  
  // Continuar
  return "continue";
}

function getNextNodeFromIntent(intent, state) {
  if (intent === "cancel" || intent === "topic_change") {
    return "EXIT";
  }
  
  if (intent === "handoff") {
    return "EXIT";
  }
  
  // Determinar siguiente nodo según lo que falta en el draft
  const { draft } = state;
  
  if (!draft.product_key) return "PRODUCT";
  if (!draft.branch_id) return "BRANCH";
  if (!draft.date_slug) return "DATE";
  if (!draft.quantity) return "QUANTITY";
  
  return "CONFIRM";
}

function detectConfirmation(text) {
  const normalized = text.toLowerCase();
  
  if (/\b(s[ií]|correcto|confirmo|dale|va|ok|listo|perfecto)\b/.test(normalized)) {
    return "yes";
  }
  
  if (/\b(no|cambiar?|modificar?|otro)\b/.test(normalized)) {
    return "no";
  }
  
  return "unknown";
}

function detectChangeTarget(text) {
  const normalized = text.toLowerCase();
  
  if (/\b(producto|rosca|sabor)\b/.test(normalized) || /\b1\b/.test(normalized)) {
    return "product";
  }
  if (/\b(sucursal|lugar|ubicaci[oó]n)\b/.test(normalized) || /\b2\b/.test(normalized)) {
    return "branch";
  }
  if (/\b(fecha|d[ií]a|cuando)\b/.test(normalized) || /\b3\b/.test(normalized)) {
    return "date";
  }
  if (/\b(cantidad|cu[aá]ntas?)\b/.test(normalized) || /\b4\b/.test(normalized)) {
    return "quantity";
  }
  
  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCHERS
// ═══════════════════════════════════════════════════════════════════════════

function matchProduct(text, products) {
  const normalized = text.toLowerCase();
  const defaultProducts = [
    { key: "clasica", name: "Rosca Clásica", id: 1 },
    { key: "nutella", name: "Rosca de Nutella", id: 2 },
    { key: "lotus", name: "Rosca Lotus", id: 3 },
    { key: "dulce_de_leche", name: "Rosca Dulce de Leche", id: 4 },
  ];
  
  const list = products?.length ? products : defaultProducts;
  
  // Por número
  const num = parseInt(text);
  if (num >= 1 && num <= list.length) {
    return list[num - 1];
  }
  
  // Por nombre
  return list.find(p => 
    normalized.includes(p.key) || 
    p.name.toLowerCase().includes(normalized) ||
    normalized.includes(p.name.toLowerCase().split(" ").pop())
  ) || null;
}

function matchBranch(text, branches) {
  const normalized = text.toLowerCase();
  const defaultBranches = [
    { branch_id: "SAN_ANGEL", name: "San Ángel (CDMX)" },
    { branch_id: "ANGELOPOLIS", name: "Angelópolis (Puebla)" },
    { branch_id: "SONATA", name: "Sonata (Puebla)" },
    { branch_id: "ZAVALETA", name: "Zavaleta (Puebla)" },
    { branch_id: "5_SUR", name: "5 Sur (Puebla)" },
  ];
  
  const list = branches?.length ? branches : defaultBranches;
  
  const num = parseInt(text);
  if (num >= 1 && num <= list.length) {
    return list[num - 1];
  }
  
  return list.find(b =>
    normalized.includes(b.branch_id.toLowerCase().replace("_", " ")) ||
    b.name.toLowerCase().includes(normalized) ||
    normalized.includes(b.name.toLowerCase().split(" ")[0])
  ) || null;
}

function matchDate(text, dates) {
  const normalized = text.toLowerCase();
  
  if (/\b6\b|seis|reyes/.test(normalized)) {
    return { slug: "enero-06", label: "6 de enero" };
  }
  if (/mañana/.test(normalized)) {
    return { slug: "tomorrow", label: "mañana" };
  }
  if (/hoy/.test(normalized)) {
    return { slug: "today", label: "hoy" };
  }
  
  const match = normalized.match(/\b(\d{1,2})\b/);
  if (match) {
    const day = parseInt(match[1]);
    if (day >= 2 && day <= 11) {
      return { slug: `enero-${day.toString().padStart(2, "0")}`, label: `${day} de enero` };
    }
  }
  
  return null;
}

function extractQuantity(text) {
  const normalized = text.toLowerCase();
  
  const numWords = { una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
  for (const [word, num] of Object.entries(numWords)) {
    if (normalized.includes(word)) return num;
  }
  
  const match = normalized.match(/\b(\d{1,2})\b/);
  return match ? parseInt(match[1]) : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DEL GRAFO (con fallback a SimpleStateMachine)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Construye el grafo de ORDER_CREATE usando LangGraph si está disponible,
 * o fallback a SimpleStateMachine si no.
 */
export async function buildOrderCreateGraph() {
  // Inicializar dependencias
  await initDependencies();
  
  // Definición de nodos
  const nodes = {
    START: startNode,
    ANALYZE: analyzeNode,
    PRODUCT: productNode,
    PRODUCT_ASK: productAskNode,
    BRANCH: branchNode,
    BRANCH_ASK: branchAskNode,
    DATE: dateNode,
    DATE_ASK: dateAskNode,
    QUANTITY: quantityNode,
    QUANTITY_ASK: quantityAskNode,
    CONFIRM: confirmNode,
    CONFIRM_ASK: confirmAskNode,
    CHANGE_ASK: changeAskNode,
    CHECKOUT: checkoutNode,
    EXIT: exitNode,
  };
  
  // Edges simples
  const edges = {
    START: "ANALYZE",
    PRODUCT_ASK: "WAIT_INPUT",
    BRANCH_ASK: "WAIT_INPUT",
    DATE_ASK: "WAIT_INPUT",
    QUANTITY_ASK: "WAIT_INPUT",
    CONFIRM_ASK: "WAIT_INPUT",
    CHANGE_ASK: "WAIT_INPUT",
    CHECKOUT: "END",
    EXIT: "END",
  };
  
  // Edges condicionales (routing basado en estado)
  const conditionalEdges = {
    ANALYZE: (state) => state.currentNode,
    PRODUCT: (state) => state.currentNode,
    BRANCH: (state) => state.currentNode,
    DATE: (state) => state.currentNode,
    QUANTITY: (state) => state.currentNode,
    CONFIRM: (state) => state.currentNode,
  };
  
  // Canales/estado
  const channels = {
    conversationId: { value: "" },
    currentNode: { value: "START" },
    messages: { value: [] },
    draft: { value: initialState.draft },
    context: { value: initialState.context },
    lastIntent: { value: null },
    retryCount: { value: 0 },
    history: { value: [] },
    error: { value: null },
    _response: { value: null },
    _nextNode: { value: null },
  };
  
  // Usar factory que maneja LangGraph vs fallback automáticamente
  return createStateGraph({
    name: "ORDER_CREATE",
    channels,
    nodes,
    edges,
    conditionalEdges,
    entryPoint: "START",
  });
}

/**
 * Versión síncrona legacy (para compatibilidad)
 * @deprecated Use buildOrderCreateGraph() async version instead
 */
export function buildOrderCreateGraphSync() {
  logger.warn("buildOrderCreateGraphSync is deprecated, use async buildOrderCreateGraph()");
  
  // Fallback: usar SimpleStateMachine directamente
  const machine = new SimpleStateMachine({
    name: "ORDER_CREATE_SYNC",
    initialState: { ...initialState },
    nodes: {
      START: startNode,
      ANALYZE: analyzeNode,
      PRODUCT: productNode,
      PRODUCT_ASK: productAskNode,
      BRANCH: branchNode,
      BRANCH_ASK: branchAskNode,
      DATE: dateNode,
      DATE_ASK: dateAskNode,
      QUANTITY: quantityNode,
      QUANTITY_ASK: quantityAskNode,
      CONFIRM: confirmNode,
      CONFIRM_ASK: confirmAskNode,
      CHANGE_ASK: changeAskNode,
      CHECKOUT: checkoutNode,
      EXIT: exitNode,
    },
    edges: {
      START: "ANALYZE",
      PRODUCT_ASK: "WAIT_INPUT",
      BRANCH_ASK: "WAIT_INPUT",
      DATE_ASK: "WAIT_INPUT",
      QUANTITY_ASK: "WAIT_INPUT",
      CONFIRM_ASK: "WAIT_INPUT",
      CHANGE_ASK: "WAIT_INPUT",
      CHECKOUT: "END",
      EXIT: "END",
    },
    conditionalEdges: {
      ANALYZE: (state) => state.currentNode,
      PRODUCT: (state) => state.currentNode,
      BRANCH: (state) => state.currentNode,
      DATE: (state) => state.currentNode,
      QUANTITY: (state) => state.currentNode,
      CONFIRM: (state) => state.currentNode,
    },
  });
  
  machine.setEntryPoint("START");
  return machine.compile();
}

// ═══════════════════════════════════════════════════════════════════════════
// WRAPPER PARA USO SIMPLIFICADO
// ═══════════════════════════════════════════════════════════════════════════

const graphInstances = new Map();

/**
 * Procesa un mensaje en el grafo de ORDER_CREATE
 * 
 * @param {Object} params
 * @param {string} params.conversationId
 * @param {string} params.messageText
 * @param {Object} params.currentState - Estado actual (o null para nuevo)
 * @param {Object} params.context - Productos, sucursales, fechas
 * @returns {Promise<{response: string, state: Object, ended: boolean}>}
 */
export async function processOrderCreate({ conversationId, messageText, currentState, context }) {
  // Obtener o crear instancia del grafo (ahora async)
  let graph = graphInstances.get(conversationId);
  if (!graph) {
    graph = await buildOrderCreateGraph();
    graphInstances.set(conversationId, graph);
  }
  
  // Preparar estado inicial
  const state = currentState || {
    ...initialState,
    conversationId,
    context: context || initialState.context,
  };
  
  // Agregar mensaje del usuario (usando helper async)
  const humanMessage = await createHumanMessage(messageText);
  state.messages = [...state.messages, humanMessage];
  
  // Si hay un _nextNode, ir ahí
  if (state._nextNode) {
    state.currentNode = state._nextNode;
    state._nextNode = null;
    state._response = null;
  }
  
  // Ejecutar el grafo
  const result = await graph.invoke(state);
  
  // Limpiar instancia si terminó
  const ended = result.currentNode === "END";
  if (ended) {
    graphInstances.delete(conversationId);
  }
  
  return {
    response: result._response,
    state: result,
    ended,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// TIME TRAVEL: Ver historial de estados
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene el historial de nodos visitados (para debugging)
 */
export function getStateHistory(state) {
  return state?.history || [];
}

/**
 * Genera visualización ASCII del camino recorrido
 */
export function visualizeStatePath(state) {
  const history = state?.history || [];
  
  if (history.length === 0) {
    return "No history available";
  }
  
  let viz = "┌─ State Path ─────────────────────────┐\n";
  
  history.forEach((entry, i) => {
    const isLast = i === history.length - 1;
    const connector = isLast ? "└" : "├";
    const line = isLast ? " " : "│";
    
    viz += `${connector}─▶ ${entry.node}`;
    
    if (entry.action) {
      viz += ` (${entry.action})`;
    }
    if (entry.product) {
      viz += ` → ${entry.product}`;
    }
    if (entry.branch) {
      viz += ` → ${entry.branch}`;
    }
    if (entry.date) {
      viz += ` → ${entry.date}`;
    }
    
    viz += "\n";
  });
  
  viz += "└──────────────────────────────────────┘";
  
  return viz;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export {
  initialState,
  buildOrderCreateGraph,
};

export default {
  processOrderCreate,
  getStateHistory,
  visualizeStatePath,
  buildOrderCreateGraph,
};
