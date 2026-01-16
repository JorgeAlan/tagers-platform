#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAGERS KISS API v21 - Testing Suite
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Pruebas E2E para verificar:
 * 1. Governor - Decisiones de si procesar
 * 2. Dispatcher - Routing de flujos
 * 3. Flujos completos - ORDER_CREATE, ORDER_STATUS, HANDOFF
 * 4. Integración con servicios
 * 
 * Uso:
 *   node scripts/test_v21_e2e.mjs
 *   node scripts/test_v21_e2e.mjs --live http://localhost:3000
 * 
 * @version 1.0.0
 */

import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  baseUrl: process.argv.find(a => a.startsWith("http")) || "http://localhost:3000",
  webhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN || "test-token",
  verbose: process.argv.includes("--verbose") || process.argv.includes("-v"),
  liveMode: process.argv.includes("--live"),
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(msg, color = "reset") {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

function logTest(name, passed, details = "") {
  const icon = passed ? "✓" : "✗";
  const color = passed ? "green" : "red";
  log(`  ${icon} ${name}${details ? ` ${colors.dim}(${details})${colors.reset}` : ""}`, color);
}

function logSection(title) {
  console.log("");
  log(`═══ ${title} ═══`, "cyan");
}

// ═══════════════════════════════════════════════════════════════════════════
// MOCK PAYLOADS
// ═══════════════════════════════════════════════════════════════════════════

const PAYLOADS = {
  // Mensaje entrante básico
  incomingMessage: (content, conversationId = 12345) => ({
    event: "message_created",
    message: {
      id: Date.now(),
      content,
      message_type: "incoming",
      sender_type: "Contact",
      sender: {
        id: 1,
        name: "Cliente Test",
        phone_number: "+521234567890",
        email: "test@example.com",
      },
    },
    conversation: {
      id: conversationId,
      inbox_id: 1,
      status: "open",
    },
    account: { id: 1 },
    inbox: { id: 1, name: "WhatsApp Test" },
  }),

  // Mensaje saliente (del bot)
  outgoingMessage: (content) => ({
    event: "message_created",
    message: {
      id: Date.now(),
      content,
      message_type: "outgoing",
      sender_type: "AgentBot",
    },
    conversation: { id: 12345 },
    account: { id: 1 },
  }),

  // Nota privada
  privateNote: (content) => ({
    event: "message_created",
    message: {
      id: Date.now(),
      content,
      message_type: "incoming",
      private: true,
    },
    conversation: { id: 12345 },
    account: { id: 1 },
  }),

  // Conversación con agente asignado
  withAgent: (content, agentId = 99) => ({
    event: "message_created",
    message: {
      id: Date.now(),
      content,
      message_type: "incoming",
      sender_type: "Contact",
    },
    conversation: {
      id: 12345,
      assignee_id: agentId,
      meta: { assignee: { id: agentId, name: "Agente Humano" } },
    },
    account: { id: 1 },
  }),
};

// ═══════════════════════════════════════════════════════════════════════════
// TEST: GOVERNOR
// ═══════════════════════════════════════════════════════════════════════════

async function testGovernor() {
  logSection("GOVERNOR TESTS");
  
  let passed = 0;
  let failed = 0;

  // Importar Governor
  let governor;
  try {
    const mod = await import(join(__dirname, "../src/core/governor.js"));
    governor = mod.governor;
    logTest("Governor importado correctamente", true);
    passed++;
  } catch (err) {
    logTest("Governor import", false, err.message);
    failed++;
    return { passed, failed };
  }

  // Test 1: Mensaje entrante válido → PROCEED
  try {
    const result = await governor.evaluate(PAYLOADS.incomingMessage("Hola, quiero una rosca"));
    const ok = result.shouldProcess === true && result.decision === "proceed";
    logTest("Mensaje entrante válido → PROCEED", ok, result.decision);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Mensaje entrante válido", false, err.message);
    failed++;
  }

  // Test 2: Mensaje saliente → SKIP_OUTGOING
  try {
    const result = await governor.evaluate(PAYLOADS.outgoingMessage("Respuesta del bot"));
    const ok = result.shouldProcess === false && result.decision === "skip_outgoing";
    logTest("Mensaje saliente → SKIP_OUTGOING", ok, result.decision);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Mensaje saliente", false, err.message);
    failed++;
  }

  // Test 3: Nota privada → SKIP_PRIVATE
  try {
    const result = await governor.evaluate(PAYLOADS.privateNote("Nota interna"));
    const ok = result.shouldProcess === false && result.decision === "skip_private";
    logTest("Nota privada → SKIP_PRIVATE", ok, result.decision);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Nota privada", false, err.message);
    failed++;
  }

  // Test 4: Mensaje vacío → SKIP_EMPTY
  try {
    const result = await governor.evaluate(PAYLOADS.incomingMessage("   "));
    const ok = result.shouldProcess === false && result.decision === "skip_empty";
    logTest("Mensaje vacío → SKIP_EMPTY", ok, result.decision);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Mensaje vacío", false, err.message);
    failed++;
  }

  // Test 5: Mensaje duplicado → SKIP_DUPLICATE
  try {
    const uniqueId = Date.now();
    const payload1 = PAYLOADS.incomingMessage("Test duplicado");
    payload1.message.id = uniqueId;
    const payload2 = { ...payload1, message: { ...payload1.message, id: uniqueId } };
    
    await governor.evaluate(payload1); // Primera vez
    const result = await governor.evaluate(payload2); // Segunda vez
    const ok = result.shouldProcess === false && result.decision === "skip_duplicate";
    logTest("Mensaje duplicado → SKIP_DUPLICATE", ok, result.decision);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Mensaje duplicado", false, err.message);
    failed++;
  }

  return { passed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: DISPATCHER
// ═══════════════════════════════════════════════════════════════════════════

async function testDispatcher() {
  logSection("DISPATCHER TESTS");
  
  let passed = 0;
  let failed = 0;

  let dispatcher;
  try {
    const mod = await import(join(__dirname, "../src/core/dispatcher.js"));
    dispatcher = mod.dispatcher;
    logTest("Dispatcher importado correctamente", true);
    passed++;
  } catch (err) {
    logTest("Dispatcher import", false, err.message);
    failed++;
    return { passed, failed };
  }

  // Crear contextos de prueba
  const createContext = (messageText, hasActiveFlow = false, currentFlow = null) => ({
    messageText,
    conversationId: 12345,
    accountId: 1,
    hasActiveFlow,
    currentFlow,
  });

  // Test 1: Saludo → GREETING
  try {
    const result = await dispatcher.route(createContext("Hola"));
    const ok = result.route === "greeting";
    logTest("'Hola' → GREETING", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Saludo", false, err.message);
    failed++;
  }

  // Test 2: Quiero rosca → ORDER_CREATE
  try {
    const result = await dispatcher.route(createContext("Quiero una rosca para el viernes"));
    const ok = result.route === "flow_order_create";
    logTest("'Quiero una rosca' → FLOW_ORDER_CREATE", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Order create", false, err.message);
    failed++;
  }

  // Test 3: Dónde está mi pedido → ORDER_STATUS
  try {
    const result = await dispatcher.route(createContext("¿Dónde está mi pedido 12345?"));
    const ok = result.route === "flow_order_status";
    logTest("'Dónde está mi pedido' → FLOW_ORDER_STATUS", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Order status", false, err.message);
    failed++;
  }

  // Test 4: Quiero hablar con humano → HANDOFF
  try {
    const result = await dispatcher.route(createContext("Quiero hablar con un humano"));
    const ok = result.route === "handoff_human";
    logTest("'Quiero hablar con humano' → HANDOFF_HUMAN", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Handoff", false, err.message);
    failed++;
  }

  // Test 5: Frustración alta → ESCALATE_FRUSTRATION
  try {
    const result = await dispatcher.route(createContext("NO ENTIENDES NADA!!! ESTOY HARTO!!!"));
    const ok = result.route === "escalate_frustration";
    logTest("Frustración alta → ESCALATE_FRUSTRATION", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Frustración", false, err.message);
    failed++;
  }

  // Test 6: FAQ Horarios
  try {
    const result = await dispatcher.route(createContext("¿Cuáles son sus horarios?"));
    const ok = result.route === "faq";
    logTest("'Horarios' → FAQ", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("FAQ Horarios", false, err.message);
    failed++;
  }

  // Test 7: Flujo activo → Continuar
  try {
    const activeFlow = {
      flow: "ORDER_CREATE",
      step: "ASK_DATE",
      draft: { product_name: "Rosca Clásica" },
    };
    const result = await dispatcher.route(createContext("Para el viernes", true, activeFlow));
    const ok = result.route === "flow_order_create" && result.meta?.continueFlow === true;
    logTest("Flujo activo → Continuar ORDER_CREATE", ok, `${result.route} (continueFlow: ${result.meta?.continueFlow})`);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Flujo activo", false, err.message);
    failed++;
  }

  // Test 8: Mensaje genérico → AGENTIC_FLOW
  try {
    const result = await dispatcher.route(createContext("¿Qué ingredientes tiene la rosca reina?"));
    const ok = result.route === "agentic_flow";
    logTest("Pregunta genérica → AGENTIC_FLOW", ok, result.route);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Agentic flow", false, err.message);
    failed++;
  }

  return { passed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: SERVICES
// ═══════════════════════════════════════════════════════════════════════════

async function testServices() {
  logSection("SERVICES TESTS");
  
  let passed = 0;
  let failed = 0;

  // Test flowStateService
  try {
    const mod = await import(join(__dirname, "../src/services/flowStateService.js"));
    const { setFlow, getFlow, clearFlow, FLOWS } = mod;
    
    const testConvId = "test_" + Date.now();
    const testState = { flow: FLOWS.ORDER_CREATE, step: "ASK_PRODUCT", draft: {} };
    
    setFlow(testConvId, testState);
    const retrieved = getFlow(testConvId);
    const ok = retrieved?.flow === FLOWS.ORDER_CREATE;
    
    clearFlow(testConvId);
    const cleared = getFlow(testConvId);
    const okCleared = cleared === null;
    
    logTest("flowStateService: set/get/clear", ok && okCleared);
    (ok && okCleared) ? passed++ : failed++;
  } catch (err) {
    logTest("flowStateService", false, err.message);
    failed++;
  }

  // Test handoff_service
  try {
    const mod = await import(join(__dirname, "../src/services/handoff_service.js"));
    const { detectsHandoffRequest, detectsFrustration, HANDOFF_REASONS } = mod;
    
    const handoffDetected = detectsHandoffRequest("Quiero hablar con un agente humano");
    const noHandoff = detectsHandoffRequest("Quiero una rosca");
    
    const frustration1 = detectsFrustration("NO ENTIENDES NADA!!!");
    const frustration2 = detectsFrustration("Gracias por la información");
    
    const ok = handoffDetected && !noHandoff && 
               frustration1.highFrustration && !frustration2.highFrustration;
    
    logTest("handoff_service: detectsHandoffRequest, detectsFrustration", ok);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("handoff_service", false, err.message);
    failed++;
  }

  // Test agent_gating
  try {
    const mod = await import(join(__dirname, "../src/services/agent_gating.js"));
    const { GATING_REASONS } = mod;
    
    const hasReasons = GATING_REASONS && typeof GATING_REASONS === "object";
    logTest("agent_gating: GATING_REASONS loaded", hasReasons);
    hasReasons ? passed++ : failed++;
  } catch (err) {
    logTest("agent_gating", false, err.message);
    failed++;
  }

  // Test quick_responses
  try {
    const mod = await import(join(__dirname, "../src/services/quick_responses.js"));
    const { getGreeting, getFAQAnswer, getSystemMessage } = mod;
    
    const greeting = getGreeting();
    const faqHorarios = getFAQAnswer("horarios");
    const errorMsg = getSystemMessage("error");
    
    const ok = greeting && greeting.includes("Tan") && 
               faqHorarios && faqHorarios.includes("Horario") &&
               errorMsg && errorMsg.includes("problema");
    
    logTest("quick_responses: getGreeting, getFAQAnswer, getSystemMessage", ok);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("quick_responses", false, err.message);
    failed++;
  }

  return { passed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: AI RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function testAIRunner() {
  logSection("AI RUNNER TESTS");
  
  let passed = 0;
  let failed = 0;

  try {
    const mod = await import(join(__dirname, "../src/core/ai_runner.js"));
    const { aiRunner, getMetrics, resetMetrics } = mod;
    
    // Verificar que existe
    const exists = typeof aiRunner === "object" && 
                   typeof aiRunner.runWithSelfHealing === "function";
    logTest("aiRunner: módulo cargado", exists);
    exists ? passed++ : failed++;
    
    // Verificar métricas
    resetMetrics();
    const metrics = getMetrics();
    const hasMetrics = metrics && typeof metrics.totalCalls === "number";
    logTest("aiRunner: métricas disponibles", hasMetrics);
    hasMetrics ? passed++ : failed++;
    
  } catch (err) {
    logTest("aiRunner", false, err.message);
    failed++;
  }

  return { passed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: QUEUE & WORKER
// ═══════════════════════════════════════════════════════════════════════════

async function testQueueWorker() {
  logSection("QUEUE & WORKER TESTS");
  
  let passed = 0;
  let failed = 0;

  // Test Queue
  try {
    const mod = await import(join(__dirname, "../src/core/queue.js"));
    const { aiQueue } = mod;
    
    const stats = await aiQueue.getStats();
    const hasStats = stats && typeof stats.redis === "boolean";
    
    logTest(`aiQueue: stats (redis: ${stats.redis ? "connected" : "fallback"})`, hasStats);
    hasStats ? passed++ : failed++;
  } catch (err) {
    logTest("aiQueue", false, err.message);
    failed++;
  }

  // Test Worker
  try {
    const mod = await import(join(__dirname, "../src/workers/aiWorker.js"));
    const { getWorkerStats } = mod;
    
    const stats = getWorkerStats();
    const hasStats = stats && typeof stats.running === "boolean";
    
    logTest(`aiWorker: stats (running: ${stats?.running})`, hasStats);
    hasStats ? passed++ : failed++;
  } catch (err) {
    logTest("aiWorker", false, err.message);
    failed++;
  }

  return { passed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST: LIVE WEBHOOK (Solo si --live)
// ═══════════════════════════════════════════════════════════════════════════

async function testLiveWebhook() {
  if (!CONFIG.liveMode) {
    log("\n  (Skip live tests - usa --live para probar contra servidor)", "dim");
    return { passed: 0, failed: 0, skipped: true };
  }

  logSection("LIVE WEBHOOK TESTS");
  
  let passed = 0;
  let failed = 0;

  const sendWebhook = async (payload) => {
    try {
      const url = `${CONFIG.baseUrl}/chatwoot/webhook?token=${CONFIG.webhookToken}`;
      const response = await fetch(url, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-tagers-chatwoot-token": CONFIG.webhookToken,
        },
        body: JSON.stringify(payload),
      });
      return { ok: response.ok, status: response.status, data: await response.json() };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  // Test 1: Health endpoint
  try {
    const response = await fetch(`${CONFIG.baseUrl}/chatwoot/health`);
    const data = await response.json();
    const ok = response.ok && data.status === "healthy";
    logTest(`GET /chatwoot/health → ${data.version || "?"}`, ok);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Health endpoint", false, err.message);
    failed++;
  }

  // Test 2: Webhook responde 200 rápido
  try {
    const start = Date.now();
    const result = await sendWebhook(PAYLOADS.incomingMessage("Test de velocidad"));
    const duration = Date.now() - start;
    const ok = result.ok && duration < 500;
    logTest(`POST /chatwoot/webhook → 200 en ${duration}ms`, ok);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Webhook speed", false, err.message);
    failed++;
  }

  // Test 3: Mensaje saliente no procesa
  try {
    const result = await sendWebhook(PAYLOADS.outgoingMessage("Bot message"));
    const ok = result.ok;
    logTest("Mensaje saliente aceptado (y luego ignorado por Governor)", ok);
    ok ? passed++ : failed++;
  } catch (err) {
    logTest("Outgoing message", false, err.message);
    failed++;
  }

  return { passed, failed };
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("");
  log("╔═══════════════════════════════════════════════════════════════════╗", "blue");
  log("║        TAGERS KISS API v21 - Testing Suite                        ║", "blue");
  log("╚═══════════════════════════════════════════════════════════════════╝", "blue");
  console.log("");
  log(`  Mode: ${CONFIG.liveMode ? "LIVE (" + CONFIG.baseUrl + ")" : "UNIT TESTS"}`, "dim");
  
  const results = {
    governor: { passed: 0, failed: 0 },
    dispatcher: { passed: 0, failed: 0 },
    services: { passed: 0, failed: 0 },
    aiRunner: { passed: 0, failed: 0 },
    queueWorker: { passed: 0, failed: 0 },
    liveWebhook: { passed: 0, failed: 0, skipped: false },
  };

  // Cambiar directorio de trabajo
  process.chdir(join(__dirname, ".."));

  // Ejecutar tests
  results.governor = await testGovernor();
  results.dispatcher = await testDispatcher();
  results.services = await testServices();
  results.aiRunner = await testAIRunner();
  results.queueWorker = await testQueueWorker();
  results.liveWebhook = await testLiveWebhook();

  // Resumen
  logSection("RESUMEN");
  
  let totalPassed = 0;
  let totalFailed = 0;

  for (const [name, { passed, failed, skipped }] of Object.entries(results)) {
    if (skipped) continue;
    totalPassed += passed;
    totalFailed += failed;
    const status = failed === 0 ? "✓" : "✗";
    const color = failed === 0 ? "green" : "red";
    log(`  ${status} ${name}: ${passed} passed, ${failed} failed`, color);
  }

  console.log("");
  log(`  TOTAL: ${totalPassed} passed, ${totalFailed} failed`, totalFailed === 0 ? "green" : "red");
  console.log("");

  if (totalFailed === 0) {
    log("  🎉 ¡Todos los tests pasaron!", "green");
  } else {
    log("  ⚠️  Algunos tests fallaron. Revisa los errores arriba.", "yellow");
  }

  console.log("");
  
  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Error fatal:", err);
  process.exit(1);
});
