# 🚀 TAN•IA - Implementación de Reglas de Temporada

## Resumen de Cambios

Este paquete implementa las reglas del **Cerebro Maestro** de WordPress en Tan•IA, leyendo toda la configuración desde **Google Sheets** (sin hardcodear nada).

---

## 📁 Archivos Creados

```
deploy-ready/
├── src/
│   ├── season/
│   │   └── season-rules.js          # Motor de reglas de temporada
│   ├── knowledge-hub/
│   │   └── sheet-loader.js          # Loader actualizado con nuevas pestañas
│   └── tania/
│       └── secure_flows/
│           ├── order_create_secure_flow.js   # Flow de crear pedido (CORREGIDO)
│           └── order_modify_secure_flow.js   # Flow de modificar pedido (NUEVO)
├── data/
│   └── SEASON_RULES.csv             # Datos de ejemplo para importar
└── docs/
    ├── GOOGLE_SHEETS_SEASON_RULES.md # Documentación de pestañas
    └── DEPLOY_GUIDE.md              # Esta guía
```

---

## 🐛 Bugs Corregidos

### BUG #1: `variation_id` no se guardaba en carrito
**Archivo:** `order_create_secure_flow.js`
**Línea original:** ~667
```javascript
// ANTES (ROTO):
d.items.push({
  product: d.current_product,
  quantity: d.current_quantity,
  // FALTABA: variation_id
});

// DESPUÉS (CORREGIDO):
const availability = await checkItemAvailability({...});
d.items.push({
  product: d.current_product,
  quantity: d.current_quantity,
  variation_id: availability.variation_id,  // ✅ AHORA SE GUARDA
  stock_at_add: availability.stock,
  price_at_add: availability.price,
});
```

### BUG #2: `variation_id` no se pasaba al checkout
**Archivo:** `order_create_secure_flow.js`
**Línea original:** ~850
```javascript
// ANTES (ROTO):
const cartItems = pending.items.map(item => ({
  product_id: item.product.wc_product_id,
  quantity: item.quantity,
  // FALTABA: variation_id
}));

// DESPUÉS (CORREGIDO):
const cartItems = pending.items.map(item => ({
  product_id: item.product.wc_product_id,
  quantity: item.quantity,
  variation_id: item.variation_id || null,  // ✅ AHORA SE INCLUYE
}));
```

### BUG #3: Falta de validación de reglas de temporada
**Solución:** Integración con `season-rules.js` que lee desde Google Sheets

### BUG #4: No había validación de identidad para cambios
**Solución:** Nuevo flow `order_modify_secure_flow.js` con verificación por teléfono/email

---

## 📊 Configuración en Google Sheets

### Nueva Pestaña: `SEASON_RULES`

| Columna | Descripción | Ejemplo |
|---------|-------------|---------|
| `rule_id` | Identificador único | `PUSH_ENE_2_4` |
| `rule_type` | Tipo de regla | `PUSH`, `PREVENTA`, `SOLO_POS`, `BLOQUEADO`, `FIN_TEMPORADA` |
| `start_date` | Fecha inicio (ISO) | `2026-01-02` |
| `end_date` | Fecha fin (ISO) | `2026-01-04` |
| `min_lead_days` | Días anticipación | `0` (push), `2` (preventa) |
| `channels` | Canales permitidos | `web;bot;pos` o solo `pos` |
| `product_categories` | Categorías | `roscas`, `postres`, `all` |
| `priority` | Prioridad (mayor gana) | `100` |
| `message_bot` | Mensaje al cliente | `Para esa fecha pasa a sucursal` |
| `can_check_stock` | ¿Mostrar stock? | `TRUE` |
| `can_suggest_branch` | ¿Sugerir sucursal? | `TRUE` |
| `enabled` | ¿Regla activa? | `TRUE` |

### Nueva Pestaña: `SEASON_CONFIG`

| key | value |
|-----|-------|
| `season_name` | `Roscas 2025-2026` |
| `season_start` | `2025-12-01` |
| `season_end` | `2026-01-18` |
| `default_min_lead_days` | `2` |
| `timezone` | `America/Mexico_City` |

### Nueva Pestaña: `ORDER_MODIFY_POLICY`

| key | value |
|-----|-------|
| `enabled` | `TRUE` |
| `require_verification` | `TRUE` |
| `verification_fields` | `phone,email` |
| `blocked_dates_for_modify` | `2026-01-05,2026-01-06` |
| `blocked_modify_message` | `Para cambios del 5 y 6 de enero, contacta la sucursal.` |
| `min_hours_before_modify` | `24` |

