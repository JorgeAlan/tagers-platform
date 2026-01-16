# Sistema de Memoria de Conversación Persistente y Resumida

## 📋 Resumen

Este sistema reemplaza el `conversationHistoryService.js` básico con un sistema completo de memoria que:

1. **Persiste** mensajes en PostgreSQL (sobrevive reinicios)
2. **Resume** conversaciones antiguas usando LLM
3. **Extrae** facts/preferencias del cliente a largo plazo
4. **Vectoriza** resúmenes y facts para búsqueda semántica

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    CONVERSATION MEMORY                         │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐    ┌──────────────┐    ┌─────────────────┐   │
│  │  Messages   │ -> │  Summaries   │ -> │     Facts       │   │
│  │  (24h)      │    │ (Compressed) │    │ (Long-term)     │   │
│  └─────────────┘    └──────────────┘    └─────────────────┘   │
│        │                   │                    │              │
│        └───────────────────┴────────────────────┘              │
│                            │                                   │
│                    ┌───────▼───────┐                          │
│                    │    pgvector   │                          │
│                    │  (Embeddings) │                          │
│                    └───────────────┘                          │
└─────────────────────────────────────────────────────────────────┘
```

## 🚀 Instalación

### 1. Auto-Migración (Recomendado)

Las tablas se crean automáticamente al iniciar el servidor. Solo necesitas:

```env
# En tu .env de Railway
CONVERSATION_MEMORY_ENABLED=true
AUTO_MIGRATE_ON_STARTUP=true   # Por defecto ya es true
```

El servidor ejecutará las migraciones SQL pendientes al iniciar.

### 2. Migración Manual (Alternativa)

Si prefieres ejecutar la migración manualmente:

```bash
# Conectar a tu base de datos PostgreSQL en Railway
psql $DATABASE_URL < src/db/migrations/003_conversation_memory.sql
```

O desde el shell de Railway:
```bash
railway run psql < src/db/migrations/003_conversation_memory.sql
```

### 3. Variables de entorno

```env
# Habilitar/deshabilitar el sistema
CONVERSATION_MEMORY_ENABLED=true

# Tiempo antes de resumir mensajes (24 horas por defecto)
MEMORY_SUMMARIZE_AFTER_MS=86400000

# Mínimo de mensajes para crear un resumen
MEMORY_MIN_MESSAGES_SUMMARY=10

# NOTA: El modelo se configura en model_policy.json (tarea: conversation_summary)
# Por defecto usa gpt-5-mini con service_tier flex

# Extraer facts automáticamente
MEMORY_EXTRACT_FACTS=true

# TTL para facts (NULL = no expira)
# MEMORY_FACTS_TTL_MS=

# Intervalo del ciclo de resumen (30 min por defecto)
MEMORY_CYCLE_INTERVAL_MS=1800000

# Deshabilitar auto-migración (solo si necesitas control manual)
# AUTO_MIGRATE_ON_STARTUP=false
```

### 4. El servidor se encarga del resto

El `server.js` ya incluye la inicialización automática:
- Auto-migración de tablas SQL
- Inicialización del servicio de memoria
- Scheduler de resúmenes

No necesitas agregar código adicional.
  // ... otros servicios ...
  
  // Inicializar memoria de conversación
  const memoryResult = await conversationMemoryService.init();
  logger.info({ memoryResult }, "Conversation memory service initialized");
  
  // Iniciar scheduler de resumen (opcional, pero recomendado)
  conversationSummarizer.start();
}
```

## 📖 Uso

### Almacenar mensajes

```javascript
import { conversationMemoryService } from "./services/conversationMemoryService.js";

// Agregar un mensaje
await conversationMemoryService.addMessage({
  conversationId: "12345",
  role: "user",
  content: "Hola, quisiera ordenar una rosca de reyes",
  contactId: "whatsapp_5551234567", // Opcional, para vincular facts
  metadata: { channel: "whatsapp" },
});
```

### Obtener contexto para el LLM

```javascript
// Obtiene: mensajes recientes + resúmenes anteriores + facts del contacto
const context = await conversationMemoryService.getContextForLLM("12345", {
  maxMessages: 20,
  contactId: "whatsapp_5551234567",
  currentQuery: "¿Tienen roscas?", // Para búsqueda semántica de facts
});

// context.messages = [{ role, content }, ...]
// context.context = "[CONTEXTO DE CONVERSACIONES ANTERIORES]..."
```

### Guardar facts manualmente

```javascript
await conversationMemoryService.saveFact({
  contactId: "whatsapp_5551234567",
  conversationId: "12345",
  factType: "preference",
  factKey: "producto_favorito",
  factValue: "Rosca de Reyes tradicional",
  confidence: 0.95,
});
```

### Obtener facts relevantes

```javascript
// Todos los facts del contacto
const allFacts = await conversationMemoryService.getRelevantFacts("whatsapp_5551234567");

// Facts relevantes a una query (búsqueda semántica)
const relevantFacts = await conversationMemoryService.getRelevantFacts(
  "whatsapp_5551234567",
  "¿Tiene alergias alimentarias?"
);
```

