#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TEST RAG PIPELINE - Verificar ingesta y búsqueda de documentos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Uso:
 *   node scripts/test-rag-pipeline.js
 * 
 * Requisitos:
 *   - DATABASE_URL configurado
 *   - OPENAI_API_KEY configurado
 *   - Vector store inicializado
 */

import { ragPipeline } from "../src/rag/index.js";
import { documentLoader } from "../src/rag/documentLoader.js";
import { chunker } from "../src/rag/chunker.js";
import { initVectorStore, getStats } from "../src/vector/vectorStore.js";

const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
};

function log(msg, color = "reset") {
  console.log(`${COLORS[color]}${msg}${COLORS.reset}`);
}

function section(title) {
  console.log();
  log(`═══════════════════════════════════════════════════════════`, "cyan");
  log(` ${title}`, "cyan");
  log(`═══════════════════════════════════════════════════════════`, "cyan");
}

async function testDocumentLoader() {
  section("TEST: Document Loader");
  
  // Test text loading
  const testText = `
# Menú de Tagers Bakery

## Pan Artesanal
Nuestro pan se hornea fresco todos los días con ingredientes de la más alta calidad.

### Pan de Elote
Delicioso pan dulce elaborado con elote fresco de temporada.
Precio: $45 MXN

### Conchas
Clásico pan mexicano con su característica cobertura crujiente.
Precio: $18 MXN

## Roscas de Reyes
La tradicional Rosca de Reyes disponible en temporada (enero).
- Rosca Clásica: $350 MXN
- Rosca con Relleno de Nutella: $450 MXN
- Rosca Reina (premium): $550 MXN

## Políticas
- Pedidos con 24 horas de anticipación
- Entregas disponibles en CDMX y área metropolitana
- Aceptamos pagos con tarjeta, transferencia y efectivo
  `;
  
  // Create temp file
  const fs = await import("fs/promises");
  const tempPath = "/tmp/test-tagers-menu.md";
  await fs.writeFile(tempPath, testText);
  
  try {
    const doc = await documentLoader.loadDocument(tempPath, {
      title: "Menú Tagers Test",
      category: "menu",
    });
    
    log(`✓ Documento cargado: ${doc.metadata.fileName}`, "green");
    log(`  - Formato: ${doc.metadata.format}`, "dim");
    log(`  - Longitud: ${doc.content.length} caracteres`, "dim");
    log(`  - Hash: ${doc.contentHash}`, "dim");
    
    return { success: true, document: doc };
    
  } catch (err) {
    log(`✗ Error al cargar documento: ${err.message}`, "red");
    return { success: false, error: err.message };
    
  } finally {
    await fs.unlink(tempPath).catch(() => {});
  }
}

async function testChunker(content) {
  section("TEST: Chunker");
  
  if (!content) {
    log("⚠ Sin contenido para probar chunker", "yellow");
    return { success: false };
  }
  
  try {
    // Test different strategies
    const strategies = ["semantic", "paragraph", "sentence", "fixed"];
    
    for (const strategy of strategies) {
      const chunks = chunker.chunk(content, { strategy });
      log(`  ${strategy}: ${chunks.length} chunks`, "dim");
    }
    
    // Test auto-detection
    const bestStrategy = chunker.detectBestStrategy(content);
    const chunks = chunker.chunk(content, { strategy: bestStrategy });
    
    log(`✓ Estrategia óptima: ${bestStrategy}`, "green");
    log(`  - Chunks generados: ${chunks.length}`, "dim");
    log(`  - Tamaño promedio: ${Math.round(content.length / chunks.length)} chars`, "dim");
    
    if (chunks.length > 0) {
      log(`  - Primer chunk (preview):`, "dim");
      log(`    "${chunks[0].text.substring(0, 100)}..."`, "dim");
    }
    
    return { success: true, chunks };
    
  } catch (err) {
    log(`✗ Error en chunker: ${err.message}`, "red");
    return { success: false, error: err.message };
  }
}

async function testVectorStore() {
  section("TEST: Vector Store");
  
  try {
    const result = await initVectorStore();
    
    if (result.ok) {
      log(`✓ Vector store inicializado: ${result.storage}`, "green");
      
      const stats = await getStats();
      log(`  - Embeddings totales: ${stats.embeddings?.total || 0}`, "dim");
      log(`  - Categorías: ${stats.embeddings?.categories || 0}`, "dim");
      log(`  - Hits totales: ${stats.embeddings?.totalHits || 0}`, "dim");
      
      return { success: true, stats };
    } else {
      log(`⚠ Vector store no disponible: ${result.reason}`, "yellow");
      return { success: false, reason: result.reason };
    }
    
  } catch (err) {
    log(`✗ Error en vector store: ${err.message}`, "red");
    return { success: false, error: err.message };
  }
}

