# 🦑 LUCA - Luminous Unified Cognitive Assistant

**El socio digital que te ahorra dinero mientras duermes.**

LUCA es un sistema de inteligencia artificial para la gestión operativa de Tagers, una cadena de restaurantes y panaderías en México. Detecta anomalías, investiga problemas, propone soluciones, ejecuta acciones y aprende continuamente.

## Versión: 0.15.0 (Release Final - Zero Hardcode)

---

## 🏗️ Arquitectura

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           LUCA API v0.15.0                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │                    CONFIG HUB (Zero Hardcode)                    │   │
│  │         Google Sheets → Cache → Getters Tipados                  │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  DETECTORES │  │   AGENTES   │  │   ACCIONES  │  │   LEARNING  │   │
│  │  - Fraude   │  │  - Fiscalía │  │  - ActionBus│  │  - Feedback │   │
│  │  - Anomalías│  │  - Forense  │  │  - Autonomía│  │  - Tuning   │   │
│  │  - Staffing │  │  - Showman  │  │  - WooComm  │  │  - Patterns │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  TWIN/SIM   │  │  EXTERNOS   │  │    VOZ      │  │  CHANNELS   │   │
│  │  - Forecast │  │  - Clima    │  │  - TTS      │  │  - WhatsApp │   │
│  │  - Capacity │  │  - Feriados │  │  - Chat     │  │  - Briefing │   │
│  │  - What-if  │  │  - Eventos  │  │  - Podcast  │  │  - Tower    │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 🔧 Config Hub - Zero Hardcode

LUCA ahora soporta configuración 100% dinámica desde Google Sheets.

### Pestañas Soportadas

| Pestaña | Contenido |
|---------|-----------|
| `LUCA_BRANCHES` | Sucursales (ID, lat/lon, baseline, horarios) |
| `LUCA_STAFFING` | Personal por turno y costos |
| `LUCA_THRESHOLDS` | Umbrales de detección |
| `LUCA_WEATHER` | Impacto del clima |
| `LUCA_HOLIDAYS` | Feriados y temporadas |
| `LUCA_FRAUD` | Patrones de fraude |
| `LUCA_CAPACITY` | Capacidades por rol |
| `LUCA_ROI` | Valores de referencia |

### Uso

```javascript
import { lucaConfigHub } from './config/LucaConfigHub.js';

// En cualquier parte del código
const branch = lucaConfigHub.getBranch('SUC-POL');
const threshold = lucaConfigHub.getThreshold('fraud', 'discount_anomaly');
const weatherImpact = lucaConfigHub.getWeatherImpact('rain');
```

### API

```bash
GET  /api/luca/config/health
POST /api/luca/config/refresh
GET  /api/luca/config/branches
GET  /api/luca/config/thresholds
GET  /api/luca/config/weather
```

---

## 📁 Estructura del Proyecto

```
luca-api/
├── src/
│   ├── server.js                 # Entry point
│   ├── config/                   # Configuración
│   │   ├── LucaConfigHub.js      # 🆕 Zero Hardcode Hub
│   │   └── lucaConfig.js         # Legacy config
│   │
│   ├── db/                       # Base de datos
│   │   └── migrations/           # Migraciones SQL
│   │
│   ├── engine/                   # Motor de detección
│   │   └── detectors/            # Detectores base
│   │
│   ├── detectors/                # Detectores específicos
│   │   ├── fraud/                # Fraude (La Fiscalía)
│   │   ├── cx/                   # Customer Experience
│   │   └── sales/                # Ventas
│   │
│   ├── agents/                   # Agentes de IA
│   │   ├── FiscaliaAgent.js      # Fraude
│   │   ├── ForenseAgent.js       # Autopsias
│   │   ├── HeadhunterAgent.js    # Staffing
│   │   ├── MercaderAgent.js      # Inventario
│   │   └── ShowmanAgent.js       # CX
│   │
│   ├── flows/                    # Flujos de trabajo
│   │   └── actionBus/            # Bus de acciones
│   │
│   ├── learning/                 # Sistema de aprendizaje
│   │
│   ├── metrics/                  # Métricas y ROI
│   │
│   ├── twin/                     # Digital Twin
│   │   ├── BranchTwin.js         # 🆕 Usa ConfigHub
│   │   ├── DemandForecaster.js
│   │   ├── CapacityModel.js
│   │   └── Simulator.js
│   │
│   ├── optimization/             # Optimización
│   │   └── StaffingOptimizer.js
│   │
│   ├── voice/                    # Voz y Audio
│   │
│   ├── conversational/           # Chat conversacional
│   │
│   ├── integrations/             # Integraciones externas
│   │   ├── weather/              # Clima (OpenWeather)
│   │   ├── calendar/             # Feriados + Escolar
│   │   └── external/             # Contexto unificado
│   │
│   ├── channels/                 # Canales de comunicación
│   │   ├── whatsapp/
│   │   └── notifications/
│   │
│   └── routes/                   # API Routes (17 archivos)
│       ├── configHub.js          # 🆕 Config API
│       ├── twin.js
│       ├── learning.js
│       └── ...
│
├── LUCA_SHEETS_TEMPLATE.md       # 🆕 Plantilla Google Sheets
└── README_ITERATION_*.md         # Docs por iteración
```

---

## 🚀 Capacidades por Iteración

### Iteraciones 1-3: Fundación
- DB, Registry, Config, Cases, Alerts

