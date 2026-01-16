# FASE 4: CRECIMIENTO - Tagers KISS API v5.4.0

## 📦 Contenido del Paquete

### Archivos Nuevos (6)
```
src/services/payments.js    - Integración MercadoPago + Stripe
src/services/abTesting.js   - Sistema de A/B Testing
src/services/proactive.js   - Mensajes proactivos automáticos
src/services/analytics.js   - Métricas y conversiones
src/routes/payments.js      - Webhooks y endpoints de pago
src/routes/growth.js        - Admin de A/B, Proactive y Analytics
```

### Archivos Modificados (2)
```
src/server.js               - Integración de nuevas rutas y scheduler
src/flows/orderCreateFlow.js - Integración con pagos y proactive
```

---

## 💳 PAYMENTS SERVICE

### Configuración (Variables de Entorno)
```bash
# Habilitar pagos
PAYMENTS_ENABLED=true

# MercadoPago (recomendado para México)
MP_ACCESS_TOKEN=APP_USR-xxx
MP_PUBLIC_KEY=APP_USR-xxx
MP_WEBHOOK_SECRET=xxx
MP_SANDBOX=false              # true para pruebas

# Stripe (alternativa)
STRIPE_ENABLED=false
STRIPE_SECRET_KEY=sk_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx

# URLs de callback
PAYMENTS_BASE_URL=https://tu-api.railway.app
PAYMENTS_CURRENCY=MXN
PAYMENTS_EXPIRATION_MINUTES=60
```

### Endpoints
```
POST /payments/webhook/mercadopago  - Webhook de MercadoPago
POST /payments/webhook/stripe       - Webhook de Stripe
GET  /payments/config               - Config (requiere admin auth)
POST /payments/create               - Crear link de pago manual
GET  /payments/status/mercadopago/:id
GET  /payments/status/stripe/:id

# Páginas de resultado (redirección del checkout)
GET  /pago/exito
GET  /pago/error
GET  /pago/pendiente
```

### Uso desde Tan•IA
```javascript
import { createPaymentLink, generatePaymentMessage } from "./services/payments.js";

// Cuando el cliente confirma su pedido
const paymentLink = await createPaymentLink({
  id: "ORD-12345",
  amount: 450.00,
  title: "2x Rosca de Reyes Grande",
  customer: {
    name: "Juan Pérez",
    phone: "+5215512345678",
    email: "juan@email.com"
  },
  items: [
    { name: "Rosca Grande", quantity: 2, price: 225 }
  ]
});

// Generar mensaje para el cliente
const message = generatePaymentMessage(paymentLink, order);
// Enviar por Chatwoot
```

---

## 🧪 A/B TESTING SERVICE

### Configuración
```bash
AB_TESTING_ENABLED=true
AB_DEFAULT_SPLIT=0.5         # 50% tráfico a variante B
AB_MIN_SAMPLE_SIZE=100       # Mínimo para significancia
```

### Endpoints
```
GET  /growth/ab/config
GET  /growth/ab/experiments
GET  /growth/ab/experiments/:id
POST /growth/ab/experiments           - Crear experimento
PATCH /growth/ab/experiments/:id      - Actualizar estado
POST /growth/ab/experiments/:id/record - Registrar resultado
```

### Crear Experimento (Ejemplo)
```bash
curl -X POST https://api.railway.app/growth/ab/experiments \
  -H "Authorization: Bearer $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Tono formal vs casual",
    "type": "prompt",
    "description": "Probar si tono formal genera más conversiones",
    "variantA": {
      "systemPrompt": "Eres Tan-IA, asistente virtual de Tagers. Mantén un tono profesional y cortés.",
      "tone": "formal"
    },
    "variantB": {
      "systemPrompt": "¡Hola! Soy Tan-IA 🥐 Tu compa de Tagers. ¿En qué te ayudo?",
      "tone": "casual"
    },
    "trafficSplit": 0.5
  }'
```

### Uso en Código
```javascript
import { getPromptVariant, recordConversion } from "./services/abTesting.js";

// Al iniciar conversación
const variant = await getPromptVariant("exp_abc123", conversationId);
if (variant) {
  systemPrompt = variant.systemPrompt;
}

// Cuando hay conversión (venta, reservación, etc.)
await recordConversion("exp_abc123", conversationId, variant.variant, {
  orderAmount: 450,
  itemCount: 2
});
```

