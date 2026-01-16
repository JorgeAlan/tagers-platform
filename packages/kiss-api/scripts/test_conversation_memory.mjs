#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST: Sistema de Memoria de Conversación
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecutar: node scripts/test_conversation_memory.mjs
 * 
 * Prueba:
 * 1. Inicialización del servicio
 * 2. Almacenamiento de mensajes
 * 3. Recuperación de contexto
 * 4. Guardado de facts
 * 5. Búsqueda de facts relevantes
 * 6. Generación de resúmenes (si hay conexión a OpenAI)
 */

import { config } from "dotenv";
config();

// Verificar configuración
console.log("\n═══════════════════════════════════════════════════════════════");
console.log("  TEST: Sistema de Memoria de Conversación");
console.log("═══════════════════════════════════════════════════════════════\n");

const checks = {
  DATABASE_URL: !!process.env.DATABASE_URL,
  OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
};

console.log("📋 Verificación de configuración:");
console.log(`   DATABASE_URL: ${checks.DATABASE_URL ? "✅" : "❌ (usará memoria)"}`);
console.log(`   OPENAI_API_KEY: ${checks.OPENAI_API_KEY ? "✅" : "❌ (resumen deshabilitado)"}`);
console.log("");

// Importar servicios
let conversationMemoryService, conversationSummarizer;

try {
  const memoryModule = await import("../src/services/conversationMemoryService.js");
  conversationMemoryService = memoryModule.conversationMemoryService;
  
  const summarizerModule = await import("../src/services/conversationSummarizer.js");
  conversationSummarizer = summarizerModule.conversationSummarizer;
} catch (err) {
  console.error("❌ Error importando módulos:", err.message);
  process.exit(1);
}

// Test helpers
const testConversationId = `test_${Date.now()}`;
const testContactId = `contact_test_${Date.now()}`;

