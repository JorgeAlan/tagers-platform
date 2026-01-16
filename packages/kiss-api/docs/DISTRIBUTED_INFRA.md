# Infraestructura Distribuida - Rate Limiting + DLQ

## Resumen

Esta actualización implementa dos mejoras críticas de infraestructura para escalar horizontalmente:

1. **Rate Limiting Distribuido**: Control de tráfico usando Redis en lugar de Map() en memoria
2. **Dead Letter Queue (DLQ)**: Cola de mensajes muertos para jobs que fallan permanentemente

---

## 1. Rate Limiting Distribuido

### Problema Anterior
```javascript
// ❌ ANTES: Mapas en memoria
const recentMessages = new Map();  // Se pierde al reiniciar
const messageRates = new Map();    // No funciona con múltiples réplicas
```

Si desplegabas 2+ instancias en Railway, cada una tenía su propio mapa en memoria. Un usuario podía enviar 10 mensajes a la instancia A y otros 10 a la instancia B, evadiendo el límite de 10 por minuto.

### Solución Implementada

El nuevo módulo `src/core/distributedRateLimiter.js` usa Redis con scripts Lua para operaciones atómicas:

```javascript
// ✅ AHORA: Redis distribuido
const result = await checkRateLimit(conversationId);
// { allowed: true, count: 5, limit: 10, remaining: 5, source: "redis" }

const dedupe = await checkDuplicate(conversationId, messageText);
// { isDuplicate: false, hash: "abc123", source: "redis" }
```

### Características

- **Sliding Window**: Rate limit con ventana deslizante de 1 minuto
- **Operaciones Atómicas**: Scripts Lua garantizan consistencia
- **Fallback Automático**: Si Redis falla, usa memoria local (fail-open)
- **TTL Automático**: Las keys expiran automáticamente

### Configuración

```env
# Variables de entorno opcionales
GOVERNOR_MAX_MESSAGES_PER_MINUTE=10  # Default: 10
GOVERNOR_DEDUPE_WINDOW_MS=5000       # Default: 5000 (5 segundos)
GOVERNOR_RATE_LIMIT_ENABLED=true     # Default: true
GOVERNOR_DEDUPE_ENABLED=true         # Default: true
```

### Keys en Redis

```
tania:rate:{conversationId}   -> { count, windowStart }
tania:dedupe:{conversationId} -> { hash, timestamp }
```

---

## 2. Dead Letter Queue (DLQ)

### Problema Anterior
Si un mensaje fallaba N veces (ej: OpenAI caído), se perdía completamente:

```javascript
// ❌ ANTES: Job desaparece después de 3 intentos
removeOnFail: { age: 24 * 3600, count: 5000 }
```

### Solución Implementada

El nuevo módulo `src/core/dlqProcessor.js` captura jobs que fallan permanentemente:

```javascript
// ✅ AHORA: Jobs fallidos van a la DLQ
worker.on("failed", async (job, err) => {
  if (job.attemptsMade >= MAX_RETRIES) {
    await moveToDeadLetter(job, err);
  }
});
```

### Flujo de un Job Fallido

```
┌─────────────────────────────────────────────────────────────────┐
│                        BullMQ Queue                              │
│  ┌─────────┐     ┌─────────┐     ┌─────────┐                    │
│  │ Intento │ ──► │ Intento │ ──► │ Intento │                    │
│  │    1    │     │    2    │     │    3    │                    │
│  └────┬────┘     └────┬────┘     └────┬────┘                    │
│       │               │               │                          │
│       ▼               ▼               ▼                          │
│    [FAIL]          [FAIL]          [FAIL]                        │
│       │               │               │                          │
│       └── retry ──────┴── retry ──────┘                          │
│                                       │                          │
│                           [PERMANENT FAIL]                       │
│                                       │                          │
└───────────────────────────────────────┼──────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                     Dead Letter Queue                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Job ID: dlq_job_123_1704672000000                       │   │
│  │  Original Job: process-message                           │   │
│  │  Conversation: 12345                                     │   │
│  │  Failed At: 2025-01-08T12:00:00Z                        │   │
│  │  Reason: OpenAI API timeout                             │   │
│  │  Attempts: 3                                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### API de Administración

```bash
# Ver jobs en la DLQ
GET /admin/dlq
GET /admin/dlq/stats

