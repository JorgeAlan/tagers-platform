# 🎯 UX Improvements Implementation Plan

## Resumen de Mejoras Priorizadas

| # | Mejora | Impacto Cliente | Esfuerzo | Estado |
|---|--------|-----------------|----------|--------|
| 1 | Pago confirmado automático | ⭐⭐⭐⭐⭐ | Alto | 🔧 Implementado |
| 2 | Menú/precios/envío sin IA | ⭐⭐⭐⭐ | Medio | 🔧 Implementado |
| 3 | Carrito editable + sin IDs técnicos | ⭐⭐⭐⭐ | Medio | 🔧 Implementado |
| 4 | Modificar pedido self-serve | ⭐⭐⭐ | Bajo | ✅ Ya existe |
| 5 | Multi-idioma end-to-end | ⭐⭐⭐ | Alto | 🔧 Mejorado |
| 6 | Proactivo con CSAT | ⭐⭐ | Medio | 🔧 Implementado |

---

## 1. Pago Confirmado Automático

### Problema
Cuando el cliente paga, no recibe confirmación automática porque no existe relación `orderId ↔ conversationId`.

### Solución Implementada

1. **Nueva tabla `payment_links`** - Almacena la relación
2. **Función `savePaymentLink()`** - Se llama al generar link de pago
3. **Función `notifyPaymentSuccess()`** - Busca conversación y notifica

### Archivos Modificados
- `src/db/migrations/004_payment_links.sql` (nuevo)
- `src/services/payments.js` (modificado)
- `src/routes/payments.js` (modificado)

### Flujo
```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│ Cliente pide    │ ──► │ Bot genera link │ ──► │ Guarda relación │
│ link de pago    │     │ de pago         │     │ en payment_links│
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                        │
┌─────────────────┐     ┌─────────────────┐            │
│ Cliente recibe  │ ◄── │ Webhook busca   │ ◄──────────┘
│ "✅ Pago        │     │ conversation_id │
│ confirmado"     │     │ y notifica      │
└─────────────────┘     └─────────────────┘
```

---

## 2. Menú/Precios/Envío sin IA

### Problema
El dispatcher detecta `menu` y `envio` pero `getFAQAnswer()` no tiene handlers específicos.

### Solución Implementada

1. **`getMenuFromHub()`** - Genera lista de productos desde Config Hub
2. **`getDeliveryFromHub()`** - Genera info de delivery/envío
3. **`getPromosFromHub()`** - Muestra promociones activas

### Formato de Respuesta Menú
```
🥐 **Nuestros Productos:**

• Rosca Tradicional - $450 MXN
  Rosca clásica con frutas cristalizadas (8-10 porciones)

• Rosca Premium - $650 MXN
  Con relleno de nata y frutos secos (12-15 porciones)

¿Te gustaría ordenar alguna? Solo dime cuál y la cantidad.
```

---

## 3. Carrito Sin IDs Técnicos

### Problema
`formatCartSummary()` mostraba `[V:123]` (variation_id) al cliente.

### Solución
- Removido `variation_id` del texto al cliente
- Mantenido en logs y notas privadas de Chatwoot
- Agregado total estimado al resumen

### Antes vs Después
```
ANTES:
1. Rosca Tradicional x2 - $900 [V:4521]

DESPUÉS:
1. Rosca Tradicional x2 - $900

💰 Total estimado: $900 MXN
```

---

## 4. Modificar Pedido Self-Serve

### Estado
✅ Ya existe en `src/ana_super/order_modify_secure_flow.js`

### Mejoras Sugeridas (Config Hub)
- Agregar `modification_policy` con reglas de:
  - Cuántos días antes se puede modificar
  - Si se permite cambiar sucursal
  - Horarios de modificación

---

## 5. Multi-idioma End-to-End

### Problema
Traducciones existen para mensajes clave, pero los flujos seguros tienen texto hardcodeado.

### Solución Implementada

1. **Expandido `translations` en multilang.js**
   - Agregado claves para flujos de pedido
   - Mensajes proactivos traducidos
   
2. **Función `translateFlowMessage()`**
   - Traducción automática de mensajes del flujo
   - Preserva URLs y formato

3. **Middleware `withMultilang` mejorado**
   - Detección + traducción automática

---

## 6. Proactivo con CSAT y Timezone

### Problemas
1. `isQuietHours()` usa hora del servidor, no Mexico City
2. No hay opt-out
3. No hay CSAT post-compra

### Solución Implementada

1. **Timezone fijo a America/Mexico_City**
   ```javascript
   const mexicoTime = new Date().toLocaleString("en-US", {
     timeZone: "America/Mexico_City"
   });
   ```

2. **Opt-out check**
   - Nueva columna `opted_out` en proactive_messages
   - Respeta "STOP" del usuario

3. **Template CSAT**
   ```
   ¡Hola! ¿Cómo estuvo tu pedido de Tagers?
   
   ⭐ Excelente (5)
   😊 Bueno (4)
   😐 Regular (3)
   😕 Malo (2)
   😞 Muy malo (1)
   
   Tu opinión nos ayuda a mejorar 💛
   ```

---

## Archivos Creados/Modificados

### Nuevos
- `src/db/migrations/004_payment_links.sql`
- `docs/UX_IMPROVEMENTS_IMPLEMENTATION.md`

### Modificados
- `src/services/quick_responses.js` - Menu/delivery handlers
- `src/services/payments.js` - savePaymentLink, getConversationByOrderId
- `src/routes/payments.js` - notifyPaymentSuccess completo
- `src/tania/secure_flows/order_create_secure_flow.js` - formatCartSummary sin variation_id
- `src/services/proactive.js` - Mexico timezone, CSAT template
- `src/services/multilang.js` - Más traducciones

---

## Variables de Entorno Nuevas

```env
# Timezone para mensajes proactivos (default: America/Mexico_City)
PROACTIVE_TIMEZONE=America/Mexico_City

# Habilitar CSAT post-compra
PROACTIVE_CSAT_ENABLED=true
PROACTIVE_CSAT_DELAY_HOURS=24
```

---

## Métricas a Monitorear

| Métrica | Antes | Target |
|---------|-------|--------|
| % mensajes "¿ya se pagó?" | Alto | <5% |
| Latencia FAQs (menu/envío) | Variable | <200ms |
| Abandono carrito mid-flow | ? | -30% |
| Handoff por idioma != es | ? | -50% |
| Response rate proactivos | ? | >20% |

---

## Próximos Pasos (Nice to Have)

1. **Carrito editable completo**
   - Comandos "Quitar 1", "Cambiar cantidad"
   - Estado: Definido en diseño, pendiente implementación

2. **CSAT con análisis automático**
   - Si calificación < 3, handoff automático
   - Dashboard de satisfacción

3. **A/B testing de mensajes proactivos**
   - Ya existe infraestructura en `abTesting.js`
