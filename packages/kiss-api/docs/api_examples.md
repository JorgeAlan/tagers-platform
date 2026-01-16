# API Examples (curl) - KISS v3

## 0) Ingest beacon (server-to-server) con HMAC

```bash
TS=$(date +%s)
BODY='{"beacon_id":"demo-123","timestamp_iso":"2026-01-05T10:15:00-06:00","signal_source":"POS_CANCEL_TRANSACTION","location_id":"puebla-5-sur","actor":{"role":"CAJERO","name":"Demo"},"human_rlhf_payload":{"ui_type":"popup_question","question":"¿Por qué cancelaste?","response_value":"Cliente cambió de opinión","response_type":"text"}}'

# Signature = HMAC_SHA256(secret, "${TS}.${BODY}")  (hex)
export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY"
```

---

## 1) Bruno (Radar social) → VIP_REQUEST_INTENT (sin tocar inventario)

Bruno es un **sensor estratégico no-operacional**. Sus señales se convierten en REQUEST_APPROVAL para Control Tower.

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"bruno-001",
  "timestamp_iso":"2026-01-03T12:05:00-06:00",
  "signal_source":"HUMAN_SENSOR_SOCIAL",
  "location_id":"puebla-5-sur",
  "actor":{"role":"BRUNO","name":"Bruno"},
  "human_rlhf_payload":{
    "ui_type":"voice_or_text",
    "question":"¿Qué está pasando?",
    "response_value":"Guárdame 5 roscas clásicas para el club hoy. Si no, se arma.",
    "response_type":"text"
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `signal_type=VIP_REQUEST_INTENT`
- `target.app=CONTROL_TOWER`
- `actions[0].type=REQUEST_APPROVAL`
- Bruno NO ejecuta inventario directamente

---

## 2) Karla (OPS) — Trigger machine→chat: OPS_TRAFFIC_ALERT

Este caso NO requiere LLM. El sistema genera una instrucción determinística para APP_OPS_HEAD.

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"ops-traffic-001",
  "timestamp_iso":"2026-01-03T13:10:00-06:00",
  "signal_source":"OPS_TRAFFIC_ALERT",
  "location_id":"puebla-5-sur",
  "actor":{"role":"SYSTEM","name":"OpsMonitor"},
  "machine_payload":{
    "from_location_id":"puebla-angelopolis",
    "to_location_id":"puebla-5-sur",
    "eta_minutes":25,
    "severity":"HIGH",
    "notes":"Fila en tienda + repartidores atrasados"
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `target.app=APP_OPS_HEAD`
- `actions[0].type=REQUEST_APPROVAL` con opción REALLOCATE_STAFF

---

## 3) Ian (Producción) — Trigger machine→chat: PRODUCTION_WEB_SPIKE

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"prod-spike-001",
  "timestamp_iso":"2026-01-03T13:15:00-06:00",
  "signal_source":"PRODUCTION_WEB_SPIKE",
  "location_id":"puebla-5-sur",
  "actor":{"role":"SYSTEM","name":"WebMonitor"},
  "machine_payload":{
    "demand":420,
    "capacity":280,
    "severity":"HIGH",
    "suggested_delta":120
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `target.app=APP_PRODUCTION`
- `message` contiene "PICO WEB"
- `actions[0].params.if_no_then` tiene ESCALATE_TO_CONTROL_TOWER

---

## 4) Jaziel (QA) — Trigger machine→chat: QA_BATCH_FINISHED

Sistema de cocina notifica que un lote está listo para QA.

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"qa-batch-001",
  "timestamp_iso":"2026-01-03T13:30:00-06:00",
  "signal_source":"QA_BATCH_FINISHED",
  "location_id":"puebla-5-sur",
  "actor":{"role":"SYSTEM","name":"KitchenSystem"},
  "machine_payload":{
    "batch_id":"BATCH-77A",
    "sku":"ROSCA-CLASICA",
    "qty":60,
    "severity":"MEDIUM"
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `target.app=APP_QA`
- `actions[0].type=REQUEST_APPROVAL`
- `actions[0].params.options` = ["APROBAR", "RECHAZAR"]

---

## 5) Jaziel responde QA — QA_BATCH_RESULT (RECHAZAR)

Cuando Jaziel rechaza un lote, el sistema bloquea stock virtual automáticamente.

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"qa-result-001",
  "timestamp_iso":"2026-01-03T14:00:00-06:00",
  "signal_source":"QA_BATCH_RESULT",
  "location_id":"puebla-5-sur",
  "actor":{"role":"JAZIEL","name":"Jaziel QA"},
  "machine_payload":{
    "batch_id":"BATCH-77A",
    "sku":"ROSCA-CLASICA",
    "qty_inspected":60,
    "decision":"RECHAZAR",
    "reason":"Decoración caída en 15 unidades"
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `target.app=CONTROL_TOWER`
- `priority=HIGH`
- `actions[0].type=BLOCK_VIRTUAL_STOCK_BATCH`
- `actions[1].type=ESCALATE_TO_CONTROL_TOWER`
- Stock virtual bloqueado en DB automáticamente

---

## 6) Gerente — Trigger machine→chat: SHIFT_END_CHECKIN → bitácora

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"shift-end-001",
  "timestamp_iso":"2026-01-03T22:05:00-06:00",
  "signal_source":"SHIFT_END_CHECKIN",
  "location_id":"puebla-5-sur",
  "actor":{"role":"SYSTEM","name":"ShiftDaemon"},
  "machine_payload":{
    "shift_id":"SHIFT-20260103-PUE5S",
    "severity":"LOW"
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `target.app=APP_GERENTE`
- `actions[0].type=CREATE_INCIDENT_LOG`

---

## 7) Reply Protocol — HUMAN_DECISION_RESPONSE (APROBAR)

Cuando un humano responde a una instrucción REQUEST_APPROVAL.

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"resp-test-001",
  "timestamp_iso":"2026-01-03T14:10:00-06:00",
  "signal_source":"HUMAN_DECISION_RESPONSE",
  "location_id":"puebla-5-sur",
  "actor":{"role":"TANY","name":"Tany Ops"},
  "machine_payload":{
    "original_instruction_id":"INS_abc123",
    "original_beacon_id":"bruno-001",
    "action_type":"REQUEST_APPROVAL",
    "decision":"APROBAR",
    "decision_params":{
      "proposed_action":{
        "type":"RESERVE_SHADOW_INVENTORY",
        "params":{"location_id":"puebla-5-sur","sku":"ROSCA-CLASICA","qty":5}
      }
    }
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `target.app=CONTROL_TOWER`
- `actions[0].type=RESERVE_SHADOW_INVENTORY`
- `message` contiene "APROBADA"
- La instrucción original (INS_abc123) se marca como RESOLVED en DB

---

## 8) POS Cancel con contexto real (OpenPOS DOM)

```bash
TS=$(date +%s)
BODY='{
  "beacon_id":"pos-cancel-real-001",
  "timestamp_iso":"2026-01-03T15:30:00-06:00",
  "signal_source":"POS_CANCEL_TRANSACTION",
  "location_id":"puebla-5-sur",
  "actor":{"role":"CAJERO","name":"María García","device_id":"POS-02"},
  "human_rlhf_payload":{
    "ui_type":"popup_question",
    "question":"¿Por qué cancelaste esta venta?",
    "response_value":"Cliente no trajo efectivo suficiente",
    "response_type":"text"
  },
  "machine_payload":{
    "order_id":"ORD-12345",
    "cart_snapshot":[
      {"name":"Rosca Clásica","qty":2,"sku":"ROSCA-CLASICA"},
      {"name":"Rosca Nutella","qty":1,"sku":"ROSCA-NUTELLA"}
    ],
    "cancel_confirmed_at":"2026-01-03T15:30:00-06:00"
  }
}'

export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

curl -sS http://127.0.0.1:8787/kiss/ingest \
  -H "Content-Type: application/json" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" \
  -d "$BODY" | jq .
```

**Esperado:**
- `signal_type=CANCEL_REASON`
- `target.app=CONTROL_TOWER`
- `actions[0].type=LOG_ONLY`
- Contexto de carrito capturado para análisis

---

## 9) Listar instrucciones por app (chat contextual)

```bash
# Generar firma para GET (body vacío)
TS=$(date +%s)
BODY=''
export TS BODY
SIG=$(python3 -c 'import hmac,hashlib,os; print(hmac.new(os.environ.get("TAGERS_SHARED_SECRET","change_me").encode(),os.environ["TS"].encode()+b"."+os.environ["BODY"].encode(),hashlib.sha256).hexdigest())')

# Control Tower (Tany)
curl -sS "http://127.0.0.1:8787/kiss/instructions?target_app=CONTROL_TOWER&location_id=puebla-5-sur&limit=25" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" | jq .

# QA (Jaziel)
curl -sS "http://127.0.0.1:8787/kiss/instructions?target_app=APP_QA&location_id=puebla-5-sur&limit=25" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" | jq .

# Ops Head (Karla)
curl -sS "http://127.0.0.1:8787/kiss/instructions?target_app=APP_OPS_HEAD&location_id=puebla-5-sur&limit=25" \
  -H "X-Tagers-Timestamp: $TS" \
  -H "X-Tagers-Signature: $SIG" | jq .
```

---

## 10) Endpoint de métricas (T4 Observabilidad)

```bash
curl -sS http://127.0.0.1:8787/metrics | jq .
```

**Esperado:**
```json
{
  "ingest_total": 10,
  "ingest_by_model": {
    "gpt-5-nano": 5,
    "deterministic": 5
  },
  "ingest_fallback_total": 0,
  "avg_latency_ms": 245.6,
  "uptime_seconds": 3600
}
```

---

## Tests de Validación DB

```bash
# Verificar shadow inventory
psql $DATABASE_URL -c "SELECT * FROM inventory_shadow WHERE location_id='puebla-5-sur';"

# Verificar virtual stock blocks
psql $DATABASE_URL -c "SELECT * FROM virtual_stock_blocks WHERE status='ACTIVE';"

# Verificar instrucciones resueltas
psql $DATABASE_URL -c "SELECT instruction_id, status, resolved_by FROM ops_instructions WHERE status='RESOLVED';"
```
