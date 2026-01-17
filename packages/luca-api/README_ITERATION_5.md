# 🔍 LUCA Iteración 5: "La Fiscalía"

**El primer detector completo end-to-end** - Detección, investigación, diagnóstico y generación de expedientes de fraude.

## Qué es La Fiscalía

La Fiscalía es un sistema de detección de fraude que:

1. **Detecta** → Ejecuta patterns de fraude sobre transacciones
2. **Investiga** → Profundiza en findings sospechosos
3. **Diagnostica** → Genera hipótesis y diagnóstico
4. **Recomienda** → Propone acciones específicas
5. **Documenta** → Genera expediente PDF con toda la evidencia

## Arquitectura

```
ITERACIÓN_5/
├── src/
│   ├── detectors/
│   │   └── fraud/
│   │       ├── FiscaliaDetector.js       # Detector principal
│   │       ├── patterns/
│   │       │   ├── sweetheartingPattern.js   # Descuentos a conocidos
│   │       │   ├── cashPreferencePattern.js  # Preferencia por efectivo
│   │       │   ├── timeConcentrationPattern.js # Horarios sospechosos
│   │       │   └── collusionPattern.js       # Colusión cajero-mesero-cliente
│   │       └── investigator/
│   │           ├── FraudInvestigator.js  # Profundiza en findings
│   │           └── EvidenceCollector.js  # Recolecta evidencia
│   │
│   ├── agents/
│   │   └── FiscaliaAgent.js              # Orquesta todo el flujo
│   │
│   └── templates/
│       └── expediente_fraude.html        # Template para PDF
```

## Patrones de Fraude

### 1. Sweethearting (Descuentos a Conocidos)

Detecta cuando un empleado da descuentos excesivos a amigos/familiares.

**Señales:**
- % descuento > 2σ vs peers
- Mismo cliente repite > 3 veces en 7 días
- Descuentos tipo "cortesía" frecuentes
- Alta proporción de efectivo

**Pesos de confianza:**
```javascript
{
  discountAnomaly: 0.35,
  customerRepeat: 0.30,
  cashPreference: 0.20,
  timePattern: 0.15,
}
```

### 2. Cash Preference (Preferencia por Efectivo)

Detecta preferencia anormal por efectivo en transacciones con descuento.

**Señales:**
- % efectivo en descuentos > 80%
- % efectivo del empleado > peers + 30%
- Ticket promedio en efectivo menor que tarjeta

### 3. Time Concentration (Concentración Horaria)

Detecta descuentos concentrados en horarios específicos (baja supervisión).

**Señales:**
- Alto coeficiente de Gini (concentración)
- Match con horas de baja supervisión (7-8am, 9-11pm)
- Patrón diferente al resto de empleados

### 4. Collusion (Colusión)

Detecta combinaciones repetidas de cajero + mesero + cliente.

**Señales:**
- Misma combinación > 3 veces
- Descuento aplicado en cada ocasión
- Varianza baja en montos (pedidos similares)

## FiscaliaAgent - Flujo Completo

```javascript
import { FiscaliaAgent } from "./agents/FiscaliaAgent.js";

const agent = new FiscaliaAgent({
  autoInvestigate: true,
  autoCreateCase: true,
  minSeverityForCase: "HIGH",
});

const result = await agent.run({
  branch_id: "SUC01",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-17",
});

console.log(result);
// {
//   status: "completed",
//   phases: {
//     detect: { findings_count: 3 },
//     investigate: { investigations_count: 3 },
//     diagnose: { diagnoses_count: 3 },
//     recommend: { recommendations_count: 3 },
//   },
//   cases_created: [{ case_id: "CASE-20260117-XXXX" }],
//   alerts_created: [],
// }
```

## FiscaliaDetector - Uso Independiente

```javascript
import { FiscaliaDetector } from "./detectors/fraud/FiscaliaDetector.js";

const detector = new FiscaliaDetector();

const result = await detector.execute({
  branch_id: "SUC01",
  dateFrom: "2026-01-10",
  dateTo: "2026-01-17",
});

console.log(result.findings);
// [
//   {
//     type: "sweethearting",
//     pattern_name: "Descuentos a Conocidos",
//     severity: "HIGH",
//     confidence: 0.78,
//     employee_id: "EMP003",
//     branch_id: "SUC01",
//     title: "Posible sweethearting detectado - Empleado EMP003",
//     evidence: { ... },
//   }
// ]
```

## Investigator - Profundizar en Finding

