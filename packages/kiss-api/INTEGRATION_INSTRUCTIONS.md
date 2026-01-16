# 🔧 Instrucciones de Integración - Chatwoot Agent Visibility

## 📁 Archivos Generados

| Archivo | Destino | Acción |
|---------|---------|--------|
| `chatwoot_client.js` | `src/integrations/chatwoot_client.js` | **REEMPLAZAR** |
| `handoff_service.js` | `src/services/handoff_service.js` | **CREAR** |
| `agent_gating.js` | `src/services/agent_gating.js` | **CREAR** |

---

## 1️⃣ Reemplazar `chatwoot_client.js`

```bash
# Backup del original
cp src/integrations/chatwoot_client.js src/integrations/chatwoot_client.js.bak

# Copiar nuevo
cp chatwoot_client.js src/integrations/chatwoot_client.js
```

### Funciones nuevas agregadas:
- `getConversation()` - Obtener info de conversación
- `assignToTeam()` - Asignar a equipo
- `assignToAgent()` - Asignar a agente
- `unassignConversation()` - Quitar asignación
- `sendPrivateNote()` - Nota solo para agentes
- `touchConversation()` - Forzar refresh UI
- `addLabels()` - Agregar etiquetas
- `updateCustomAttributes()` - Actualizar atributos

---

## 2️⃣ Crear `handoff_service.js`

```bash
cp handoff_service.js src/services/handoff_service.js
```

### Funciones disponibles:
- `initiateHandoff()` - Handoff completo
- `detectsHandoffRequest()` - Detectar si cliente pide humano
- `detectsFrustration()` - Detectar frustración
- `detectsSensitiveTopic()` - Detectar temas sensibles
- `handoffOnExplicitRequest()` - Handoff rápido
- `handoffOnFrustration()` - Handoff por frustración
- `handoffOnRepeatedErrors()` - Handoff por errores

---

## 3️⃣ Crear `agent_gating.js`

```bash
cp agent_gating.js src/services/agent_gating.js
```

### Funciones disponibles:
- `shouldBotRespond()` - Verificar si bot debe responder
- `isAgentActive()` - Verificar si agente está activo
- `getAssignedAgent()` - Obtener info del agente

---

## 4️⃣ Modificar `chatwoot.js`

### 4.1 Agregar imports al inicio del archivo

```javascript
// Después de los otros imports, agregar:
import { shouldBotRespond } from "../services/agent_gating.js";
import { 
  initiateHandoff, 
  detectsHandoffRequest,
  detectsFrustration,
  HANDOFF_REASONS,
} from "../services/handoff_service.js";
```

### 4.2 Modificar `processChatwootEvent()`

Buscar la función `processChatwootEvent` (aproximadamente línea 100-200) y agregar la verificación de agente **DESPUÉS** de extraer los datos del webhook y **ANTES** de procesar:

```javascript
async function processChatwootEvent(body) {
  const { event, message, conversation, account, inbox, contact } = extractChatwoot(body);
  
  // ... validaciones existentes ...
  
  const conversationId = conversation?.id;
  const accountId = account?.id || config.chatwoot.accountId;
  const messageText = message?.content || "";
  
  // ═══════════════════════════════════════════════════════════════════════
  // NUEVO: Verificar si hay agente asignado activo
  // ═══════════════════════════════════════════════════════════════════════
  const { respond, reason, assigneeId } = await shouldBotRespond({ 
    accountId, 
    conversationId, 
    conversation,
  });
  
  if (!respond) {
    logger.info({ 
      conversationId, 
      reason, 
      assigneeId,
      messagePreview: messageText?.substring(0, 50),
    }, "Bot deferring to human agent");
    return; // No procesar, agente está manejando
  }
  
  // ... resto del procesamiento existente ...
}
```

### 4.3 Modificar detección de "humano"

Buscar donde detectas que el cliente pide humano (hay varias instancias) y reemplazar con el servicio:

```javascript
// ANTES (múltiples lugares):
if (/\b(humano|persona|agente|asesor|ejecutivo)\b/.test(normMsgForFlow)) {
  // lógica de handoff...
}

// DESPUÉS:
if (detectsHandoffRequest(messageText)) {
  await initiateHandoff({
    accountId,
    conversationId,
    inboxId,
    branchId: branch_id_hint,
    reason: HANDOFF_REASONS.EXPLICIT_REQUEST,
    contact,
  });
  return;
}
```

### 4.4 Agregar handoff por frustración

En el servicio de sentiment analysis, agregar:

```javascript
// Donde detectas frustración:
const frustration = detectsFrustration(messageText);
if (frustration.highFrustration) {
  await initiateHandoff({
    accountId,
    conversationId,
    inboxId,
    branchId: branch_id_hint,
    reason: HANDOFF_REASONS.HIGH_FRUSTRATION,
    contact,
    customerSummary: "Cliente muestra alta frustración en la conversación.",
  });
  return;
}
```

