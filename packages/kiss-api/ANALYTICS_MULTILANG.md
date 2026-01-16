# Fase 4.1 - Analytics Tracking + Multi-idioma

## Resumen de Cambios

### 1. Analytics Tracking Completo

Se conectó el servicio de analytics a todos los puntos del flujo:

#### Eventos trackeados:

| Punto | Evento | Datos |
|-------|--------|-------|
| Saludo inicial | `conversation_started` | canal, contactId |
| Inicio flujo pedido | `order_flow_started` | canal |
| Cada paso del flujo | `order_flow_step` | step, producto, sucursal |
| Pedido confirmado | `order_completed` | producto, sucursal, cantidad, monto |
| Cancelación/abandono | `order_flow_abandoned` | step, razón |
| Handoff solicitado | `handoff_requested` | razón |
| Error de AI | `error` | tipo, mensaje |
| Link de pago creado | `payment_link_created` | orderId, provider, monto |
| Pago completado | `payment_completed` | orderId, provider |

#### Archivos modificados:
- `src/workers/aiWorker.js` - Tracking en dispatcher
- `src/routes/payments.js` - Tracking de pagos
- `src/flows/orderCreateFlow.js` - Tracking de flujo de pedidos

---

### 2. Multi-idioma para Turistas

#### Idiomas soportados:
- 🇲🇽 Español (es) - default
- 🇺🇸 Inglés (en)
- 🇫🇷 Francés (fr)
- 🇩🇪 Alemán (de)
- 🇧🇷 Portugués (pt)

#### Cómo funciona:

1. **Detección automática**: Analiza patrones del primer mensaje del cliente
2. **Cache por conversación**: Una vez detectado, se mantiene durante toda la conversación
3. **Traducciones pre-definidas**: Mensajes comunes ya traducidos
4. **Traducción con AI** (opcional): Para respuestas dinámicas

#### Variables de entorno:

```bash
MULTILANG_ENABLED=true          # Habilitar/deshabilitar
MULTILANG_DEFAULT=es            # Idioma por defecto
MULTILANG_AI_DETECTION=false    # Usar AI para detectar (más costoso)
```

#### Mensajes traducidos:

- `greeting` - Saludo inicial
- `goodbye` - Despedida
- `orderConfirm` - Confirmación de pedido
- `askProduct` - Pregunta de producto
- `askBranch` - Pregunta de sucursal
- `askDate` - Pregunta de fecha
- `askQuantity` - Pregunta de cantidad
- `orderConfirmed` - Pedido confirmado
- `paymentSuccess` - Pago exitoso
- `error` - Error genérico
- `connectHuman` - Transferir a humano
- `hoursInfo` - Información de horarios
- `locationInfo` - Información de ubicación
- `cancelled` - Pedido cancelado
- `orderSummary` - Resumen del pedido
- `paymentLink` - Link de pago

---

## Nuevos Endpoints

### Multilang Admin

```bash
# Ver configuración
GET /growth/multilang/config

# Listar idiomas
GET /growth/multilang/languages

# Ver idioma de conversación
GET /growth/multilang/conversation/:conversationId

# Establecer idioma manualmente
POST /growth/multilang/conversation/:conversationId
{ "language": "en" }

# Detectar idioma de texto
POST /growth/multilang/detect
{ "text": "Hello, I want to order a rosca" }

# Ver traducciones de una clave
GET /growth/multilang/translation/:key?language=en
```

### Dashboard actualizado

```bash
GET /growth/dashboard
# Ahora incluye sección "multilang" con config
```

---

## Archivos Nuevos

| Archivo | Descripción |
|---------|-------------|
| `src/services/multilang.js` | Servicio completo de multi-idioma |

## Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `src/workers/aiWorker.js` | + imports analytics/multilang, + detección idioma, + tracking eventos |
| `src/routes/payments.js` | + import analytics, + tracking pagos |
| `src/routes/growth.js` | + import multilang, + endpoints admin, + dashboard actualizado |
| `src/flows/orderCreateFlow.js` | + imports, + tracking pasos, + mensaje cancelación localizado |

---

## Uso en el Código

### Detectar idioma

```javascript
import { multilangService } from "../services/multilang.js";

// Detectar del mensaje
const lang = await multilangService.detectLanguage(messageText, conversationId);

// Obtener del cache
const lang = multilangService.getConversationLanguage(conversationId);
```

### Obtener traducción

```javascript
// Por clave
const greeting = multilangService.getTranslation("greeting", lang);

// Helpers rápidos
const greeting = multilangService.getLocalizedGreeting(conversationId);
const error = multilangService.getLocalizedError(conversationId);
const goodbye = multilangService.getLocalizedGoodbye(conversationId);
```

### Traducir con AI (opcional)

```javascript
const translated = await multilangService.translateWithAI(
  "Tu pedido está listo",
  "en",
  openaiClient
);
// Returns: "Your order is ready"
```

---

## Versión

- **API Version**: 5.4.1
- **Fecha**: 2026-01-08
