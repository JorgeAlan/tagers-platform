# 🎯 LUCA Iteración 9: "El Headhunter" + "El Mercader"

**Staffing Dinámico + Supply Chain Inteligente** - Dos nuevos agentes especializados.

## El Headhunter 🎯

Asegura que siempre haya personal suficiente mediante staffing dinámico.

### Flujo del Headhunter

```
1. PREDICT      → Forecast de personal necesario por día/turno
      ↓
2. DETECT       → Encuentra gaps vs programación actual
      ↓
3. SEARCH       → Filtra eventuales por rating, disponibilidad, recencia
      ↓
4. DRAFT        → Prepara mensajes de convocatoria personalizados
      ↓
5. SEND         → Envía via ActionBus (requiere APPROVAL)
      ↓
6. PROCESS      → Procesa respuestas de candidatos
      ↓
7. CONFIRM      → Asigna turno en BUK, notifica a gerente
```

### Capacidades

- **Predicción de demanda**: Calcula personal necesario según día, estacionalidad
- **Detección de gaps**: Compara demanda vs horarios programados
- **Selección inteligente**: Rankea eventuales por rating, recencia, skills
- **Convocatoria automática**: Mensajes personalizados por WhatsApp
- **Procesamiento de respuestas**: Acepta/rechaza y asigna automáticamente
- **Integración BUK**: Lee horarios, ausencias; escribe asignaciones

### API Endpoints

```bash
# Ejecutar flujo completo
POST /api/luca/staffing/run
{
  "branch_id": "SUC01",
  "lookahead_days": 2
}

# Detectar gaps sin convocar
GET /api/luca/staffing/gaps?branch_id=SUC01&days=3

# Procesar respuesta de candidato
POST /api/luca/staffing/response
{
  "convocatoria_id": "CONV-xxx",
  "phone": "5255123456789",
  "response": "sí acepto"
}

# Horarios programados
GET /api/luca/staffing/schedules?branch_id=SUC01

# Lista de eventuales
GET /api/luca/staffing/eventuals?min_rating=4.0

# Asignar turno
POST /api/luca/staffing/assign
{
  "employee_id": "EVT001",
  "branch_id": "SUC01",
  "date": "2026-01-20",
  "start_time": "07:00",
  "end_time": "15:00"
}
```

---

## El Mercader 📦

Optimiza inventario y compras de manera inteligente.

### Flujo del Mercader

```
1. MONITOR      → Vigila niveles de inventario
      ↓
2. DETECT       → Identifica stock bajo, agotado, sobre-stock
      ↓
3. ANALYZE      → Compara precios, detecta inflación
      ↓
4. RECOMMEND    → Genera recomendaciones de compra
      ↓
5. DRAFT PO     → Crea borradores de órdenes de compra
      ↓
6. SAVINGS      → Calcula oportunidades de ahorro
```

### Capacidades

- **Monitoreo de stock**: Revisa niveles vs mínimos por sucursal
- **Detección proactiva**: Alertas antes de quedarse sin stock
- **Análisis de precios**: Compara proveedores, detecta tendencias
- **Arbitraje**: Identifica cuando otro proveedor es más barato
- **Generación de POs**: Borradores automáticos con items consolidados
- **Reporte de ahorros**: Cuantifica oportunidades de optimización

### API Endpoints

```bash
# Ejecutar flujo completo
POST /api/luca/inventory/run
{
  "branch_id": "SUC01"
}

# Resumen de inventario
GET /api/luca/inventory/summary?branch_id=SUC01

# Detectar problemas
GET /api/luca/inventory/issues?branch_id=SUC01

# Oportunidades de ahorro
GET /api/luca/inventory/savings

# Niveles de inventario
GET /api/luca/inventory/levels?branch_id=SUC01&below_minimum=true

# Precios de producto
GET /api/luca/inventory/product/PROD001/prices

# Historial de precios
GET /api/luca/inventory/product/PROD001/price-history?days=90

# Crear borrador de PO
POST /api/luca/inventory/po/draft
{
  "branch_id": "SUC01",
  "supplier_id": "SUP001",
  "items": [
    {"productId": "PROD001", "quantity": 50, "unitPrice": 25.50}
  ]
}

# Lista de proveedores
GET /api/luca/inventory/suppliers
```

---

## Arquitectura

```
ITERACIÓN_9/
├── src/
│   ├── agents/
│   │   ├── HeadhunterAgent.js     # Staffing dinámico
│   │   └── MercaderAgent.js       # Supply chain
│   │
│   ├── integrations/
│   │   ├── buk/
│   │   │   └── BukClient.js       # API de BUK (RRHH)
│   │   │
│   │   └── inventory/
│   │       └── InventoryClient.js # API de inventario
│   │
│   └── routes/
│       ├── staffing.js            # Endpoints Headhunter
│       └── inventory.js           # Endpoints Mercader
```

## Configuración

### Variables de Entorno

