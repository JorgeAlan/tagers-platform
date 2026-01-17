# 🦑 LUCA API - Iteración 2: El Motor de Ejecución

**"Los Músculos"** - El sistema puede ejecutar detectores, generar runs, y crear findings.

## Qué hay de nuevo en v0.2.0

### Tablas de Registry
- `registry_sources` - Fuentes de datos registradas
- `registry_datasets` - Datasets por fuente
- `registry_data_products` - Data Products (lo que LUCA consume)
- `registry_metrics` - Métricas definidas
- `registry_detectors` - Detectores configurados

### Tablas de Ejecución
- `detector_runs` - Historial de ejecuciones con métricas
- `detector_findings` - Hallazgos generados por detectores
- `finding_labels` - Feedback para mejorar detectores

### Servicios
- `registryService.js` - Carga y cachea configuración
- `runService.js` - CRUD de runs
- `findingService.js` - CRUD de findings y labeling

### Engine
- `BaseDetector.js` - Clase base para todos los detectores
- `detectorRunner.js` - Factory para ejecutar detectores
- `scheduledRunner.js` - Job scheduler con BullMQ

### Detectores Implementados
- `salesAnomalyDetector.js` - "El Forense" - Detecta anomalías en ventas

## API Endpoints

### Config / Registry
```
GET  /api/luca/config          - Resumen del registry
POST /api/luca/config/reload   - Forzar recarga
```

### Detectores
```
GET  /api/luca/detectors       - Lista todos los detectores
GET  /api/luca/detectors/:id   - Detalle de un detector
POST /api/luca/detectors/:id/trigger - Ejecutar manualmente
```

### Runs
```
GET  /api/luca/runs            - Lista runs con filtros
GET  /api/luca/runs/recent     - Runs recientes (dashboard)
GET  /api/luca/runs/stats      - Estadísticas de runs
GET  /api/luca/runs/:id        - Detalle de un run + findings
POST /api/luca/runs/:id/cancel - Cancelar run en curso
```

### Findings
```
GET  /api/luca/findings              - Lista findings con filtros
GET  /api/luca/findings/unlabeled    - Para queue de labeling
GET  /api/luca/findings/stats        - Estadísticas
GET  /api/luca/findings/:id          - Detalle
POST /api/luca/findings/:id/label    - Etiquetar (true/false positive)
POST /api/luca/findings/:id/acknowledge - Marcar como visto
POST /api/luca/findings/:id/dismiss  - Descartar
```

### Queue
```
GET /api/luca/queue - Estado del scheduler
```

## Cómo usar

### Ejecutar un detector manualmente
```bash
curl -X POST http://localhost:3002/api/luca/detectors/sales_anomaly/trigger \
  -H "Content-Type: application/json" \
  -d '{"triggeredBy": "jorge", "scope": {"branches": ["ALL"]}}'
```

### Ver runs recientes
```bash
curl http://localhost:3002/api/luca/runs/recent
```

### Ver findings sin etiquetar
```bash
curl http://localhost:3002/api/luca/findings/unlabeled
```

### Etiquetar un finding
```bash
curl -X POST http://localhost:3002/api/luca/findings/FND-20260117-ABC1/label \
  -H "Content-Type: application/json" \
  -d '{
    "label": "true_positive",
    "labeled_by": "jorge",
    "notes": "Confirmado: error de TPV"
  }'
```

## Detectores Configurados

| ID | Nombre | Agente | Schedule | Output |
|---|---|---|---|---|
| `sales_anomaly` | Detector de Anomalías en Ventas | El Forense | 8am, 2pm, 8pm | alert |
| `fraud_discounts` | Detector de Sweethearting | La Fiscalía | 10pm diario | case |
| `sales_hourly_pattern` | Patrón de Ventas por Hora | El Profeta | Cada hora | insight |
| `no_sales_alert` | Alerta Sin Ventas | El Vigilante | Cada 30 min | alert |

## Crear un nuevo detector

1. Crear clase que extienda `BaseDetector`:

```javascript
import { BaseDetector } from "../BaseDetector.js";

export class MiDetector extends BaseDetector {
  async analyze(data, scope) {
    const findings = [];
    
    // Tu lógica de detección aquí
    if (condicionAnomala) {
      findings.push({
        type: "anomaly",
        severity: "high",
        title: "Título del hallazgo",
        description: "Descripción detallada",
        branch_id: "SUC01",
        metric_value: valorActual,
        baseline_value: valorEsperado,
        deviation_pct: porcentajeDesviacion,
        evidence: { datosAdicionales }
      });
    }
    
    return findings;
  }
}
```

2. Registrar en `detectorRunner.js`:
```javascript
const DETECTOR_CLASSES = {
  "mi_detector": MiDetector,
  // ...
};
```

3. Insertar en `registry_detectors`:
```sql
INSERT INTO registry_detectors (
  detector_id, name, category, agent_name,
  input_data_products, output_type, schedule, thresholds
) VALUES (
  'mi_detector', 'Mi Detector', 'sales', 'El Nombre',
  ARRAY['dp_sales_daily'], 'alert', '0 8 * * *',
  '{"threshold": 10}'
);
```

## Variables de Entorno

```bash
# Habilitar scheduler automático
ENABLE_SCHEDULER=true

# Puerto (default 3002)
PORT=3002
```

## Próxima Iteración

**Iteración 3: "El Sistema Nervioso"** - Case Management completo
- Findings → Alerts → Cases → Actions
- State Machine de casos
- Routing de alertas según preferencias
- Audit log completo
