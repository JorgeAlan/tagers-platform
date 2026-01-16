/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EJEMPLO: Integración de Model Registry en agentic_flow.js
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Este archivo muestra los cambios necesarios para integrar el Model Registry
 * en tu agentic_flow.js existente.
 * 
 * NO ES UN ARCHIVO COMPLETO - son snippets para copiar/adaptar.
 */

// ═══════════════════════════════════════════════════════════════════════════
// 1. AGREGAR IMPORT (al inicio del archivo)
// ═══════════════════════════════════════════════════════════════════════════

import { 
  getChatParams, 
  getResponsesParams, 
  getModel,
  modelRegistry 
} from "../config/modelRegistry.js";


// ═══════════════════════════════════════════════════════════════════════════
// 2. ANALYZER - Cambiar llamada hardcoded a dinámica
// ═══════════════════════════════════════════════════════════════════════════

// ANTES (hardcoded):
/*
const analyzerResponse = await openai.chat.completions.create({
  model: "gpt-5-nano",
  temperature: 0.1,
  max_tokens: 500,
  messages: [
    { role: "system", content: ANALYZER_PROMPT },
    { role: "user", content: userMessage },
  ],
  response_format: { type: "json_object" },
});
*/

// DESPUÉS (dinámico):
const analyzerResponse = await openai.chat.completions.create({
  ...getChatParams("analyzer"),
  messages: [
    { role: "system", content: ANALYZER_PROMPT },
    { role: "user", content: userMessage },
  ],
  response_format: { type: "json_object" },
});


// ═══════════════════════════════════════════════════════════════════════════
// 3. EXECUTOR (Responses API) - Cambiar a dinámico
// ═══════════════════════════════════════════════════════════════════════════

// ANTES (hardcoded):
/*
const response = await openai.responses.create({
  model: "gpt-5-mini",
  temperature: 0.4,
  max_output_tokens: 4000,
  input: conversationInput,
  instructions: systemPrompt,
  tools: tools,
});
*/

// DESPUÉS (dinámico):
const executorParams = getResponsesParams("executor");

const response = await openai.responses.create({
  ...executorParams,
  input: conversationInput,
  instructions: systemPrompt,
  tools: tools,
});


// ═══════════════════════════════════════════════════════════════════════════
// 4. VALIDATOR - Cambiar a dinámico
// ═══════════════════════════════════════════════════════════════════════════

// ANTES:
/*
const validatorResponse = await openai.chat.completions.create({
  model: "gpt-5-nano",
  temperature: 0,
  max_tokens: 200,
  messages: [...],
});
*/

// DESPUÉS:
const validatorResponse = await openai.chat.completions.create({
  ...getChatParams("validator"),
  messages: [...],
});


// ═══════════════════════════════════════════════════════════════════════════
// 5. LOGGING - Agregar info del modelo usado
// ═══════════════════════════════════════════════════════════════════════════

// En los logs, puedes incluir qué modelo se usó:
logger.info({
  role: "executor",
  model: getModel("executor"),
  source: modelRegistry.getModelConfig("executor").source || "default",
}, "Executing with model");


// ═══════════════════════════════════════════════════════════════════════════
// 6. HEALTH ENDPOINT - Agregar info de modelos
// ═══════════════════════════════════════════════════════════════════════════

// En tu server.js, agregar endpoint para ver configuración de modelos:
/*
app.get('/health/models', (req, res) => {
  res.json({
    models: modelRegistry.getRegistrySummary(),
    roles: modelRegistry.listRoles(),
  });
});
*/


// ═══════════════════════════════════════════════════════════════════════════
// GOOGLE SHEET: Pestaña AI_MODELS
// ═══════════════════════════════════════════════════════════════════════════

/*
Crear pestaña "AI_MODELS" con estas columnas:

| role            | model                    | api       | temperature | max_tokens | top_p | fallback          | enabled | notes                    |
|-----------------|--------------------------|-----------|-------------|------------|-------|-------------------|---------|--------------------------|
| analyzer        | gpt-5-nano               | chat      | 0.1         | 500        | 1     | gpt-4o-mini       | TRUE    | Intent detection         |
| executor        | gpt-5-mini               | responses | 0.4         | 4000       | 1     | gpt-4o            | TRUE    | Main responses           |
| validator       | gpt-5-nano               | chat      | 0           | 200        | 1     | gpt-4o-mini       | TRUE    | Safety validation        |
| schema_analyzer | gpt-5-nano               | chat      | 0.1         | 500        | 1     | gpt-4o-mini       | TRUE    | Sheet structure analysis |
| embeddings      | text-embedding-3-large   | embeddings|             | 3072       |       | text-embedding-3-small | TRUE | Semantic search          |
| summarizer      | gpt-5-nano               | chat      | 0.2         | 1000       | 1     | gpt-4o-mini       | TRUE    | Conversation summary     |

NOTAS:
- "api" puede ser: chat, responses, embeddings
- Para embeddings, max_tokens es "dimensions"
- Dejar celdas vacías usa el default del registry
- enabled=FALSE desactiva ese rol (usa default)
*/


// ═══════════════════════════════════════════════════════════════════════════
// MIGRACIÓN FUTURA A GPT-6
// ═══════════════════════════════════════════════════════════════════════════

/*
Cuando salga GPT-6:

1. En Google Sheet, cambiar:
   | role     | model      | ... |
   | executor | gpt-6-mini | ... |

2. Guardar sheet

3. Esperar 5 minutos (o hacer refresh manual)

4. ¡Listo! Sin deploy, sin código.

Si algo falla:
- El sistema usa el "fallback" automáticamente
- O revertir en Sheet a gpt-5-mini
*/
