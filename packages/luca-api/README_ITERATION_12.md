# 📚 LUCA Iteración 12: "El Aprendiz"

**Observabilidad + Feedback** - LUCA aprende de sus errores.

## El Aprendiz 📚

Sistema de aprendizaje continuo que:
- Recolecta feedback (TP/FP/TN/FN)
- Ajusta umbrales automáticamente
- Descubre nuevos patterns
- Calcula ROI generado
- Genera reportes semanales

## Ciclo de Aprendizaje

```
1. COLLECT    → Recolectar feedback (explícito + implícito)
      ↓
2. ANALYZE    → Calcular métricas (precision, recall, F1)
      ↓
3. ADJUST     → Ajustar umbrales automáticamente
      ↓
4. DOCUMENT   → Generar reporte semanal
      ↓
5. REPEAT     → Ciclo continuo de mejora
```

## Arquitectura

```
ITERACIÓN_12/
├── src/
│   ├── learning/
│   │   ├── FeedbackProcessor.js    # Procesa labels
│   │   ├── ThresholdTuner.js       # Ajusta umbrales
│   │   └── PatternLearner.js       # Aprende patterns
│   │
│   ├── metrics/
│   │   ├── DetectorMetrics.js      # Precision, Recall
│   │   ├── ActionMetrics.js        # Success rate
│   │   └── ROICalculator.js        # $ saved/generated
│   │
│   ├── reports/
│   │   └── WeeklyLearningReport.js # Reporte semanal
│   │
│   └── routes/
│       └── learning.js             # API endpoints
```

## Feedback Processor

Recolecta 3 tipos de feedback:

### 1. Labels Explícitos
Usuario marca directamente:
- **TP** (True Positive): Alerta correcta
- **FP** (False Positive): Falsa alarma
- **TN** (True Negative): Correctamente no alertó
- **FN** (False Negative): Debió alertar

### 2. Señales Implícitas
Inferido del comportamiento:
- **ACK**: Usuario vio la alerta
- **IGN**: Usuario ignoró
- **ACT**: Se tomó acción
- **ESC**: Se escaló

### 3. Resultados Medidos
Basado en outcomes:
- **RES**: Problema resuelto
- **REC**: Problema recurrió
- **PRV**: Problema prevenido

## Threshold Tuner

Ajuste automático de umbrales basado en reglas:

| Condición | Acción |
|-----------|--------|
| FP rate > 30% | Subir umbral 10% |
| FN rate > 20% | Bajar umbral 5% |
| Cambio > 15% | Requiere aprobación |

### Límites de Seguridad
- Máximo 3 ajustes automáticos/semana
- Cooldown de 24h entre ajustes
- Cambios grandes requieren aprobación

## Pattern Learner

Descubre patterns automáticamente de:
- **False Negatives** (qué se perdió)
- **Casos exitosos** (qué funcionó)

### Tipos de Patterns
- **THRESHOLD**: Umbral en métrica
- **SEQUENCE**: Secuencia de eventos
- **TEMPORAL**: Patrón de tiempo
- **COMBINATION**: Múltiples condiciones

### Ciclo de vida
```
DISCOVERED → VALIDATING → APPROVED → ACTIVE
                              ↓
                          REJECTED
```

## Métricas de Detectores

| Métrica | Fórmula | Descripción |
|---------|---------|-------------|
| **Precision** | TP / (TP + FP) | Qué % de alertas fueron correctas |
| **Recall** | TP / (TP + FN) | Qué % de problemas detectamos |
| **F1 Score** | 2 * P * R / (P + R) | Balance entre P y R |
| **FP Rate** | FP / (FP + TN) | Tasa de falsas alarmas |
| **Ack Rate** | ACK / (ACK + IGN) | Qué % de alertas se ven |

## ROI Calculator

Trackea el valor generado por LUCA:

### Categorías de Impacto
- **LOSS_PREVENTED**: Pérdidas evitadas (fraude)
- **COST_SAVED**: Costos ahorrados
- **REVENUE_GENERATED**: Ingresos generados
- **TIME_SAVED**: Tiempo ahorrado

### Fuentes de Impacto
- Fraud detection
- Inventory optimization
- Staffing optimization
- Customer retention
- Automation

### Cálculo de ROI
```
ROI = (Valor Generado - Costo LUCA) / Costo LUCA × 100%
```

## Weekly Learning Report

Reporte automático semanal que incluye:

1. **Resumen Ejecutivo**
   - Precisión promedio
   - Valor generado
   - ROI
   - Estado general

