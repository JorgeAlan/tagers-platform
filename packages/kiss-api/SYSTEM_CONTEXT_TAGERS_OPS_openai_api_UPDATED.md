# SYSTEM CONTEXT: TAGERS OPS + KISS PRODUCTION API (OpenAI Integration)

**Documento objetivo (esta iteración):** convertir el “Beacon Protocol” en **chat interfaces contextuales por rol** (Tany/Karla/Ian/Jaziel/Gerentes/Andrés/Jorge) con **autoridad por rol** y con triggers **machine→chat** (batch finished, web spike, store collapse, end-of-shift), sin exponer llaves de OpenAI en cliente.

Este paquete incluye:
- Un microservicio (Node.js) con endpoints `/kiss/ingest` y `/kiss/instructions`
- Un *Model Router* (política de costos/coherencia) para elegir modelo y `service_tier`
- Prompts y esquemas (JSON Schema) para “Structured Outputs”
- Motor de reglas (routing + autoridad + priorización) que **enforcea** el resultado del LLM
- Integraciones (WordPress/WooCommerce + OpenPOS Tampermonkey identity-aware)
- Un “task-pack” JSON para que Claude Opus 4.5 pueda completar/extender partes del sistema

---

## 1) Problema real que resolvemos con esta iteración

El kit previo normalizaba señales humanas (`kiss_signal`) y emitía instrucciones (`kiss_instruction`) con foco en:
- Normalizar señales humanas → `kiss_signal`
- Emitir instrucciones → `kiss_instruction`
- Reservar “shadow inventory” en casos VIP

Pero no estaba modelado para:
- **Chat interfaces contextuales por rol** (Karla/Ian/Jaziel/Managers)
- **Autoridad por rol** (quién puede qué)
- **Bruno no-operacional** (sus señales no deben tocar inventario directamente)
- **Triggers machine→chat** (batch finished, web spike, store collapse, end-of-shift)

En esta iteración se implementa:
- Routing explícito por matriz (`signal_type` → `instruction.target.app`)
- Priorización por `severity` (no solo por nombre del tipo)
- “Cortafuegos” post-LLM: el LLM redacta, pero reglas duras fuerzan target/prioridad/acciones permitidas

---

## 2) Contrato (para que la matriz sea “código”, no texto)

### 2.1 Roles como identidad estándar (actor.role)

Valores recomendados (MAYÚSCULAS):
- JORGE (Visionary / Architect)
- ANDRES (Audit)
- TANY (Operational Commander)
- BRUNO (Strategic Sensor)
- KARLA (Head of Ops)
- IAN (Head Chef / Production)
- JAZIEL (QA)
- GERENTE_SUCURSAL (Branch Manager)
- CAJERO
- RUNNER
- REPARTIDOR
- SYSTEM

### 2.2 Apps/Targets (instruction.target.app)

Routing explícito por rol:
- CONTROL_TOWER → Tany (Ops Thermometer / Kill Switch)
- APP_OPS_HEAD → Karla (Traffic Control)
- APP_PRODUCTION → Ian (Oven Rhythm)
- APP_QA → Jaziel (Shield)
- APP_AUDIT → Andrés (Audit Eye)
- SYSTEM → Jorge (Telemetry / God View)
- APP_BRUNO → Bruno (solo ack / follow-ups; no operativo)
- APP_GERENTE, APP_CAJERO, APP_RUNNER (staff)

### 2.3 Señales normalizadas (signal_type) mínimas

Esta iteración usa un set reducido (UI-driving):
- CANCEL_REASON (POS)
- VIP_REQUEST_INTENT (Bruno / social: “guárdame 5 para el club”)
- VIP_PRESSURE (crisis real: reputación / colapso / pérdida masiva)
- OPS_REALLOCATION (Karla: mover runners, balance de carga)
- PRODUCTION_CONSTRAINT (Ian: demanda > capacidad)
- QUALITY_ISSUE (Jaziel: lote rechazado / riesgo de producto)
- SHIFT_INCIDENT_LOG (bitácora gerentes)
- STOCK_DISCREPANCY (físico vs sistema)
- OTHER

---

## 3) Routing y autoridad (hard)

### 3.1 Routing por matriz (determinístico)

- VIP_REQUEST_INTENT → CONTROL_TOWER (Tany aprueba)
- OPS_REALLOCATION → APP_OPS_HEAD (Karla autoriza)
- PRODUCTION_CONSTRAINT → APP_PRODUCTION (Ian decide capacidad; Tany decide pausas)
- QUALITY_ISSUE → APP_QA (Jaziel decide; bloquea stock virtual)
- STOCK_DISCREPANCY → APP_GERENTE (acción inmediata; auditoría por agregación)
- SHIFT_INCIDENT_LOG → APP_AUDIT (legal/auditable; escala a Tany si severidad alta)
- CANCEL_REASON → CONTROL_TOWER (insights)

