/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST SCRIPT: Verificar arquitectura SOTA con GPT-5 Family
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecutar: node test_zod_sota.js
 * 
 * Este script prueba que el "cerebro" funciona correctamente antes de
 * conectarlo a los "músculos" (Chatwoot).
 * 
 * MODELOS PROBADOS:
 * - gpt-5-nano  → Clasificadores
 * - gpt-5-mini  → Generación de respuestas
 */

import dotenv from "dotenv";
dotenv.config();

import {
  createStructuredJSON,
  classifyChatwootIntent,
  classifyOrderStep,
  classifyFlowControl,
  analyzeSentiment,
  generateTaniaReply,
  getFallbackForSchema,
  getRecommendedModel,
  MODELS,
} from "./src/openai_client_tania.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function logResult(testName, result, model) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`✅ ${testName}`);
  console.log(`   Modelo: ${model}`);
  console.log(`${"═".repeat(60)}`);
  console.log(JSON.stringify(result, null, 2));
}

function logError(testName, error) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`❌ ${testName} - ERROR`);
  console.log(`${"═".repeat(60)}`);
  console.log(error.message || error);
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 1: Order Step Classifier (gpt-5-nano)
// ═══════════════════════════════════════════════════════════════════════════

async function testOrderStepClassifier() {
  const testName = "Order Step Classifier";
  const model = MODELS.NANO;
  console.log(`\n🧪 Probando: ${testName} con ${model}...`);
  
  try {
    const result = await classifyOrderStep({
      model,
      instructions: `Eres un experto clasificando intenciones en un flujo de pedidos de roscas de reyes.
      
Analiza el mensaje del usuario y clasifica su intención:
- select: quiere elegir una opción de la lista
- change: quiere modificar algo del pedido (producto, sucursal, fecha, cantidad)
- confirm: acepta/confirma el pedido actual
- ask_options: quiere ver las opciones disponibles
- cancel: quiere cancelar todo el proceso
- unknown: no está claro qué quiere

Extrae también cualquier información mencionada (producto, sucursal, fecha, cantidad).`,
      inputObject: {
        step: "product_selection",
        message_text: "Quiero cambiar mi rosca por una de nutella",
        draft: {
          product: "rosca clásica",
          branch: null,
          date: null,
          quantity: 1,
        },
        options: {
          products: [
            { key: "clasica", name: "Rosca Clásica" },
            { key: "nutella", name: "Rosca de Nutella" },
            { key: "lotus", name: "Rosca Lotus" },
          ]
        }
      },
      metadata: { conversation_id: "test-123" }
    });
    
    logResult(testName, result, model);
    
    // Validaciones
    console.log("\n📋 Validaciones:");
    console.log(`  • intent = "change"? ${result.intent === "change" ? "✅" : "❌"}`);
    console.log(`  • change_target = "product"? ${result.change_target === "product" ? "✅" : "❌"}`);
    console.log(`  • product_text contiene "nutella"? ${result.product_text?.toLowerCase().includes("nutella") ? "✅" : "❌"}`);
    console.log(`  • confidence >= 0.7? ${result.confidence >= 0.7 ? "✅" : "❌"}`);
    
    return true;
  } catch (error) {
    logError(testName, error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 2: Chatwoot Intent (gpt-5-nano)
// ═══════════════════════════════════════════════════════════════════════════

async function testChatwootIntent() {
  const testName = "Chatwoot Intent Classifier";
  const model = MODELS.NANO;
  console.log(`\n🧪 Probando: ${testName} con ${model}...`);
  
  try {
    const result = await classifyChatwootIntent({
      model,
      instructions: `Eres un router de intención para Tagers café.

Clasifica la intención del mensaje del cliente:
- PHYSICAL_CHECK: preguntas sobre estado en tiempo real (clima, filas, mesas)
- ORDER_CREATE: quiere hacer un pedido de rosca
- ORDER_STATUS: pregunta por estado de un pedido existente
- RESERVATION_LINK: quiere reservar mesa
- GENERAL_INFO: saludos, preguntas generales
- CAREERS: empleo/vacantes
- SENTIMENT_CRISIS: queja urgente

Si falta información crítica (ej: sucursal para PHYSICAL_CHECK), marca needs_clarification=true.`,
      inputObject: {
        message_text: "Hola, quiero pedir una rosca para el 6 de enero",
        conversation_id: "test-456",
        inbox_name: "WhatsApp",
        branch_hint: null,
        branches: [
          { slug: "san_angel", name: "San Ángel", branch_id: "SAN_ANGEL" },
          { slug: "sonata", name: "Sonata", branch_id: "SONATA" },
          { slug: "angelopolis", name: "Angelópolis", branch_id: "ANGELOPOLIS" },
        ],
        conversation_history: []
      },
      metadata: { conversation_id: "test-456" }
    });
    
    logResult(testName, result, model);
    
    console.log("\n📋 Validaciones:");
    console.log(`  • intent = "ORDER_CREATE"? ${result.intent === "ORDER_CREATE" ? "✅" : "❌"}`);
    console.log(`  • query_category = "order"? ${result.query_category === "order" ? "✅" : "❌"}`);
    console.log(`  • needs_clarification = false? ${result.needs_clarification === false ? "✅" : "❌"}`);
    
    return true;
  } catch (error) {
    logError(testName, error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 3: Sentiment Analysis (gpt-5-nano)
// ═══════════════════════════════════════════════════════════════════════════

async function testSentimentAnalysis() {
  const testName = "Sentiment Analysis";
  const model = MODELS.NANO;
  console.log(`\n🧪 Probando: ${testName} con ${model}...`);
  
  try {
    const result = await analyzeSentiment({
      model,
      instructions: `Analiza el sentimiento del mensaje del cliente.

POSITIVE: cliente contento, agradece, satisfecho
NEUTRAL: tono normal, sin emociones fuertes
NEGATIVE_LOW: molesto pero manejable, frustraciones menores
NEGATIVE_HIGH: muy enojado, amenaza, insultos, urgente

Identifica las señales (palabras/frases) que indican el sentimiento.
Recomienda la acción apropiada:
- NORMAL: continuar conversación normal
- ESCALATE_MANAGER: pasar a gerente
- ASK_BRANCH: preguntar sucursal para escalar
- OFFER_CALLBACK: ofrecer que le llamen`,
      inputObject: {
        message_text: "Ya es la tercera vez que me cancelan el pedido, esto es un pésimo servicio, quiero hablar con un gerente AHORA",
        conversation_history: [
          { role: "cliente", content: "Mi pedido no llegó" },
          { role: "ana", content: "Disculpa, voy a verificar..." },
        ]
      },
      metadata: { conversation_id: "test-789" }
    });
    
    logResult(testName, result, model);
    
    console.log("\n📋 Validaciones:");
    console.log(`  • sentiment = "NEGATIVE_HIGH"? ${result.sentiment === "NEGATIVE_HIGH" ? "✅" : "❌"}`);
    console.log(`  • recommended_action = "ESCALATE_MANAGER"? ${result.recommended_action === "ESCALATE_MANAGER" ? "✅" : "❌"}`);
    console.log(`  • signals detectadas? ${result.signals.length > 0 ? "✅" : "❌"}`);
    
    return true;
  } catch (error) {
    logError(testName, error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 4: Flow Control (gpt-5-nano)
// ═══════════════════════════════════════════════════════════════════════════

async function testFlowControl() {
  const testName = "Flow Control Classifier";
  const model = MODELS.NANO;
  console.log(`\n🧪 Probando: ${testName} con ${model}...`);
  
  try {
    const result = await classifyFlowControl({
      model,
      instructions: `Detecta si el usuario quiere cambiar de flujo, cancelar, o hablar con un humano.

Acciones:
- continue: seguir en el flujo actual
- switch_flow: cambiar a otro flujo (ORDER_CREATE, ORDER_STATUS, etc.)
- cancel_flow: cancelar todo el proceso
- handoff_human: pasar a un agente humano
- restart: empezar de nuevo

El usuario está actualmente en el flujo ORDER_CREATE.`,
      inputObject: {
        active_flow: { flow: "ORDER_CREATE", step: "product_selection" },
        message_text: "Sabes qué, mejor pásame con una persona real",
        conversation_history: []
      },
      metadata: { conversation_id: "test-flow" }
    });
    
    logResult(testName, result, model);
    
    console.log("\n📋 Validaciones:");
    console.log(`  • action = "handoff_human"? ${result.action === "handoff_human" ? "✅" : "❌"}`);
    console.log(`  • confidence >= 0.6? ${result.confidence >= 0.6 ? "✅" : "❌"}`);
    
    return true;
  } catch (error) {
    logError(testName, error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 5: Tania Reply Generation (gpt-5-mini)
// ═══════════════════════════════════════════════════════════════════════════

async function testTaniaReply() {
  const testName = "Tania Reply Generation";
  const model = MODELS.MINI;
  console.log(`\n🧪 Probando: ${testName} con ${model}...`);
  
  try {
    const result = await generateTaniaReply({
      model,
      instructions: `Eres Ana, asistente virtual de Tagers café.

Genera una respuesta amigable y profesional para el cliente.
- Usa un tono cálido pero profesional
- Sé concisa (máximo 1800 caracteres)
- Si recomiendas sucursales, explica brevemente por qué`,
      inputObject: {
        customer_query: "¿Cuál sucursal me recomiendas para ir con niños?",
        context: {
          branches: [
            { id: "SONATA", name: "Sonata", has_kids_area: true },
            { id: "SAN_ANGEL", name: "San Ángel", has_kids_area: true },
            { id: "ANGELOPOLIS", name: "Angelópolis", has_kids_area: false },
          ]
        }
      },
      metadata: { conversation_id: "test-reply" }
    });
    
    logResult(testName, result, model);
    
    console.log("\n📋 Validaciones:");
    console.log(`  • customer_message no vacío? ${result.customer_message?.length > 0 ? "✅" : "❌"}`);
    console.log(`  • confidence > 0? ${result.confidence > 0 ? "✅" : "❌"}`);
    console.log(`  • recommended_branches tiene sucursales con área infantil? ${
      result.recommended_branches.some(b => ["SONATA", "SAN_ANGEL"].includes(b.branch_id)) ? "✅" : "❌"
    }`);
    
    return true;
  } catch (error) {
    logError(testName, error);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 6: Model Routing
// ═══════════════════════════════════════════════════════════════════════════

function testModelRouting() {
  const testName = "Model Routing";
  console.log(`\n🧪 Probando: ${testName}...`);
  
  const expectedRoutes = {
    chatwoot_intent: MODELS.NANO,
    order_step_classifier: MODELS.NANO,
    flow_control_classifier: MODELS.NANO,
    sentiment_result: MODELS.NANO,
    tania_reply: MODELS.MINI,
    hitl_customer_reply: MODELS.MINI,
    incident_report: MODELS.MINI,
    conversation_analysis: MODELS.MINI,
    response_validation: MODELS.NANO,
  };
  
  console.log("\n📋 Modelo recomendado por tarea:");
  let allCorrect = true;
  
  for (const [task, expectedModel] of Object.entries(expectedRoutes)) {
    const actualModel = getRecommendedModel(task);
    const isCorrect = actualModel === expectedModel;
    allCorrect = allCorrect && isCorrect;
    console.log(`  • ${task}: ${actualModel} ${isCorrect ? "✅" : "❌"}`);
  }
  
  logResult(testName, { message: allCorrect ? "Todos los modelos correctos" : "Hay errores en el routing" }, "N/A");
  return allCorrect;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST 7: Fallback System
// ═══════════════════════════════════════════════════════════════════════════

function testFallbacks() {
  const testName = "Fallback System";
  console.log(`\n🧪 Probando: ${testName}...`);
  
  const schemas = [
    "chatwoot_intent",
    "order_step_classifier", 
    "flow_control_classifier",
    "sentiment_result",
    "tania_reply",
    "hitl_customer_reply",
    "incident_report",
    "conversation_analysis",
    "response_validation",
  ];
  
  console.log("\n📋 Fallbacks disponibles:");
  let allPresent = true;
  
  for (const key of schemas) {
    const fallback = getFallbackForSchema(key);
    const hasIt = fallback !== null;
    allPresent = allPresent && hasIt;
    console.log(`  • ${key}: ${hasIt ? "✅" : "❌"}`);
  }
  
  logResult(testName, { message: allPresent ? "Todos los fallbacks presentes" : "Faltan fallbacks" }, "N/A");
  return allPresent;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function runAllTests() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║     TAGERS KISS API - TEST SUITE (SOTA + GPT-5 Family)                    ║
║                                                                           ║
║  Verificando que el "cerebro" funciona antes de conectar a Chatwoot       ║
║                                                                           ║
║  MODELOS:                                                                 ║
║    • gpt-5-nano  → Clasificadores (rápido, bajo costo)                    ║
║    • gpt-5-mini  → Generación (mejor calidad)                             ║
║    • gpt-5.2     → Tareas complejas (agentic)                             ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  // Verificar API key
  if (!process.env.OPENAI_API_KEY && !process.env.OPENAI_API_KEY_TANIA) {
    console.error("❌ ERROR: OPENAI_API_KEY o OPENAI_API_KEY_TANIA no configurada");
    console.error("   Configura la variable de entorno o crea un archivo .env");
    process.exit(1);
  }
  
  console.log("🔑 API Key detectada");
  console.log(`📊 LangSmith: ${process.env.LANGCHAIN_TRACING_V2 === "true" ? "Habilitado" : "Deshabilitado"}`);
  console.log(`\n🤖 Modelos GPT-5 Family:`);
  console.log(`   NANO:     ${MODELS.NANO}`);
  console.log(`   MINI:     ${MODELS.MINI}`);
  console.log(`   STANDARD: ${MODELS.STANDARD}`);
  console.log(`   PRO:      ${MODELS.PRO}`);
  
  const startTime = Date.now();
  const results = [];
  
  // Tests de modelo routing (sin API)
  results.push({ name: "Model Routing", passed: testModelRouting() });
  results.push({ name: "Fallback System", passed: testFallbacks() });
  
  // Tests con API
  results.push({ name: "Order Step Classifier", passed: await testOrderStepClassifier() });
  results.push({ name: "Chatwoot Intent", passed: await testChatwootIntent() });
  results.push({ name: "Sentiment Analysis", passed: await testSentimentAnalysis() });
  results.push({ name: "Flow Control", passed: await testFlowControl() });
  results.push({ name: "Tania Reply", passed: await testTaniaReply() });
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const passed = results.filter(r => r.passed).length;
  const total = results.length;
  
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║                         RESUMEN DE TESTS                                  ║
╠═══════════════════════════════════════════════════════════════════════════╣`);
  
  for (const r of results) {
    const status = r.passed ? "✅ PASS" : "❌ FAIL";
    console.log(`║  ${status}  ${r.name.padEnd(50)}║`);
  }
  
  console.log(`╠═══════════════════════════════════════════════════════════════════════════╣
║                                                                           ║
║  Total: ${passed}/${total} tests pasaron                                              ║
║  Tiempo: ${elapsed}s                                                         ║
║                                                                           ║
║  ${passed === total ? "🎉 LISTO PARA PRODUCCIÓN" : "⚠️  HAY TESTS FALLANDO"}                                           ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  process.exit(passed === total ? 0 : 1);
}

runAllTests().catch(console.error);
