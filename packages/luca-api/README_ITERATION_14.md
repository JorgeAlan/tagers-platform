# 🔮 LUCA Iteración 14: "El Gemelo"

**Digital Twin + Simulador** - LUCA predice y simula el futuro.

## El Gemelo 🔮

LUCA ahora tiene un "gemelo digital" de cada sucursal que permite:
- 📊 **Forecast de demanda** (por hora y día)
- 🔮 **Simulación "What if"** (¿qué pasa si...?)
- 👥 **Optimización de staffing**
- ⚙️ **Modelado de capacidad**

## Arquitectura

```
ITERACIÓN_14/
├── src/
│   ├── twin/
│   │   ├── BranchTwin.js          # Modelo de sucursal
│   │   ├── DemandForecaster.js    # Predice demanda
│   │   ├── CapacityModel.js       # Capacidad operativa
│   │   └── Simulator.js           # "What if" engine
│   │
│   ├── optimization/
│   │   └── StaffingOptimizer.js   # Optimiza plantilla
│   │
│   └── routes/
│       └── twin.js                # API endpoints
```

## Branch Twin 🏪

Modelo digital de cada sucursal:

### Configuración por Sucursal
```javascript
{
  id: "SUC-POL",
  name: "Polanco",
  city: "CDMX",
  type: "premium",
  
  capacity: {
    tables: 30,
    seats: 100,
    maxOccupancy: 120,
    kitchenStations: 5,
  },
  
  hours: {
    open: "07:00",
    close: "23:00",
    peakHours: ["08:00-10:00", "13:00-15:00", "19:00-22:00"],
  },
  
  baseline: {
    dailySales: 120000,
    avgTicket: 220,
    dailyTransactions: 545,
    peakHourFactor: 2.0,
  },
}
```

### Sucursales Configuradas
| ID | Nombre | Ciudad | Tipo | Ventas Base |
|----|--------|--------|------|-------------|
| SUC-ANG | Angelópolis | Puebla | flagship | $85,000 |
| SUC-ZAV | Zavaleta | Puebla | standard | $55,000 |
| SUC-POL | Polanco | CDMX | premium | $120,000 |
| SUC-CON | Condesa | CDMX | trendy | $75,000 |
| SUC-ROM | Roma | CDMX | trendy | $78,000 |
| SUC-COY | Coyoacán | CDMX | family | $95,000 |

## Demand Forecaster 📊

Predice demanda combinando múltiples factores:

### Factores de Predicción
1. **Día de semana**
   - Sábado: +20%
   - Domingo: +15%
   - Lunes: -15%

2. **Estacionalidad mensual**
   - Enero (Rosca): +15%
   - Mayo (Madres): +10%
   - Julio (Vacaciones): -15%

3. **Hora del día**
   - Desayuno (8-9am): +40%
   - Comida (13-14h): +50%
   - Valle (15-17h): -40%

4. **Externos** (de Iteración 13)
   - Clima
   - Feriados
   - Eventos locales

### Ejemplo de Forecast
```json
{
  "branchId": "SUC-POL",
  "date": "2026-01-17",
  "expectedSales": 144000,
  "expectedTransactions": 654,
  "factors": {
    "dayOfWeek": { "day": 6, "factor": 1.20 },
    "month": { "month": 1, "factor": 1.15 },
    "external": { "weather": 0.95, "calendar": 1.0 }
  },
  "hourly": [
    { "hour": 7, "expectedTransactions": 32 },
    { "hour": 8, "expectedTransactions": 65 },
    { "hour": 13, "expectedTransactions": 82 }
  ]
}
```

## Capacity Model ⚙️

Modela la capacidad operativa:

### Capacidad por Rol
| Rol | Capacidad/Hora |
|-----|----------------|
| Barista | 30 bebidas |
| Cocina | 12 platos |
| Piso | 20 clientes |
| Caja | 45 transacciones |

### Identificación de Cuellos de Botella
```javascript
// Analiza dónde se satura primero
{
  bottleneck: "kitchen",
  utilization: 0.95,
  isOverCapacity: false,
  headroom: 15  // transacciones adicionales posibles
}
```

### Umbrales de Utilización
| Estado | Rango | Acción |
|--------|-------|--------|
| Óptimo | 60-80% | ✅ Normal |
| Advertencia | 80-95% | ⚠️ Monitorear |
| Crítico | >95% | 🔴 Reforzar |
| Subutilizado | <60% | 🔵 Reducir |

## Simulator 🔮

Motor de simulación "What if":

### Tipos de Escenarios

#### 1. Cambio de Demanda
```javascript
// ¿Qué pasa si aumentamos 20% las ventas?
{
  type: "demand_change",
  params: { changePercent: 20 }
}
// Respuesta: Necesitas +3 empleados, cocina será cuello de botella
```

#### 2. Cambio de Staff
```javascript
// ¿Qué pasa si quitamos 1 cocinero?
{
  type: "staff_change",
  params: { staffChanges: { kitchen: -1 } }
}
// Respuesta: Utilización sube a 95%, NO recomendado
```

#### 3. Evento Climático
```javascript
// ¿Qué pasa si hay tormenta?
{
  type: "weather_event",
  params: { weatherType: "storm", intensity: "heavy" }
}
// Respuesta: -40% dine-in, +20% delivery, reducir staff piso
```

#### 4. Fecha Especial
```javascript
// ¿Cuánto personal para Día de Reyes?
{
  type: "special_date",
  params: { dateName: "dia_de_reyes" }
}
// Respuesta: Necesitas 18 empleados (+6 vs normal)
```