2. **Performance de Detectores**
   - Ranking por F1 score
   - Tendencias
   - Alertas

3. **Ajustes de Umbrales**
   - Ajustes realizados
   - Pendientes de aprobación

4. **Patterns Descubiertos**
   - Nuevos discoveries
   - Aprobados recientemente

5. **Recomendaciones**
   - Prioridad HIGH/MEDIUM
   - Acciones sugeridas

## API Endpoints

### Feedback

```bash
# Registrar feedback
POST /api/luca/learning/feedback
{
  "finding_id": "FND-001",
  "label": "TP",
  "user_id": "jorge",
  "comment": "Fraude confirmado"
}

# Tipos de feedback
GET /api/luca/learning/feedback/types

# Resumen
GET /api/luca/learning/feedback/summary
```

### Threshold Tuning

```bash
# Estado del tuner
GET /api/luca/learning/tuning/status

# Analizar detector
POST /api/luca/learning/tuning/analyze/:detector

# Aplicar ajuste
POST /api/luca/learning/tuning/apply
{
  "detector": "fraud_detector",
  "adjustment": { "direction": "up", "percentChange": 10 },
  "approved_by": "jorge"
}

# Aprobar pendiente
POST /api/luca/learning/tuning/approve/:detector

# Ver pendientes
GET /api/luca/learning/tuning/pending

# Auto-tune
POST /api/luca/learning/tuning/auto-tune
```

### Patterns

```bash
# Listar patterns
GET /api/luca/learning/patterns?state=discovered

# Resumen
GET /api/luca/learning/patterns/summary

# Aprobar pattern
POST /api/luca/learning/patterns/:patternId/approve

# Rechazar pattern
POST /api/luca/learning/patterns/:patternId/reject
```

### Métricas

```bash
# Métricas de detectores
GET /api/luca/learning/metrics/detectors?period=weekly

# Métricas de un detector
GET /api/luca/learning/metrics/detectors/:detector

# Ranking
GET /api/luca/learning/metrics/detectors/ranking

# Métricas de acciones
GET /api/luca/learning/metrics/actions
```

### ROI

```bash
# Registrar impacto
POST /api/luca/learning/roi/impact
{
  "source": "fraud_detection",
  "category": "loss_prevented",
  "amount": 15000,
  "description": "Fraude prevenido en caso X"
}

# Calcular ROI
GET /api/luca/learning/roi?period=monthly

# Reporte completo
GET /api/luca/learning/roi/report
```

### Reportes

```bash
# Generar reporte semanal
POST /api/luca/learning/reports/weekly

# Último reporte
GET /api/luca/learning/reports/weekly/latest

# Historial
GET /api/luca/learning/reports/weekly/history
```

## Ejemplo de Weekly Report

```json
{
  "id": "WLR-1737144000000",
  "sections": {
    "executiveSummary": {
      "status": { "status": "GOOD", "emoji": "✅" },
      "highlights": [
        { "metric": "Precisión Promedio", "value": "78%", "trend": "📈" },
        { "metric": "Valor Generado", "value": "$45,000 MXN", "trend": "📈" },
        { "metric": "ROI", "value": "350%", "trend": "🚀" }
      ]
    },
    "detectorPerformance": {
      "summary": {
        "avgPrecision": 0.78,
        "improving": 3,
        "declining": 1
      }
    },
    "recommendations": {
      "items": [
        {
          "priority": "HIGH",
          "title": "Revisar fraud_detector",
          "description": "Precisión de 55% está por debajo del objetivo"
        }
      ]
    }
  }
}
```

## Checklist de Completitud

- [x] FeedbackProcessor con 3 tipos de feedback
- [x] Labels se guardan correctamente
- [x] ThresholdTuner con reglas automáticas
- [x] Límites de seguridad (max ajustes, cooldown)
- [x] PatternLearner descubre patterns
- [x] DetectorMetrics calcula P/R/F1
- [x] ActionMetrics trackea success rate
- [x] ROICalculator calcula valor generado
- [x] WeeklyLearningReport genera reportes
- [x] API endpoints completos
- [ ] Persistencia en DB (actualmente in-memory)
- [ ] UI de feedback en Tower
- [ ] Cron job para reportes semanales

## Próxima Iteración

**Iteración 13: "Los Sentidos"** - Integraciones Externas
- Weather API (OpenWeather)
- Calendario de feriados México
- Eventos locales
- Impacto del clima en ventas

---

📚 **"LUCA aprende de cada error para ser mejor mañana."**
