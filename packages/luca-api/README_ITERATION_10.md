# 🎭 LUCA Iteración 10: "El Showman"

**CX & Customer Retention** - Recupera clientes y previene churn.

## El Showman 🎭

El Showman cuida la salud de la relación con los clientes:

- **Identifica** clientes en riesgo de abandono
- **Analiza** señales de churn (por qué se van)
- **Genera** mensajes de win-back personalizados
- **Ejecuta** campañas de retención
- **Trackea** efectividad y aprende
- **Celebra** éxitos recuperados

## Customer Health Score

Score compuesto basado en 5 componentes:

| Componente | Peso | Cálculo |
|------------|------|---------|
| **RECENCY** | 30% | Días desde última visita |
| **FREQUENCY** | 25% | Visitas por mes |
| **MONETARY** | 20% | Ticket vs promedio tienda |
| **SENTIMENT** | 15% | Score de satisfacción |
| **ENGAGEMENT** | 10% | Interacciones por mes |

### Categorías de Salud

| Categoría | Score | Acción | Emoji |
|-----------|-------|--------|-------|
| **HEALTHY** | ≥ 0.7 | Nurture | 💚 |
| **AT_RISK** | ≥ 0.4 | Win-back light | 💛 |
| **CHURNING** | ≥ 0.2 | Win-back agresivo | 🧡 |
| **CHURNED** | < 0.2 | Reactivación | ❤️ |

### Señales de Churn

```javascript
// Señales que el Showman detecta:
- FREQUENCY_DROP    → Caída en frecuencia de visitas
- RECENCY_WARNING   → Muchos días sin visitar
- TICKET_DROP       → Caída en ticket promedio
- NEGATIVE_SENTIMENT → Sentimiento negativo reciente
- UNRESOLVED_COMPLAINT → Queja sin resolver
```

## Flujo del Showman

```
1. GET CUSTOMERS    → Obtener clientes para análisis
      ↓
2. IDENTIFY AT RISK → Calcular Health Score, categorizar
      ↓
3. ANALYZE SIGNALS  → Detectar señales de churn
      ↓
4. GENERATE WINBACK → Crear mensaje personalizado
      ↓
5. EXECUTE CAMPAIGN → Enviar via ActionBus (DRAFT)
      ↓
6. CHECK WINS       → Verificar clientes recuperados
      ↓
7. LEARN & CELEBRATE → Guardar en memoria, reportar
```

## Detectores de CX

### ChurnRiskDetector
Detecta clientes en riesgo de abandono basado en:
- Health Score bajo
- Múltiples señales de churn
- VIPs mostrando warning signs

### ComplaintSpikeDetector
Detecta picos anómalos de quejas por:
- Sucursal
- Categoría (servicio, producto, etc.)
- Canal (WhatsApp, Instagram, etc.)

### SentimentDropDetector
Detecta caídas en sentimiento a través de:
- Conversaciones (Chatwoot/KISS)
- Reviews (Google, TripAdvisor)
- Encuestas de satisfacción

## API Endpoints

### Showman Agent

```bash
# Ejecutar flujo completo
POST /api/luca/cx/run
{
  "branch_id": "SUC01"
}

# Resumen para briefing
GET /api/luca/cx/summary

# Wins recientes
GET /api/luca/cx/wins
```

### Health Score

```bash
# Calcular health score de un cliente
POST /api/luca/cx/health-score
{
  "customerId": "CUST001",
  "daysSinceLastVisit": 45,
  "visitsLast30Days": 0,
  "avgTicketRatio": 1.2,
  "avgSentiment": 3.5,
  "interactionsLast30Days": 1
}

# Calcular en batch
POST /api/luca/cx/health-score/batch
{
  "customers": [...]
}

# Detectar señales de churn
POST /api/luca/cx/churn-signals
{
  "currentData": {...},
  "historicalData": {...}
}
```

### Detectores

```bash
# Ejecutar detector de churn
POST /api/luca/cx/detect/churn-risk

# Ejecutar detector de quejas
POST /api/luca/cx/detect/complaint-spike

# Ejecutar detector de sentimiento
POST /api/luca/cx/detect/sentiment-drop

# Ejecutar todos los detectores
POST /api/luca/cx/detect/all
```

### Campañas

```bash
# Listar campañas activas
GET /api/luca/cx/campaigns

# Detalle de campaña
GET /api/luca/cx/campaigns/:campaignId

# Trackear resultado
POST /api/luca/cx/campaigns/:campaignId/track
{
  "event": "OFFER_REDEEMED",
  "data": { "orderValue": 150 }
}
```

### Métricas

```bash
# Métricas de CX
GET /api/luca/cx/metrics

# Estado del sistema
GET /api/luca/cx/status
```

## Templates de Mensajes

### Win-back Light (10% descuento)
```
¡Hola {name}! 👋

Te extrañamos en Tagers. Han pasado {days} días desde tu última visita.

¿Se te antoja un {producto favorito}?

Como agradecimiento por ser parte de nuestra familia, 
te regalamos un *10% de descuento* en tu próxima visita.

¡Te esperamos! 🥐☕

_Código: WIN1234_
```

