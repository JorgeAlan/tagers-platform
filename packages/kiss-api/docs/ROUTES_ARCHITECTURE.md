# 📍 Arquitectura de Rutas - TAGERS KISS API

## 📁 Archivo Principal del Webhook

**El servidor usa `chatwoot.js`**

```
src/server.js:
  import chatwootRouter from "./routes/chatwoot.js";
  app.use("/chatwoot", chatwootRouter);
```

## 📁 Archivos de Rutas

| Archivo | Montado en | Descripción |
|---------|------------|-------------|
| `chatwoot.js` | `/chatwoot` | Webhook async con BullMQ |
| `health.js` | `/health` | Health checks |
| `hitl.js` | `/hitl` | Human-in-the-loop |
| `ingest.js` | `/kiss/ingest` | Ingest instrucciones |
| `instructions.js` | `/kiss/instructions` | Listar instrucciones |
| `metrics.js` | `/metrics` | Métricas Prometheus |
| `recommendations.js` | `/system/recommendations` | Auto-recomendaciones |
| `config-hub/routes.js` | `/internal/config` | Config Hub |

## 📋 Endpoints del Webhook (chatwoot.js)

```
POST /chatwoot/webhook       ← Recibe mensajes de Chatwoot
GET  /chatwoot/health        ← Health check
GET  /chatwoot/stats         ← Estadísticas de cola
POST /chatwoot/cache/clear   ← Limpiar caché semántico
POST /chatwoot/queue/pause   ← Pausar procesamiento
POST /chatwoot/queue/resume  ← Reanudar procesamiento
```

## 🏗️ Arquitectura del Webhook

```
Cliente → POST /chatwoot/webhook
           ↓
       1. Validar token
           ↓
       2. Responder 200 OK (<50ms)
           ↓
       3. processWebhookAsync() [Fire & Forget]
           ↓
       4. Governor: ¿Procesar?
           ↓
       5. Dispatcher: ¿Cómo procesar?
           ↓
       6. aiQueue.add() → BullMQ
           ↓
       7. AI Worker → Respuesta → Chatwoot
```
