# 🔮 Migración a pgvector: RAG Semántico Real

## Resumen Ejecutivo

Esta migración reemplaza el sistema actual de **hash exacto + fuzzy matching** por **búsqueda semántica real con pgvector**, permitiendo que el bot entienda sinónimos y conceptos relacionados sin hardcodear keywords.

### Antes vs Después

| Escenario | Antes (Fuzzy) | Después (Semántico) |
|-----------|---------------|---------------------|
| "¿Tienen pan de reyes?" | ❌ No match | ✅ Rosca (~85% similitud) |
| "Quiero un roscón" | ❌ No match | ✅ Rosca (~88% similitud) |
| "¿A qué hora cierran?" | ❌ Depende de keyword | ✅ FAQ horarios (~90%) |
| "Recoger en Ángeles" | ❌ No match | ✅ Angelópolis (~82%) |

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                         FLUJO DE DATOS                          │
└─────────────────────────────────────────────────────────────────┘

   Config Hub (Sheets)          WooCommerce
         │                           │
         ▼                           ▼
   ┌───────────────────────────────────────┐
   │         Vector Populator              │
   │  • Genera embeddings con OpenAI       │
   │  • Almacena en pgvector               │
   └───────────────────────────────────────┘
                     │
                     ▼
   ┌───────────────────────────────────────┐
   │            PostgreSQL                 │
   │  ┌─────────────────────────────────┐  │
   │  │       vector_embeddings         │  │
   │  │  • FAQs                         │  │
   │  │  • Productos                    │  │
   │  │  • Sucursales                   │  │
   │  │  • Knowledge Base               │  │
   │  └─────────────────────────────────┘  │
   │  ┌─────────────────────────────────┐  │
   │  │     vector_response_cache       │  │
   │  │  • Respuestas cacheadas         │  │
   │  └─────────────────────────────────┘  │
   │              (pgvector HNSW)          │
   └───────────────────────────────────────┘
                     │
                     ▼
   ┌───────────────────────────────────────┐
   │         Semantic Matchers             │
   │  • extractProductSemantic()           │
   │  • extractBranchSemantic()            │
   │  • findFAQSemantic()                  │
   │  • getContextForLLM()                 │
   └───────────────────────────────────────┘
                     │
                     ▼
            Tan•IA Responses
```

---

## Componentes

### 1. Vector Store (`src/vector/vectorStore.js`)

Gestiona la base de datos vectorial con pgvector.

```javascript
import { vectorStore } from "./src/vector/index.js";

// Inicializar al arrancar
await vectorStore.init();

// Buscar productos similares
const productos = await vectorStore.search("pan de reyes", {
  category: "product",
  threshold: 0.75,
  limit: 3,
});

// Cache semántico de respuestas
const cached = await vectorStore.getCached("¿tienen rosca?");
if (cached.hit) {
  return cached.response; // Evita llamada a OpenAI
}
```

### 2. Embeddings Service (`src/vector/embeddings.js`)

Genera vectores con OpenAI text-embedding-3-small.

```javascript
import { getEmbedding, getEmbeddingBatch, cosineSimilarity } from "./src/vector/embeddings.js";

// Embedding individual
const vec = await getEmbedding("Rosca de Reyes tradicional");

// Batch (más eficiente)
const vecs = await getEmbeddingBatch(["rosca", "café", "pastel"]);

// Similitud manual
const sim = cosineSimilarity(vec1, vec2); // 0.0 - 1.0
```

### 3. Semantic Matchers (`src/vector/semanticMatchers.js`)

Reemplaza/complementa los matchers fuzzy actuales.

```javascript
import { semanticMatchers } from "./src/vector/semanticMatchers.js";

// Extracción de productos
const product = await semanticMatchers.extractProduct("quiero pan de reyes");
// → { name: "Rosca de Reyes", sku: "ROSCA-001", confidence: 0.85 }

// Extracción de sucursales
const branch = await semanticMatchers.extractBranch("recoger en angeles");
// → { branch_id: "angelopolis", name: "Angelópolis", confidence: 0.82 }

