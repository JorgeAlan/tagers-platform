# 🤚 LUCA Iteración 8: "Las Manos"

**Action Bus + Niveles de Autonomía** - LUCA ahora puede escribir, no solo leer.

## Qué son Las Manos

Las Manos es el sistema de ejecución de acciones de LUCA con control humano:

1. **LUCA propone acciones** → ActionBus determina nivel de autonomía
2. **AUTO** → Ejecuta inmediatamente sin preguntar
3. **DRAFT** → Prepara acción, pide confirmación con un click
4. **APPROVAL** → Requiere aprobación explícita
5. **CRITICAL** → Requiere 2FA o doble confirmación

## Arquitectura

```
ITERACIÓN_8/
├── src/
│   ├── actions/
│   │   ├── ActionBus.js               # Router central de acciones
│   │   ├── ActionExecutor.js          # Ejecuta acciones aprobadas
│   │   └── handlers/
│   │       ├── whatsappHandler.js     # Enviar mensajes WhatsApp
│   │       ├── chatwootHandler.js     # Crear notas, tickets, tags
│   │       ├── sheetsHandler.js       # Actualizar Google Sheets
│   │       ├── webhookHandler.js      # Trigger sistemas externos
│   │       └── internalHandler.js     # Acciones internas LUCA
│   │
│   ├── approval/
│   │   └── ApprovalService.js         # Gestión de aprobaciones
│   │
│   ├── autonomy/
│   │   └── AutonomyLevels.js          # Define niveles y permisos
│   │
│   ├── routes/
│   │   └── actions.js                 # API endpoints
│   │
│   └── db/
│       └── action_bus_schema.sql      # Schema de tablas
```

## Niveles de Autonomía

| Nivel | Descripción | Ejemplo |
|-------|-------------|---------|
| **AUTO** | Ejecuta solo, sin preguntar | Crear nota interna, enviar alerta |
| **DRAFT** | Prepara, humano confirma con 1 click | Notificar a socio, cerrar caso |
| **APPROVAL** | Humano debe revisar y aprobar | Contactar staff, enviar PO |
| **CRITICAL** | Requiere 2FA | Bloquear usuario, suspender empleado |

## Acciones Disponibles

### Nivel AUTO (LUCA ejecuta solo)
```javascript
NOTIFY_GERENTE       // Avisar a gerente de sucursal
SEND_ALERT           // Enviar alerta del sistema
CREATE_INTERNAL_NOTE // Crear nota en Chatwoot
ASSIGN_CONVERSATION  // Asignar conversación
TAG_CONVERSATION     // Agregar tag
DRAFT_PURCHASE_ORDER // Crear borrador de PO
CREATE_CASE          // Crear caso de investigación
ESCALATE_CASE        // Escalar caso
```

### Nivel DRAFT (LUCA prepara, humano confirma)
```javascript
NOTIFY_SOCIO               // Avisar a dueño
CREATE_TICKET              // Crear ticket de seguimiento
SUGGEST_SCHEDULE_CHANGE    // Sugerir cambio de horario
UPDATE_PRODUCT_AVAILABILITY // Actualizar disponibilidad
CLOSE_CASE                 // Cerrar caso
```

### Nivel APPROVAL (Requiere aprobación)
```javascript
CONTACT_EVENTUAL_STAFF   // Contactar staff eventual
APPROVE_SHIFT_SWAP       // Aprobar intercambio de turno
SUBMIT_PURCHASE_ORDER    // Enviar PO a proveedor
FLAG_EMPLOYEE            // Marcar para auditoría
INITIATE_INVESTIGATION   // Iniciar investigación
UPDATE_CONFIG            // Actualizar configuración
```

### Nivel CRITICAL (Requiere 2FA)
```javascript
SUSPEND_EMPLOYEE_ACCESS  // Suspender acceso de empleado
BLOCK_POS_USER           // Bloquear usuario en POS
```

## Flujo de una Acción

```
1. Agente/Detector propone acción
         ↓
2. ActionBus.propose(action)
         ↓
3. Determinar nivel de autonomía
         ↓
┌────────┴────────┬────────────┬────────────┐
↓                 ↓            ↓            ↓
AUTO          DRAFT      APPROVAL      CRITICAL
  ↓               ↓            ↓            ↓
Ejecutar     Crear       Encolar     Encolar +
inmediato    draft       para        requerir
             ↓           aprobación  2FA
         Notificar       ↓            ↓
         para         Notificar    Notificar
         confirmar    aprobadores  aprobadores
             ↓           ↓            ↓
         Humano       Humano       Humano
         confirma     aprueba      aprueba
             ↓           ↓            ↓
         Ejecutar    Ejecutar     Verificar
                                  2FA
                                     ↓
                                  Ejecutar
```

## API Endpoints

