# Chatwoot Community Self-Hosted Setup Guide

## 📋 Configuración para chat.tagers.com (Chatwoot 4.9.1)

Esta guía configura Tan•IA para trabajar con tu instancia self-hosted de Chatwoot Community.

---

## 🔧 Variables de Entorno (Railway)

```env
# ═══════════════════════════════════════════════════════════════════════════
# CHATWOOT COMMUNITY SELF-HOSTED - chat.tagers.com
# ═══════════════════════════════════════════════════════════════════════════

CHATWOOT_ENABLED=true

# URL de tu instancia (SIN barra al final)
CHATWOOT_BASE_URL=https://chat.tagers.com

# Account ID (usualmente 1 para la primera cuenta)
CHATWOOT_ACCOUNT_ID=1

# API Access Token del agente bot
# Obtener desde: Profile Settings → Access Token
CHATWOOT_API_ACCESS_TOKEN=<tu_token_aqui>

# Token secreto para validar webhooks entrantes
# Genera uno seguro con: openssl rand -hex 32
CHATWOOT_WEBHOOK_TOKEN=<token_secreto_generado>

# (Opcional) Limitar a inboxes específicos (IDs separados por coma)
# Si está vacío, procesa todos los inboxes
CHATWOOT_INBOX_ALLOWLIST=1,2,3

# ═══════════════════════════════════════════════════════════════════════════
# MAPEO DE EQUIPOS (Teams) - Para escalación a humanos
# ═══════════════════════════════════════════════════════════════════════════

# Mapeo sucursal → team_id en Chatwoot
# Cuando Tan•IA escala, asigna al equipo correcto según sucursal
CHATWOOT_BRANCH_TO_TEAM={"SAN_ANGEL":1,"ANGELOPOLIS":2,"SONATA":3,"ZAVALETA":4,"5_SUR":5,"HQ":6,"DEFAULT":6}

# Mapeo inbox_id → team_id (alternativo si no hay sucursal)
CHATWOOT_INBOX_TO_TEAM={"1":1,"2":2,"3":3,"DEFAULT":6}

# ═══════════════════════════════════════════════════════════════════════════
# AGENT GATING - Control Bot vs Humano
# ═══════════════════════════════════════════════════════════════════════════

# Habilitar verificación de agente antes de responder
BOT_AGENT_GATING_ENABLED=true

# Minutos sin actividad del agente antes de que el bot retome
BOT_AGENT_TIMEOUT_MINUTES=5
```

---

## 🚀 Pasos de Configuración en Chatwoot

### 1. Crear un Agente para el Bot

1. Ve a **Settings → Agents → Add Agent**
2. Crea un agente llamado "Tan•IA" o "Bot"
3. **IMPORTANTE**: Este agente NO debe tener inbox asignado (el bot responde via API)

### 2. Obtener el API Access Token

1. Inicia sesión con el usuario del bot
2. Ve a **Profile Settings** (esquina superior derecha)
3. Copia el **Access Token**

> ⚠️ En Chatwoot Community self-hosted, el token es por usuario. NO uses el super admin token.

### 3. Configurar Webhooks en cada Inbox

Para cada inbox (WhatsApp, Messenger, Instagram):

1. Ve a **Settings → Inboxes → [Tu Inbox]**
2. Click en **Webhooks** (pestaña o configuración)
3. Agrega el webhook URL:

```
https://tu-api.up.railway.app/chatwoot/webhook?token=TU_WEBHOOK_TOKEN
```

4. Selecciona los eventos:
   - ✅ `message_created`
   - ✅ `conversation_created`
   - ✅ `conversation_status_changed`
   - ✅ `conversation_updated`

### 4. Crear Teams (Equipos)

Para que la escalación funcione correctamente:

1. Ve a **Settings → Teams**
2. Crea un equipo por sucursal/área:
   - Team 1: "San Ángel"
   - Team 2: "Angelópolis"
   - Team 3: "Sonata"
   - etc.