---

## 5️⃣ Variables de Entorno

Agregar a `.env`:

```bash
# ═══════════════════════════════════════════════════════════════════════════
# AGENT GATING - Control de bot vs agente
# ═══════════════════════════════════════════════════════════════════════════

# Minutos sin actividad de agente antes de que bot retome (default: 5)
BOT_AGENT_TIMEOUT_MINUTES=5

# Habilitar/deshabilitar verificación de agente (default: true)
BOT_AGENT_GATING_ENABLED=true

# ═══════════════════════════════════════════════════════════════════════════
# HANDOFF - Mapeo de equipos
# ═══════════════════════════════════════════════════════════════════════════

# Mapeo branch_id → team_id en Chatwoot (JSON)
# Obtener team_ids de: Chatwoot → Settings → Teams
CHATWOOT_BRANCH_TO_TEAM={"SAN_ANGEL":1,"ANGELOPOLIS":2,"SONATA":3,"ZAVALETA":4,"5_SUR":5,"HQ":6,"DEFAULT":6}

# Mapeo inbox_id → team_id en Chatwoot (JSON)
# Obtener inbox_ids de: Chatwoot → Settings → Inboxes
CHATWOOT_INBOX_TO_TEAM={"1":1,"2":2,"3":3,"DEFAULT":6}
```

---

## 6️⃣ Configurar Equipos en Chatwoot

### Crear equipos:

1. Ir a **Settings → Teams** en Chatwoot
2. Crear equipos:
   - `CS - San Ángel` (anotar ID)
   - `CS - Angelópolis` (anotar ID)
   - `CS - Sonata` (anotar ID)
   - `CS - Zavaleta` (anotar ID)
   - `CS - 5 Sur` (anotar ID)
   - `CS - General` (anotar ID)
3. Asignar agentes a cada equipo
4. Actualizar `CHATWOOT_BRANCH_TO_TEAM` con los IDs reales

### Crear custom attributes (opcional pero recomendado):

1. Ir a **Settings → Custom Attributes**
2. Crear para **Conversation**:
   - `last_bot_reply_at` (Date)
   - `bot_active` (Checkbox)
   - `human_handling` (Checkbox)
   - `handoff_reason` (Text)
   - `handoff_at` (Date)

---

## 7️⃣ Testing

### Test 1: Bot responde sin agente
```
1. Enviar mensaje a conversación nueva
2. ✅ Bot debe responder normalmente
```

### Test 2: Bot NO responde con agente activo
```
1. Asignar agente a conversación en Chatwoot
2. Agente envía mensaje
3. Cliente responde
4. ✅ Bot NO debe responder
```

### Test 3: Bot retoma después de timeout
```
1. Tener agente asignado pero inactivo > 5 min
2. Cliente envía mensaje
3. ✅ Bot debe responder
```

### Test 4: Handoff explícito
```
1. Cliente escribe "quiero hablar con un humano"
2. ✅ Bot envía mensaje de handoff
3. ✅ Agente recibe nota privada
4. ✅ Conversación se asigna a equipo
```

### Test 5: Agente ve mensajes del bot
```
1. Bot responde a cliente
2. ✅ Agente ve el mensaje en su UI
3. ✅ Conversation se actualiza sin refresh manual
```

---

## 8️⃣ Verificar Sintaxis

```bash
# Verificar que no hay errores de sintaxis
node --check src/integrations/chatwoot_client.js
node --check src/services/handoff_service.js
node --check src/services/agent_gating.js
```

---

## 📋 Checklist

```
□ Backup de chatwoot_client.js original
□ Copiar chatwoot_client.js nuevo
□ Crear handoff_service.js
□ Crear agent_gating.js
□ Agregar imports a chatwoot.js
□ Agregar shouldBotRespond a processChatwootEvent
□ Actualizar detección de "humano"
□ Agregar variables a .env
□ Crear equipos en Chatwoot
□ Obtener IDs de equipos
□ Actualizar CHATWOOT_BRANCH_TO_TEAM
□ Verificar sintaxis
□ Testing
□ Deploy a staging
□ Testing en staging (24-48h)
□ Deploy a producción
```

---

## ⚠️ Notas Importantes

1. **El archivo `chatwoot.js` NO se modifica automáticamente** - Debes agregar los imports y la lógica manualmente siguiendo las instrucciones.

2. **Los team_ids son específicos de TU instalación de Chatwoot** - Debes crearlos y obtener los IDs reales.

3. **El timeout default es 5 minutos** - Ajusta `BOT_AGENT_TIMEOUT_MINUTES` según tus necesidades.

4. **La verificación de agente está habilitada por default** - Puedes deshabilitarla temporalmente con `BOT_AGENT_GATING_ENABLED=false`.

5. **El `touchConversation` ya está integrado en `sendChatwootMessage`** - No necesitas llamarlo manualmente.
