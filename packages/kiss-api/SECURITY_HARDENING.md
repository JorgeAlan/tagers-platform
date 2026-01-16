# 🔒 SECURITY & INFRASTRUCTURE HARDENING

## Cambios Implementados (2026-01-15)

Este documento describe los cambios de seguridad y mejoras de infraestructura implementados.

---

## 1. Endpoints Health Protegidos ✅

**Problema:** Endpoints de health hacían llamadas a OpenAI sin autenticación, exponiendo costos y datos internos.

**Solución:** Se agregó `adminAuthMiddleware` a todos los endpoints sensibles:

| Endpoint | Riesgo | Acción |
|----------|--------|--------|
| `/health/vector/search` | Genera embeddings (costo OpenAI) | ✅ Protegido |
| `/health/models` | Expone configuración | ✅ Protegido |
| `/health/models/:role` | Expone configuración | ✅ Protegido |
| `/health/models/knowledge/all` | Expone conocimiento interno | ✅ Protegido |
| `/health/models/probe/:model` | Llama a OpenAI (costo) | ✅ Protegido |
| `/health/models/sync` | Modifica DB | ✅ Protegido |
| `/health/models/reset` | Modifica estado | ✅ Protegido |

**Uso:**
```bash
# Ahora requiere autenticación
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" https://api.tagers.mx/health/models
```

---

## 2. Bug de Channel Corregido ✅

**Problema:** Precedencia de operadores incorrecta en `aiWorker.js`:
```javascript
// ANTES (incorrecto)
channel: governorContext?.channelType || inboxName?.includes("whatsapp") ? "whatsapp" : ...
// Se evaluaba como: (channelType || includes()) ? "whatsapp" : ...
```

**Solución:**
```javascript
// DESPUÉS (correcto)
const insightsChannel = governorContext?.channelType || (
  inboxName?.toLowerCase()?.includes("whatsapp") ? "whatsapp" : 
  inboxName?.toLowerCase()?.includes("instagram") ? "instagram" : 
  inboxName?.toLowerCase()?.includes("facebook") ? "facebook" : "web"
);
```

**Impacto:** Analytics ahora reporta el canal correcto (whatsapp/instagram/facebook/web).

---

## 3. Stripe Webhook Corregido ✅

**Problema:** La verificación de firma de Stripe fallaba porque se usaba `JSON.stringify(body)` en lugar del raw body exacto.

**Solución:**
- Webhook ahora usa `req.rawBody` (capturado en `server.js` via express.json verify callback)
- Si no hay `STRIPE_WEBHOOK_SECRET` configurado, se loguea advertencia
- Si hay secret pero no hay signature, se rechaza el webhook (fail-closed)

**Configuración requerida:**
```env
STRIPE_WEBHOOK_SECRET=whsec_xxxx  # Requerido en producción
```

---

## 4. RUN_MODE para Control de Worker ✅

**Problema:** El worker embebido siempre se iniciaba, causando duplicación si también se corría el worker separado.

**Solución:** Nueva variable de entorno `RUN_MODE`:

| Valor | Comportamiento |
|-------|----------------|
| `both` (default) | Inicia servidor HTTP + worker embebido |
| `web` | Solo servidor HTTP (para escalar horizontalmente) |
| `worker` | Solo worker (para proceso separado) |

**Ejemplo de uso:**
```bash
# Proceso web (Railway web service)
RUN_MODE=web node src/server.js

# Proceso worker (Railway worker service)
RUN_MODE=worker node src/workers/aiWorker.js
```

---

## 5. Logger con Redacción de PII ✅

**Problema:** Logger era un stub que exponía PII (teléfonos, emails, tokens) en logs.

**Solución:** Logger completo con:
- Redacción automática de campos sensibles
- Patrones regex para detectar y censurar PII
- Formato JSON estructurado en producción
- Pretty print en desarrollo
- Correlación con trace IDs de OpenTelemetry

**Campos redactados automáticamente:**
- `phone`, `phone_number`, `phoneNumber`, `telefono`
- `email`, `email_address`, `emailAddress`, `correo`
- `apiKey`, `api_key`, `accessToken`, `access_token`
- `password`, `secret`, `Authorization`, `rawBody`
- `X-Admin-Token`, `stripe-signature`

**Configuración:**
```env
LOG_LEVEL=info     # trace|debug|info|warn|error|fatal
NODE_ENV=production  # Activa formato JSON
```

---

## Variables de Entorno Nuevas/Modificadas

```env
# ═══════════════════════════════════════════════════════════════
# SECURITY
# ═══════════════════════════════════════════════════════════════
ADMIN_API_TOKEN=your-secure-token-here  # REQUERIDO en producción

# ═══════════════════════════════════════════════════════════════
# STRIPE (si usas pagos con Stripe)
# ═══════════════════════════════════════════════════════════════
STRIPE_WEBHOOK_SECRET=whsec_xxxx  # REQUERIDO para verificar webhooks

# ═══════════════════════════════════════════════════════════════
# INFRASTRUCTURE
# ═══════════════════════════════════════════════════════════════
RUN_MODE=both  # web|worker|both

# ═══════════════════════════════════════════════════════════════
# LOGGING
# ═══════════════════════════════════════════════════════════════
LOG_LEVEL=info  # trace|debug|info|warn|error|fatal
```

---

## Checklist de Deploy

- [ ] Configurar `ADMIN_API_TOKEN` con token seguro (32+ caracteres)
- [ ] Configurar `STRIPE_WEBHOOK_SECRET` si usas Stripe
- [ ] Decidir `RUN_MODE` según arquitectura de deploy
- [ ] Verificar que logs no exponen PII con `LOG_LEVEL=debug` temporal
- [ ] Probar endpoints protegidos con y sin token

---

## Testing

```bash
# Test 1: Endpoint protegido sin token (debe fallar con 401)
curl https://api.tagers.mx/health/models
# Expected: {"ok":false,"error":"MISSING_ADMIN_TOKEN",...}

# Test 2: Endpoint protegido con token (debe funcionar)
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" https://api.tagers.mx/health/models
# Expected: {"ok":true,"roles_count":...}

# Test 3: Verificar redacción de logs
LOG_LEVEL=debug node -e "
const {logger} = await import('./src/utils/logger.js');
logger.info({phone: '5512345678', email: 'test@test.com'}, 'Test');
"
# Expected: phone y email redactados en output
```

---

## Siguientes Pasos Recomendados

1. **Sprint 1 (1-2 semanas):**
   - Eliminar código legacy (`controllers/webhookController.js`, `aiOrchestrator.js`)
   - Unificar memoria/historial entre worker y agentic_flow_optimized
   - Agregar tests de contrato para Chatwoot payload

2. **Sprint 2 (2-6 semanas):**
   - Implementar verificación de firma de MercadoPago
   - Unificar semantic cache (in-memory + pgvector)
   - ESLint + Prettier + reglas de precedencia