3. Asigna agentes humanos a cada equipo

### 5. Verificar IDs

Para obtener los IDs de inboxes y teams:

```bash
# Listar inboxes
curl -H "api_access_token: TU_TOKEN" \
  https://chat.tagers.com/api/v1/accounts/1/inboxes

# Listar teams
curl -H "api_access_token: TU_TOKEN" \
  https://chat.tagers.com/api/v1/accounts/1/teams
```

---

## 🔄 Flujo de Mensajes

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         FLUJO NORMAL                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  Cliente (WhatsApp/FB/IG)                                               │
│       │                                                                  │
│       ▼                                                                  │
│  Chatwoot (chat.tagers.com)                                             │
│       │                                                                  │
│       │ webhook                                                          │
│       ▼                                                                  │
│  tagers-kiss-api (Railway)                                              │
│       │                                                                  │
│       ├─► Governor: ¿Procesar? ─► NO ─► (agente activo, spam, etc.)    │
│       │                                                                  │
│       │   SI                                                             │
│       ▼                                                                  │
│  Dispatcher: ¿Qué tipo de mensaje?                                      │
│       │                                                                  │
│       ├─► Handoff Request ─► initiateHandoff() ─► Escala a humano      │
│       ├─► Frustración Alta ─► handoffOnFrustration() ─► Escala          │
│       ├─► Flujo Activo ─► Continuar flujo (pedido, status, etc.)       │
│       └─► General ─► runAgenticFlow() ─► IA responde                    │
│                                                                          │
│       │                                                                  │
│       ▼                                                                  │
│  sendChatwootMessage() ──► API Chatwoot ──► Cliente ve respuesta       │
│                                                                          │
│  (Los agentes ven TODO en el panel de Chatwoot)                         │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 👥 Visibilidad para Agentes

### Lo que los agentes VEN en Chatwoot:

1. **Mensajes del cliente** - Todos los mensajes entrantes
2. **Respuestas de Tan•IA** - Aparecen como mensajes salientes del bot
3. **Notas privadas** - Contexto interno (solo agentes las ven)
4. **Labels** - Tags como `bot-handoff`, `reason-frustration`
5. **Custom Attributes** - `bot_active`, `handoff_reason`, etc.

### Cuándo el BOT responde:

- ✅ No hay agente asignado
- ✅ Agente asignado pero sin actividad por más de X minutos
- ✅ `custom_attributes.bot_active = true`

### Cuándo el BOT NO responde (cede al humano):

- ❌ Agente respondió recientemente (< X minutos)
- ❌ `custom_attributes.human_handling = true`
- ❌ Conversación marcada para manejo humano

---

## 🆘 Escalación a Humano

### Tan•IA escala automáticamente cuando:

1. **Cliente pide humano explícitamente**:
   - "quiero hablar con una persona"
   - "pásame con un agente"
   - "eres un robot?"

2. **Frustración alta detectada**:
   - Múltiples signos de enojo/frustración
   - MAYÚSCULAS sostenidas
   - Repetición de quejas

3. **Tema sensible**:
   - Quejas formales
   - Solicitudes de reembolso
   - Temas legales/médicos

### Qué hace initiateHandoff():

1. **Mensaje al cliente**: "Te comunico con un agente..."
2. **Nota privada**: Contexto completo para el agente
3. **Asigna a Team**: Según sucursal o inbox
4. **Agrega labels**: `bot-handoff`, `reason-explicit_request`
5. **Cambia status**: `open` (aparece en cola)
6. **Actualiza attributes**: `bot_active: false`

---

## 🔧 Cuándo el Agente Toma el Control

### Opción 1: El agente simplemente responde

Cuando un agente envía un mensaje:
- El sistema detecta actividad reciente del agente
- Tan•IA automáticamente deja de responder por X minutos
- Si el agente no responde más, el bot retoma

### Opción 2: Asignarse la conversación

