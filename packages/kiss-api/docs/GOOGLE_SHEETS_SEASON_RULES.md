# 📋 TAN•IA KNOWLEDGE BASE - SEASON_RULES Sheet

## Descripción
Esta pestaña controla las reglas de temporada que el bot debe respetar.
**IMPORTANTE:** Estas reglas deben estar sincronizadas con el Cerebro Maestro de WordPress.

---

## PESTAÑA: SEASON_RULES

### Columnas Requeridas:

| Columna | Tipo | Descripción | Ejemplo |
|---------|------|-------------|---------|
| `rule_id` | string | Identificador único | `PUSH_ENE_2_4` |
| `rule_type` | enum | Tipo de regla | `PUSH`, `PREVENTA`, `SOLO_POS`, `BLOQUEADO` |
| `start_date` | date | Fecha inicio (ISO) | `2026-01-02` |
| `end_date` | date | Fecha fin (ISO) | `2026-01-04` |
| `min_lead_days` | number | Días mínimos anticipación | `0` (push), `2` (preventa) |
| `channels` | string | Canales permitidos (csv) | `web,bot,pos` o `pos` |
| `product_categories` | string | Categorías afectadas | `roscas` o `postres` o `all` |
| `priority` | number | Prioridad (mayor = preferente) | `100` |
| `message_bot` | string | Mensaje para el cliente | `Para esa fecha pasa a sucursal` |
| `can_check_stock` | boolean | ¿Bot puede consultar stock? | `TRUE` |
| `can_suggest_branch` | boolean | ¿Sugerir sucursal? | `TRUE` |
| `enabled` | boolean | ¿Regla activa? | `TRUE` |

---

## DATOS DE EJEMPLO (Temporada Roscas 2025-2026)

Copiar estos datos a tu Google Sheet:

```
rule_id,rule_type,start_date,end_date,min_lead_days,channels,product_categories,priority,message_bot,can_check_stock,can_suggest_branch,enabled
PREVENTA_DEFAULT,PREVENTA,2025-12-01,2026-01-18,2,web;bot;pos,all,10,Para esa fecha necesitas ordenar con al menos 2 días de anticipación.,TRUE,FALSE,TRUE
PUSH_DIC_24,PUSH,2025-12-24,2025-12-24,0,web;bot;pos,roscas,100,¡Hoy es día de push! Puedes ordenar para recoger hoy mismo.,TRUE,FALSE,TRUE
PUSH_DIC_31,PUSH,2025-12-31,2025-12-31,0,web;bot;pos,roscas,100,¡Hoy es día de push! Puedes ordenar para recoger hoy mismo.,TRUE,FALSE,TRUE
PUSH_ENE_2_4,PUSH,2026-01-02,2026-01-04,0,web;bot;pos,roscas,100,¡Días de push! Puedes ordenar para recoger hoy mismo.,TRUE,FALSE,TRUE
PUSH_ENE_2_4_POSTRES,BLOQUEADO,2026-01-02,2026-01-04,0,web;bot;pos,postres,110,Los postres no están disponibles del 2 al 4 de enero.,FALSE,FALSE,TRUE
SOLO_POS_ENE_5_6,SOLO_POS,2026-01-05,2026-01-06,0,pos,roscas,100,📍 El 5 y 6 de enero solo vendemos en sucursal. Te puedo decir dónde hay disponibilidad.,TRUE,TRUE,TRUE
SOLO_POS_ENE_5_6_POSTRES,BLOQUEADO,2026-01-05,2026-01-06,0,pos,postres,110,Los postres no están disponibles el 5 y 6 de enero.,FALSE,FALSE,TRUE
PUSH_ENE_7_11,PUSH,2026-01-07,2026-01-11,0,web;bot;pos,roscas,100,¡Días de push! Puedes ordenar para recoger hoy mismo.,TRUE,FALSE,TRUE
PUSH_ENE_7_11_POSTRES,BLOQUEADO,2026-01-07,2026-01-11,0,web;bot;pos,postres,110,Los postres no están disponibles del 7 al 11 de enero.,FALSE,FALSE,TRUE
PREVENTA_ENE_12_18,PREVENTA,2026-01-12,2026-01-18,2,web;bot;pos,all,100,Del 12 al 18 de enero solo hay preventa (mínimo 2 días).,TRUE,FALSE,TRUE
FIN_TEMPORADA,FIN_TEMPORADA,2026-01-19,2026-12-31,0,,all,1000,La temporada de roscas terminó el 18 de enero.,FALSE,FALSE,TRUE
```