// Híbrido (semántico + fallback fuzzy)
const product = await semanticMatchers.extractProductHybrid(text, fuzzyExtractor);
```

### 4. Vector Populator (`src/vector/vectorPopulator.js`)

Sincroniza embeddings desde Config Hub y WooCommerce.

```javascript
import { vectorPopulator } from "./src/vector/vectorPopulator.js";

// Poblar desde Config Hub
await vectorPopulator.populateFromConfigHub(config);

// Poblar desde WooCommerce
await vectorPopulator.populateFromWooCommerce(products);

// Sync completo
await vectorPopulator.syncAll();
```

---

## Instalación

### 1. Variables de Entorno

Agregar a `.env`:

```bash
# ═══════════════════════════════════════════════════════════════
# VECTOR STORE (pgvector)
# ═══════════════════════════════════════════════════════════════

# Habilitar/deshabilitar
VECTOR_STORE_ENABLED=true

# Modelo de embeddings (text-embedding-3-small es rápido y económico)
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# Umbral de similitud (0.0 - 1.0)
# Más bajo = más permisivo, más alto = más estricto
VECTOR_SIMILARITY_THRESHOLD=0.78

# TTLs (milisegundos)
VECTOR_TTL_FAQ_MS=604800000       # 7 días
VECTOR_TTL_PRODUCT_MS=86400000    # 24 horas
VECTOR_TTL_KNOWLEDGE_MS=14400000  # 4 horas
VECTOR_TTL_RESPONSE_MS=7200000    # 2 horas

# Cache de embeddings en memoria
EMBEDDING_CACHE_ENABLED=true
EMBEDDING_CACHE_TTL_MS=3600000    # 1 hora
EMBEDDING_CACHE_MAX_SIZE=1000

# Umbrales por tipo (opcional)
SEMANTIC_THRESHOLD_PRODUCT=0.75
SEMANTIC_THRESHOLD_BRANCH=0.80
SEMANTIC_THRESHOLD_FAQ=0.78

# Fallback a fuzzy matching si vector store falla
SEMANTIC_FALLBACK_FUZZY=true

# API key separada para embeddings (opcional)
# OPENAI_EMBEDDING_API_KEY=sk-...
```

### 2. Migración de Base de Datos

Railway PostgreSQL ya tiene pgvector instalado. Ejecutar la migración:

```bash
# Opción A: Desde Railway CLI
railway run psql $DATABASE_URL < src/db/migrations/001_pgvector_init.sql

# Opción B: Desde psql local
psql $DATABASE_URL < src/db/migrations/001_pgvector_init.sql

# Opción C: Copiar y ejecutar en Railway Console
# Ver: src/db/migrations/001_pgvector_init.sql
```

### 3. Dependencias

No se requieren nuevas dependencias. El proyecto ya tiene:
- `pg` - Cliente PostgreSQL
- `openai` - SDK de OpenAI

pgvector es una extensión de PostgreSQL, no una dependencia de Node.

### 4. Verificar Instalación

```bash
node scripts/test_vector_store.mjs
```

---

## Integración

### Modificar `server.js`

```javascript
// Al inicio, después de initDb()
import { initVectorStore, vectorStore } from "./src/vector/index.js";
import { vectorPopulator } from "./src/vector/vectorPopulator.js";

// En el bloque de inicialización
async function startServer() {
  // ... código existente ...
  
  // Inicializar vector store
  const vectorResult = await initVectorStore();
  if (vectorResult.ok) {
    logger.info("Vector store initialized with pgvector");
    
    // Poblar vectores después de sync de Config Hub
    // (esto se maneja automáticamente si registras el hook)
  } else {
    logger.warn({ reason: vectorResult.reason }, "Vector store not available");
  }
  
  // ... resto del código ...
}
```

### Modificar `sync-service.js`

Agregar hook para poblar vectores cuando se sincroniza Config Hub:

```javascript
import { vectorPopulator } from "../vector/vectorPopulator.js";