```javascript
import FraudInvestigator from "./investigator/FraudInvestigator.js";

const investigation = await FraudInvestigator.investigate(finding, "DEEP");

console.log(investigation.hypotheses);
// [
//   {
//     hypothesis: "Fraude intencional",
//     confidence: 0.7,
//     recommended_actions: ["Revisar cámaras", "Auditar transacciones"],
//   },
//   {
//     hypothesis: "Desconocimiento de políticas",
//     confidence: 0.4,
//     recommended_actions: ["Re-capacitar"],
//   }
// ]
```

## Generar Expediente

```javascript
const expediente = await agent.generateExpediente("CASE-20260117-XXXX");

console.log(expediente);
// {
//   metadata: { case_id, generated_at, version },
//   cover: { title, subtitle, severity },
//   executive_summary: { conclusion, risk_level },
//   evidence: { transactions, patterns },
//   hypotheses: [ ... ],
//   recommended_actions: [ ... ],
//   timeline: [ ... ],
//   signatures: { investigator, reviewer, approver },
// }
```

## Severidad y Acciones

| Severidad | Confianza | Acción Automática |
|-----------|-----------|-------------------|
| CRITICAL | ≥85% | Crear caso + Notificar owner |
| HIGH | ≥70% | Crear caso + Notificar gerente |
| MEDIUM | ≥55% | Crear alerta |
| LOW | <55% | Solo logging |

## Acciones Recomendadas por Severidad

### CRITICAL / HIGH
- Investigación inmediata (requiere aprobación)
- Revisión de cámaras de seguridad
- Notificar al gerente
- Generar expediente formal
- Considerar suspensión temporal (solo CRITICAL)

### MEDIUM / LOW
- Notificar al gerente
- Programar re-capacitación
- Monitoreo incrementado

## Estructura de un Finding

```javascript
{
  type: "sweethearting",
  pattern_name: "Descuentos a Conocidos",
  severity: "HIGH",
  confidence: 0.78,
  employee_id: "EMP003",
  branch_id: "SUC01",
  
  title: "Posible sweethearting detectado - Empleado EMP003",
  description: "Descuentos 45% superiores al promedio. 2 cliente(s) repiten frecuentemente.",
  
  evidence: {
    discount_anomaly: {
      avgDiscountPct: 18.5,
      globalAvgDiscountPct: 12.7,
      zScore: 2.4,
      topDiscounts: [ ... ],
    },
    customer_repeat: {
      repeatCustomerCount: 2,
      topRepeatCustomers: [ ... ],
    },
    cash_preference: {
      cashPctInDiscounts: 0.82,
      globalCashPct: 0.25,
    },
    time_pattern: {
      giniCoefficient: 0.58,
      peakHour: 21,
    },
  },
  
  signals: [
    { type: "discount_anomaly", severity: "high" },
    { type: "customer_repeat", severity: "medium" },
    { type: "cash_preference", severity: "high" },
  ],
}
```

## Datos de Prueba

El detector incluye generación de datos de prueba cuando no hay tabla de transacciones disponible. Un empleado "sospechoso" (EMP003) es simulado con:

- 40% probabilidad de descuento (vs 10% normal)
- 80% de descuentos en efectivo
- Cliente repetido "CUST_FRIEND_001"

## Integración con Case Management

La Fiscalía se integra con el sistema de casos de la Iteración 3:

1. **Crea caso** con `caseService.createCase()`
2. **Agrega evidencia** con `caseService.addEvidence()`
3. **Registra hipótesis** con `caseService.addHypothesis()`
4. **Recomienda acciones** con `caseService.recommendAction()`

El caso sigue el flujo del state machine:
```
OPEN → INVESTIGATING → DIAGNOSED → RECOMMENDED → APPROVED → EXECUTED → CLOSED
```

## Checklist de Completitud

- [x] Todos los patterns implementados (4/4)
- [x] Investigator profundiza correctamente
- [x] Genera template de expediente
- [x] Crea caso automáticamente
- [x] Recomienda acciones específicas
- [x] Routing correcto (configurable)
- [ ] PDF generation (template listo, puppeteer pendiente)
- [ ] Feedback loop para labels (siguiente iteración)

## Próxima Iteración

**Iteración 6: "La Voz"** - WhatsApp + Morning Briefing
- Notificaciones por WhatsApp
- Morning Briefing diario para socios
- Voice TTS para briefings

---

🦑 **"Nadie sospecha del cajero simpático hasta que LUCA revisa los números."**
