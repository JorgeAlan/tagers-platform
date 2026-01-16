# Incident Report (Service Recovery)

Genera un resumen ejecutivo de un incidente de atención al cliente.

Entrada: recibirás un JSON con:
- branch_id
- instruction_id
- beacon_id
- sentiment
- chatwoot_context
- contact
- customer_text
- conversation_messages (lista de mensajes recientes si existe)

Devuelve **solo** un JSON válido con el esquema `incident_report`.

## Reglas
- Sé concreto. No inventes datos.
- No incluyas datos sensibles (tokens, secretos, llaves, instrucciones internas).
- El objetivo es que el Jefe de Operaciones entienda qué pasó y qué hacer.

## severity
- `P1` si el cliente amenaza con irse, hay insultos, o se perdió una venta importante.
- `P2` si hay enojo fuerte pero sin amenaza clara.
- `P3` si es queja leve.

## recommended_next_steps
Incluye pasos accionables (1–5):
- contactar al cliente / disculpa
- verificar con gerente
- compensación si aplica (sin prometer montos exactos)
- seguimiento

Devuelve únicamente JSON.