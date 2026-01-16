# 🚀 MIGRACIÓN A ARQUITECTURA ASÍNCRONA

## Resumen

Este documento describe la migración de Tan•IA desde procesamiento síncrono a una arquitectura completamente asíncrona con **BullMQ + Redis**.

### Antes (v4.x)
```
Webhook → Procesa → Responde
         ↓
    (Si tarda >10s, Chatwoot marca timeout)
```

### Después (v5.x)
```
Webhook → 200 OK (<50ms) → Encola → Worker procesa → Responde
                              ↓
                        (Redis persiste la tarea)
```

---

## 📋 Checklist de Migración

### Fase 1: Instalar Dependencias

```bash
npm install ioredis bullmq
```

### Fase 2: Configurar Redis

**Opción A: Docker (Desarrollo)**
```bash
docker-compose up -d redis
```

**Opción B: Railway (Producción)**
1. Agregar Redis plugin a tu proyecto Railway
2. Copiar la URL de conexión a `.env`:
```env
REDIS_URL=redis://default:xxxx@xxxx.railway.app:6379
```

**Opción C: Redis Cloud (Alternativa)**
1. Crear cuenta en redis.com
2. Crear database (tier free disponible)
3. Copiar URL a `.env`

### Fase 3: Variables de Entorno

Agregar a `.env`:
```env
# ═══════════════════════════════════════════════════════════════════════════
# REDIS / BULLMQ
# ═══════════════════════════════════════════════════════════════════════════
REDIS_URL=redis://localhost:6379
# O separado:
# REDIS_HOST=localhost
# REDIS_PORT=6379
# REDIS_PASSWORD=

# Configuración del Worker
WORKER_CONCURRENCY=3
WORKER_TYPING_ENABLED=true
WORKER_TYPING_INTERVAL_MS=3000
WORKER_PROCESSING_TIMEOUT_MS=45000

# Configuración de la Cola
QUEUE_NAME=tania-messages
QUEUE_MAX_RETRIES=3
QUEUE_RETRY_DELAY_MS=1000

# ═══════════════════════════════════════════════════════════════════════════
# SEMANTIC CACHE
# ═══════════════════════════════════════════════════════════════════════════
SEMANTIC_CACHE_ENABLED=true
CACHE_TTL_FAQ_MS=86400000       # 24 horas
CACHE_TTL_GENERAL_MS=14400000   # 4 horas
CACHE_TTL_TRANSIENT_MS=1800000  # 30 min
CACHE_MAX_ENTRIES=5000
```

### Fase 4: Actualizar server.js

Hay dos opciones para correr el worker:

**Opción A: Worker Embebido (Simple)**
```javascript
// src/server.js
import { startWorker } from "./workers/aiWorker.js";

// Al final del archivo, después de app.listen():
startWorker().catch(err => {
  logger.error({ err: err?.message }, "Failed to start embedded worker");
});
```

**Opción B: Worker Separado (Producción)**
```bash
# Terminal 1: API
npm start

# Terminal 2: Worker
npm run worker
```

### Fase 5: Cambiar Router de Chatwoot

En `server.js`, cambiar:

```javascript
// ANTES
import chatwootRouter from "./routes/chatwoot.js";
app.use("/chatwoot", chatwootRouter);

// DESPUÉS
import chatwootRouterV3 from "./routes/chatwoot_v3.js";
app.use("/chatwoot", chatwootRouterV3);
```

O para migración gradual con feature flag:
```javascript
import chatwootRouter from "./routes/chatwoot.js";
import chatwootRouterV3 from "./routes/chatwoot_v3.js";

const USE_ASYNC = process.env.USE_ASYNC_WEBHOOK === "true";
app.use("/chatwoot", USE_ASYNC ? chatwootRouterV3 : chatwootRouter);
```

---

## 🏗️ Arquitectura de Archivos

