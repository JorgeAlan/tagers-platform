# 🛡️ Resilience Module - Production-Grade Lite

## Qué es

Módulo de resiliencia optimizado para tu arquitectura Railway + Postgres.

### Incluye
- **p-queue**: Control de concurrencia (evita crashes por picos de tráfico)
- **Graceful Shutdown**: Apagado elegante (deploys sin ghosting)

### No Incluye (innecesario)
- ~~SQLite~~: Ya tienes Postgres para persistencia

---

## Instalación

```bash
npm install p-queue
```

Eso es todo. El módulo ya está integrado en `server.js`.

---

## Variables de Entorno (Opcionales)

```env
# Control de concurrencia (default: 3)
LOCAL_QUEUE_CONCURRENCY=3

# Timeout por tarea en ms (default: 60000)
LOCAL_QUEUE_TIMEOUT_MS=60000

# Máximo de tareas en cola (default: 100)
LOCAL_QUEUE_MAX_SIZE=100

# Timeout de shutdown en ms (default: 10000)
SHUTDOWN_TIMEOUT_MS=10000
```

---

## Verificación

### Al arrancar el servidor

```
═══════════════════════════════════════════════════════════════════
  🥐 TAGERS KISS PRODUCTION API - v5.1.0 Resilient
═══════════════════════════════════════════════════════════════════
  ✓ Server listening on :3000
  ✓ Environment: production

  RESILIENCE:
  ├─ Queue concurrency: 3
  └─ Shutdown handlers: localQueue, bullmq, http
═══════════════════════════════════════════════════════════════════
```

### Endpoint de diagnóstico

```bash
curl http://localhost:3000/health/resilience
```

Respuesta:
```json
{
  "initialized": true,
  "queue": {
    "pending": 0,
    "active": 2,
    "concurrency": 3,
    "successRate": "98.5%"
  },
  "shutdownHandlers": [
    { "name": "localQueue", "priority": 10 },
    { "name": "bullmq", "priority": 8 },
    { "name": "http", "priority": 1 }
  ]
}
```

### Al hacer Ctrl+C o deploy

```
🛑 Initiating graceful shutdown...
  ├─ Closing: localQueue
  │  ✓ localQueue (234ms)
  ├─ Closing: bullmq
  │  ✓ bullmq (45ms)
  ├─ Closing: http
  │  ✓ http (102ms)
  └─ ✅ Graceful shutdown complete
```

---

## Cómo funciona

### p-queue (Control de Tráfico)

```
SIN p-queue:
  20 usuarios → 20 llamadas OpenAI → RAM explota → CRASH 💥

CON p-queue:
  20 usuarios → Cola ordena → 3 procesan a la vez → Estable ✓
```

El control se aplica automáticamente cuando Redis no está disponible.

### Graceful Shutdown

```
SIN graceful shutdown:
  Deploy → Proceso muere → Usuario queda esperando → Ghosting 👻

CON graceful shutdown:
  Deploy → SIGTERM → Termina tareas activas → Usuario recibe respuesta → Cierra limpio ✓
```

Railway envía SIGTERM y da ~10 segundos antes de forzar el cierre.

---

## Arquitectura

```
┌─────────────────────────────────────────────────────────────┐
│                    Webhook de Chatwoot                       │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                      queue.js                                │
│  ┌─────────────────┐     ┌─────────────────┐                │
│  │    BullMQ       │ OR  │    p-queue      │                │
│  │  (con Redis)    │     │  (sin Redis)    │                │
│  └─────────────────┘     └─────────────────┘                │
│         │                        │                          │
│         └────────────┬───────────┘                          │
│                      │                                      │
│                      ▼                                      │
│              aiWorker.js                                    │
│        (procesa mensajes)                                   │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Postgres                                 │
│               (flowStateService)                             │
│          Persistencia de sesiones                            │
└─────────────────────────────────────────────────────────────┘
```

---

## Checklist Final

| Verificación | Cómo verificar |
|--------------|----------------|
| p-queue instalado | `npm ls p-queue` |
| Logs de resiliencia | Buscar `[RESILIENCE]` al arrancar |
| Endpoint funciona | `curl /health/resilience` |
| Shutdown graceful | Hacer Ctrl+C y ver logs |
| Deploy sin ghosting | Deploy en Railway y verificar |

---

## Solución de Problemas

### "Cannot find module 'p-queue'"
```bash
npm install p-queue
```

### "Queue is at capacity"
Demasiado tráfico. Opciones:
1. Aumentar `LOCAL_QUEUE_MAX_SIZE` 
2. Reducir `LOCAL_QUEUE_CONCURRENCY` (procesa más lento pero más estable)

### Shutdown se fuerza
El timeout es muy corto. Aumentar `SHUTDOWN_TIMEOUT_MS=15000`
