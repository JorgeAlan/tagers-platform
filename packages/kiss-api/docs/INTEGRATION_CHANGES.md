# 🔧 Cambios en Archivos Existentes

Este documento detalla los cambios mínimos necesarios en tu código existente para integrar pgvector.

---

## 1. `package.json`

No se requieren nuevas dependencias. Ya tienes `pg` y `openai`.

---

## 2. `.env` / Variables de Entorno (Railway)

Agregar estas variables:

```bash
# Vector Store
VECTOR_STORE_ENABLED=true
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536
VECTOR_SIMILARITY_THRESHOLD=0.78
SEMANTIC_FALLBACK_FUZZY=true
```

---

## 3. `src/server.js`

Agregar inicialización del vector store:

```javascript
// Agregar import al inicio
import { initVectorStore } from "./vector/index.js";
import { vectorPopulator } from "./vector/vectorPopulator.js";

// En la función de inicio, después de initDb():
async function startServer() {
  // ... código existente ...
  
  // Después de: const dbResult = await initDb();
  
  // ═══ NUEVO: Inicializar Vector Store ═══
  const vectorResult = await initVectorStore();
  if (vectorResult.ok) {
    logger.info({ storage: vectorResult.storage }, "Vector store initialized");
  } else {
    logger.warn({ reason: vectorResult.reason }, "Vector store not available, using fuzzy fallback");
  }
  
  // ... resto del código ...
}
```

---

## 4. `src/config-hub/sync-service.js`

Agregar hook para poblar vectores cuando se sincroniza Config Hub:

```javascript
// Agregar import al inicio
import { vectorPopulator } from "../vector/vectorPopulator.js";

// En la función syncConfig(), al final después de actualizar _config:
export async function syncConfig(options = {}) {
  // ... código existente de sync ...
  
  // Al final de la función, antes del return:
  
  // ═══ NUEVO: Poblar vectores (no bloquea) ═══
  if (_config) {
    vectorPopulator.populateFromConfigHub(_config).catch(err => {
      logger.warn({ error: err.message }, "Failed to populate vectors from Config Hub");
    });
  }
  
  return { success: true, /* ... */ };
}
```

---

## 5. `src/knowledge-hub/matchers.js`

Opción A: **Reemplazo completo** (recomendado para nuevos proyectos)

Usar `semanticMatchers` en lugar de los extractores actuales.

Opción B: **Híbrido** (recomendado para migración gradual)

Agregar funciones wrapper que usen semántico con fallback:

```javascript
// Agregar import al inicio
import { semanticMatchers } from "../vector/semanticMatchers.js";

// ═══ NUEVO: Extractores híbridos ═══

/**
 * Extrae producto con búsqueda semántica + fallback fuzzy
 */
export async function extractProductEnhanced(text) {
  // Intentar semántico primero
  try {
    const semantic = await semanticMatchers.extractProduct(text);
    if (semantic && semantic.confidence > 0.75) {
      return {
        ...semantic,
        source: "semantic",
      };
    }
  } catch (err) {
    // Silenciar error, usar fallback
  }
  
  // Fallback a fuzzy matching existente
  const fuzzy = extractProduct(text);
  if (fuzzy) {
    return {
      ...fuzzy,
      source: "fuzzy",
    };
  }
  
  return null;
}

/**
 * Extrae sucursal con búsqueda semántica + fallback fuzzy
 */
export async function extractBranchEnhanced(text) {
  try {
    const semantic = await semanticMatchers.extractBranch(text);
    if (semantic && semantic.confidence > 0.80) {
      return {
        ...semantic,
        source: "semantic",
      };
    }
  } catch (err) {
    // Silenciar error, usar fallback
  }
  
  const fuzzy = extractBranch(text);
  if (fuzzy) {
    return {
      ...fuzzy,
      source: "fuzzy",
    };
  }
  
  return null;
}

// Actualizar el export default para incluir las nuevas funciones:
export default {
  // ... exports existentes ...
  
  // Nuevos extractores híbridos
  extractProductEnhanced,
  extractBranchEnhanced,
};
```

---

## 6. `src/core/semanticCache.js`

**Opción A: Mantener ambos** (recomendado inicialmente)

El semantic cache actual sigue funcionando. El nuevo vector cache es complementario:
- `semanticCache.js` → Cache por hash exacto (rápido, sin costo)
- `vectorStore.js` → Cache semántico (más inteligente, costo mínimo)

**Opción B: Migrar completamente** (opcional)

Reemplazar las llamadas a `semanticCache.get/set` por `vectorStore.getCached/setCached`:

```javascript
// Antes:
import { semanticCache } from "./core/semanticCache.js";
const cached = semanticCache.get(question);
if (cached.hit) return cached.response;

// Después:
import { vectorStore } from "./vector/index.js";
const cached = await vectorStore.getCached(question);
if (cached.hit) return cached.response;
```

---

## 7. `src/routes/health.js`

Agregar endpoint para métricas del vector store:

```javascript
// Agregar import
import { vectorStore } from "../vector/index.js";

// Agregar nuevo endpoint
router.get("/vector", async (req, res) => {
  try {
    const stats = await vectorStore.getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
```

---

## 8. Flujos que usan extractores

Los siguientes archivos llaman a `extractProduct` o `extractBranch`:

- `src/flows/orderCreateFlow.js`
- `src/tania/agentic_flow.js`
- `src/tools/intent_extractor.js`

Para cada uno, tienes dos opciones:

### Opción A: Cambiar a versión async híbrida

```javascript
// Antes:
import { extractProduct, extractBranch } from "../knowledge-hub/matchers.js";
const product = extractProduct(text);

// Después:
import { extractProductEnhanced, extractBranchEnhanced } from "../knowledge-hub/matchers.js";
const product = await extractProductEnhanced(text);
```

### Opción B: Mantener sin cambios

Los extractores originales siguen funcionando. El nuevo sistema es opt-in.

---

## Orden de Implementación Sugerido

1. **Día 1**: Agregar variables de entorno + ejecutar migración SQL
2. **Día 2**: Agregar código del módulo `src/vector/`
3. **Día 3**: Modificar `server.js` y `sync-service.js`
4. **Día 4**: Probar con `test_vector_store.mjs`
5. **Día 5**: Integrar extractores híbridos gradualmente

---

## Rollback

Si necesitas desactivar pgvector:

```bash
VECTOR_STORE_ENABLED=false
SEMANTIC_FALLBACK_FUZZY=true
```

El sistema usará automáticamente los matchers fuzzy existentes.