---

## 📣 PROACTIVE MESSAGING SERVICE

### Configuración
```bash
PROACTIVE_ENABLED=true
PROACTIVE_MAX_PER_DAY=3          # Max mensajes por conversación/día
PROACTIVE_MIN_INTERVAL=60        # Minutos entre mensajes
PROACTIVE_QUIET_START=22         # No enviar después de 10pm
PROACTIVE_QUIET_END=8            # No enviar antes de 8am
PROACTIVE_CART_TIMEOUT=30        # Minutos para carrito abandonado
PROACTIVE_FOLLOWUP_HOURS=24      # Horas para seguimiento post-compra
PROACTIVE_REACTIVATION_DAYS=7    # Días para reactivación
```

### Endpoints
```
GET  /growth/proactive/config
GET  /growth/proactive/history/:conversationId
POST /growth/proactive/send        - Enviar mensaje inmediato
POST /growth/proactive/schedule    - Programar mensaje
DELETE /growth/proactive/scheduled/:conversationId
GET  /growth/proactive/can-send/:conversationId
POST /growth/proactive/trigger/:type
```

### Templates Disponibles
- `cart_abandoned` - Carrito abandonado
- `post_purchase` - Seguimiento post-compra
- `order_reminder` - Recordatorio de recogida
- `payment_pending` - Pago pendiente
- `reactivation` - Reactivación de cliente inactivo
- `promotion` - Promoción personalizada

### Triggers Automáticos
```javascript
import { 
  triggerCartAbandoned,
  triggerPostPurchase,
  triggerPaymentPending 
} from "./services/proactive.js";

// Cuando detectamos abandono de carrito
await triggerCartAbandoned(conversationId, contactId, {
  customerName: "Juan",
  items: "2x Rosca Grande"
});

// Después de completar una compra
await triggerPostPurchase(conversationId, contactId, {
  customerName: "Juan",
  orderId: "ORD-12345"
});

// Cuando hay pago pendiente
await triggerPaymentPending(conversationId, contactId, {
  orderId: "ORD-12345",
  paymentLink: "https://..."
});
```

---

## 📊 ANALYTICS SERVICE

### Configuración
```bash
ANALYTICS_ENABLED=true
ANALYTICS_RETENTION_DAYS=90    # Retención de eventos
```

### Tipos de Eventos
```javascript
EVENT_TYPES = {
  // Conversaciones
  CONVERSATION_STARTED, CONVERSATION_ENDED, MESSAGE_RECEIVED, MESSAGE_SENT,
  
  // Flujos de pedidos
  ORDER_FLOW_STARTED, ORDER_FLOW_STEP, ORDER_FLOW_COMPLETED, ORDER_FLOW_ABANDONED,
  
  // Pagos
  PAYMENT_LINK_CREATED, PAYMENT_COMPLETED, PAYMENT_FAILED,
  
  // Handoffs
  HANDOFF_REQUESTED, HANDOFF_COMPLETED,
  
  // Proactive
  PROACTIVE_SENT, PROACTIVE_RESPONDED,
  
  // A/B Testing
  AB_VARIANT_ASSIGNED, AB_CONVERSION,
  
  // Feedback
  FEEDBACK_POSITIVE, FEEDBACK_NEGATIVE,
  
  // Errores
  AI_ERROR, SYSTEM_ERROR,
}
```

### Endpoints
```
GET  /growth/analytics/config
GET  /growth/analytics/events?startDate=&endDate=&channel=
GET  /growth/analytics/orders?startDate=&endDate=&channel=
GET  /growth/analytics/payments?startDate=&endDate=
GET  /growth/analytics/daily?startDate=&endDate=&metrics=
POST /growth/analytics/track    - Trackear evento manual
POST /growth/analytics/cleanup  - Limpiar eventos antiguos
```