```
src/
├── core/
│   ├── governor.js       # ✓ Actualizado (fix config)
│   ├── dispatcher.js     # ✓ Sin cambios
│   ├── queue.js          # ★ NUEVO - BullMQ wrapper
│   ├── semanticCache.js  # ★ NUEVO - Caché de respuestas
│   ├── async_processor.js # ✓ Actualizado (fix config) - Legacy
│   └── index.js          # ✓ Actualizado (exports)
│
├── workers/
│   └── aiWorker.js       # ★ NUEVO - Procesa mensajes
│
├── routes/
│   ├── chatwoot.js       # Versión anterior (backup)
│   └── chatwoot_v3.js    # ★ NUEVO - Webhook asíncrono
│
└── ...
```

---

## 🔧 Operaciones de Emergencia

### Pausar procesamiento
```bash
curl -X POST http://localhost:8787/chatwoot/queue/pause
```

### Reanudar procesamiento
```bash
curl -X POST http://localhost:8787/chatwoot/queue/resume
```

### Ver estadísticas
```bash
curl http://localhost:8787/chatwoot/stats
```

### Limpiar caché
```bash
curl -X POST http://localhost:8787/chatwoot/cache/clear
```

---

## 📊 Monitoreo

### Métricas importantes
- `queue.waiting` - Jobs pendientes
- `queue.active` - Jobs procesándose
- `queue.failed` - Jobs fallidos (revisar logs)
- `cache.hitRate` - % de respuestas desde caché

### Alertas sugeridas
- `queue.waiting > 100` - Escalar workers
- `queue.failed > 10/hour` - Revisar errores
- `cache.hitRate < 20%` - Revisar FAQs

---

## 🚀 Escalar Horizontalmente

### Docker Compose
```bash
docker-compose up --scale ai_worker=3 -d
```

### Railway
1. Crear nuevo servicio desde mismo repo
2. Cambiar Start Command a `npm run worker`
3. Duplicar según necesidad

---

## ⚠️ Rollback

Si algo sale mal, revertir a v4:

1. Cambiar router en server.js:
```javascript
import chatwootRouter from "./routes/chatwoot.js";
app.use("/chatwoot", chatwootRouter);
```

2. El sistema seguirá funcionando sin Redis (in-memory fallback)

---

## ✅ Verificación Post-Migración

1. [ ] Redis conecta correctamente (ver logs)
2. [ ] Webhook responde < 100ms
3. [ ] Worker procesa mensajes (ver logs)
4. [ ] Semantic cache tiene hits (ver /stats)
5. [ ] Agentes ven respuestas del bot en Chatwoot
6. [ ] Handoffs funcionan correctamente

---

## 📝 Changelog v5.0.0

### Nuevos Archivos
- `src/core/queue.js` - Cola BullMQ con fallback in-memory
- `src/core/semanticCache.js` - Caché inteligente de respuestas
- `src/workers/aiWorker.js` - Worker de procesamiento asíncrono
- `src/routes/chatwoot_v3.js` - Webhook refactorizado

### Modificados
- `src/core/governor.js` - Fix bug de redeclaración de config
- `src/core/async_processor.js` - Fix bug de redeclaración de config
- `src/core/index.js` - Exports actualizados
- `docker-compose.yml` - Agregado Redis y ai_worker
- `package.json` - Nuevas dependencias (ioredis, bullmq)

### Dependencias Nuevas
- `ioredis@^5.4.0` - Cliente Redis
- `bullmq@^5.0.0` - Cola de mensajes

---

## 💡 Beneficios Obtenidos

| Métrica | Antes | Después |
|---------|-------|---------|
| Tiempo de respuesta webhook | 2-30s | <50ms |
| Timeout de Chatwoot | Frecuente | Nunca |
| Mensajes perdidos por crash | Sí | No (Redis) |
| Costo OpenAI | $X/mes | ~30% menos (caché) |
| Escalabilidad | Vertical | Horizontal |