// En syncConfig(), después de actualizar la config:
export async function syncConfig(options = {}) {
  // ... código existente de sync ...
  
  // Al final, después de actualizar _config:
  if (_config) {
    // Poblar vectores en background (no bloquea)
    vectorPopulator.populateFromConfigHub(_config).catch(err => {
      logger.warn({ error: err.message }, "Failed to populate vectors");
    });
  }
}
```

### Modificar `matchers.js`

Agregar fallback híbrido:

```javascript
import { semanticMatchers } from "../vector/semanticMatchers.js";

// Reemplazar extractProduct con versión híbrida
export async function extractProductEnhanced(text) {
  // Intentar semántico primero
  const semantic = await semanticMatchers.extractProduct(text);
  if (semantic && semantic.confidence > 0.75) {
    return semantic;
  }
  
  // Fallback a fuzzy
  return extractProduct(text);
}

// Similar para extractBranch
export async function extractBranchEnhanced(text) {
  const semantic = await semanticMatchers.extractBranch(text);
  if (semantic && semantic.confidence > 0.80) {
    return semantic;
  }
  
  return extractBranch(text);
}
```

---

## Costos

### OpenAI Embeddings

| Modelo | Costo | Dimensiones | Uso Recomendado |
|--------|-------|-------------|-----------------|
| text-embedding-3-small | $0.02 / 1M tokens | 1536 | ✅ Producción |
| text-embedding-3-large | $0.13 / 1M tokens | 3072 | Alta precisión |

**Estimación mensual:**

- 10,000 queries/día × 30 días = 300,000 queries
- ~50 tokens/query promedio = 15M tokens
- **Costo: ~$0.30/mes** (text-embedding-3-small)

### PostgreSQL (Railway)

pgvector no tiene costo adicional. El storage depende de:
- ~6KB por embedding (1536 dimensiones × 4 bytes)
- 10,000 embeddings = ~60MB

---

## Monitoreo

### Métricas en `/health`

```javascript
// Agregar a health.js
import { vectorStore } from "../vector/index.js";

router.get("/vector", async (req, res) => {
  const stats = await vectorStore.getStats();
  res.json(stats);
});
```

### LangSmith

Los embeddings se tracean automáticamente si LangSmith está habilitado:

```bash
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=ls_...
LANGCHAIN_PROJECT=tagers-kiss-api
```

---

## FAQ

### ¿Qué pasa si pgvector falla?

El sistema tiene fallback a fuzzy matching si `SEMANTIC_FALLBACK_FUZZY=true`. El bot sigue funcionando con capacidades reducidas.

### ¿Cuántos embeddings puedo almacenar?

Con índice HNSW, búsquedas son O(log n). Railway Free tier soporta ~100,000 embeddings sin problemas.

### ¿Cómo actualizo los embeddings cuando cambia el Config Hub?

El hook `vectorPopulator.onConfigHubSync(config)` se dispara automáticamente. Los embeddings antiguos se invalidan y se crean nuevos.

### ¿Puedo usar otro modelo de embeddings?

Sí, cambia `EMBEDDING_MODEL` y `EMBEDDING_DIMENSIONS`. Asegúrate de actualizar la migración SQL si cambias dimensiones.

---

## Archivos Creados

```
src/
├── vector/
│   ├── index.js              # Exports principales
│   ├── vectorStore.js        # Base de datos vectorial
│   ├── embeddings.js         # Generación de embeddings
│   ├── semanticMatchers.js   # Matchers semánticos
│   └── vectorPopulator.js    # Sincronización desde Config Hub
│
├── db/
│   └── migrations/
│       └── 001_pgvector_init.sql  # Migración SQL
│
scripts/
└── test_vector_store.mjs     # Script de prueba
```

---

## Próximos Pasos

1. **Ejecutar migración SQL** en Railway
2. **Agregar variables de entorno** en Railway
3. **Desplegar código** con los nuevos módulos
4. **Verificar con test script**
5. **Monitorear métricas** en LangSmith

¿Preguntas? La implementación está diseñada para ser plug-and-play con tu arquitectura actual.
