# 📢 LUCA Iteración 6: "La Voz"

**WhatsApp + Morning Briefing** - LUCA ahora habla con los socios.

## ⚠️ ZERO-HARDCODE

Toda la configuración viene de **Google Sheets** via `lucaConfig.js`:
- Nombres y metas de sucursales
- Usuarios y preferencias
- Canales de notificación
- Quiet hours

**NO hay valores hardcodeados.** Los defaults solo se usan si no hay config.

## Configuración via Environment Variables

```bash
# Configuración como JSON (o fetch de Google Sheets en producción)
LUCA_BRANCHES_CONFIG='{"SUC01":{"name":"San Ángel","daily_goal":80000},...}'
LUCA_USERS_CONFIG='{"jorge":{"name":"Jorge","phone":"5255...","role":"owner"},...}'

# O teléfonos individuales
JORGE_PHONE=5255xxxxxxxx
ANDRES_PHONE=5255xxxxxxxx
TANY_PHONE=5255xxxxxxxx
```

## Qué es La Voz

La Voz es el sistema de comunicación de LUCA que:

1. **Envía alertas por WhatsApp** → Según severidad y preferencias
2. **Genera Morning Briefings** → Todos los dueños reciben FULL
3. **Recibe respuestas** → Aprobar/rechazar desde WhatsApp
4. **Respeta quiet hours** → No molesta en la noche

## Arquitectura

```
ITERACIÓN_6/
├── src/
│   ├── config/
│   │   └── lucaConfig.js          # ⭐ Config dinámica (zero-hardcode)
│   │
│   ├── channels/
│   │   ├── whatsapp/
│   │   │   ├── WhatsAppClient.js      # Cliente Meta Business API
│   │   │   ├── templates.js           # Templates pre-aprobados
│   │   │   └── messageFormatter.js    # Formateo de mensajes
│   │   │
│   │   └── notifications/
│   │       ├── NotificationRouter.js  # Decide canal por usuario
│   │       └── NotificationQueue.js   # Cola con rate limiting
│   │
│   ├── briefing/
│   │   ├── BriefingGenerator.js       # Genera el contenido
│   │   ├── BriefingNarrator.js        # Escribe en estilo LUCA
│   │   └── sections/
│   │       ├── salesSection.js        # Datos de ventas
│   │       ├── alertsSection.js       # Alertas activas
│   │       ├── casesSection.js        # Casos abiertos
│   │       └── contextSection.js      # Clima, eventos
│   │
│   ├── jobs/
│   │   └── morningBriefingJob.js      # Cron 8:00 AM
│   │
│   └── routes/
│       └── notifications.js           # API endpoints
```

## Usuarios: Todos Dueños, Todos FULL

**Jorge, Andrés y Tany son dueños** - todos reciben el mismo briefing FULL:

```javascript
// Config en Google Sheets o env var
{
  jorge: {
    name: "Jorge",
    role: "owner",
    briefing_type: "FULL",
    severity_threshold: "LOW",  // Recibe todo
  },
  andres: {
    name: "Andrés", 
    role: "owner",
    briefing_type: "FULL",
    severity_threshold: "LOW",
  },
  tany: {
    name: "Tany",
    role: "owner", 
    briefing_type: "FULL",
    severity_threshold: "LOW",
  },
}
```

## API Endpoints

### Enviar notificaciones
```bash
# Enviar notificación rutada
POST /api/luca/notifications/send
{
  "type": "alert",
  "severity": "HIGH",
  "topic": "fraud",
  "data": { "title": "Alerta de fraude", "message": "..." }
}

# Enviar mensaje directo
POST /api/luca/notifications/send-direct
{
  "phone": "525512345678",
  "message": "Mensaje de prueba"
}
```

### Morning Briefing
```bash
# Preview sin enviar
GET /api/luca/notifications/briefing/preview/jorge?type=FULL

# Enviar a un usuario
POST /api/luca/notifications/briefing/send/jorge

# Trigger para todos
POST /api/luca/notifications/briefing/trigger

# Estado del job
GET /api/luca/notifications/briefing/status
```

### Cola de notificaciones
```bash
# Estado de la cola
GET /api/luca/notifications/queue/status

# Limpiar cola
POST /api/luca/notifications/queue/clear
```

## Rate Limiting

```javascript
const RATE_LIMITS = {
  whatsapp: {
    perUser: { max: 10, windowMs: 60000 },   // 10/min por usuario
    global: { max: 100, windowMs: 60000 },   // 100/min total
  },
};
```

## Variables de Entorno

```bash
# WhatsApp (Meta Business API)
WHATSAPP_TOKEN=your_access_token
WHATSAPP_PHONE_ID=your_phone_id
WHATSAPP_BUSINESS_ID=your_business_id
WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token

# Jobs
ENABLE_BRIEFING=true
```

## Webhook de WhatsApp

```bash
# Configurar en Meta Business Manager
Webhook URL: https://your-domain.com/api/luca/notifications/webhook/whatsapp
Verify Token: ${WHATSAPP_VERIFY_TOKEN}
```

## Personalidad de LUCA

LUCA tiene una personalidad específica al comunicarse:

- **Profesional pero cercano** - No es un bot frío
- **Directo y conciso** - No se va por las ramas
- **Usa emojis moderadamente** - Para claridad, no exceso
- **Menciona datos concretos** - Números específicos
- **Personaliza por usuario** - Sabe quién es cada quien

Ejemplos:
- ✅ "Buenos días Jorge! Ayer facturamos $487K, +8% vs meta."
- ❌ "Estimado usuario, se le informa que las ventas fueron..."

## Checklist de Completitud

- [x] WhatsApp Client conectado a Meta API (mock mode sin credenciales)
- [x] Templates definidos (pendiente aprobación en Meta)
- [x] Alertas pueden enviarse por WhatsApp
- [x] Morning Briefing se genera a las 8am (cron)
- [x] Cada socio recibe su versión personalizada
- [x] Quiet hours respetadas
- [x] Rate limiting funcionando
- [x] Webhook para respuestas de WhatsApp
- [ ] Templates aprobados en Meta Business Manager
- [ ] Audio/Voice TTS (siguiente iteración)

## Próxima Iteración

**Iteración 7: "El Forense"** - Autopsias de días malos + Vector DB
- Detector de caídas de ventas
- Autopsia automática (¿qué pasó?)
- Memoria vectorial para casos similares

---

📢 **"LUCA no solo observa, ahora también habla."**
