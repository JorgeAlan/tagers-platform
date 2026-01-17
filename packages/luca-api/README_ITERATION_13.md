# 👁️ LUCA Iteración 13: "Los Sentidos"

**Integraciones Externas** - LUCA percibe el mundo exterior.

## Los Sentidos 👁️

LUCA ahora conecta con fuentes externas que afectan las ventas:
- ☀️ **Clima** (OpenWeather API)
- 📅 **Feriados** (Calendario México)
- 🎭 **Eventos Locales** (Conciertos, deportes)
- 🏫 **Calendario Escolar** (SEP)

## Arquitectura

```
ITERACIÓN_13/
├── src/
│   ├── integrations/
│   │   ├── weather/
│   │   │   ├── WeatherService.js      # OpenWeather API
│   │   │   └── WeatherImpact.js       # Modelo de impacto
│   │   │
│   │   ├── calendar/
│   │   │   ├── MexicoHolidays.js      # Feriados MX
│   │   │   ├── LocalEvents.js         # Eventos locales
│   │   │   └── SchoolCalendar.js      # Calendario escolar
│   │   │
│   │   └── external/
│   │       └── ExternalContext.js     # Agregador de contexto
│   │
│   └── routes/
│       └── external.js                # API endpoints
```

## Weather Service ☀️

Conecta con OpenWeather API para:
- Clima actual por sucursal
- Forecast de 5 días
- Alertas meteorológicas

### Ubicaciones de Sucursales
```javascript
const BranchLocations = {
  "SUC-ANG": { name: "Angelópolis", lat: 19.0270, lon: -98.2263, city: "Puebla" },
  "SUC-ZAV": { name: "Zavaleta", lat: 19.0117, lon: -98.2149, city: "Puebla" },
  "SUC-POL": { name: "Polanco", lat: 19.4326, lon: -99.1971, city: "CDMX" },
  "SUC-CON": { name: "Condesa", lat: 19.4111, lon: -99.1744, city: "CDMX" },
  "SUC-ROM": { name: "Roma", lat: 19.4195, lon: -99.1618, city: "CDMX" },
  "SUC-COY": { name: "Coyoacán", lat: 19.3467, lon: -99.1617, city: "CDMX" },
};
```

### Condiciones Detectadas
- clear, partly_cloudy, cloudy, overcast
- light_rain, rain, heavy_rain, drizzle
- thunderstorm, mist, fog
- Temperatura: isHot (>30°C), isCold (<15°C)

## Weather Impact Model 📊

Predice cómo el clima afecta ventas:

### Impacto por Condición
| Condición | Dine-in | Delivery | Bebidas Frías |
|-----------|---------|----------|---------------|
| **Lluvia** | -20% | +15% | - |
| **Lluvia Fuerte** | -35% | +25% | - |
| **Calor Extremo** | -10% | +20% | +30% |
| **Frío** | +5% | +5% | -20% |

### Ajustes por Ciudad
```javascript
CityAdjustments = {
  CDMX: {
    rain_sensitivity: 1.3,    // Más sensible a lluvia (tráfico)
    heat_sensitivity: 0.8,
  },
  Puebla: {
    rain_sensitivity: 1.0,
    heat_sensitivity: 1.0,
  },
};
```

### Recomendaciones Automáticas
- 🌧️ Lluvia → "Reforzar delivery", "Promoción Día Lluvioso"
- 🔥 Calor → "Push bebidas frías", "Verificar AC"
- ❄️ Frío → "Destacar bebidas calientes y pan dulce"

## Mexico Holidays 📅

Calendario completo de días especiales:

### Feriados Nacionales
- Año Nuevo, Día de Reyes, Día de la Independencia
- Revolución, Navidad, etc.

### Días Comerciales
- **Día de Reyes** (6 enero) → +100% 🎂 TEMPORADA ROSCA
- **Día de las Madres** (10 mayo) → +100%
- **San Valentín** (14 febrero) → +50%
- **Día de Muertos** (2 noviembre) → +50% 💀

### Temporadas Especiales
```javascript
// Detecta temporadas automáticamente
isRoscaSeason()      // 2-6 enero
isPanDeMuertoSeason() // 15 oct - 2 nov
```

### Detección de Puentes
Identifica automáticamente días de puente entre feriados y fines de semana.

## Local Events 🎭

Eventos que afectan tráfico por zona:

### Tipos de Eventos
- CONCERT (+30% sucursales cercanas)
- SPORTS (+25%, +40% bebidas)
- FESTIVAL (+40%)
- MARATHON (-30% delivery)
- PARADE (-20% delivery)

### Venues Conocidos
```javascript
// CDMX
Foro Sol (65,000), Estadio Azteca (87,000), 
Palacio de Deportes (22,000), Auditorio Nacional (10,000)

// Puebla
Estadio Cuauhtémoc (51,726)
```