---

## 📅 Reglas de Negocio Implementadas

### Temporada Roscas 2025-2026

| Fecha | Tipo | Bot puede vender | Bot puede ver stock | Notas |
|-------|------|------------------|---------------------|-------|
| Dic 24 | PUSH | ✅ Sí | ✅ Sí | Nochebuena |
| Dic 31 | PUSH | ✅ Sí | ✅ Sí | Fin de año |
| Ene 2-4 | PUSH | ✅ Sí (roscas) | ✅ Sí | Postres bloqueados |
| **Ene 5-6** | **SOLO_POS** | ❌ No | ✅ Sí | Solo en sucursal, puede sugerir dónde ir |
| Ene 7-11 | PUSH | ✅ Sí (roscas) | ✅ Sí | Postres bloqueados |
| Ene 12-18 | PREVENTA | ✅ Con 2 días | ✅ Sí | Preventa normal |
| Ene 19+ | FIN | ❌ No | ❌ No | Temporada terminada |

---

## 🔐 Validación de Cambios de Pedido

### Flujo de Verificación

1. Cliente pide modificar pedido → Bot pide número de pedido
2. Bot pide teléfono O email para verificar
3. Bot consulta pedido en WooCommerce
4. Compara teléfono/email del pedido con lo proporcionado
5. Si coincide → permite modificación
6. Si no coincide → "Los datos no coinciden. Por seguridad..."

### Fechas Bloqueadas para Modificación

```
5 y 6 de enero → No se pueden modificar pedidos de estas fechas
Mensaje: "Para cambios en pedidos del 5 y 6 de enero, contacta la sucursal."
```

---

## 🚀 Pasos de Deploy

### 1. Actualizar Google Sheets

Agregar las 3 nuevas pestañas:
- `SEASON_RULES` - Importar desde `data/SEASON_RULES.csv`
- `SEASON_CONFIG` - Configuración key-value
- `ORDER_MODIFY_POLICY` - Política de modificaciones

### 2. Copiar archivos al proyecto

```bash
# Desde la raíz del proyecto tagers-kiss-api
cp -r deploy-ready/src/season ./src/
cp deploy-ready/src/knowledge-hub/sheet-loader.js ./src/knowledge-hub/
cp deploy-ready/src/tania/secure_flows/* ./src/tania/secure_flows/
```

### 3. Verificar imports

En `src/routes/chatwoot.js`, agregar:
```javascript
import { validateOrderDate, RULE_TYPES } from '../season/season-rules.js';
```

### 4. Reiniciar servicio

```bash
# Railway redeploy
railway up
```

### 5. Verificar logs

```bash
# Buscar inicialización correcta
[KNOWLEDGE-HUB] Loaded: {
  season_rules: 11,
  has_season_config: true,
  has_order_modify_policy: true
}
```

---

## 🧪 Tests Recomendados

### Test 1: Fecha PUSH (2-4 enero)
```
Cliente: "Quiero una rosca para el 3 de enero"
Bot: [Debe permitir generar carrito]
```

### Test 2: Fecha SOLO_POS (5-6 enero)
```
Cliente: "Quiero una rosca para el 6 de enero"
Bot: "📍 El 5 y 6 de enero solo vendemos en sucursal. ¿Te digo dónde hay disponibilidad?"
```

### Test 3: Modificación con verificación
```
Cliente: "Quiero cambiar mi pedido"
Bot: "¿Me das el número de pedido?"
Cliente: "1234"
Bot: "Para verificar, dame el teléfono o email del pedido"
Cliente: "5512345678"
Bot: [Verifica contra WooCommerce]
```

### Test 4: Modificación bloqueada
```
Cliente: [Tiene pedido para el 6 de enero, quiere cambiar]
Bot: "Para cambios en pedidos del 5 y 6 de enero, contacta la sucursal."
```

---

## ⚠️ Notas Importantes

1. **Sincronización con WordPress**: Las reglas en Google Sheets DEBEN coincidir con el Cerebro Maestro de WordPress para evitar inconsistencias.

2. **Fallback**: Si Google Sheets falla, el sistema usa reglas de fallback hardcodeadas (solo para emergencia).

3. **Caché**: El Config Hub sincroniza cada 5 minutos. Cambios en el Sheet pueden tardar hasta 5 minutos en reflejarse.

4. **Logs**: Todas las validaciones se registran en LangSmith si está habilitado.

---

## 📞 Soporte

Si algo no funciona:
1. Verificar logs en Railway
2. Verificar estructura del Google Sheet
3. Forzar refresh: `POST /api/config/refresh`
