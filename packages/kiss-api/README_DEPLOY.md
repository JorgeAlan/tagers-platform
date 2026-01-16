# 🧠 Sistema Auto-Adaptativo OpenAI v2.0

## Descripción

Sistema que **aprende automáticamente** las capacidades de cada modelo OpenAI.
Cuando un modelo devuelve error por parámetro no soportado, el sistema:

1. Detecta qué parámetro falló
2. Aprende la restricción
3. Reintenta automáticamente
4. Las siguientes llamadas funcionan sin errores

## Archivos a Desplegar

```
┌─────────────────────────────────────────────────────────────────┐
│ ARCHIVO                    │ UBICACIÓN EN PROYECTO             │
├─────────────────────────────────────────────────────────────────┤
│ modelRegistry.js           │ /config/modelRegistry.js          │
│ openaiHelper.js            │ /src/utils/openaiHelper.js        │
│ schemaAnalyzer.js          │ /src/vector/schemaAnalyzer.js     │
└─────────────────────────────────────────────────────────────────┘
```

## Instrucciones de Instalación

### 1. Backup (opcional pero recomendado)
```bash
cp config/modelRegistry.js config/modelRegistry.backup.js
cp src/vector/schemaAnalyzer.js src/vector/schemaAnalyzer.backup.js
```

### 2. Reemplazar Archivos

**En GitHub Desktop:**
1. Reemplaza `config/modelRegistry.js` con el nuevo
2. Crea `src/utils/openaiHelper.js` (archivo nuevo)
3. Reemplaza `src/vector/schemaAnalyzer.js` con el nuevo

### 3. Commit y Deploy
```
Commit: "feat: Auto-adaptive OpenAI system v2.0"
Push to main → Railway auto-deploy
```

## Simplificar Google Sheet AI_Models

Con este sistema, ya NO necesitas las columnas de compatibilidad:

### ANTES (complejo):
```
role | model | temperature | max_tokens | supports_temperature | supports_json_mode | uses_max_completion_tokens
```

### DESPUÉS (simple):
```
role | model | temperature | max_tokens | enabled
```

El sistema aprende automáticamente qué parámetros soporta cada modelo.

## Cómo Funciona

### Primera llamada con modelo nuevo:
```
1. Intenta con temperature=0.1
2. OpenAI error: "temperature not supported"
3. Sistema aprende: gpt-5-mini.supports_temperature = false
4. Reintenta sin temperature
5. ✅ Éxito
```

### Llamadas siguientes:
```
1. Sistema ya sabe que no soporta temperature
2. Omite temperature desde el inicio
3. ✅ Éxito inmediato
```

## Logs Esperados

### Aprendizaje:
```
[INFO] 🧠 Model capability learned from error { model: "gpt-5-mini", capability: "supports_temperature", newValue: false }
[WARN] 🔄 Retrying with learned params { model: "gpt-5-mini", attempt: 2 }
```

### Análisis exitoso:
```
[INFO] Sheet analyzed by AI ✨ { sheetName: "FAQ", category: "faq", model: "gpt-5-mini" }
[INFO] Google Sheet analysis complete ✅ { total: 16, indexed: 14 }
```

## API Reference

### modelRegistry.js

```javascript
import { 
  getModel,           // Obtener modelo para un rol
  getChatParams,      // Obtener parámetros inteligentes para OpenAI
  supportsJsonMode,   // Verificar si modelo soporta JSON mode
  learnFromError,     // Aprender de un error de OpenAI
  getAllKnowledge,    // Debug: ver todo el conocimiento acumulado
} from "../config/modelRegistry.js";

// Ejemplo de uso
const params = getChatParams("schema_analyzer");
// Retorna: { model: "gpt-5-mini", max_completion_tokens: 500 }
// (sin temperature porque el modelo no lo soporta)
```

### openaiHelper.js

```javascript
import { smartCall, extractJson } from "../utils/openaiHelper.js";

// Llamada inteligente con retry automático
const response = await smartCall(openaiClient, params, {
  maxRetries: 2,
  role: "schema_analyzer",
});

// Extraer JSON de cualquier respuesta
const data = extractJson(response.choices[0].message.content);
```

### schemaAnalyzer.js

```javascript
import { analyzeGoogleSheet, generateDocumentsFromAnalysis } from "../vector/schemaAnalyzer.js";

// Analizar todas las hojas
const config = await analyzeGoogleSheet(sheetsData);

// Generar documentos para embeddings
const docs = generateDocumentsFromAnalysis(sheetsData, config);
```

## Compatibilidad

- ✅ Compatible con tu código existente
- ✅ Mismas funciones exportadas
- ✅ Sin cambios en otros archivos necesarios
- ✅ Funciona con gpt-4o, gpt-4o-mini, gpt-5-*, o1-*, o3-*

## Troubleshooting

### Error: Cannot find module '../src/utils/logger.js'
La ruta del logger es relativa. Verifica que tu logger esté en `/src/utils/logger.js`.

### Error: OPENAI_API_KEY required
Asegúrate de que la variable de entorno esté configurada en Railway.

### No aprende de errores
Verifica que `learnFromError` se esté llamando con el mensaje de error completo.