async function testIngestion() {
  section("TEST: Ingestion Pipeline");
  
  const testContent = `
Políticas de Tagers Bakery

1. DEVOLUCIONES
No aceptamos devoluciones de productos perecederos una vez entregados.
Los productos defectuosos serán reemplazados sin costo adicional.

2. PEDIDOS ESPECIALES
Los pedidos personalizados requieren 48 horas de anticipación.
El pago debe realizarse al momento de confirmar el pedido.

3. HORARIOS DE ATENCIÓN
Lunes a Viernes: 7:00 AM - 9:00 PM
Sábados y Domingos: 8:00 AM - 8:00 PM

4. ENTREGAS
Entregas disponibles de 9:00 AM a 6:00 PM.
Costo de envío: $50 MXN en CDMX, $80 MXN zona metropolitana.
  `;
  
  try {
    // Create buffer for ingestion
    const buffer = Buffer.from(testContent, "utf-8");
    
    const result = await ragPipeline.ingest(buffer, {
      title: "Políticas Tagers Test",
      category: "policy",
      source: "test_script",
      fileName: "politicas-test.txt",
      metadata: {
        testRun: true,
        timestamp: new Date().toISOString(),
      },
    });
    
    if (result.ok) {
      log(`✓ Documento ingestado exitosamente`, "green");
      log(`  - Job ID: ${result.jobId}`, "dim");
      log(`  - Chunks: ${result.chunks?.total || 0}`, "dim");
      log(`  - Insertados: ${result.chunks?.inserted || 0}`, "dim");
      log(`  - Duración: ${result.duration_ms}ms`, "dim");
      
      return { success: true, result };
    } else {
      log(`⚠ Ingesta falló: ${result.error}`, "yellow");
      return { success: false, error: result.error };
    }
    
  } catch (err) {
    log(`✗ Error en ingesta: ${err.message}`, "red");
    return { success: false, error: err.message };
  }
}

async function testSearch() {
  section("TEST: Search");
  
  const queries = [
    "¿Cuál es la política de devoluciones?",
    "¿A qué hora abren los fines de semana?",
    "¿Cuánto cuesta el envío?",
  ];
  
  try {
    for (const query of queries) {
      const result = await ragPipeline.search(query, {
        limit: 3,
        threshold: 0.5,
      });
      
      log(`\n  Query: "${query}"`, "cyan");
      
      if (result.results?.length > 0) {
        log(`  ✓ ${result.count} resultados encontrados`, "green");
        
        result.results.slice(0, 2).forEach((r, idx) => {
          const preview = r.text?.substring(0, 80) || "N/A";
          log(`    [${idx + 1}] Score: ${r.score?.toFixed(3)} - "${preview}..."`, "dim");
        });
      } else {
        log(`  ⚠ Sin resultados (error: ${result.error || "ninguno"})`, "yellow");
      }
    }
    
    return { success: true };
    
  } catch (err) {
    log(`✗ Error en búsqueda: ${err.message}`, "red");
    return { success: false, error: err.message };
  }
}

async function testContextGeneration() {
  section("TEST: Context Generation");
  
  try {
    const query = "¿Cómo funcionan los pedidos especiales y entregas?";
    const result = await ragPipeline.generateContext(query);
    
    if (result) {
      log(`✓ Contexto generado para AI`, "green");
      log(`  - Fuentes: ${result.count}`, "dim");
      log(`  - Longitud: ${result.context?.length || 0} caracteres`, "dim");
      
      if (result.sources?.length) {
        log(`  - Primera fuente: ${result.sources[0]?.title}`, "dim");
      }
      
      return { success: true, result };
    } else {
      log(`⚠ Sin contexto generado`, "yellow");
      return { success: false };
    }
    
  } catch (err) {
    log(`✗ Error generando contexto: ${err.message}`, "red");
    return { success: false, error: err.message };
  }
}

async function main() {
  log("\n🔬 TAGERS KISS API - RAG Pipeline Test Suite\n", "cyan");
  log(`Timestamp: ${new Date().toISOString()}`, "dim");
  
  const results = {
    documentLoader: null,
    chunker: null,
    vectorStore: null,
    ingestion: null,
    search: null,
    context: null,
  };
  
  // 1. Test Document Loader
  const loaderResult = await testDocumentLoader();
  results.documentLoader = loaderResult.success;
  
  // 2. Test Chunker (if loader succeeded)
  if (loaderResult.success) {
    const chunkerResult = await testChunker(loaderResult.document.content);
    results.chunker = chunkerResult.success;
  }
  
  // 3. Test Vector Store
  const vectorResult = await testVectorStore();
  results.vectorStore = vectorResult.success;
  
  // 4. Test Ingestion (if vector store is ready)
  if (vectorResult.success) {
    const ingestResult = await testIngestion();
    results.ingestion = ingestResult.success;
    
    // 5. Test Search (if ingestion succeeded)
    if (ingestResult.success) {
      // Wait a moment for embeddings to be indexed
      await new Promise(r => setTimeout(r, 500));
      
      const searchResult = await testSearch();
      results.search = searchResult.success;
      
      // 6. Test Context Generation
      const contextResult = await testContextGeneration();
      results.context = contextResult.success;
    }
  }
  
  // Summary
  section("RESUMEN");
  
  const passed = Object.values(results).filter(r => r === true).length;
  const failed = Object.values(results).filter(r => r === false).length;
  const skipped = Object.values(results).filter(r => r === null).length;
  
  for (const [test, result] of Object.entries(results)) {
    const icon = result === true ? "✓" : result === false ? "✗" : "○";
    const color = result === true ? "green" : result === false ? "red" : "yellow";
    log(`  ${icon} ${test}`, color);
  }
  
  console.log();
  log(`  Passed: ${passed}/${Object.keys(results).length}`, "green");
  if (failed > 0) log(`  Failed: ${failed}`, "red");
  if (skipped > 0) log(`  Skipped: ${skipped}`, "yellow");
  
  console.log();
  
  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
