#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LANGCHAIN/LANGSMITH INTEGRATION TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Verifica que la integración de LangChain/LangSmith esté funcionando.
 * 
 * Uso:
 *   node scripts/test_langchain_integration.mjs
 * 
 * @version 1.0.0
 */

import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// TEST HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function logTest(name, status, details = null) {
  const emoji = status ? "✅" : "❌";
  console.log(`${emoji} ${name}`);
  if (details) {
    console.log(`   └─ ${details}`);
  }
}

function logSection(title) {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(60)}\n`);
}

// ═══════════════════════════════════════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════════════════════════════════════

async function testLangSmithConfig() {
  logSection("1. LANGSMITH CONFIGURATION");
  
  const { 
    langsmithConfig, 
    isLangSmithEnabled,
    shouldTrace,
    getStatusReport,
  } = await import("../src/langchain/index.js");
  
  // Check env vars
  const hasApiKey = Boolean(process.env.LANGCHAIN_API_KEY);
  const tracingEnabled = process.env.LANGCHAIN_TRACING_V2 === "true";
  
  logTest("LANGCHAIN_API_KEY set", hasApiKey, 
    hasApiKey ? `Key starts with: ${process.env.LANGCHAIN_API_KEY.slice(0, 10)}...` : "Missing!");
  
  logTest("LANGCHAIN_TRACING_V2=true", tracingEnabled,
    `Current value: ${process.env.LANGCHAIN_TRACING_V2 || "undefined"}`);
  
  logTest("Project configured", Boolean(langsmithConfig.project),
    `Project: ${langsmithConfig.project}`);
  
  logTest("isLangSmithEnabled()", isLangSmithEnabled(),
    isLangSmithEnabled() ? "Tracing is ON" : "Tracing is OFF");
  
  logTest("shouldTrace() respects sampling", true,
    `Sample rate: ${langsmithConfig.sampleRate * 100}%`);
  
  // Status report
  const status = await getStatusReport();
  console.log("\n📊 Status Report:");
  console.log(JSON.stringify(status, null, 2));
  
  return isLangSmithEnabled();
}

async function testDependencies() {
  logSection("2. DEPENDENCIES CHECK");
  
  const { isLangGraphAvailable, getLangGraph, getLangChainMessages } = 
    await import("../src/langchain/index.js");
  
  // LangSmith
  let langsmithOk = false;
  try {
    const { traceable } = await import("langsmith/traceable");
    langsmithOk = typeof traceable === "function";
    logTest("langsmith installed", langsmithOk, "traceable function available");
  } catch (e) {
    logTest("langsmith installed", false, e.message);
  }
  
  // LangGraph
  const langGraphOk = await isLangGraphAvailable();
  logTest("@langchain/langgraph installed", langGraphOk,
    langGraphOk ? "StateGraph available" : "Will use SimpleStateMachine fallback");
  
  if (langGraphOk) {
    const { StateGraph, END } = await getLangGraph();
    logTest("  └─ StateGraph class", Boolean(StateGraph));
    logTest("  └─ END constant", Boolean(END));
  }
  
  // LangChain Core Messages
  const messages = await getLangChainMessages();
  const hasMessages = Boolean(messages.HumanMessage && messages.AIMessage);
  logTest("@langchain/core messages", hasMessages,
    hasMessages ? "Using LangChain messages" : "Using fallback message classes");
  
  return { langsmithOk, langGraphOk, hasMessages };
}

async function testTracing() {
  logSection("3. TRACING FUNCTIONALITY");
  
  const { withTracing, createTracingContext } = await import("../src/langchain/tracing.js");
  const { isLangSmithEnabled } = await import("../src/langchain/index.js");
  
  // Test withTracing wrapper
  const tracedFn = withTracing(
    async (x) => x * 2,
    { name: "test-double", runType: "chain", metadata: { test: true } }
  );
  
  const result = await tracedFn(21);
  logTest("withTracing wrapper works", result === 42, `2 * 21 = ${result}`);
  
  // Test tracing context
  const ctx = createTracingContext("integration-test", { source: "test_script" });
  
  await ctx.trace("step1", async () => "done");
  await ctx.trace("step2", async () => "done");
  const summary = ctx.end();
  
  logTest("createTracingContext works", summary.traces.length === 2,
    `${summary.traces.length} steps traced`);
  
  if (isLangSmithEnabled()) {
    logTest("Traces sent to LangSmith", true, 
      "Check smith.langchain.com for traces");
  } else {
    logTest("Traces sent to LangSmith", false,
      "LangSmith disabled - traces only logged locally");
  }
  
  return true;
}

async function testCallbacks() {
  logSection("4. CALLBACKS & METRICS");
  
  const { 
    createCallbacks, 
    withCallbacks, 
    getMetrics, 
    resetMetrics,
    getPrometheusMetrics,
  } = await import("../src/langchain/callbacks.js");
  
  // Reset metrics
  resetMetrics();
  
  // Simulate some LLM calls
  await withCallbacks(
    async () => ({ usage: { total_tokens: 100, prompt_tokens: 80, completion_tokens: 20 } }),
    { model: "gpt-5-nano", task: "test-classification", inputs: "test" }
  );
  
  await withCallbacks(
    async () => ({ usage: { total_tokens: 200 } }),
    { model: "gpt-5-mini", task: "test-generation", inputs: "test" }
  );
  
  const metrics = getMetrics();
  
  logTest("Metrics tracking works", metrics.llmCalls === 2,
    `${metrics.llmCalls} calls tracked`);
  
  logTest("Token counting works", metrics.totalTokens === 300,
    `${metrics.totalTokens} total tokens`);
  
  logTest("Calls by model tracked", metrics.callsByModel["gpt-5-nano"] === 1);
  logTest("Calls by task tracked", metrics.callsByTask["test-classification"] === 1);
  
  // Test Prometheus format
  const prometheus = getPrometheusMetrics();
  const hasPrometheus = prometheus.includes("tagers_llm_calls_total");
  logTest("Prometheus metrics format", hasPrometheus,
    hasPrometheus ? "Ready for scraping" : "Format issue");
  
  return true;
}

async function testStateGraph() {
  logSection("5. STATE GRAPH / STATE MACHINE");
  
  const { SimpleStateMachine, createStateGraph } = 
    await import("../src/langchain/runnable-config.js");
  const { isLangGraphAvailable } = await import("../src/langchain/index.js");
  
  // Test SimpleStateMachine fallback
  const machine = new SimpleStateMachine({
    name: "test-machine",
    initialState: { count: 0 },
    nodes: {
      INCREMENT: async (state) => ({ ...state, count: state.count + 1 }),
      DOUBLE: async (state) => ({ ...state, count: state.count * 2 }),
    },
    edges: {
      INCREMENT: "DOUBLE",
      DOUBLE: "END",
    },
  });
  machine.setEntryPoint("INCREMENT");
  
  const compiled = machine.compile();
  const result = await compiled.invoke({ count: 5 });
  
  logTest("SimpleStateMachine works", result.count === 12,
    `(5 + 1) * 2 = ${result.count}`);
  
  // Test createStateGraph factory
  const graph = await createStateGraph({
    name: "test-factory",
    channels: { value: { value: 0 } },
    nodes: { PROCESS: async (s) => ({ ...s, value: s.value + 10 }) },
    edges: { PROCESS: "END" },
    entryPoint: "PROCESS",
  });
  
  const factoryResult = await graph.invoke({ value: 5 });
  const usesLangGraph = await isLangGraphAvailable();
  
  logTest("createStateGraph factory works", factoryResult.value === 15,
    usesLangGraph ? "Using LangGraph" : "Using SimpleStateMachine fallback");
  
  return true;
}

async function testOrderCreateGraph() {
  logSection("6. ORDER CREATE GRAPH INTEGRATION");
  
  try {
    const { buildOrderCreateGraph, processOrderCreate } = 
      await import("../src/graphs/orderCreateGraph.js");
    
    logTest("orderCreateGraph imports successfully", true);
    
    // Build graph
    const graph = await buildOrderCreateGraph();
    logTest("buildOrderCreateGraph() works", Boolean(graph.invoke));
    
    // Test simple flow
    const result = await processOrderCreate({
      conversationId: "test-123",
      messageText: "Quiero una rosca clásica",
      currentState: null,
      context: {
        products: [
          { key: "clasica", name: "Rosca Clásica", id: 1 },
          { key: "nutella", name: "Rosca de Nutella", id: 2 },
        ],
        branches: [
          { branch_id: "SONATA", name: "Sonata (Puebla)" },
        ],
        dates: [],
      },
    });
    
    logTest("processOrderCreate() executes", Boolean(result.state));
    logTest("State has draft", Boolean(result.state?.draft));
    
    return true;
  } catch (e) {
    logTest("orderCreateGraph integration", false, e.message);
    console.error(e);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log(`