1. El agente se asigna la conversación
2. Tan•IA detecta `assignee_id` y cede
3. El bot solo retoma si pasa el timeout

### Opción 3: Marcar como manejo humano

```bash
# API para marcar manejo humano permanente
curl -X PATCH \
  -H "api_access_token: TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"custom_attributes":{"human_handling":true}}' \
  https://chat.tagers.com/api/v1/accounts/1/conversations/123
```

---

## 🧪 Testing

### 1. Verificar conectividad

```bash
# Health check
curl https://tu-api.up.railway.app/chatwoot/health

# Respuesta esperada:
{
  "status": "healthy",
  "version": "3.1.0-consolidated",
  "queue": {...},
  "cache": {...}
}
```

### 2. Simular webhook

```bash
curl -X POST \
  "https://tu-api.up.railway.app/chatwoot/webhook?token=TU_WEBHOOK_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "message": {
      "id": 123,
      "content": "Hola, quiero pedir una rosca",
      "message_type": "incoming",
      "sender_type": "contact"
    },
    "conversation": {
      "id": 456
    },
    "account": {
      "id": 1
    },
    "inbox": {
      "id": 1
    }
  }'
```

### 3. Verificar logs en Railway

Busca en los logs:
- `Governor: PROCEED` - Mensaje aceptado
- `Dispatcher: routed` - Ruta determinada
- `Message enqueued` - En cola para procesamiento
- `Chatwoot: message sent` - Respuesta enviada

---

## 🐛 Troubleshooting

### "Unauthorized" en webhook

- Verificar `CHATWOOT_WEBHOOK_TOKEN` coincide con `?token=` en URL
- O usar header `X-Tagers-Chatwoot-Token`

### Bot no responde pero no hay errores

1. Verificar `CHATWOOT_ENABLED=true`
2. Verificar que el inbox está en `CHATWOOT_INBOX_ALLOWLIST` (o dejarlo vacío)
3. Revisar si hay agente activo (`skip_agent_active` en logs)

### Respuestas no visibles en Chatwoot

- **Bug corregido**: `apiBaseUrl` → `baseUrl` en chatwootService.js
- Verificar `CHATWOOT_BASE_URL` tiene la URL correcta sin `/` al final
- Verificar `CHATWOOT_API_ACCESS_TOKEN` es válido

### Escalación no funciona

1. Verificar que existen los Teams en Chatwoot
2. Verificar `CHATWOOT_BRANCH_TO_TEAM` tiene IDs correctos
3. Revisar logs buscando "handoff"

---

## 📊 Monitoreo

### Endpoints disponibles

```bash
# Estadísticas generales
curl https://tu-api.up.railway.app/chatwoot/stats

# Estado de la cola
curl https://tu-api.up.railway.app/chatwoot/health
```

### Métricas importantes

- `queue.waiting` - Mensajes esperando procesamiento
- `queue.active` - Mensajes siendo procesados
- `cache.hitRate` - Eficiencia del cache semántico

---

## 🔐 Seguridad

1. **Webhook Token**: Genera uno seguro con `openssl rand -hex 32`
2. **API Token**: Nunca compartir, rota periódicamente
3. **HTTPS**: Siempre usar HTTPS para webhooks
4. **Rate Limiting**: Habilitado por defecto en Governor

---

## 📝 Checklist Final

- [ ] `CHATWOOT_ENABLED=true`
- [ ] `CHATWOOT_BASE_URL=https://chat.tagers.com` (sin `/` al final)
- [ ] `CHATWOOT_ACCOUNT_ID` configurado
- [ ] `CHATWOOT_API_ACCESS_TOKEN` del usuario bot
- [ ] `CHATWOOT_WEBHOOK_TOKEN` generado y seguro
- [ ] Webhooks configurados en cada inbox de Chatwoot
- [ ] Teams creados para escalación
- [ ] `CHATWOOT_BRANCH_TO_TEAM` con IDs correctos
- [ ] Probado con mensaje de prueba
