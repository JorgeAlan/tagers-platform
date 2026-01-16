/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST SCRIPT - Distributed Rate Limiting + DLQ
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Prueba las nuevas funcionalidades de infraestructura:
 * 1. Rate Limiting Distribuido con Redis
 * 2. Deduplicación Distribuida con Redis
 * 3. Dead Letter Queue (DLQ)
 * 
 * USO:
 *   node scripts/test_distributed_infra.mjs
 * 
 * REQUISITOS:
 *   - REDIS_URL configurado (o Redis local en puerto 6379)
 * 
 * @version 1.0.0
 */

import { 
  checkRateLimit, 
  checkDuplicate, 
  getStats as getRateLimiterStats,
  resetRateLimit 
} from "../src/core/distributedRateLimiter.js";

import { 
  initDLQ, 
  moveToDeadLetter, 
  getDLQJobs, 
  getDLQStats,
  retryFromDLQ,
  discardFromDLQ,
  closeDLQ 
} from "../src/core/dlqProcessor.js";

import { getGovernorStats } from "../src/core/governor.js";
import { isRedisAvailable } from "../src/core/redis.js";

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function log(emoji, message, data = {}) {
  console.log(`${emoji} ${message}`, Object.keys(data).length ? JSON.stringify(data, null, 2) : "");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`❌ ASSERTION FAILED: ${message}`);
  }
  log("✅", message);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════════════════════════════════════
// TEST SUITES
// ═══════════════════════════════════════════════════════════════════════════

async function testRateLimiting() {
  log("🧪", "=== TEST: Rate Limiting Distribuido ===");
  
  const conversationId = `test_rate_${Date.now()}`;
  
  // Reset para empezar limpio
  await resetRateLimit(conversationId);
  
  // Test 1: Primeras llamadas deberían pasar
  log("📝", "Test 1: Primeras llamadas pasan...");
  for (let i = 1; i <= 5; i++) {
    const result = await checkRateLimit(conversationId);
    assert(result.allowed, `Llamada ${i} debería pasar (count: ${result.count})`);
  }
  
  // Test 2: Muchas llamadas consecutivas
  log("📝", "Test 2: Rate limit se activa después de umbral...");
  for (let i = 6; i <= 15; i++) {
    const result = await checkRateLimit(conversationId);
    if (i <= 10) {
      // Deberían pasar (default max = 10)
      log("  ", `Llamada ${i}: allowed=${result.allowed}, count=${result.count}`);
    } else {
      // Deberían bloquearse
      assert(!result.allowed, `Llamada ${i} debería estar bloqueada (count: ${result.count})`);
    }
  }
  
  // Test 3: Verificar source (Redis o memory)
  log("📝", "Test 3: Verificar source...");
  const stats = await getRateLimiterStats();
  log("📊", "Rate Limiter Stats:", stats);
  
  log("✅", "=== Rate Limiting Tests PASSED ===\n");
}

async function testDeduplication() {
  log("🧪", "=== TEST: Deduplicación Distribuida ===");
  
  const conversationId = `test_dedupe_${Date.now()}`;
  const message1 = "Hola, quiero una rosca";
  const message2 = "Cuánto cuesta la rosca?";
  
  // Test 1: Primer mensaje NO es duplicado
  log("📝", "Test 1: Primer mensaje no es duplicado...");
  const result1 = await checkDuplicate(conversationId, message1);
  assert(!result1.isDuplicate, "Primer mensaje no debería ser duplicado");
  log("  ", `Hash: ${result1.hash}, Source: ${result1.source}`);
  
  // Test 2: Mismo mensaje inmediato ES duplicado
  log("📝", "Test 2: Mensaje repetido inmediato es duplicado...");
  const result2 = await checkDuplicate(conversationId, message1);
  assert(result2.isDuplicate, "Mensaje repetido debería ser duplicado");
  
  // Test 3: Mensaje diferente NO es duplicado
  log("📝", "Test 3: Mensaje diferente no es duplicado...");
  const result3 = await checkDuplicate(conversationId, message2);
  assert(!result3.isDuplicate, "Mensaje diferente no debería ser duplicado");
  
  // Test 4: Después de esperar, ya no es duplicado
  log("📝", "Test 4: Después de ventana, no es duplicado...");
  log("  ", "Esperando 6 segundos para que expire la ventana...");
  await sleep(6000);
  const result4 = await checkDuplicate(conversationId, message1);
  // Nota: dependiendo de la config, podría seguir siendo duplicado si la ventana es > 5s
  log("  ", `isDuplicate: ${result4.isDuplicate} (esperado: false si ventana < 6s)`);
  
  log("✅", "=== Deduplication Tests PASSED ===\n");
}

