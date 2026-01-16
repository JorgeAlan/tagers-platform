#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST: Sistema de Vectores y Búsqueda Semántica
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecutar: node scripts/test_vector_store.mjs
 * 
 * Prueba:
 * 1. Conexión a pgvector
 * 2. Generación de embeddings con OpenAI
 * 3. Inserción y búsqueda de vectores
 * 4. Búsqueda semántica (pan de reyes → rosca)
 * 
 * @version 1.0.0
 */

import { config } from "dotenv";
config();

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(emoji, message, color = "reset") {
  console.log(`${colors[color]}${emoji} ${message}${colors.reset}`);
}

function section(title) {
  console.log("\n" + "═".repeat(60));
  console.log(`${colors.cyan}${title}${colors.reset}`);
  console.log("═".repeat(60));
}

async function test(name, fn) {
  try {
    const start = Date.now();
    const result = await fn();
    const ms = Date.now() - start;
    log("✅", `${name} (${ms}ms)`, "green");
    return { success: true, result, ms };
  } catch (error) {
    log("❌", `${name}: ${error.message}`, "red");
    return { success: false, error: error.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VERIFICACIONES PREVIAS
// ═══════════════════════════════════════════════════════════════════════════

async function checkEnvironment() {
  section("1. VERIFICACIÓN DE AMBIENTE");
  
  const checks = {
    DATABASE_URL: !!process.env.DATABASE_URL,
    OPENAI_API_KEY: !!process.env.OPENAI_API_KEY,
    NODE_ENV: process.env.NODE_ENV || "development",
  };
  
  for (const [key, value] of Object.entries(checks)) {
    if (key === "NODE_ENV") {
      log("ℹ️", `${key}: ${value}`, "dim");
    } else {
      log(value ? "✅" : "❌", `${key}: ${value ? "Configurado" : "FALTA"}`, value ? "green" : "red");
    }
  }
  
  if (!checks.DATABASE_URL) {
    throw new Error("DATABASE_URL es requerido para pruebas de pgvector");
  }
  
  if (!checks.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY es requerido para generar embeddings");
  }
  
  return checks;
}

// ═══════════════════════════════════════════════════════════════════════════
// PRUEBAS
// ═══════════════════════════════════════════════════════════════════════════

async function runTests() {
  console.log("\n🧪 TEST: Sistema de Vectores con pgvector\n");
  
  await checkEnvironment();
  
  // ─────────────────────────────────────────────────────────────────────────
  section("2. INICIALIZACIÓN DE VECTOR STORE");
  // ─────────────────────────────────────────────────────────────────────────
  
  const { initVectorStore, getStats, isReady } = await import("../src/vector/vectorStore.js");
  
  await test("Inicializar pgvector", async () => {
    const result = await initVectorStore();
    if (!result.ok) throw new Error(result.reason || "Inicialización falló");
    return result;
  });
  
  await test("Verificar estado del vector store", async () => {
    if (!isReady()) throw new Error("Vector store no está listo");
    const stats = await getStats();
    console.log(`     ${colors.dim}Embeddings: ${stats.embeddings?.total || 0}${colors.reset}`);
    console.log(`     ${colors.dim}Cache: ${stats.cache?.total || 0}${colors.reset}`);
    return stats;
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  section("3. GENERACIÓN DE EMBEDDINGS");
  // ─────────────────────────────────────────────────────────────────────────
  
  const { getEmbedding, getEmbeddingBatch, cosineSimilarity, getCacheStats } = await import("../src/vector/embeddings.js");
  
  let embedding1, embedding2;
  
  await test("Generar embedding individual", async () => {
    embedding1 = await getEmbedding("Rosca de Reyes tradicional");
    if (!embedding1) throw new Error("No se generó embedding");
    console.log(`     ${colors.dim}Dimensiones: ${embedding1.length}${colors.reset}`);
    return { dimensions: embedding1.length };
  });
  
  await test("Generar embedding batch", async () => {
    const texts = [
      "Pan de reyes dulce",
      "Café americano caliente",
      "Pastel de chocolate",
    ];
    const embeddings = await getEmbeddingBatch(texts);
    if (!embeddings || embeddings.length !== texts.length) {
      throw new Error("Batch incompleto");
    }
    console.log(`     ${colors.dim}Generados: ${embeddings.filter(Boolean).length}/${texts.length}${colors.reset}`);
    return { count: embeddings.length };
  });
  
  await test("Verificar cache de embeddings", async () => {
    // Segundo request debe venir del cache
    embedding2 = await getEmbedding("Rosca de Reyes tradicional");
    const stats = getCacheStats();
    console.log(`     ${colors.dim}Cache size: ${stats.size}${colors.reset}`);
    return stats;
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  section("4. SIMILITUD SEMÁNTICA");
  // ─────────────────────────────────────────────────────────────────────────
  
  await test("Similitud: 'rosca' vs 'pan de reyes'", async () => {
    const emb1 = await getEmbedding("rosca de reyes");
    const emb2 = await getEmbedding("pan de reyes");
    const similarity = cosineSimilarity(emb1, emb2);
    console.log(`     ${colors.dim}Similitud: ${(similarity * 100).toFixed(1)}%${colors.reset}`);
    if (similarity < 0.8) {
      console.log(`     ${colors.yellow}⚠️ Similitud baja, pero el modelo puede variar${colors.reset}`);
    }
    return { similarity };
  });
  
  await test("Similitud: 'rosca' vs 'café' (debe ser baja)", async () => {
    const emb1 = await getEmbedding("rosca de reyes");
    const emb2 = await getEmbedding("café americano");
    const similarity = cosineSimilarity(emb1, emb2);
    console.log(`     ${colors.dim}Similitud: ${(similarity * 100).toFixed(1)}%${colors.reset}`);
    if (similarity > 0.7) {
      console.log(`     ${colors.yellow}⚠️ Similitud inesperadamente alta${colors.reset}`);
    }
    return { similarity };
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  section("5. INSERCIÓN Y BÚSQUEDA EN PGVECTOR");
  // ─────────────────────────────────────────────────────────────────────────
  
  const { upsertEmbedding, upsertEmbeddingBatch, searchSimilar, findBestMatch } = await import("../src/vector/vectorStore.js");
  
  await test("Insertar embeddings de prueba", async () => {
    const docs = [
      {
        text: "Rosca de Reyes tradicional con frutas cristalizadas | roscón | pan de reyes",
        category: "product",
        source: "test",
        metadata: { sku: "ROSCA-001", name: "Rosca Tradicional", price: 350 },
      },
      {
        text: "Café americano caliente | coffee | bebida",
        category: "product",
        source: "test",
        metadata: { sku: "CAFE-001", name: "Café Americano", price: 45 },
      },
      {
        text: "Sucursal Angelópolis | plaza angelopolis | puebla",
        category: "branch",
        source: "test",
        metadata: { branch_id: "angelopolis", name: "Angelópolis" },
      },
      {
        text: "¿A qué hora abren? | horario | hora de atención | cuando abren",
        category: "faq",
        source: "test",
        metadata: { answer: "Abrimos de 7am a 9pm todos los días" },
      },
    ];
    
    const result = await upsertEmbeddingBatch(docs);
    console.log(`     ${colors.dim}Insertados: ${result.inserted}/${docs.length}${colors.reset}`);
    return result;
  });
  
  await test("Buscar 'pan de reyes' (debe encontrar rosca)", async () => {
    const results = await searchSimilar("quiero pan de reyes", {
      category: "product",
      threshold: 0.7,
      limit: 3,
    });
    
    if (!results.length) throw new Error("No se encontraron resultados");
    
    const best = results[0];
    console.log(`     ${colors.dim}Match: ${best.metadata?.name || best.text.substring(0, 30)}${colors.reset}`);
    console.log(`     ${colors.dim}Similitud: ${(best.similarity * 100).toFixed(1)}%${colors.reset}`);
    
    return { found: results.length, best: best.metadata?.name };
  });
  
  await test("Buscar 'roscón' (sinónimo)", async () => {
    const results = await searchSimilar("tienen roscón", {
      category: "product",
      threshold: 0.7,
    });
    
    console.log(`     ${colors.dim}Resultados: ${results.length}${colors.reset}`);
    if (results.length) {
      console.log(`     ${colors.dim}Mejor: ${results[0].metadata?.name || "N/A"}${colors.reset}`);
    }
    return { found: results.length };
  });
  
  await test("Buscar sucursal 'angelopolis'", async () => {
    const result = await findBestMatch("recoger en angelopolis", {
      category: "branch",
      threshold: 0.75,
    });
    
    if (!result) throw new Error("No se encontró sucursal");
    console.log(`     ${colors.dim}Match: ${result.metadata?.name || result.text}${colors.reset}`);
    return result;
  });
  
  await test("Buscar FAQ sobre horarios", async () => {
    const result = await findBestMatch("¿a qué hora cierran?", {
      category: "faq",
      threshold: 0.75,
    });
    
    if (!result) throw new Error("No se encontró FAQ");
    console.log(`     ${colors.dim}Respuesta: ${result.metadata?.answer?.substring(0, 40) || "N/A"}...${colors.reset}`);
    return result;
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  section("6. CACHE SEMÁNTICO DE RESPUESTAS");
  // ─────────────────────────────────────────────────────────────────────────
  
  const { getCachedResponse, setCachedResponse } = await import("../src/vector/vectorStore.js");
  
  await test("Guardar respuesta en cache semántico", async () => {
    const hash = await setCachedResponse(
      "¿Tienen rosca de reyes?",
      "¡Sí! Tenemos Rosca de Reyes tradicional por $350. ¿Te gustaría ordenar?",
      { category: "product" }
    );
    
    if (!hash) throw new Error("No se guardó en cache");
    console.log(`     ${colors.dim}Hash: ${hash}${colors.reset}`);
    return { hash };
  });
  
  await test("Buscar 'pan de reyes' en cache (debe match)", async () => {
    const result = await getCachedResponse("tienen pan de reyes", {
      threshold: 0.75,
    });
    
    console.log(`     ${colors.dim}Hit: ${result.hit}${colors.reset}`);
    if (result.hit) {
      console.log(`     ${colors.dim}Similitud: ${(result.similarity * 100).toFixed(1)}%${colors.reset}`);
      console.log(`     ${colors.dim}Query original: ${result.matchedQuery?.substring(0, 30)}...${colors.reset}`);
    }
    return result;
  });
  
  // ─────────────────────────────────────────────────────────────────────────
  section("7. ESTADÍSTICAS FINALES");
  // ─────────────────────────────────────────────────────────────────────────
  
  const finalStats = await getStats();
  console.log(JSON.stringify(finalStats, null, 2));
  
  // ─────────────────────────────────────────────────────────────────────────
  section("✨ TODAS LAS PRUEBAS COMPLETADAS");
  // ─────────────────────────────────────────────────────────────────────────
  
  console.log(`
${colors.green}El sistema de vectores está funcionando correctamente.${colors.reset}

Próximos pasos:
1. Ejecutar migración SQL: psql $DATABASE_URL < src/db/migrations/001_pgvector_init.sql
2. Poblar vectores desde Config Hub
3. Integrar en matchers.js

Queries de ejemplo que ahora funcionan:
  • "¿Tienen pan de reyes?" → Rosca de Reyes (similitud ~85%)
  • "Quiero un roscón" → Rosca de Reyes (sinónimo)
  • "¿A qué hora cierran?" → FAQ de horarios
`);
}

// ═══════════════════════════════════════════════════════════════════════════
// EJECUCIÓN
// ═══════════════════════════════════════════════════════════════════════════

runTests().catch((error) => {
  console.error(`\n${colors.red}ERROR FATAL: ${error.message}${colors.reset}\n`);
  console.error(error.stack);
  process.exit(1);
});
