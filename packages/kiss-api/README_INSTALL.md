# 🧠 Sistema Auto-Adaptativo OpenAI

Sistema que **aprende automáticamente** qué soporta cada modelo de OpenAI.
Ya no más errores por `temperature`, `json_mode`, o `max_tokens`.

## El Problema Anterior

Cada modelo GPT-5 tiene restricciones diferentes:
- `gpt-5-nano`: NO soporta temperature, NO soporta json_mode
- `gpt-5-mini`: NO soporta temperature, SÍ soporta json_mode  
- `gpt-4o`: SÍ soporta todo

Antes: Cambias modelo → todo se rompe → parche manual → se vuelve a romper.

## La Solución

El sistema ahora:
1. **Intenta** la llamada con todos los parámetros
2. Si OpenAI devuelve error → **detecta QUÉ falló**
3. **Aprende** esa restricción del modelo
4. **Reintenta** sin el parámetro problemático
5. **Cachea** el conocimiento para siempre

**Resultado:** Cambias modelo → funciona solo. Modelo nuevo de OpenAI → funciona solo.

---

## Instalación (3 archivos)

```
config/modelRegistry.js     ← REEMPLAZAR
src/utils/openaiHelper.js   ← CREAR NUEVO
src/vector/schemaAnalyzer.js ← REEMPLAZAR
```

### 1. modelRegistry.js → `config/`

Reemplaza tu `config/modelRegistry.js` actual. Tiene la misma API pero ahora con auto-aprendizaje.

Funciones que siguen funcionando igual:
- `getChatParams(role)` - Ahora omite parámetros no soportados automáticamente
- `getModel(role)` - Sin cambios
- `requiresMaxCompletionTokens(model)` - Ahora consulta conocimiento aprendido
- `doesNotSupportCustomTemperature(model)` - Ahora consulta conocimiento aprendido

Nueva función:
- `learnFromError(model, errorMsg)` - Aprende de errores de OpenAI
- `supportsJsonMode(model)` - Verifica si soporta json_mode

### 2. openaiHelper.js → `src/utils/`

Archivo NUEVO. Helper para llamadas con retry inteligente.

```javascript
import { smartCall, extractJson } from "../utils/openaiHelper.js";

// En lugar de:
const response = await openai.chat.completions.create(params);

// Usar:
const response = await smartCall(openai, params, { maxRetries: 2 });
```

### 3. schemaAnalyzer.js → `src/vector/`

Reemplaza tu `src/vector/schemaAnalyzer.js`. Ya usa el helper internamente.

---

## Cómo Funciona el Aprendizaje

```
Primera llamada con gpt-5-mini + temperature=0.1:
  → OpenAI: "temperature not supported"
  → Sistema aprende: gpt-5-mini.supports_temperature = false
  → Reintenta SIN temperature
  → Funciona ✅

Segunda llamada con gpt-5-mini:
  → Sistema ya sabe que no soporta temperature
  → Ni siquiera lo envía
  → Funciona inmediatamente ✅
```

---

## Logs que Verás

Cuando aprende algo nuevo:
```
[INFO] 🧠 Model capability learned { model: "gpt-5-mini", learning: "supports_temperature", value: false }
[WARN] 🔄 Retrying with learned params { model: "gpt-5-mini", attempt: 2 }
```

Cuando funciona:
```
[INFO] Sheet analyzed by AI ✨ { sheetName: "FAQ", category: "faq", model: "gpt-5-mini" }
```

---

## Conocimiento Inicial (Bootstrap)

El sistema viene pre-cargado con conocimiento de modelos comunes para arrancar más rápido:

| Modelo | temperature | json_mode | max_completion_tokens |
|--------|-------------|-----------|----------------------|
| gpt-5-nano | ❌ | ❌ | ✅ |
| gpt-5-mini | ❌ | ✅ | ✅ |
| gpt-5-turbo | ✅ | ✅ | ✅ |
| gpt-4o | ✅ | ✅ | ❌ (usa max_tokens) |
| gpt-4o-mini | ✅ | ✅ | ❌ |
| o1/o1-mini/o3-mini | ❌ | ❌ | ✅ |

**Si este conocimiento está mal, se auto-corregirá** en la primera llamada.

---

## API de Debug

```javascript
import { getAllKnowledge, getModelKnowledge } from "../config/modelRegistry.js";

// Ver todo lo que sabe el sistema
console.log(getAllKnowledge());
// {
//   "gpt-5-mini": { supports_temperature: false, supports_json_mode: true, ... },
//   "gpt-4o": { ... }
// }

// Ver conocimiento de un modelo específico
console.log(getModelKnowledge("gpt-5-nano"));
```

---

## Beneficios

1. **Zero config:** No necesitas columnas especiales en Google Sheet
2. **Auto-healing:** Errores se convierten en aprendizaje
3. **Future-proof:** Modelos nuevos funcionan automáticamente
4. **Mismo API:** No cambias tu código existente (excepto schemaAnalyzer)
5. **Retry inteligente:** Solo reintenta si puede aprender algo

---

## Después del Deploy

Deberías ver en logs:
```
[INFO] Sheet analyzed by AI ✨ { sheetName: 'FAQ', category: 'faq' }
[INFO] Sheet analyzed by AI ✨ { sheetName: 'BRANCHES', category: 'branch' }
...
[INFO] Google Sheet analysis complete ✅ { total: 16, indexed: 14 }
```

**Sin errores de temperature ni json_mode** 🎯