### Proponer Acción
```bash
POST /api/luca/actions/propose
{
  "type": "NOTIFY_SOCIO",
  "payload": {
    "user_id": "jorge",
    "message": "Alerta de ventas en Condesa"
  },
  "reason": "Caída de 25% detectada",
  "requestedBy": "forense_agent"
}

# Response
{
  "actionId": "ACT-1737144000-abc123",
  "state": "DRAFT",
  "message": "Draft creado, esperando confirmación"
}
```

### Aprobar/Confirmar
```bash
# Confirmar draft
POST /api/luca/actions/ACT-xxx/confirm
{
  "confirmedBy": "jorge"
}

# Aprobar acción
POST /api/luca/actions/ACT-xxx/approve
{
  "approvedBy": "jorge"
}

# Aprobar con 2FA
POST /api/luca/actions/ACT-xxx/approve
{
  "approvedBy": "jorge",
  "code2FA": "123456"
}
```

### Rechazar/Cancelar
```bash
POST /api/luca/actions/ACT-xxx/reject
{
  "rejectedBy": "jorge",
  "reason": "No procede"
}

POST /api/luca/actions/ACT-xxx/cancel
{
  "cancelledBy": "jorge",
  "reason": "Ya no es necesario"
}
```

### Consultar
```bash
# Ver acción específica
GET /api/luca/actions/ACT-xxx

# Listar pendientes
GET /api/luca/actions/pending

# Estadísticas
GET /api/luca/actions/stats

# Configuración de autonomía
GET /api/luca/actions/config
```

### Quick Actions (Atajos)
```bash
# Notificación rápida
POST /api/luca/actions/quick/notify
{
  "user_id": "jorge",
  "message": "Mensaje rápido"
}

# Alerta rápida
POST /api/luca/actions/quick/alert
{
  "title": "Alerta de prueba",
  "message": "Contenido",
  "severity": "HIGH"
}

# Marcar empleado
POST /api/luca/actions/quick/flag-employee
{
  "employee_id": "EMP003",
  "reason": "Patrón sospechoso"
}
```

## Handlers Disponibles

| Handler | Descripción | Integraciones |
|---------|-------------|---------------|
| **whatsapp** | Mensajes WhatsApp | Meta Business API |
| **chatwoot** | CRM y tickets | Chatwoot API |
| **sheets** | Configuración | Google Sheets |
| **webhook** | Sistemas externos | BUK, POS, WooCommerce |
| **internal** | Acciones LUCA | Casos, alertas, flags |

## Estados de una Acción

```
PROPOSED → DRAFT → (confirmación) → APPROVED → EXECUTING → EXECUTED
    ↓         ↓                        ↓            ↓
    ↓     EXPIRED                   REJECTED      FAILED
    ↓
    └→ PENDING_APPROVAL → (aprobación) → APPROVED
           ↓                               ↓
       EXPIRED/REJECTED              PENDING_2FA → (2FA) → APPROVED
```

## Límites por Acción

Cada acción tiene límites configurables:

```javascript
NOTIFY_GERENTE: {
  level: 'AUTO',
  limits: { max_per_hour: 5, max_per_day: 20 }
}

CONTACT_EVENTUAL_STAFF: {
  level: 'APPROVAL',
  limits: { max_contacts: 10 }
}

SUBMIT_PURCHASE_ORDER: {
  level: 'APPROVAL',
  limits: { max_amount: 50000 }
}
```

## Ejemplo: Flujo Completo

```javascript
// 1. El Forense detecta caída y quiere notificar
await actionBus.propose({
  type: "NOTIFY_SOCIO",
  payload: {
    user_id: "jorge",
    message: "Ventas en Condesa cayeron 25% vs semana pasada"
  },
  reason: "Autopsia detectó anomalía",
  requestedBy: "forense_agent"
});

// 2. ActionBus determina: DRAFT (necesita confirmación)
// 3. Jorge recibe notificación en WhatsApp con botón "Confirmar"

// 4. Jorge confirma
await actionBus.confirm("ACT-xxx", "jorge");

// 5. Acción se ejecuta automáticamente
// 6. Jorge recibe el mensaje final
```

## Checklist de Completitud

- [x] ActionBus enruta correctamente según nivel
- [x] Todos los handlers implementados (5 handlers)
- [x] ApprovalService notifica a aprobadores
- [x] Niveles de autonomía respetados
- [x] Auto-execute para nivel AUTO
- [x] Draft con confirmación para DRAFT
- [x] Cola de aprobación para APPROVAL
- [x] 2FA para acciones CRITICAL
- [x] API endpoints completos
- [x] Schema SQL para persistencia
- [x] Quick actions para uso rápido
- [ ] Integración completa con Tower para ver pendientes
- [ ] Cron para procesar expirados

## Próxima Iteración

**Iteración 9: "El Headhunter" + "El Mercader"**
- Staffing dinámico y convocatoria automática
- Inventario y arbitraje de precios

---

🤚 **"Las Manos le dan a LUCA la capacidad de actuar, con el control humano apropiado."**
