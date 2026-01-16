# 🔗 LangChain/LangSmith Integration Module

Este módulo proporciona integración completa con LangChain y LangSmith para observabilidad, tracing y máquinas de estado.

## 📦 Estructura

```
src/langchain/
├── index.js           # Configuración central y exportaciones
├── tracing.js         # Wrappers de traceable para diferentes tipos de runs
├── callbacks.js       # Callbacks personalizados para métricas
├── runnable-config.js # Configuración de state graphs con fallback
└── README.md          # Este archivo
```

## 🚀 Quick Start

### 1. Configurar Variables de Entorno

```bash
# .env
LANGCHAIN_TRACING_V2=true
LANGCHAIN_API_KEY=lsv2_pt_xxxxx
LANGCHAIN_PROJECT=tagers-kiss-api
```

### 2. Usar Tracing en tu Código

```javascript
import { withTracing } from "./langchain/tracing.js";

// Wrappear cualquier función async
const processWithTracing = withTracing(
  async (input) => {
    // tu lógica aquí
    return result;
  },
  { 
    name: "my-process", 
    runType: "chain",
    metadata: { task: "processing" }
  }
);

await processWithTracing(input);
```

### 3. Usar State Graphs

```javascript
import { createStateGraph } from "./langchain/runnable-config.js";

// Automáticamente usa LangGraph si está instalado,
// o fallback a SimpleStateMachine si no
const graph = await createStateGraph({
  name: "my-graph",
  channels: { value: { value: 0 } },
  nodes: {
    PROCESS: async (state) => ({ ...state, value: state.value + 1 }),
    FINISH: async (state) => state,
  },
  edges: { PROCESS: "FINISH", FINISH: "END" },
  entryPoint: "PROCESS",
});

const result = await graph.invoke({ value: 5 });
```

## 📊 Features

### Tracing Types

| Wrapper | Run Type | Use Case |
|---------|----------|----------|
| `traceableLLM` | llm | Llamadas a OpenAI/modelos |
| `traceableChain` | chain | Pipelines/flujos |
| `traceableTool` | tool | Tool calls |
| `traceableRetriever` | retriever | Búsquedas/RAG |

### Callbacks & Metrics

```javascript
import { getMetrics, getPrometheusMetrics } from "./langchain/callbacks.js";

// Obtener métricas JSON
const metrics = getMetrics();
// { llmCalls: 10, llmErrors: 1, totalTokens: 5000, ... }

// Obtener métricas Prometheus
const prometheus = getPrometheusMetrics();
// tagers_llm_calls_total 10
// tagers_llm_errors_total 1
// ...
```

### Sampling (Reducir Costos)

```bash
# Solo tracear 10% de las llamadas
LANGCHAIN_TRACING_SAMPLE_RATE=0.1
```

## 🔧 Fallbacks

El módulo está diseñado para funcionar sin dependencias opcionales:

| Dependencia | Requerida | Fallback |
|-------------|-----------|----------|
| `langsmith` | ✅ Sí | - |
| `@langchain/langgraph` | ❌ No | `SimpleStateMachine` |
| `@langchain/core` | ❌ No | Clases de mensaje simples |

## 🧪 Testing

```bash
# Ejecutar test de integración
node scripts/test_langchain_integration.mjs
```

## 📈 Ver Traces

1. Ve a [smith.langchain.com](https://smith.langchain.com)
2. Selecciona tu proyecto (`tagers-kiss-api`)
3. Explora los traces en tiempo real

## 🔑 API Key

Obtén tu API key en [smith.langchain.com/settings](https://smith.langchain.com/settings)

---

**Nota**: Este módulo fue diseñado para Tagers KISS API v4.1.2+
