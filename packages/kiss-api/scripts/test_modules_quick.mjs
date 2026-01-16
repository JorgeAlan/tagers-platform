#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAGERS v21 - Quick Module Test
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Verifica que todos los módulos cargan correctamente sin errores de sintaxis
 * o dependencias faltantes.
 * 
 * Uso:
 *   node scripts/test_modules_quick.mjs
 * 
 * @version 1.0.0
 */

console.log("");
console.log("╔═══════════════════════════════════════════════════════════════════╗");
console.log("║        TAGERS v21 - Quick Module Test                             ║");
console.log("╚═══════════════════════════════════════════════════════════════════╝");
console.log("");

const modules = [
  // Core
  { path: "../src/core/governor.js", name: "Governor" },
  { path: "../src/core/dispatcher.js", name: "Dispatcher" },
  { path: "../src/core/async_processor.js", name: "AsyncProcessor" },
  { path: "../src/core/ai_runner.js", name: "AIRunner" },
  { path: "../src/core/queue.js", name: "Queue" },
  { path: "../src/core/semanticCache.js", name: "SemanticCache" },
  
  // Core/Resilience
  { path: "../src/core/resilience/index.js", name: "Resilience" },
  { path: "../src/core/resilience/localQueue.js", name: "LocalQueue" },
  { path: "../src/core/resilience/gracefulShutdown.js", name: "GracefulShutdown" },
  
  // Services
  { path: "../src/services/flowStateService.js", name: "FlowStateService" },
  { path: "../src/services/agent_gating.js", name: "AgentGating" },
  { path: "../src/services/handoff_service.js", name: "HandoffService" },
  { path: "../src/services/quick_responses.js", name: "QuickResponses" },
  { path: "../src/services/chatwootService.js", name: "ChatwootService" },
  { path: "../src/services/payloadParser.js", name: "PayloadParser" },
  
  // Workers
  { path: "../src/workers/aiWorker.js", name: "AIWorker" },
  
  // Routes
  { path: "../src/routes/chatwoot_v3.js", name: "ChatwootV3 Router" },
  { path: "../src/routes/health.js", name: "Health Router" },
];

let passed = 0;
let failed = 0;
const errors = [];

console.log("  Cargando módulos...\n");

for (const mod of modules) {
  try {
    await import(mod.path);
    console.log(`  ✓ ${mod.name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${mod.name}: ${err.message.split('\n')[0]}`);
    errors.push({ name: mod.name, error: err.message });
    failed++;
  }
}

console.log("");
console.log("═══ RESUMEN ═══");
console.log("");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log("");

if (failed === 0) {
  console.log("  🎉 ¡Todos los módulos cargan correctamente!");
} else {
  console.log("  ⚠️  Errores encontrados:");
  console.log("");
  for (const { name, error } of errors) {
    console.log(`  ${name}:`);
    console.log(`    ${error.substring(0, 200)}`);
    console.log("");
  }
}

console.log("");
process.exit(failed > 0 ? 1 : 0);
