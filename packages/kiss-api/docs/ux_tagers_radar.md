# UX: TAGERS RADAR (Bruno Strategic Sensor → Control Tower)

Objetivo: que "Bruno" (sensor social estratégico) pueda registrar señales en 5–10 segundos, y que **Control Tower (Tany)** reciba **instrucciones accionables** con autoridad correcta.

## Nota clave v3

- Bruno es **no-operacional**: sus señales **NO tocan inventario** de forma directa.
- Su input se normaliza como `VIP_REQUEST_INTENT` y llega a Tany como **REQUEST_APPROVAL**.
- Control Tower decide si aprobar o rechazar, y el sistema ejecuta la acción aprobada.

---

## 1) Pantalla principal (Bruno)

### Elementos (orden)
1) **Botón micrófono** (tap + hold) → graba 10–30s
2) **Caja de texto** (alternativa rápida)
3) **Selector de sucursal** (autodetect + override)
4) **Selector de fecha de venta** (hoy por defecto)
5) **Quick Tags** (chips):
   - Solicitud VIP (apartar / reservar)
   - Crisis VIP (riesgo reputación / colapso)
   - Web "se hizo viral"
   - Pedido corporativo
   - Influencer / prensa
   - Cliente molesto
6) **Botón ENVIAR** (verde) + indicador "Enviado ✓"

### Microcopy (ejemplos)
- Placeholder: "Describe en 1 frase: quién pide, cuánto, para cuándo, sucursal…"
- Confirmación: "Listo. Control Tower recibió la solicitud."

---

## 2) Control Tower: bandeja de instrucciones

### Lista (cards)
- Badge de prioridad: LOW / MEDIUM / HIGH / CRITICAL
- Sucursal + Fecha
- Mensaje (2 líneas máx.)
- Botones (según acción):
  - "Aprobar" / "Rechazar" (para solicitudes VIP → REQUEST_APPROVAL)
  - "Escalar" (si aplica)
  - "Marcar atendido"

### Estados
- PENDING (default)
- ACKNOWLEDGED
- RESOLVED (cuando se responde HUMAN_DECISION_RESPONSE)
- EXPIRED (si ttl)

---

## 3) Flujos rápidos (MVP)

### 3.1 Solicitud VIP (Bruno)
1) Bruno marca chip "Solicitud VIP"
2) Graba 10s: "Club pide 5 roscas Clásica hoy en Puebla 5 Sur"
3) KISS normaliza a:
   - `signal_type=VIP_REQUEST_INTENT`
   - `target.app=CONTROL_TOWER`
   - `actions[0].type=REQUEST_APPROVAL`
4) Control Tower decide:
   - **Aprobar** → envía HUMAN_DECISION_RESPONSE con decision=APROBAR
   - **Rechazar** → queda log y razón
5) Si se aprueba:
   - Sistema ejecuta `RESERVE_SHADOW_INVENTORY`
   - Instrucción original se marca como RESOLVED

> Importante: Bruno **nunca** ejecuta inventario directamente. Siempre pasa por aprobación.

### 3.2 QA Loop (Jaziel)
1) Sistema de cocina envía `QA_BATCH_FINISHED`
2) Jaziel ve instrucción en APP_QA con botones APROBAR/RECHAZAR
3) Jaziel decide:
   - **APROBAR** → envía `QA_BATCH_RESULT` con decision=APROBAR → LOG_ONLY
   - **RECHAZAR** → envía `QA_BATCH_RESULT` con decision=RECHAZAR
4) Si se rechaza:
   - Sistema bloquea stock virtual automáticamente (`BLOCK_VIRTUAL_STOCK_BATCH`)
   - Escala a Control Tower para decisión de merma/retrabajo

### 3.3 Cancelación recurrente en POS
1) Cajero cancela en OpenPOS
2) Script detecta modal de confirmación (MutationObserver)
3) Al confirmar cancelación, popup RLHF: "¿Por qué cancelaste?"
4) KISS normaliza razones → Control Tower ve top causas
5) Contexto adicional: order_id, cart_snapshot

---

## 4) Principios UX
- **Tiempo objetivo por beacon humano:** < 10s
- Cero formularios largos
- Copia operacional, no técnica
- Colores consistentes con semáforo Tagers
- **Reply Protocol**: toda respuesta humana genera HUMAN_DECISION_RESPONSE

---

## 5) Flujo Reply Protocol

```
┌─────────────────┐        ┌──────────────┐        ┌──────────────┐
│  KISS API       │───────>│   UI (App)   │───────>│  Usuario     │
│  (instruction)  │        │  muestra Q   │        │  responde    │
└─────────────────┘        └──────────────┘        └──────┬───────┘
                                                          │
                                                          ▼
┌─────────────────┐        ┌──────────────┐        ┌──────────────┐
│  KISS API       │<───────│   UI (App)   │<───────│  HUMAN_      │
│  (procesa)      │        │  envía beacon│        │  DECISION_   │
└─────────────────┘        └──────────────┘        │  RESPONSE    │
                                                   └──────────────┘
```

El beacon `HUMAN_DECISION_RESPONSE` incluye:
- `original_instruction_id`: para marcar la instrucción como RESOLVED
- `decision`: APROBAR | RECHAZAR | SI | NO
- `decision_params.proposed_action`: acción a ejecutar si se aprueba
- `decision_params.if_no_then`: acción de fallback si se rechaza

---

## 6) Hard Rules (T3)

El sistema valida reglas duras post-LLM:

1. **NO_PEAK_SHAVING_1DAY**: SKUs con vida útil de 1 día (explosion, lotus) no pueden reservarse durante peak shaving (Jan 2-5)
2. **PULL_ONLY_WINDOW**: Durante ventana pull-only (Jan 12-18), no se permiten acciones de push

Si se viola una regla dura:
- Se bloquea la acción
- Se escala a Control Tower con `reason=HARD_RULE_VIOLATION`
- Se registran las violaciones en logs