## 🔄 Migración desde conversationHistoryService

El nuevo servicio mantiene compatibilidad con la API anterior:

```javascript
// ANTES
import { conversationHistoryService } from "./services/conversationHistoryService.js";
conversationHistoryService.addMessage(convId, role, content);
conversationHistoryService.getHistoryForLLM(convId, 20);

// DESPUÉS (misma API)
import { conversationMemoryService } from "./services/conversationMemoryService.js";
conversationMemoryService.addMessage(convId, role, content);
conversationMemoryService.getHistoryForLLM(convId, 20);
```

Para mantener ambos servicios durante la migración:

```javascript
// En tu código que usa el historial
import conversationHistoryService from "./services/conversationHistoryService.js";
import conversationMemoryService from "./services/conversationMemoryService.js";

// Usar el nuevo con fallback al viejo
const historyService = process.env.USE_NEW_MEMORY === "true" 
  ? conversationMemoryService 
  : conversationHistoryService;
```

## 📊 Monitoreo

### Estadísticas del servicio

```javascript
const stats = await conversationMemoryService.getStats();
// {
//   storage: "postgres",
//   total_messages: 15420,
//   unsummarized_messages: 342,
//   unique_conversations: 1250,
//   active_summaries: 890,
//   active_facts: 2100,
//   ...
// }
```

### Estadísticas del summarizer

```javascript
const summarizerStats = await conversationSummarizer.getStats();
// {
//   status: "ok",
//   scheduler: "running",
//   pending: { conversations: 5, messages: 120 },
//   totals: { summaries: 890, summarizedMessages: 12500 },
//   ...
// }
```

### Ejecutar resumen manualmente

```javascript
// Ejecutar un ciclo de resumen ahora
await conversationSummarizer.runCycle();
```

## 🧹 Mantenimiento

### Limpieza de mensajes antiguos

```javascript
// Eliminar mensajes resumidos de más de 30 días
await conversationSummarizer.cleanup(30);
```

### Marcar facts como desactualizados

```javascript
// Si sabes que cierta info cambió
await conversationMemoryService.markFactsStale("whatsapp_5551234567", ["direccion_entrega"]);

// O marcar todos los facts del contacto
await conversationMemoryService.markFactsStale("whatsapp_5551234567");
```

## 🗄️ Tablas de Base de Datos

| Tabla | Descripción |
|-------|-------------|
| `conversation_messages` | Historial completo de mensajes |
| `conversation_summaries` | Resúmenes comprimidos con embeddings |
| `conversation_facts` | Hechos/preferencias a largo plazo |

### conversation_messages
- `conversation_id`: ID de la conversación
- `contact_id`: ID del contacto (vincula entre conversaciones)
- `role`: user/assistant/system
- `content`: Contenido del mensaje
- `summarized`: Si ya fue incluido en un resumen
- `message_timestamp`: Timestamp del mensaje

### conversation_summaries
- `conversation_id`: ID de la conversación
- `summary_text`: Resumen generado por LLM
- `summary_embedding`: Vector para búsqueda semántica
- `messages_start_at` / `messages_end_at`: Rango de tiempo resumido
- `metadata`: Intent, sentimiento, productos, etc.

### conversation_facts
- `contact_id`: ID del contacto
- `fact_type`: preference/personal_info/dietary/occasion/feedback
- `fact_key`: Identificador del fact
- `fact_value`: Valor del fact
- `fact_embedding`: Vector para búsqueda semántica
- `confidence`: Nivel de confianza (0-1)

## 🔧 Configuración Avanzada

### Ajustar el prompt del resumidor

Editar `prompts/conversation_summarizer_system.md` para personalizar:
- Qué incluir/omitir en los resúmenes
- Tipos de facts a extraer
- Niveles de confianza

### Ajustar el schema de salida

Editar `src/schemas/conversation_summary.schema.json` para modificar:
- Tipos de intent permitidos
- Estados de resolución
- Tipos de facts

## ⚠️ Consideraciones

1. **Costos de API**: Cada resumen consume tokens de OpenAI. Ajusta `MEMORY_MIN_MESSAGES_SUMMARY` y `MEMORY_SUMMARIZE_AFTER_MS` según tu volumen.

2. **Espacio en DB**: Los embeddings ocupan ~6KB cada uno. Considera TTLs si tienes muchas conversaciones.

3. **Privacidad**: Los facts pueden contener información sensible. Implementa políticas de retención según tus requerimientos legales.

4. **Fallback**: Si la DB no está disponible, el sistema usa memoria temporal. Los datos se perderán al reiniciar.

## 📁 Archivos del Sistema

```
src/
├── db/
│   └── migrations/
│       └── 003_conversation_memory.sql    # Migración de tablas
├── prompts/
│   └── conversation_summarizer_system.md  # Prompt del resumidor
├── schemas/
│   └── conversation_summary.schema.json   # Schema de output
└── services/
    ├── conversationMemoryService.js       # Servicio principal
    └── conversationSummarizer.js          # Worker de resumen
```
