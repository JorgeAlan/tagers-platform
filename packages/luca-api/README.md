# LUCA API - Complete Fix Package

## Resumen de Problemas y Soluciones

### 1. Dockerfile (build failure)
**Problema:** `pnpm install --frozen-lockfile` fallaba porque no existe `pnpm-lock.yaml`
**Solución:** Fallback pattern + copia de `pnpm-workspace.yaml`

### 2. package.json (runtime errors)
**Problema:** Dependencias faltantes
**Solución:** Agregados:
- `bullmq: ^5.34.0`
- `googleapis: ^144.0.0`

### 3. scheduledRunner.js (BullMQ API deprecada)
**Problema:** `QueueScheduler` fue eliminado en BullMQ v4+
**Solución:** Removido `QueueScheduler` - ya no es necesario en versiones modernas

### 4. FiscaliaAgent.js (5 imports rotos)
**Problema:** Rutas relativas incorrectas
**Cambios:**
```javascript
// ANTES (incorrecto)
import { FiscaliaDetector } from "./FiscaliaDetector.js";
import FraudInvestigator from "./investigator/FraudInvestigator.js";
import EvidenceCollector from "./investigator/EvidenceCollector.js";
import { createCase... } from "../../services/caseService.js";
import { createAlert } from "../../services/alertService.js";

// DESPUÉS (correcto)
import { FiscaliaDetector } from "../detectors/fraud/FiscaliaDetector.js";
import FraudInvestigator from "../detectors/fraud/investigator/FraudInvestigator.js";
import EvidenceCollector from "../detectors/fraud/investigator/EvidenceCollector.js";
import { createCase... } from "../services/caseService.js";
import { createAlert } from "../services/alertService.js";
```

### 5. Detectores CX (3 archivos)
**Archivos:** `ChurnRiskDetector.js`, `ComplaintSpikeDetector.js`, `SentimentDropDetector.js`
**Problema:** Import de BaseDetector incorrecto
**Cambio:** `../BaseDetector.js` → `../../engine/BaseDetector.js`

### 6. ForenseDetector.js
**Problema:** Import de BaseDetector incorrecto
**Cambio:** `../engine/BaseDetector.js` → `../../engine/BaseDetector.js`

### 7. salesAnomalyDetector.js
**Problema:** Import de BaseDetector incorrecto
**Cambio:** `./BaseDetector.js` → `../BaseDetector.js`

### 8. ExternalContext.js (5 imports rotos)
**Problema:** Rutas a weather/ y calendar/ incorrectas
**Cambio:** `./weather/*` y `./calendar/*` → `../weather/*` y `../calendar/*`

### 9. AudioBriefingGenerator.js
**Problema:** Imports a archivos inexistentes
**Cambios:**
- `../services/morningBriefingGenerator.js` → `../briefing/BriefingGenerator.js`
- `../integrations/WhatsAppClient.js` → `../channels/whatsapp/WhatsAppClient.js`
- Actualizado uso de `morningBriefingGenerator` a `briefingGenerator`

---

## Cómo Aplicar

### Opción 1: Copiar archivos manualmente
Extrae el ZIP y copia cada archivo a su ubicación correspondiente en `packages/luca-api/`

### Opción 2: Desde terminal
```bash
cd tu-repo/packages/luca-api
unzip ~/Downloads/luca-api-complete-fix.zip
cp -r luca-api-complete-fix/* .
rm -rf luca-api-complete-fix
```

### Después de aplicar
```bash
git add .
git commit -m "fix(luca-api): correct broken imports and dependencies"
git push
```

Railway debería reconstruir automáticamente.