# Reintentar un job específico
POST /admin/dlq/retry/:jobId

# Reintentar todos los jobs
POST /admin/dlq/retry-all

# Descartar un job
DELETE /admin/dlq/:jobId

# Limpiar toda la DLQ (requiere confirmación)
DELETE /admin/dlq
Body: { "confirm": "DELETE_ALL_DLQ_JOBS" }
```

### Configuración

```env
# Variables de entorno opcionales
DLQ_NAME=tania-dlq              # Nombre de la cola DLQ
DLQ_ALERT_THRESHOLD=10          # Alertar cuando haya N+ jobs
DLQ_CHECK_INTERVAL_MS=300000    # Intervalo de chequeo (5 min)
QUEUE_MAX_RETRIES=3             # Intentos antes de mover a DLQ
QUEUE_RETRY_DELAY_MS=1000       # Delay inicial para backoff
```

### Alertas

El sistema genera logs de advertencia cuando la DLQ supera el umbral:

```
⚠️ DLQ ALERT: Dead Letter Queue has exceeded threshold!
{ dlqCount: 15, threshold: 10 }
```

---

## Endpoints de Estadísticas

### GET /admin/stats
Ahora incluye estadísticas de DLQ:

```json
{
  "ok": true,
  "redis": true,
  "queue": {
    "waiting": 5,
    "active": 2,
    "completed": 1000,
    "failed": 10,
    "dlq": {
      "available": true,
      "counts": {
        "waiting": 3,
        "total": 3
      },
      "alertThreshold": 10,
      "isAboveThreshold": false
    }
  }
}
```

### GET /admin/governor/stats
Nuevas estadísticas del rate limiter distribuido:

```json
{
  "ok": true,
  "config": {
    "serviceHoursEnabled": false,
    "rateLimitEnabled": true,
    "dedupeEnabled": true
  },
  "rateLimiter": {
    "redisAvailable": true,
    "memoryFallback": {
      "ratesCount": 0,
      "dedupesCount": 0
    },
    "config": {
      "maxRequestsPerMinute": 10,
      "dedupeWindowMs": 5000
    },
    "redis": {
      "activeRateLimitKeys": 45,
      "activeDedupeKeys": 30
    }
  }
}
```

---

## Testing

```bash
# Ejecutar pruebas de infraestructura distribuida
node scripts/test_distributed_infra.mjs
```

Este script prueba:
- Rate limiting: límites se aplican correctamente
- Deduplicación: mensajes duplicados se detectan
- DLQ: jobs fallidos se almacenan correctamente
- Governor: estadísticas se generan correctamente

---

## Archivos Modificados/Creados

### Nuevos
- `src/core/distributedRateLimiter.js` - Rate limiting y deduplicación con Redis
- `src/core/dlqProcessor.js` - Gestión de Dead Letter Queue
- `scripts/test_distributed_infra.mjs` - Script de pruebas
- `docs/DISTRIBUTED_INFRA.md` - Esta documentación

### Modificados
- `src/core/governor.js` - Usa distributedRateLimiter en lugar de Map()
- `src/core/queue.js` - Integra DLQ cuando jobs fallan permanentemente
- `src/core/index.js` - Exporta nuevos módulos
- `src/routes/admin.js` - Nuevos endpoints para DLQ y Governor stats

---

## Consideraciones de Producción

### Escalado Horizontal
Ahora puedes escalar a múltiples réplicas en Railway sin preocuparte por:
- Rate limiting inconsistente entre réplicas
- Deduplicación fallando entre réplicas
- Jobs perdidos cuando fallan permanentemente

### Monitoreo Recomendado
1. **DLQ Count**: Alertar si supera el umbral
2. **Redis Connectivity**: Monitorear fallbacks a memoria
3. **Rate Limit Hits**: Detectar posibles ataques o bugs

### Mantenimiento de DLQ
- Revisar DLQ regularmente vía `/admin/dlq`
- Reintentar jobs después de resolver problemas (ej: OpenAI volvió)
- Descartar jobs irrecuperables para evitar acumulación
