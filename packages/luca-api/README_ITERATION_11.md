# 🎙️ LUCA Iteración 11: "El Podcast Matutino"

**Audio Briefing + Interfaz Conversacional** - LUCA habla y escucha.

## El Podcast Matutino 🎙️

El Morning Briefing ahora está disponible en audio:
- Voz natural en español mexicano
- Pausas y ritmo natural
- Duración ~2 minutos
- Enviable por WhatsApp

## Interfaz Conversacional 💬

Habla con LUCA de forma natural:

```
"Oye LUCA, ¿cómo vamos?"
"¿Qué pasa en Zavaleta?"
"¿Hay alertas?"
"Aprueba la PO"
"Mándame el audio"
```

## Arquitectura

```
ITERACIÓN_11/
├── src/
│   ├── voice/
│   │   ├── TTSService.js              # Text-to-Speech (OpenAI/ElevenLabs)
│   │   └── AudioBriefingGenerator.js  # Genera el podcast
│   │
│   ├── conversational/
│   │   ├── LucaConversation.js        # Handler principal de chat
│   │   ├── intents/
│   │   │   └── index.js               # Todos los intents
│   │   └── context/
│   │       └── ConversationContext.js # Mantiene contexto
│   │
│   └── routes/
│       └── voice.js                   # API endpoints
```

## TTS Service

Convierte texto en audio usando:
- **OpenAI TTS** (primario) - Voz "Nova"
- **ElevenLabs** (alternativo) - Voces multilingües

### Características

- Conversión automática de números a palabras en español
- Soporte para pausas naturales: `{pause:short}`, `{pause:medium}`, `{pause:long}`
- División automática de textos largos
- Optimización para móvil
- Almacenamiento local con cleanup automático

### Voces Disponibles

**OpenAI:**
- alloy, echo, fable, onyx, **nova** (default), shimmer

**ElevenLabs:**
- rachel, domi, bella, antoni, josh

## Audio Briefing Generator

Convierte el Morning Briefing en un podcast de ~2 minutos.

### Estructura del Script

```
1. Saludo personalizado
   "Buenos días Jorge."
   
2. Intro
   "Aquí está tu resumen del día."
   
3. Ventas
   "Ayer cerramos en cuatrocientos ochenta y siete mil pesos.
    Eso es ocho por ciento arriba de la meta.
    La estrella fue Angelópolis con ciento cuarenta y dos mil."
    
4. Alertas
   "Tienes dos alertas activas.
    Una crítica: posible fraude en Zavaleta."
    
5. Contexto
   "Para hoy: se espera lluvia en la tarde.
    Sugiero reforzar delivery en San Ángel."
    
6. Cierre
   "Eso es todo por ahora. Que tengas un excelente día."
```

### Templates con Variación

El generador selecciona aleatoriamente entre varias versiones de cada sección para sonar más natural y no repetitivo.

## Sistema Conversacional

### Intents Soportados

| Intent | Ejemplos | Qué hace |
|--------|----------|----------|
| **status** | "¿Cómo vamos?" | Resumen de ventas y alertas |
| **branch** | "¿Qué pasa en Zavaleta?" | Datos de una sucursal |
| **alerts** | "¿Hay alertas?" | Lista alertas activas |
| **action** | "Aprueba la PO" | Aprobar/rechazar acciones |
| **help** | "¿Qué puedes hacer?" | Muestra capacidades |

### Contexto de Conversación

LUCA mantiene contexto durante la conversación:
- Historial de mensajes recientes
- Entidades mencionadas (sucursales, fechas)
- Flujos activos (aprobación, selección)
- TTL: 30 minutos

### Flujos de Múltiples Turnos

```
Usuario: "Aprueba la orden"
LUCA: "Aprobar: Orden de compra para café ($15,000). ¿Confirmas?"
Usuario: "Sí"
LUCA: "✅ Aprobado. La acción se ejecutará."
```

### Fallback a LLM

Para preguntas complejas no reconocidas, LUCA usa GPT-4 como fallback manteniendo su personalidad.

## API Endpoints