#### 5. Cambio de Precios
```javascript
// ¿Qué pasa si subimos precios 10%?
{
  type: "price_change",
  params: { priceChangePercent: 10, elasticity: -0.5 }
}
// Respuesta: -5% transacciones, +4.5% ventas netas
```

## Staffing Optimizer 👥

Optimiza la plantilla de personal:

### Niveles de Servicio
| Nivel | Utilización Target | Descripción |
|-------|-------------------|-------------|
| PREMIUM | 65% | Servicio excepcional |
| STANDARD | 75% | Balance óptimo |
| EFFICIENT | 85% | Eficiencia alta |
| LEAN | 90% | Mínimo viable |

### Optimización por Turno
```json
{
  "branchId": "SUC-POL",
  "date": "2026-01-17",
  "serviceLevel": "Standard",
  "shifts": [
    {
      "name": "morning",
      "hours": "07:00 - 12:00",
      "staff": { "baristas": 4, "kitchen": 3, "floor": 2, "cashier": 2 },
      "expectedDemand": 85
    },
    {
      "name": "afternoon",
      "hours": "12:00 - 18:00",
      "staff": { "baristas": 5, "kitchen": 4, "floor": 3, "cashier": 3 },
      "expectedDemand": 120
    }
  ],
  "totals": {
    "totalCost": 12500,
    "currentCost": 14200,
    "savings": 1700,
    "savingsPercent": 12
  }
}
```

### Generación de Horarios Semanales
Genera horario optimizado para toda la semana con:
- Staff recomendado por turno
- Costo total vs actual
- Ahorro potencial

## API Endpoints

### Branch Twin

```bash
# Lista sucursales
GET /api/luca/twin/branches

# Detalle de sucursal
GET /api/luca/twin/branches/:branchId

# Configuración completa
GET /api/luca/twin/branches/:branchId/config
```

### Demand Forecast

```bash
# Forecast del día
GET /api/luca/twin/forecast/:branchId?date=2026-01-17

# Forecast rango
GET /api/luca/twin/forecast/:branchId/range?days=7

# Forecast todas las sucursales
GET /api/luca/twin/forecast/all

# Resumen para briefing
GET /api/luca/twin/forecast/summary
```

### Capacity

```bash
# Capacidad de sucursal
GET /api/luca/twin/capacity/:branchId

# Capacidad todas las sucursales
GET /api/luca/twin/capacity/all

# Analizar escenario específico
POST /api/luca/twin/capacity/:branchId/analyze
```

### Simulator

```bash
# Tipos de escenarios
GET /api/luca/twin/simulator/scenarios

# Ejecutar simulación
POST /api/luca/twin/simulator/run
{
  "branch_id": "SUC-POL",
  "scenario": {
    "type": "demand_change",
    "params": { "changePercent": 30 }
  }
}

# Comparar escenarios
POST /api/luca/twin/simulator/compare
```

### Staffing Optimization

```bash
# Niveles de servicio
GET /api/luca/twin/staffing/levels

# Optimizar día
GET /api/luca/twin/staffing/optimize/:branchId

# Optimizar semana
GET /api/luca/twin/staffing/optimize/:branchId/week

# Generar horario semanal
GET /api/luca/twin/staffing/schedule/:branchId

# Comparar niveles de servicio
GET /api/luca/twin/staffing/compare/:branchId

# Resumen todas las sucursales
GET /api/luca/twin/staffing/summary
```

## Ejemplo de Simulación Completa

**Pregunta:** "¿Qué pasa si hay tormenta el Día de Reyes?"

```bash
POST /api/luca/twin/simulator/run
{
  "branch_id": "SUC-POL",
  "scenario": {
    "type": "custom",
    "params": {
      "factors": {
        "dia_de_reyes": 2.0,    // +100%
        "storm": 0.6            // -40%
      }
    }
  }
}
```

**Respuesta:**
```json
{
  "baseline": { "dailySales": 120000 },
  "simulated": {
    "combinedFactor": 1.2,
    "dailySales": 144000
  },
  "impact": {
    "salesDiff": 24000,
    "salesDiffPercent": 20,
    "utilization": 0.88,
    "status": "warning"
  },
  "recommendations": [
    {
      "priority": "HIGH",
      "action": "Planificar staff adicional",
      "details": "Demanda esperada 20% arriba del baseline"
    },
    {
      "priority": "CRITICAL",
      "action": "Maximizar producción de rosca"
    },
    {
      "priority": "MEDIUM",
      "action": "Reforzar delivery por tormenta"
    }
  ]
}
```

## Checklist de Completitud

- [x] BranchTwin con configuración de 6 sucursales
- [x] Forecast diario funciona
- [x] Forecast por hora funciona
- [x] Considera día de semana y mes
- [x] Considera externos (clima, eventos)
- [x] Simulador "what if" con 6 tipos de escenarios
- [x] Modelo de capacidad con cuellos de botella
- [x] Recomendaciones de staffing
- [x] Optimización por nivel de servicio
- [x] API endpoints completos
- [ ] UI de simulación en Tower (futuro)
- [ ] Integración con datos históricos reales

## Filosofía Final

> "No construyas un dashboard. Construye un socio que te ahorra dinero mientras duermes."

LUCA es un empleado digital que:
- ✅ Vigila 24/7
- ✅ Detecta problemas antes que tú
- ✅ Investiga y diagnostica
- ✅ Propone soluciones concretas
- ✅ Ejecuta lo que apruebes
- ✅ Aprende de sus errores
- ✅ Percibe el entorno
- ✅ **Predice el futuro**
- Y te cuenta todo en 2 minutos cada mañana

---

🔮 **"LUCA anticipa la demanda y optimiza recursos antes de que los necesites."**