```bash
# BUK (RRHH)
BUK_API_URL=https://api.buk.cl/v1
BUK_API_KEY=xxx
BUK_COMPANY_ID=xxx

# Inventario (Marketman u otro)
INVENTORY_API_URL=https://api.inventario.com
INVENTORY_API_KEY=xxx
```

### Configuración de Staffing

```javascript
// Requerimientos por tipo de día
const STAFFING_REQUIREMENTS = {
  weekday: {
    morning: { min: 3, optimal: 4 },
    afternoon: { min: 3, optimal: 4 },
  },
  weekend: {
    morning: { min: 4, optimal: 5 },
    afternoon: { min: 4, optimal: 6 },
  },
  holiday: {
    morning: { min: 5, optimal: 6 },
    afternoon: { min: 5, optimal: 7 },
  },
};

// Criterios de selección de eventuales
const SELECTION_CRITERIA = {
  minRating: 3.5,
  maxDaysSinceLastShift: 60,
  preferredRating: 4.0,
  maxCandidatesToContact: 10,
};
```

### Configuración de Inventario

```javascript
// Umbrales de detección
const DETECTION_THRESHOLDS = {
  lowStockDays: 3,           // Alertar si stock < 3 días
  priceIncreaseAlert: 10,    // Alertar si precio +10%
  minSavingsToReport: 100,   // MXN mínimo para reportar
};

// Configuración de reorden por categoría
const REORDER_CONFIG = {
  ingredients: { reorderPoint: 1.5, priority: "HIGH" },
  packaging: { reorderPoint: 1.2, priority: "MEDIUM" },
  supplies: { reorderPoint: 1.0, priority: "LOW" },
};
```

## Integraciones

### BUK (Sistema de RRHH)

| Método | Función |
|--------|---------|
| `getSchedules()` | Obtener horarios programados |
| `getEventualEmployees()` | Lista de eventuales activos |
| `getEmployeeAvailability()` | Disponibilidad por fecha |
| `getAbsences()` | Ausencias/vacaciones |
| `assignShift()` | Asignar turno |
| `confirmShift()` | Confirmar turno |
| `cancelShift()` | Cancelar turno |

### Sistema de Inventario

| Método | Función |
|--------|---------|
| `getInventoryLevels()` | Niveles actuales por sucursal |
| `getInventoryAlerts()` | Alertas activas |
| `getSuppliers()` | Lista de proveedores |
| `getProductPrices()` | Precios por proveedor |
| `getPriceHistory()` | Historial de precios |
| `getProjectedConsumption()` | Proyección de consumo |
| `createPurchaseOrderDraft()` | Crear borrador de PO |

## Checklist de Completitud

### Headhunter
- [x] Predice demanda de personal
- [x] Detecta gaps correctamente
- [x] Filtra eventuales por criterios (rating, disponibilidad)
- [x] Genera mensajes personalizados
- [x] Envía convocatorias via ActionBus
- [x] Procesa respuestas de candidatos
- [x] Integración con BUK (mock ready)
- [ ] Integración real con BUK API

### Mercader
- [x] Monitorea niveles de inventario
- [x] Detecta stock bajo/agotado/exceso
- [x] Compara precios entre proveedores
- [x] Detecta inflación de precios
- [x] Genera órdenes de compra automáticamente
- [x] Calcula oportunidades de ahorro
- [x] Integración genérica (mock ready)
- [ ] Integración real con Marketman

## Ejemplo de Resultados

### Headhunter Run
```json
{
  "runId": "headhunter_1737144000000",
  "status": "completed",
  "gaps_found": [
    {
      "gapId": "GAP-SUC01-2026-01-20-morning",
      "branchId": "SUC01",
      "date": "2026-01-20",
      "shift": "morning",
      "required": 4,
      "scheduled": 2,
      "deficit": 2,
      "severity": "HIGH"
    }
  ],
  "convocatorias_created": [
    {
      "convocatoriaId": "CONV-xxx",
      "candidatesFound": 5,
      "actionState": "PENDING_APPROVAL"
    }
  ]
}
```

### Mercader Run
```json
{
  "runId": "mercader_1737144000000",
  "status": "completed",
  "issues_found": [
    {
      "type": "LOW_STOCK",
      "productName": "Café molido",
      "currentLevel": 5,
      "minimumLevel": 10,
      "daysOfStock": 1.4,
      "severity": "HIGH"
    }
  ],
  "pos_drafted": [
    {
      "poId": "PO-DRAFT-xxx",
      "supplierName": "Café Premium MX",
      "items": 3,
      "estimatedTotal": 5800
    }
  ],
  "savings_opportunities": [
    {
      "productName": "Harina",
      "currentPrice": 28.00,
      "alternativePrice": 25.50,
      "totalSavings": 250
    }
  ]
}
```

---

## Próxima Iteración

**Iteración 10: "El Showman"** - CX & Retention
- Customer Health Score
- Churn Risk Detection
- Win-back Campaigns
- Integración KISS + Encuestas + Reviews

---

🎯 **"El Headhunter asegura personal, El Mercader asegura productos."**