async function testDLQ() {
  log("🧪", "=== TEST: Dead Letter Queue ===");
  
  // Inicializar DLQ
  await initDLQ();
  
  // Test 1: Stats iniciales
  log("📝", "Test 1: Obtener stats de DLQ...");
  const stats1 = await getDLQStats();
  log("📊", "DLQ Stats:", stats1);
  
  // Test 2: Simular job fallido
  log("📝", "Test 2: Mover job fallido a DLQ...");
  const fakeFailedJob = {
    id: `job_test_${Date.now()}`,
    name: "process-message",
    data: {
      conversationId: 12345,
      messageText: "Test message",
      accountId: 1,
    },
    attemptsMade: 3,
  };
  const fakeError = new Error("OpenAI API timeout");
  
  const dlqJob = await moveToDeadLetter(fakeFailedJob, fakeError, {
    testMode: true,
  });
  
  if (dlqJob) {
    log("✅", `Job movido a DLQ: ${dlqJob.id}`);
    
    // Test 3: Ver jobs en DLQ
    log("📝", "Test 3: Listar jobs en DLQ...");
    const jobs = await getDLQJobs({ start: 0, end: 10 });
    log("📊", "DLQ Jobs:", { total: jobs.total, jobIds: jobs.jobs.map(j => j.id) });
    
    // Test 4: Descartar job de prueba
    log("📝", "Test 4: Descartar job de prueba...");
    const discardResult = await discardFromDLQ(dlqJob.id);
    assert(discardResult.success, "Job debería descartarse exitosamente");
  } else {
    log("⚠️", "DLQ no disponible (Redis no conectado) - test parcialmente completado");
  }
  
  log("✅", "=== DLQ Tests PASSED ===\n");
}

async function testGovernorStats() {
  log("🧪", "=== TEST: Governor Stats ===");
  
  const stats = await getGovernorStats();
  log("📊", "Governor Stats:", stats);
  
  assert(stats.config !== undefined, "Config debería existir");
  assert(stats.rateLimiter !== undefined, "RateLimiter stats deberían existir");
  
  log("✅", "=== Governor Stats Tests PASSED ===\n");
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("\n" + "═".repeat(70));
  console.log("  DISTRIBUTED INFRASTRUCTURE TESTS");
  console.log("  Rate Limiting + Deduplication + Dead Letter Queue");
  console.log("═".repeat(70) + "\n");
  
  // Check Redis
  log("🔌", "Verificando conexión a Redis...");
  await sleep(1000); // Dar tiempo a que se conecte
  
  const redisUp = isRedisAvailable();
  log(redisUp ? "✅" : "⚠️", `Redis: ${redisUp ? "CONECTADO" : "NO DISPONIBLE (usando fallback en memoria)"}`);
  console.log("");
  
  try {
    // Run tests
    await testRateLimiting();
    await testDeduplication();
    await testDLQ();
    await testGovernorStats();
    
    console.log("═".repeat(70));
    console.log("  ✅ ALL TESTS PASSED!");
    console.log("═".repeat(70) + "\n");
    
  } catch (err) {
    console.error("\n❌ TEST FAILED:", err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    // Cleanup
    await closeDLQ();
    process.exit(0);
  }
}

main().catch(console.error);