### Win-back Agresivo (20% descuento)
```
¡{name}, te echamos de menos! 💙

Ha pasado un tiempo desde que nos visitaste y 
queremos que sepas que eres importante para nosotros.

{Hook personalizado basado en historial}

Para que regreses, te ofrecemos un *20% de descuento* 
en todo tu pedido.

¿Qué dices? ¡Vuelve pronto! 🎁

_Código: AGG1234 - Válido 7 días_
```

### Reactivación (30% descuento)
```
{name}, ¡hace mucho que no te vemos! 😢

Han pasado {days} días y realmente te extrañamos.

Mucho ha cambiado en Tagers y queremos que lo descubras.

Tenemos una oferta especial SOLO para ti:
🎁 *30% de descuento* en cualquier compra

Este código es exclusivo y expira pronto. 
¿Nos das otra oportunidad?

_Código: REACT1234 - Válido hasta {fecha}_
```

## Arquitectura

```
ITERACIÓN_10/
├── src/
│   ├── agents/
│   │   ├── ShowmanAgent.js            # Agente principal
│   │   └── CustomerHealthScore.js     # Cálculo de health score
│   │
│   ├── detectors/
│   │   └── cx/
│   │       ├── ChurnRiskDetector.js   # Detecta riesgo de churn
│   │       ├── ComplaintSpikeDetector.js  # Detecta picos de quejas
│   │       └── SentimentDropDetector.js   # Detecta caídas de sentimiento
│   │
│   └── routes/
│       └── cx.js                      # API endpoints
```

## Configuración

### Umbrales de Health Score

```javascript
// Recency (días sin visita)
healthy: { max: 14, score: 1.0 }
warning: { max: 30, score: 0.7 }
risk: { max: 60, score: 0.4 }
churned: { min: 60, score: 0.1 }

// Frequency (visitas/mes)
vip: { min: 4, score: 1.0 }
regular: { min: 2, score: 0.8 }
occasional: { min: 1, score: 0.5 }
rare: { min: 0, score: 0.2 }
```

### Configuración de Campañas

```javascript
WINBACK_LIGHT: {
  channel: "whatsapp",
  autonomyLevel: "DRAFT",
  offerValue: 10,  // %
}

WINBACK_AGGRESSIVE: {
  channel: "whatsapp",
  autonomyLevel: "APPROVAL",
  offerValue: 20,
}

REACTIVATION: {
  channel: "whatsapp",
  autonomyLevel: "APPROVAL",
  offerValue: 30,
}
```

## Ejemplo de Resultados

### Showman Run
```json
{
  "runId": "showman_1737144000000",
  "status": "completed",
  "customersAnalyzed": 100,
  "atRiskIdentified": 15,
  "campaignsCreated": [
    {
      "customerId": "CUST001",
      "customerName": "María García",
      "campaignType": "WINBACK_LIGHT",
      "actionId": "ACT-xxx",
      "actionState": "DRAFT"
    }
  ],
  "wins": [
    {
      "customerId": "CUST050",
      "customerName": "Carlos López",
      "daysToReturn": 3,
      "orderValue": 180,
      "usedOffer": true
    }
  ]
}
```

### Health Score Response
```json
{
  "healthScore": {
    "score": 0.35,
    "category": "CHURNING",
    "action": "winback_aggressive",
    "color": "orange",
    "emoji": "🧡",
    "components": {
      "recency": { "value": 45, "score": 0.4, "weight": 0.3 },
      "frequency": { "value": 0, "score": 0.2, "weight": 0.25 },
      "monetary": { "value": 1.2, "score": 0.7, "weight": 0.2 },
      "sentiment": { "value": 3.5, "score": 0.6, "weight": 0.15 },
      "engagement": { "value": 1, "score": 0.5, "weight": 0.1 }
    }
  },
  "recommendation": {
    "type": "WINBACK_AGGRESSIVE",
    "priority": "HIGH",
    "tactics": ["significant_discount", "direct_call", "special_experience"]
  }
}
```

## Checklist de Completitud

- [x] Customer Health Score calculado (5 componentes)
- [x] Detecta clientes at-risk automáticamente
- [x] Genera mensajes personalizados con hooks
- [x] Integra producto favorito en mensajes
- [x] Ejecuta campañas via ActionBus
- [x] Trackea resultados de campañas
- [x] 3 detectores de CX operativos
- [x] Calcula win-back potential
- [x] API endpoints completos
- [ ] Integración real con Chatwoot/KISS
- [ ] Integración con Redshift para datos reales
- [ ] Dashboard de métricas de CX

## Próxima Iteración

**Iteración 11: "El Podcast Matutino"**
- Morning Briefing en audio (TTS)
- Interfaz conversacional ("Oye LUCA, ¿cómo vamos?")

---

🎭 **"El Showman convierte clientes perdidos en clientes leales."**