### Text-to-Speech

```bash
# Generar audio desde texto
POST /api/luca/voice/tts
{
  "text": "Buenos días, aquí está tu resumen.",
  "voice": "nova",
  "provider": "openai"
}

# Listar voces disponibles
GET /api/luca/voice/tts/voices
```

### Audio Briefing

```bash
# Generar briefing de audio
POST /api/luca/voice/briefing
{
  "user_id": "jorge",
  "name": "Jorge",
  "send_to_whatsapp": true,
  "phone": "5215512345678"
}

# Preview del script (sin generar audio)
GET /api/luca/voice/briefing/preview?name=Jorge

# Obtener archivo de audio
GET /api/luca/voice/audio/:filename
```

### Conversacional

```bash
# Enviar mensaje
POST /api/luca/voice/chat
{
  "user_id": "jorge",
  "message": "¿Cómo vamos?",
  "channel": "whatsapp"
}

# Mensaje de WhatsApp
POST /api/luca/voice/chat/whatsapp
{
  "phone": "5215512345678",
  "message": "¿Qué pasa en Zavaleta?"
}

# Obtener contexto
GET /api/luca/voice/chat/context/:userId

# Eliminar contexto
DELETE /api/luca/voice/chat/context/:userId

# Detectar intent (sin ejecutar)
POST /api/luca/voice/detect-intent
{
  "message": "¿Hay alertas?"
}
```

### Status

```bash
# Estado del sistema
GET /api/luca/voice/status

# Limpiar archivos antiguos
POST /api/luca/voice/cleanup
{
  "max_age_days": 7
}
```

## Configuración

### Variables de Entorno

```bash
# TTS
OPENAI_API_KEY=sk-xxx              # OpenAI API key
ELEVENLABS_API_KEY=xxx             # ElevenLabs API key (opcional)
AUDIO_STORAGE_PATH=/tmp/luca-audio # Directorio para audios
```

### Configuración de Conversación

```javascript
const CONFIG = {
  minConfidenceThreshold: 0.4,  // Mínimo para usar intent
  llmFallbackEnabled: true,     // Usar LLM para preguntas no reconocidas
  llmModel: "gpt-4o-mini",
  maxTokens: 500,
};
```

## Ejemplo de Respuestas

### Audio Briefing Response
```json
{
  "success": true,
  "script": "Buenos días Jorge...",
  "audio": {
    "success": true,
    "filepath": "/tmp/luca-audio/briefing_1737144000000.mp3",
    "filename": "briefing_1737144000000.mp3",
    "duration": 95,
    "format": "mp3",
    "size": 152400
  }
}
```

### Chat Response
```json
{
  "text": "Ayer cerramos en $487,520, 8% arriba de la meta. 📈\n\nMejor: Angelópolis. Atención: San Ángel.\n\nTienes 2 alertas activas.",
  "intent": "status",
  "confidence": 0.95,
  "suggestions": [
    "Más detalles de ventas",
    "¿Hay alertas?",
    "¿Cómo va Angelópolis?"
  ]
}
```

### Intent Detection
```json
{
  "intent": "alerts",
  "confidence": 0.92,
  "recognized": true
}
```

## Checklist de Completitud

- [x] TTS funciona con OpenAI
- [x] TTS fallback a ElevenLabs
- [x] Conversión números a palabras en español
- [x] Script con pausas naturales
- [x] Audio ~2 minutos
- [x] Chat básico funciona ("¿Cómo vamos?")
- [x] Intent detection con 5 intents
- [x] Contexto se mantiene (30 min TTL)
- [x] Flujos de múltiples turnos
- [x] Fallback a LLM
- [x] API endpoints completos
- [ ] Envío real por WhatsApp (audio)
- [ ] Integración con KISS para entrada de voz

## Próxima Iteración

**Iteración 12: "El Aprendiz"** - Observabilidad + Feedback
- Sistema aprende de errores
- UI para feedback y tuning
- Métricas de detectores
- Weekly learning reports

---

🎙️ **"LUCA habla y escucha. Tu briefing, cuando lo necesites."**