### 3.2 Autoridad por rol

- **TANY (CONTROL_TOWER)**: única con Kill Switch y overrides (pausas, reservas, stock).
- **BRUNO**: no-operacional. Su señal se vuelve solicitud para Tany (REQUEST_APPROVAL).
- **KARLA**: re-balanceo humano (REALLOCATE_STAFF). No kill switch.
- **IAN**: decide capacidad (UPDATE_MAX_DAILY_CAPACITY). Si no puede, escalar a Tany para PAUSE_FUTURE_WEB_SALES.
- **JAZIEL**: QA binario; puede bloquear stock virtual (BLOCK_VIRTUAL_STOCK_BATCH).
- **ANDRES**: auditoría/logs; escala solo en HIGH/CRITICAL.

---

## 4) Triggers machine→chat (sin LLM)

Cuando el beacon es “machine” (sin RLHF), KISS genera instrucción determinística para el humano correcto:
- `OPS_TRAFFIC_ALERT` → APP_OPS_HEAD (Karla): pregunta reallocation
- `PRODUCTION_WEB_SPIKE` → APP_PRODUCTION (Ian): ¿aumentar capacidad? si NO, escalar a Tany
- `QA_BATCH_FINISHED` → APP_QA (Jaziel): Aprobado/Rechazado
- `SHIFT_END_CHECKIN` → APP_GERENTE: bitácora estructurada

---

## 5) Beacon Protocol (entrada mínima)

El endpoint `/kiss/ingest` acepta un JSON con esta forma (mínimo):

```json
{
  "beacon_id": "UUID",
  "timestamp_iso": "2026-01-05T10:15:00-06:00",
  "signal_source": "POS_CANCEL_TRANSACTION | HUMAN_SENSOR_SOCIAL | OPS_TRAFFIC_ALERT | PRODUCTION_WEB_SPIKE | QA_BATCH_FINISHED | SHIFT_END_CHECKIN | ...",
  "location_id": "puebla-5-sur",
  "actor": { "role": "CAJERO | RUNNER | GERENTE_SUCURSAL | BRUNO | SYSTEM", "name": "...", "device_id": "..." },
  "human_rlhf_payload": {
    "ui_type": "popup_question",
    "question": "¿Por qué cancelaste?",
    "response_value": "Cliente no tenía dinero"
  },
  "machine_payload": { "any": "thing" }
}
```

---

## 6) Salida: Instruction Protocol (Structured Outputs)

KISS responde un JSON estricto (schema `KissInstruction`) para:
- Pintar UI por rol (chat contextual)
- Ejecutar acciones semánticas (a futuro)
- Auditar decisiones

`target.app` y `priority` se **fuerzan** por motor de reglas aunque el LLM se equivoque.

---

## 7) Integración OpenAI (Responses API)

- Microservicio usa `POST https://api.openai.com/v1/responses`.
- `store:false` por defecto para minimizar retención.

---

## 8) Model Router (costo vs coherencia)

Regla general:
- **Barato** para extracción/clasificación (normalización)
- **Más potente** para coherencia en alto impacto (decisiones high/critical)

Política propuesta (ver `src/model_policy.json`):
- `gpt-5-nano` (flex) → normalización barata
- `gpt-5-mini` (standard) → tareas de texto de bajo riesgo
- `gpt-5.2` (standard/priority) → instrucciones high/critical

---

## 9) Seguridad mínima (MVP)

- Auth inbound por HMAC (`X-Tagers-Signature` + `X-Tagers-Timestamp`).
- `OPENAI_API_KEY` solo en backend.
- Tokens separados por canal en WordPress Bridge (opcional, recomendado):
  - POS / RADAR / KITCHEN / QA

---

## 10) Integraciones clave (esta iteración)

### 10.1 OpenPOS Tampermonkey (identity-aware)
- Guarda en `localStorage`: `role`, `location_id`, `device_id`.
- Usa esa identidad para `actor.role` y `location_id`.
- El shortcut manual es para **staff POS** (no “Bruno-style”).

### 10.2 WordPress Bridge
- Mantiene forwarding a KISS con HMAC.
- Puede validar tokens por canal (POS/RADAR/KITCHEN/QA) para reducir superficie de ataque.