### Iteración 4: Los Ojos
- Control Tower PWA

### Iteración 5: La Fiscalía
- Detector de fraude multi-patrón (8 patrones)

### Iteración 6: La Voz
- WhatsApp + Morning Briefing

### Iteración 7: El Forense
- Autopsias automáticas + Memoria institucional

### Iteración 8: Las Manos
- Action Bus + 5 niveles de autonomía

### Iteración 9: Headhunter + Mercader
- Staffing dinámico + Inventario

### Iteración 10: El Showman
- CX & Retention + Win-back campaigns

### Iteración 11: El Podcast
- Audio briefing TTS + Chat conversacional

### Iteración 12: El Aprendiz
- Feedback loop + Threshold tuning + ROI Calculator

### Iteración 13: Los Sentidos
- Clima + Feriados + Eventos + Calendario escolar

### Iteración 14: El Gemelo
- Digital Twin + Demand Forecaster + Simulator + Staffing Optimizer

### Iteración 15: Config Hub 🆕
- **Zero Hardcode** - Toda configuración desde Google Sheets
- Sucursales, umbrales, impactos, capacidades dinámicos
- Cache con refresh automático cada 5 minutos

---

## 🔧 Configuración

### Variables de Entorno

```bash
# Base de datos
DATABASE_URL=postgresql://...
REDIS_URL=redis://...

# OpenAI
OPENAI_API_KEY=sk-...

# Google Sheets (Config Hub)
GOOGLE_SHEET_ID=...                    # Sheet principal
LUCA_CONFIG_SHEET_ID=...               # (opcional) Sheet separado para LUCA
GOOGLE_SERVICE_ACCOUNT_EMAIL=...
GOOGLE_PRIVATE_KEY=...

# WhatsApp (Twilio)
TWILIO_ACCOUNT_SID=...
TWILIO_AUTH_TOKEN=...

# Clima
OPENWEATHER_API_KEY=...
```

---

## 📊 API Endpoints

### Config Hub 🆕
```
GET  /api/luca/config/health
POST /api/luca/config/refresh
GET  /api/luca/config/branches
GET  /api/luca/config/branches/:branchId
GET  /api/luca/config/thresholds
GET  /api/luca/config/weather
GET  /api/luca/config/holidays
GET  /api/luca/config/capacity
GET  /api/luca/config/roi
```

### Core
```
GET  /health
GET  /api/luca/cases
GET  /api/luca/alerts
GET  /api/luca/detectors
```

### Agentes
```
POST /api/luca/agents/fiscalia/investigate
POST /api/luca/agents/forense/autopsy
POST /api/luca/agents/showman/winback
```

### Acciones
```
GET  /api/luca/actions
POST /api/luca/actions/:id/approve
POST /api/luca/actions/:id/execute
```

### Digital Twin
```
GET  /api/luca/twin/forecast/:branchId
POST /api/luca/twin/simulator/run
GET  /api/luca/twin/staffing/optimize/:branchId
```

---

## 🏪 Sucursales (desde Config Hub)

| ID | Nombre | Ciudad | Tipo | Ventas Base |
|----|--------|--------|------|-------------|
| SUC-ANG | Angelópolis | Puebla | flagship | $85,000 |
| SUC-ZAV | Zavaleta | Puebla | standard | $55,000 |
| SUC-POL | Polanco | CDMX | premium | $120,000 |
| SUC-CON | Condesa | CDMX | trendy | $75,000 |
| SUC-ROM | Roma | CDMX | trendy | $78,000 |
| SUC-COY | Coyoacán | CDMX | family | $95,000 |

*Estos valores ahora vienen de Google Sheets y son editables sin deploy.*

---

## 🧠 Filosofía

> "No construyas un dashboard. Construye un socio que te ahorra dinero mientras duermes."

LUCA no es un reporte. LUCA es un empleado digital que:

- ✅ **Vigila 24/7** - Detectores corriendo continuamente
- ✅ **Detecta problemas antes que tú** - Anomalías, fraude, riesgos
- ✅ **Investiga y diagnostica** - Autopsias automáticas
- ✅ **Propone soluciones concretas** - Acciones con ROI estimado
- ✅ **Ejecuta lo que apruebes** - Action Bus con autonomía
- ✅ **Aprende de sus errores** - Feedback loop + threshold tuning
- ✅ **Percibe el entorno** - Clima, eventos, calendario
- ✅ **Predice el futuro** - Forecast + simulación
- ✅ **Se configura sin código** - Zero Hardcode via Google Sheets

---

## 📈 Estadísticas del Proyecto

- **105+ archivos JavaScript**
- **17 archivos de rutas**
- **6 agentes de IA**
- **8 patrones de fraude**
- **5 niveles de autonomía**
- **6 sucursales configuradas**
- **15 iteraciones completadas**
- **12 pestañas de configuración en Sheets**

---

## 🚀 Despliegue

```bash
# Instalar dependencias
npm install

# Ejecutar migraciones
npm run migrate

# Iniciar servidor
npm start
```

---

## 📚 Documentación Adicional

- `LUCA_SHEETS_TEMPLATE.md` - Plantilla para crear pestañas en Google Sheets
- `README_ITERATION_*.md` - Documentación detallada de cada iteración

---

## 🦑 LUCA v0.15.0

**Luminous Unified Cognitive Assistant**

*El socio digital de Tagers - Zero Hardcode Edition*

---

© 2026 Tagers - Desarrollado con Claude AI