### Uso en Código
```javascript
import { analyticsService } from "./services/analytics.js";

// Trackear inicio de conversación
await analyticsService.trackConversationStarted(conversationId, "whatsapp", contactId);

// Trackear flujo de pedido
await analyticsService.trackOrderFlowStarted(conversationId, "whatsapp");
await analyticsService.trackOrderFlowStep(conversationId, "ASK_BRANCH", { product: "Rosca Grande" });
await analyticsService.trackOrderFlowCompleted(conversationId, { orderId, amount: 450 });

// Trackear pago
await analyticsService.trackPaymentLinkCreated(conversationId, { provider: "mercadopago", amount: 450 });
await analyticsService.trackPaymentCompleted(conversationId, { provider: "mercadopago", amount: 450, paymentId });

// Trackear conversión A/B
await analyticsService.trackABConversion(conversationId, experimentId, "b", { orderAmount: 450 });

// Obtener resumen de dashboard
const summary = await analyticsService.getDashboardSummary(7); // últimos 7 días
```

### Dashboard Response Example
```json
{
  "period": { "start": "2025-01-01", "end": "2025-01-08", "days": 7 },
  "conversations": { "started": 150, "messages": 1200 },
  "orders": {
    "started": 45,
    "completed": 32,
    "abandoned": 10,
    "conversionRate": "71.11",
    "abandonmentRate": "22.22"
  },
  "payments": {
    "linksCreated": 32,
    "paymentsCompleted": 28,
    "totalRevenue": 12600,
    "conversionRate": "87.50"
  },
  "handoffs": { "requested": 8, "completed": 6 },
  "proactive": { "sent": 25, "responded": 12 },
  "feedback": { "positive": 20, "negative": 2 },
  "errors": { "ai": 3, "system": 1 }
}
```

---

## 🔄 INTEGRACIÓN CON FLUJO DE PEDIDOS

El archivo `orderCreateFlow.js` ahora incluye:

### Generación automática de link de pago
Cuando el cliente confirma su pedido:
- Se calcula el total (producto × cantidad)
- Se genera link de MercadoPago/Stripe
- Se envía mensaje con link al cliente
- Se programa recordatorio de pago pendiente (30 min)

### Carrito abandonado
Cuando el cliente está en medio del flujo:
- Se programa mensaje proactivo de carrito abandonado
- Si el cliente responde, se cancela el mensaje programado
- Timeout configurable (default: 30 min)

### Cancelación automática
Los mensajes proactivos programados se cancelan automáticamente cuando:
- El cliente responde al chat
- El cliente completa el checkout
- El cliente cancela el pedido

---

## 🚀 Instalación

### 1. Copiar Archivos
Copiar todos los archivos del ZIP a sus ubicaciones correspondientes.

### 2. Instalar Dependencias (Opcional)
```bash
# Solo si vas a usar MercadoPago
npm install mercadopago

# Solo si vas a usar Stripe
npm install stripe
```

### 3. Configurar Variables de Entorno
Agregar en Railway las variables según la sección de cada servicio.

### 4. Deploy
```bash
git add .
git commit -m "feat: add Phase 4 - Payments, A/B Testing, Proactive Messaging, Analytics"
git push origin main
```

---

## 📋 Dependencias Opcionales

| Paquete | Versión | Uso |
|---------|---------|-----|
| mercadopago | ^2.x | Pagos con MercadoPago |
| stripe | ^14.x | Pagos con Stripe |

**Nota:** Los paquetes se importan dinámicamente, no fallarán si no están instalados.

---

## ⚠️ Notas Importantes

1. **Webhooks de Pago**: Configurar URLs en dashboards de MercadoPago/Stripe
   - MercadoPago: `https://tu-api.railway.app/payments/webhook/mercadopago`
   - Stripe: `https://tu-api.railway.app/payments/webhook/stripe`

2. **Horarios Silenciosos**: Proactive no envía mensajes entre 10pm-8am

3. **Límites Anti-Spam**: Max 3 mensajes proactivos por conversación por día

4. **A/B Testing**: Los experimentos usan hash del conversationId para asignación consistente

5. **Tablas de BD**: Se crean automáticamente al iniciar:
   - `ab_experiments`
   - `ab_results`
   - `proactive_messages`
   - `proactive_scheduled`
   - `analytics_events`
   - `analytics_metrics_daily`

---

## 📈 Siguiente Fase (Opcional)

- [ ] Multi-idioma para turistas
- [ ] Integración con Google Analytics
- [ ] Reportes automáticos por email
- [ ] Predicción de demanda con ML