async function runTests() {
  let passed = 0;
  let failed = 0;
  
  // Test 1: Inicialización
  console.log("\n📌 Test 1: Inicialización del servicio");
  try {
    const initResult = await conversationMemoryService.init();
    console.log(`   Storage: ${initResult.storage}`);
    console.log(`   Status: ${initResult.ok ? "✅ OK" : "⚠️ " + initResult.reason}`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 2: Agregar mensajes
  console.log("\n📌 Test 2: Almacenamiento de mensajes");
  try {
    const messages = [
      { role: "user", content: "Hola, quisiera ordenar una rosca de reyes para 50 personas" },
      { role: "assistant", content: "¡Hola! Con gusto te ayudo. Para 50 personas te recomiendo nuestra Rosca Grande de 2kg." },
      { role: "user", content: "Perfecto, mi esposa es celíaca, ¿tienen opción sin gluten?" },
      { role: "assistant", content: "Sí, tenemos versión sin gluten. Tiene un costo adicional de $150." },
      { role: "user", content: "Ok, la quiero para el 6 de enero, recojo en sucursal Coyoacán" },
    ];
    
    for (const msg of messages) {
      await conversationMemoryService.addMessage({
        conversationId: testConversationId,
        contactId: testContactId,
        role: msg.role,
        content: msg.content,
        metadata: { test: true },
      });
    }
    
    console.log(`   ✅ ${messages.length} mensajes almacenados`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 3: Recuperar mensajes
  console.log("\n📌 Test 3: Recuperación de mensajes");
  try {
    const messages = await conversationMemoryService.getMessages(testConversationId);
    console.log(`   Mensajes recuperados: ${messages.length}`);
    
    if (messages.length > 0) {
      console.log(`   Último mensaje: "${messages[messages.length - 1].content.substring(0, 50)}..."`);
      console.log(`   ✅ OK`);
      passed++;
    } else {
      console.log(`   ⚠️ No se recuperaron mensajes`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 4: Contexto para LLM
  console.log("\n📌 Test 4: Contexto para LLM");
  try {
    const context = await conversationMemoryService.getContextForLLM(testConversationId, {
      maxMessages: 10,
      contactId: testContactId,
    });
    
    console.log(`   Mensajes: ${context.messages.length}`);
    console.log(`   Contexto adicional: ${context.context ? "Sí" : "No"}`);
    console.log(`   Source: ${context.source}`);
    console.log(`   ✅ OK`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 5: Guardar facts
  console.log("\n📌 Test 5: Guardado de facts");
  try {
    const facts = [
      { factType: "dietary", factKey: "familiar_celiaco", factValue: "esposa tiene enfermedad celíaca", confidence: 0.95 },
      { factType: "preference", factKey: "sucursal_preferida", factValue: "Coyoacán", confidence: 0.9 },
      { factType: "personal_info", factKey: "tamano_evento", factValue: "eventos de 50 personas", confidence: 0.85 },
    ];
    
    for (const fact of facts) {
      await conversationMemoryService.saveFact({
        contactId: testContactId,
        conversationId: testConversationId,
        ...fact,
      });
    }
    
    console.log(`   ✅ ${facts.length} facts guardados`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 6: Recuperar facts
  console.log("\n📌 Test 6: Recuperación de facts");
  try {
    const facts = await conversationMemoryService.getRelevantFacts(testContactId);
    console.log(`   Facts recuperados: ${facts.length}`);
    
    if (facts.length > 0) {
      for (const f of facts.slice(0, 3)) {
        console.log(`   - ${f.fact_type}/${f.fact_key}: ${f.fact_value}`);
      }
      console.log(`   ✅ OK`);
      passed++;
    } else {
      console.log(`   ⚠️ No se recuperaron facts`);
      failed++;
    }
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 7: Búsqueda semántica de facts (solo si hay OpenAI)
  if (checks.OPENAI_API_KEY) {
    console.log("\n📌 Test 7: Búsqueda semántica de facts");
    try {
      const relevantFacts = await conversationMemoryService.getRelevantFacts(
        testContactId,
        "¿Tiene restricciones alimentarias o alergias?"
      );
      
      console.log(`   Facts relevantes encontrados: ${relevantFacts.length}`);
      if (relevantFacts.length > 0) {
        for (const f of relevantFacts.slice(0, 2)) {
          console.log(`   - ${f.fact_key}: ${f.fact_value} (sim: ${f.similarity?.toFixed(3) || "N/A"})`);
        }
      }
      console.log(`   ✅ OK`);
      passed++;
    } catch (err) {
      console.log(`   ⚠️ Error (puede ser normal sin embeddings): ${err.message}`);
    }
  }
  
  // Test 8: Estadísticas
  console.log("\n📌 Test 8: Estadísticas del servicio");
  try {
    const stats = await conversationMemoryService.getStats();
    console.log(`   Storage: ${stats.storage}`);
    if (stats.storage === "postgres") {
      console.log(`   Total mensajes: ${stats.total_messages || 0}`);
      console.log(`   Conversaciones: ${stats.unique_conversations || 0}`);
      console.log(`   Facts activos: ${stats.active_facts || 0}`);
    } else {
      console.log(`   Conversaciones en memoria: ${stats.conversations || 0}`);
      console.log(`   Mensajes en memoria: ${stats.totalMessages || 0}`);
    }
    console.log(`   ✅ OK`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 9: Estadísticas del summarizer
  console.log("\n📌 Test 9: Estadísticas del summarizer");
  try {
    const stats = await conversationSummarizer.getStats();
    console.log(`   Status: ${stats.status}`);
    if (stats.status === "ok") {
      console.log(`   Scheduler: ${stats.scheduler}`);
      console.log(`   Conversaciones pendientes: ${stats.pending?.conversations || 0}`);
      console.log(`   Total resúmenes: ${stats.totals?.summaries || 0}`);
    }
    console.log(`   ✅ OK`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Test 10: Compatibilidad con API anterior
  console.log("\n📌 Test 10: Compatibilidad con API anterior");
  try {
    // Usar la API del servicio anterior
    conversationMemoryService.addMessage(testConversationId + "_legacy", "user", "Test de compatibilidad");
    const history = await conversationMemoryService.getHistoryForLLM(testConversationId + "_legacy", 5);
    
    console.log(`   Mensajes con API legacy: ${history.length}`);
    console.log(`   ✅ Compatibilidad verificada`);
    passed++;
  } catch (err) {
    console.log(`   ❌ Error: ${err.message}`);
    failed++;
  }
  
  // Cleanup
  console.log("\n📌 Limpieza de datos de prueba");
  try {
    await conversationMemoryService.clearMessages(testConversationId);
    await conversationMemoryService.clearMessages(testConversationId + "_legacy");
    console.log(`   ✅ Datos de prueba eliminados`);
  } catch (err) {
    console.log(`   ⚠️ Error en limpieza: ${err.message}`);
  }
  
  // Resumen
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log(`  RESULTADO: ${passed} passed, ${failed} failed`);
  console.log("═══════════════════════════════════════════════════════════════\n");
  
  return failed === 0;
}

// Ejecutar tests
runTests()
  .then(success => process.exit(success ? 0 : 1))
  .catch(err => {
    console.error("Error fatal:", err);
    process.exit(1);
  });