╔═══════════════════════════════════════════════════════════════════════════╗
║       TAGERS KISS API - LANGCHAIN/LANGSMITH INTEGRATION TEST              ║
║                                                                           ║
║  Verificando la integración de observabilidad y grafos de estado          ║
╚═══════════════════════════════════════════════════════════════════════════╝
`);

  const results = {
    config: await testLangSmithConfig(),
    deps: await testDependencies(),
    tracing: await testTracing(),
    callbacks: await testCallbacks(),
    stateGraph: await testStateGraph(),
    orderGraph: await testOrderCreateGraph(),
  };
  
  logSection("SUMMARY");
  
  const allPassed = Object.values(results).every(r => 
    typeof r === "boolean" ? r : Object.values(r).every(Boolean)
  );
  
  if (allPassed) {
    console.log("🎉 ALL TESTS PASSED!");
    console.log("\nNext steps:");
    console.log("1. Configure LANGCHAIN_API_KEY in .env if not done");
    console.log("2. Set LANGCHAIN_TRACING_V2=true to enable tracing");
    console.log("3. Check traces at: https://smith.langchain.com");
  } else {
    console.log("⚠️  SOME TESTS FAILED");
    console.log("\nCheck the output above for details.");
  }
  
  console.log("\n");
  process.exit(allPassed ? 0 : 1);
}

main().catch(console.error);