### Cálculo de Impacto
- Considera distancia de sucursal al evento
- Más cerca = más impacto
- Radio de 5km para considerar evento relevante

## School Calendar 🏫

Calendario escolar oficial SEP:

### Información Disponible
- Períodos de vacaciones
- Días de asueto
- Semana Santa (fecha variable)
- Regreso a clases

### Impacto en Tráfico
| Período | Impacto |
|---------|---------|
| Vacaciones Verano | -15% |
| Vacaciones Invierno | -20% |
| Semana Santa | -25% |
| Día normal | Sin ajuste |

### Zonas Escolares
Identifica sucursales en zonas de alta densidad escolar para ajustar expectativas de tráfico.

## External Context 🔮

Agregador de todas las fuentes:

```javascript
const context = await externalContext.getContext(date, { branchId });

// Retorna:
{
  weather: { current, forecast, impact },
  calendar: { holidays, seasons, isPuente },
  events: { today, upcoming, branchImpact },
  school: { isSchoolDay, vacations },
  combinedImpact: { overall, factors },
  recommendations: [...],
  alerts: [...],
}
```

### Impacto Combinado
Calcula efecto total de todos los factores:
```javascript
combinedImpact = weather × calendar × events × school
```

## API Endpoints

### Weather

```bash
# Clima actual
GET /api/luca/external/weather/current/:branchId

# Forecast
GET /api/luca/external/weather/forecast/:branchId?days=5

# Todas las sucursales
GET /api/luca/external/weather/all

# Impacto del clima
GET /api/luca/external/weather/impact/:branchId
```

### Calendar

```bash
# Hoy
GET /api/luca/external/calendar/today

# Fecha específica
GET /api/luca/external/calendar/date/2026-01-06

# Próximos días especiales
GET /api/luca/external/calendar/upcoming?days=30

# Temporadas
GET /api/luca/external/calendar/seasons
```

### Events

```bash
# Eventos del día
GET /api/luca/external/events/date/:date

# Próximos eventos
GET /api/luca/external/events/upcoming?days=7&city=CDMX

# Impacto en sucursal
GET /api/luca/external/events/impact/:branchId

# Añadir evento
POST /api/luca/external/events
```

### School

```bash
# Estado escolar hoy
GET /api/luca/external/school/today

# Impacto tráfico
GET /api/luca/external/school/traffic/:branchId

# Próximas vacaciones
GET /api/luca/external/school/vacations
```

### Unified Context

```bash
# Contexto completo
GET /api/luca/external/context?branch_id=SUC-POL

# Contexto para briefing
GET /api/luca/external/context/briefing

# Señales de demanda
GET /api/luca/external/context/demand/:branchId
```

## Configuración

### Variables de Entorno
```bash
OPENWEATHER_API_KEY=your_api_key_here
```

## Ejemplo de Contexto

```json
{
  "date": "2026-01-06",
  "weather": {
    "current": {
      "condition": "rain",
      "temperature": 18,
      "description": "lluvia moderada"
    },
    "impact": {
      "overall": -0.15,
      "byService": { "dine_in": -0.20, "delivery": 0.15 }
    }
  },
  "calendar": {
    "isSpecialDay": true,
    "holidays": [{ "name": "Día de Reyes", "impact": 2.0 }],
    "isRoscaSeason": true
  },
  "events": {
    "today": []
  },
  "school": {
    "isSchoolDay": false,
    "vacationName": "Vacaciones de Invierno"
  },
  "combinedImpact": {
    "overall": 1.65,
    "overallFormatted": "+65%",
    "factors": [
      { "source": "calendar", "factor": 2.0, "description": "Día de Reyes" },
      { "source": "weather", "factor": 0.85, "description": "lluvia" }
    ]
  },
  "recommendations": [
    { "priority": "HIGH", "action": "Maximizar producción de rosca" },
    { "priority": "MEDIUM", "action": "Reforzar delivery por lluvia" }
  ]
}
```

## Checklist de Completitud

- [x] Weather API conectado (OpenWeather)
- [x] Forecast diario disponible
- [x] Impacto calculado por sucursal
- [x] Calendario de feriados MX
- [x] Temporadas especiales (Rosca, Pan de Muerto)
- [x] Eventos locales básicos
- [x] Calendario escolar SEP
- [x] Contexto unificado para briefing
- [x] API endpoints completos
- [ ] Integración con detectores (usar contexto)
- [ ] Google Trends (futuro)

## Próxima Iteración

**Iteración 14: "El Gemelo"** - Digital Twin Básico
- Forecast de demanda por hora
- Simulador "What if"
- Optimización de staffing
- UI de simulación

---

👁️ **"LUCA percibe el clima, los eventos y el calendario para anticipar la demanda."**