---

## PESTAÑA: SEASON_CONFIG

Configuración general de la temporada:

| key | value | description |
|-----|-------|-------------|
| `season_name` | `Roscas 2025-2026` | Nombre de la temporada |
| `season_start` | `2025-12-01` | Inicio de temporada |
| `season_end` | `2026-01-18` | Fin de temporada |
| `default_min_lead_days` | `2` | Días mínimos por defecto |
| `timezone` | `America/Mexico_City` | Zona horaria |
| `bot_channel_id` | `bot` | Identificador del canal bot |

---

## PESTAÑA: ORDER_MODIFY_POLICY

Reglas para modificaciones de pedido:

| key | value | description |
|-----|-------|-------------|
| `enabled` | `TRUE` | ¿Permitir modificaciones? |
| `require_verification` | `TRUE` | ¿Requiere verificar identidad? |
| `verification_fields` | `phone,email` | Campos para verificar |
| `blocked_dates_for_modify` | `2026-01-05,2026-01-06` | Fechas sin modificación |
| `blocked_modify_message` | `Para cambios en pedidos del 5 y 6 de enero, por favor contacta directamente a la sucursal.` | Mensaje |
| `min_hours_before_modify` | `24` | Horas mínimas antes de entrega |

---

## TIPOS DE REGLA (rule_type)

| Tipo | Descripción | Comportamiento Bot |
|------|-------------|-------------------|
| `PREVENTA` | Requiere anticipación mínima | Verifica `min_lead_days` |
| `PUSH` | Venta el mismo día | Permite carrito inmediato |
| `SOLO_POS` | Solo punto de venta físico | NO genera carrito, SÍ muestra stock, sugiere sucursal |
| `BLOQUEADO` | Sin venta | NO genera carrito, NO muestra stock |
| `FIN_TEMPORADA` | Después de temporada | Rechaza cualquier pedido |

---

## CANALES (channels)

- `web` = Tienda online WooCommerce
- `bot` = Tan•IA (Chatwoot/WhatsApp)
- `pos` = Punto de venta físico (OpenPOS)
- Separar múltiples con `;` ejemplo: `web;bot;pos`

---

## CATEGORÍAS DE PRODUCTO

- `roscas` = Roscas de Reyes
- `postres` = Postres para celebrar
- `extras` = Para acompañar
- `all` = Todas las categorías

---

## NOTAS IMPORTANTES

1. **Prioridad**: Las reglas con mayor `priority` se evalúan primero
2. **Fechas**: Usar formato ISO (YYYY-MM-DD)
3. **Sincronización**: Estas reglas DEBEN coincidir con el Cerebro Maestro de WordPress
4. **can_check_stock**: Para SOLO_POS, el bot puede mostrar disponibilidad aunque no genere carrito
5. **can_suggest_branch**: Activa sugerencias de sucursal cuando no puede vender

---

## EJEMPLO DE USO EN BOT

**Cliente**: "Quiero una rosca para el 6 de enero"

**Bot detecta**: 
- Fecha: enero-06
- Regla aplicable: SOLO_POS_ENE_5_6
- Resultado: `allowed: false`, `can_check_stock: true`, `can_suggest_branch: true`

**Bot responde**:
> 📍 El 5 y 6 de enero solo vendemos en sucursal. 
> Te puedo decir dónde hay disponibilidad. ¿Quieres que busque stock en alguna sucursal?

---

## VALIDACIÓN DE CAMBIOS DE PEDIDO

Cuando un cliente quiere modificar un pedido:

1. Pedir número de pedido
2. Pedir teléfono O email
3. Validar contra datos del pedido en WooCommerce
4. Si coincide → permitir cambios
5. Si no coincide → "Los datos no coinciden. Por seguridad necesito verificar que eres el titular."

**Fechas bloqueadas para cambios**: 5 y 6 de enero
**Mensaje**: "Para cambios en pedidos del 5 y 6 de enero, contacta directamente a la sucursal o llámanos."
