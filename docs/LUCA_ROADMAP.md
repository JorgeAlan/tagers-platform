# 🦑 LUCA — ROADMAP DEFINITIVO V3

## Organizado por Iteraciones de Claude Opus 4.5

**Filosofía:** Cada iteración es un bloque de trabajo completo que Claude puede entregar en una sesión. No se mide en semanas, se mide en **entregables funcionales end-to-end**.

---

## CONTEXTO CONSOLIDADO (V1 + V2 + V3)

### De V1 (Original): La Base
- ✅ Schema de casos, alertas, acciones
- ✅ Control Tower PWA
- ✅ 10 Misiones de negocio
- ✅ WhatsApp + Morning Briefing

### De V2 (Modular): La Escalabilidad
- ✅ Data Products sobre tablas crudas
- ✅ Registry-driven (fuentes, métricas, detectores)
- ✅ Observabilidad de algoritmos (runs, findings, feedback)
- ✅ Personalización por socio (watchlists, brief packs)

### De V3 (Agéntico): La Inteligencia
- ✅ Memoria (Vector DB + contexto operativo)
- ✅ Manos (Action Bus con write-back)
- ✅ Personalidad financiera (defiende EBITDA)
- ✅ Human-in-the-Loop configurable

---

## ARQUITECTURA FINAL

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           🦑 LUCA ARCHITECTURE V3                            │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ═══════════════════════ LAYER 1: SOURCES ═══════════════════════           │
│                                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Redshift │ │   Buk    │ │   KISS   │ │Marketman │ │ External │          │
│  │  (POS)   │ │  (RRHH)  │ │   (CX)   │ │ (CEDIS)  │ │(Clima,   │          │
│  │          │ │          │ │          │ │          │ │ Reviews) │          │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘ └────┬─────┘          │
│       │            │            │            │            │                  │
│       └────────────┴────────────┴────────────┴────────────┘                  │
│                                 │                                            │
│                                 ▼                                            │
│  ═══════════════════ LAYER 2: DATA PRODUCTS ════════════════════            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │                    DATA PRODUCTS LAYER                       │            │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │            │
│  │  │dp_sales_*   │ │dp_labor_*   │ │dp_cx_*      │            │            │
│  │  │(daily,hourly│ │(headcount,  │ │(sentiment,  │            │            │
│  │  │ by_employee)│ │ turnover)   │ │ complaints) │            │            │
│  │  └─────────────┘ └─────────────┘ └─────────────┘            │            │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │            │
│  │  │dp_discounts │ │dp_inventory │ │dp_external  │            │            │
│  │  │(by_employee,│ │(positions,  │ │(weather,    │            │            │
│  │  │ by_item)    │ │ movements)  │ │ events)     │            │            │
│  │  └─────────────┘ └─────────────┘ └─────────────┘            │            │
│  │                                                              │            │
│  │  📋 Registry: sources | datasets | metrics | contracts       │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                                 │                                            │
│                                 ▼                                            │
│  ═══════════════════ LAYER 3: INTELLIGENCE ═════════════════════            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │                      LUCA BRAIN                              │            │
│  │                                                              │            │
│  │  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐  │            │
│  │  │   MEMORY    │      │   CORTEX    │      │  DETECTORS  │  │            │
│  │  │  (Vector DB)│─────▶│   (LLM +    │◀─────│  (Registry) │  │            │
│  │  │             │      │   Rules)    │      │             │  │            │
│  │  │ • Manuales  │      │             │      │ • Fraude    │  │            │
│  │  │ • Casos     │      │ • Analiza   │      │ • Anomalías │  │            │
│  │  │ • Contexto  │      │ • Decide    │      │ • Staffing  │  │            │
│  │  │ • Chats     │      │ • Narra     │      │ • CX        │  │            │
│  │  └─────────────┘      └──────┬──────┘      └─────────────┘  │            │
│  │                              │                               │            │
│  │                              ▼                               │            │
│  │  ┌─────────────────────────────────────────────────────────┐│            │
│  │  │              EXECUTION LEDGER (Observability)           ││            │
│  │  │  runs | findings | labels | feedback | costs | ROI      ││            │
│  │  └─────────────────────────────────────────────────────────┘│            │
│  └─────────────────────────────────────────────────────────────┘            │
│                                 │                                            │
│                                 ▼                                            │
│  ═══════════════════ LAYER 4: ACTIONS ══════════════════════════            │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────┐            │
│  │                    ACTION BUS (THE HANDS)                    │            │
│  │                                                              │            │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐            │            │
│  │  │    AUTO     │ │  APPROVAL   │ │  CRITICAL   │            │            │
│  │  │  (Ejecuta)  │ │ (Propone)   │ │  (Sugiere)  │            │            │
│  │  │             │ │             │ │             │            │            │
│  │  │• Send alert │ │• Draft PO   │ │• Block user │            │            │
│  │  │• Create case│ │• Staff msg  │ │• Fire alert │            │            │
│  │  │• Log metric │ │• Price chg  │ │• Policy chg │            │            │
│  │  └─────────────┘ └─────────────┘ └─────────────┘            │            │
│  │                                                              │            │
│  │  📋 Action Registry: permissions | limits | audit | rollback │            │
│  └─────────────────────────────────────────────────────────────┘            │
│                                 │                                            │
│                                 ▼                                            │
│  ═══════════════════ LAYER 5: OUTPUTS ══════════════════════════            │
│                                                                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐          │
│  │ Control  │ │ WhatsApp │ │ Morning  │ │ Chatwoot │ │ External │          │
│  │  Tower   │ │  Alerts  │ │ Briefing │ │  Notes   │ │  Actions │          │
│  │  (Feed)  │ │          │ │ (Audio)  │ │          │ │          │          │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘          │
│                                                                              │
│  📋 Persona Prefs: dashboards | watchlists | routing | brief_packs          │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## ITERACIONES DE CLAUDE OPUS 4.5

Cada iteración produce **código funcional + documentación + tests** que se puede deployar inmediatamente.

---

# 🔷 ITERACIÓN 0: FUNDACIÓN DE DATOS

## Objetivo
Establecer la infraestructura de datos modular que soportará todo lo demás.

## Entregables

### 1. Schema Completo de Base de Datos
```
Archivos:
├── migrations/
│   ├── 001_luca_core.sql           # cases, alerts, actions
│   ├── 002_data_products.sql       # dp_* tables
│   ├── 003_registry.sql            # sources, datasets, metrics, detectors
│   ├── 004_execution_ledger.sql    # runs, findings, labels
│   └── 005_tower_users.sql         # users, sessions, prefs
```

### 2. Registry System (Google Sheets + Sync)
```
Archivos:
├── config/
│   ├── LUCA_REGISTRY.gsheet        # Sheet con todas las configs
│   │   ├── sources                 # Fuentes de datos
│   │   ├── datasets                # Datasets por fuente
│   │   ├── data_products           # Productos canónicos
│   │   ├── metrics                 # Métricas definidas
│   │   ├── detectors               # Detectores registrados
│   │   ├── playbooks               # Reglas de acción
│   │   └── persona_prefs           # Preferencias por socio
│   │
│   └── registry_sync.js            # Sincronizador Sheets → DB
```

### 3. Data Products Base (Views/Materialized)
```
Archivos:
├── data_products/
│   ├── dp_sales_daily.sql
│   ├── dp_sales_hourly.sql
│   ├── dp_sales_by_employee.sql
│   ├── dp_discounts_detail.sql
│   ├── dp_refunds.sql
│   ├── dp_labor_headcount.sql
│   ├── dp_labor_turnover.sql
│   └── dp_cx_sentiment.sql
```

### 4. API Base
```
Archivos:
├── src/
│   ├── routes/
│   │   └── luca.js                 # /api/luca/*
│   ├── services/
│   │   ├── registryService.js      # CRUD registry
│   │   └── dataProductService.js   # Materialización
│   └── jobs/
│       └── syncRedshift.js         # Job de sync
```

## Definition of Done
- [ ] `npm run migrate` crea todas las tablas
- [ ] Google Sheet conectado y sincronizando
- [ ] Al menos 5 Data Products materializados
- [ ] Endpoint `/api/luca/health` retorna status de cada componente
- [ ] Test: agregar nueva fuente solo requiere config (no código)

## Contexto para Siguiente Iteración
```
Estado: Base de datos lista con registry system
Próximo: Construir el sistema de detección y casos
Dependencias resueltas: Schema, sync, data products
```

---

# 🔷 ITERACIÓN 1: DETECCIÓN Y CASOS

## Objetivo
Sistema completo de detección de anomalías con observabilidad.

## Entregables

### 1. Detector Engine
```
Archivos:
├── src/
│   ├── detectors/
│   │   ├── engine.js               # Runner genérico
│   │   ├── registry.js             # Carga detectores de config
│   │   │
│   │   ├── fraud/
│   │   │   ├── discount_anomaly.js # Descuentos por empleado
│   │   │   ├── cash_preference.js  # Preferencia efectivo
│   │   │   └── collusion.js        # Patrones de colusión
│   │   │
│   │   ├── sales/
│   │   │   ├── daily_drop.js       # Caída diaria
│   │   │   ├── hourly_anomaly.js   # Anomalía por hora
│   │   │   └── baseline_deviation.js
│   │   │
│   │   └── hr/
│   │       ├── staffing_gap.js     # Falta de personal
│   │       └── burnout_risk.js     # Riesgo de burnout
│   │
│   ├── services/
│   │   ├── detectorService.js      # Orquestador
│   │   └── executionLedger.js      # Logging de runs
│   │
│   └── jobs/
│       ├── runDetectors.js         # Cron job
│       └── schedules.js            # Configuración de schedules
```

### 2. Case Management
```
Archivos:
├── src/
│   ├── services/
│   │   ├── caseService.js          # CRUD de casos
│   │   ├── caseStateMachine.js     # Estados y transiciones
│   │   ├── autopsyEngine.js        # Motor de autopsias
│   │   └── hypothesisRanker.js     # Ranking de hipótesis
│   │
│   └── routes/
│       └── cases.js                # API de casos
```

### 3. Alert System
```
Archivos:
├── src/
│   ├── services/
│   │   ├── alertService.js         # CRUD de alertas
│   │   ├── alertRouter.js          # Routing por severidad/persona
│   │   └── deduplicator.js         # Evitar alertas duplicadas
│   │
│   └── routes/
│       └── alerts.js               # API de alertas
```

### 4. Execution Ledger (Observabilidad)
```
Archivos:
├── src/
│   ├── services/
│   │   └── ledgerService.js        # Registro de ejecuciones
│   │
│   └── routes/
│       └── runs.js                 # API de runs
│           GET  /runs              # Lista de ejecuciones
│           GET  /runs/:id          # Detalle con findings
│           POST /runs/:id/label    # Marcar TP/FP
```

## Definition of Done
- [ ] Job `runDetectors` ejecuta todos los detectores habilitados
- [ ] Cada run genera `run_id` trazable hasta la alerta/caso
- [ ] Detectores de fraude generan casos con evidencia
- [ ] Autopsia de ventas genera hipótesis rankeadas
- [ ] UI puede marcar finding como "falso positivo"

## Contexto para Siguiente Iteración
```
Estado: Sistema de detección funcionando con observabilidad
Próximo: Construir el Control Tower
Dependencias resueltas: Detectors, cases, alerts, runs
```

---

# 🔷 ITERACIÓN 2: CONTROL TOWER (FEED)

## Objetivo
Interfaz completa para socios: Feed de decisiones + Dashboard + Cases.

## Entregables

### 1. Backend API para Tower
```
Archivos:
├── src/
│   ├── routes/
│   │   └── tower.js                # /api/tower/*
│   │       GET  /dashboard         # KPIs del día
│   │       GET  /feed              # Tarjetas de decisión
│   │       GET  /cases             # Lista de casos
│   │       GET  /cases/:id         # Detalle con evidencia
│   │       POST /cases/:id/act     # Aprobar/rechazar
│   │       GET  /alerts            # Alertas activas
│   │       POST /alerts/:id/ack    # Acknowledge
│   │       GET  /branches          # Estado por sucursal
│   │       GET  /runs              # Monitor de detectores
│   │       WS   /realtime          # WebSocket updates
│   │
│   ├── services/
│   │   ├── dashboardService.js     # Agregaciones
│   │   ├── feedService.js          # Generador de tarjetas
│   │   └── realtimeService.js      # WebSocket
│   │
│   └── middleware/
│       └── towerAuth.js            # JWT + permisos
```

### 2. Frontend PWA (Next.js)
```
Archivos:
├── tower/
│   ├── app/
│   │   ├── page.tsx                # Dashboard (KPIs + Feed)
│   │   ├── feed/page.tsx           # Feed de decisiones
│   │   ├── cases/
│   │   │   ├── page.tsx            # Lista de casos
│   │   │   └── [id]/page.tsx       # Detalle + approve
│   │   ├── alerts/page.tsx         # Alertas
│   │   ├── branches/
│   │   │   ├── page.tsx            # Vista sucursales
│   │   │   └── [id]/page.tsx       # Detalle sucursal
│   │   ├── monitor/page.tsx        # Runs + Data Catalog
│   │   └── settings/page.tsx       # Preferencias
│   │
│   ├── components/
│   │   ├── FeedCard.tsx            # Tarjeta de decisión
│   │   ├── CaseDetail.tsx          # Vista de caso
│   │   ├── EvidenceViewer.tsx      # Evidencia expandible
│   │   ├── ActionApprover.tsx      # Botones aprobar/rechazar
│   │   ├── KPICard.tsx             # Métrica con tendencia
│   │   ├── BranchChart.tsx         # Gráfica de sucursal
│   │   └── RunsTable.tsx           # Tabla de ejecuciones
│   │
│   ├── lib/
│   │   ├── api.ts                  # Cliente API
│   │   ├── auth.ts                 # NextAuth
│   │   └── realtime.ts             # WebSocket
│   │
│   └── public/
│       ├── manifest.json           # PWA
│       └── sw.js                   # Service Worker
```

### 3. Sistema de Permisos por Persona
```
Archivos:
├── src/
│   ├── services/
│   │   └── personaService.js       # Preferencias por usuario
│   │       - getDashboardConfig(userId)
│   │       - getWatchlist(userId)
│   │       - getAlertRouting(userId)
│   │       - getBriefPack(userId)
```

## Definition of Done
- [ ] Tower accesible en `luca-tower.tagers.com`
- [ ] Login con Google/Email funcionando
- [ ] Feed muestra tarjetas de decisión en tiempo real
- [ ] Aprobar/rechazar actualiza caso y notifica
- [ ] Monitor muestra runs con status y findings
- [ ] PWA instalable en móvil

## Contexto para Siguiente Iteración
```
Estado: Control Tower funcional con todas las vistas
Próximo: Agregar canales de salida (WhatsApp, Briefing)
Dependencias resueltas: API Tower, Frontend, Auth
```

---

# 🔷 ITERACIÓN 3: CANALES DE SALIDA

## Objetivo
WhatsApp Business API + Morning Briefing + Chatwoot integration.

## Entregables

### 1. WhatsApp Business Integration
```
Archivos:
├── src/
│   ├── integrations/
│   │   └── whatsapp/
│   │       ├── client.js           # API client
│   │       ├── templates.js        # Message templates
│   │       └── sender.js           # Send logic
│   │
│   ├── services/
│   │   └── notificationService.js  # Router de notificaciones
│   │       - sendAlert(alert, recipients)
│   │       - sendBriefing(userId, content)
│   │       - sendActionRequest(action, approvers)
```

### 2. Morning Briefing Generator
```
Archivos:
├── src/
│   ├── services/
│   │   └── briefingService.js
│   │       - generateDailyBrief(userId)
│   │       - formatForWhatsApp(brief)
│   │       - formatForAudio(brief)       # Para TTS futuro
│   │
│   ├── templates/
│   │   ├── brief_full.md           # Para Jorge
│   │   ├── brief_audit.md          # Para Andrés
│   │   ├── brief_ops.md            # Para Tany
│   │   └── brief_branch.md         # Para Gerentes
│   │
│   └── jobs/
│       └── morningBrief.js         # Cron 8:00 AM
```

### 3. Chatwoot Integration
```
Archivos:
├── src/
│   ├── integrations/
│   │   └── chatwoot/
│   │       └── notesClient.js      # Crear notas privadas
│   │
│   ├── services/
│   │   └── cxContextService.js     # Contexto para agentes
│   │       - getCustomerContext(contactId)
│   │       - addCaseNote(conversationId, caseId)
```

### 4. Conversational Interface (WhatsApp → LUCA)
```
Archivos:
├── src/
│   ├── routes/
│   │   └── lucaChat.js             # Webhook para mensajes a LUCA
│   │
│   ├── services/
│   │   └── conversationService.js
│   │       - parseCommand(message)
│   │       - handleQuery("¿cómo vamos?")
│   │       - handleAction("investiga San Ángel")
```

## Definition of Done
- [ ] Alertas críticas llegan a WhatsApp en <30 segundos
- [ ] Morning Briefing se envía a las 8:00 AM
- [ ] Cada socio recibe su versión personalizada
- [ ] Jorge puede preguntar "¿cómo vamos?" y recibir respuesta
- [ ] Casos escalados crean nota en Chatwoot

## Contexto para Siguiente Iteración
```
Estado: Sistema de comunicación completo
Próximo: Agregar memoria y contexto (Vector DB)
Dependencias resueltas: WhatsApp, Briefing, Chatwoot
```

---

# 🔷 ITERACIÓN 4: MEMORIA Y CONTEXTO

## Objetivo
Vector Database para memoria a largo plazo + RAG para respuestas contextuales.

## Entregables

### 1. Vector Database Setup
```
Archivos:
├── src/
│   ├── memory/
│   │   ├── vectorStore.js          # Cliente Pinecone/Chroma
│   │   ├── embeddings.js           # OpenAI embeddings
│   │   └── chunker.js              # Divisor de documentos
```

### 2. Knowledge Ingestion
```
Archivos:
├── src/
│   ├── memory/
│   │   ├── ingesters/
│   │   │   ├── manuals.js          # PDFs de manuales
│   │   │   ├── cases.js            # Casos cerrados
│   │   │   ├── chats.js            # Conversaciones KISS
│   │   │   └── policies.js         # Políticas de Sheets
│   │   │
│   │   └── schemas/
│   │       ├── manual_chunk.js
│   │       ├── case_summary.js
│   │       └── operational_context.js
│   │
│   └── jobs/
│       └── ingestKnowledge.js      # Job de ingesta
```

### 3. RAG System
```
Archivos:
├── src/
│   ├── services/
│   │   └── ragService.js
│   │       - search(query, filters)
│   │       - getRelevantContext(caseType, branchId)
│   │       - findSimilarCases(caseId)
│   │       - answerWithContext(question)
```

### 4. Operational Context
```
Archivos:
├── src/
│   ├── memory/
│   │   └── operationalContext.js
│   │       - getBranchContext(branchId)
│   │         // "En enero siempre baja San Ángel"
│   │       - getSeasonalPatterns(date)
│   │         // "Es temporada de roscas"
│   │       - getEmployeeHistory(employeeId)
│   │         // "Ha tenido 3 incidentes previos"
```

## Definition of Done
- [ ] Manuales de operación indexados y buscables
- [ ] Casos cerrados se guardan como memoria episódica
- [ ] `findSimilarCases()` retorna casos relevantes
- [ ] Briefing incluye contexto histórico relevante
- [ ] LUCA no alerta sobre "anomalías" que son estacionales

## Contexto para Siguiente Iteración
```
Estado: Sistema con memoria y contexto
Próximo: Agregar capacidad de acción (write-back)
Dependencias resueltas: Vector DB, RAG, Context
```

---

# 🔷 ITERACIÓN 5: ACTION BUS (LAS MANOS)

## Objetivo
Capacidad de ejecutar acciones en sistemas externos con control y auditoría.

## Entregables

### 1. Action Registry
```
Archivos:
├── config/
│   └── actions_registry.yaml
│       actions:
│         - id: send_whatsapp
│           level: auto
│           limits: { daily: 100 }
│         - id: draft_purchase_order
│           level: approval
│           limits: { max_amount: 5000 }
│         - id: block_pos_user
│           level: critical
│           limits: { requires: "jorge" }
```

### 2. Action Bus Engine
```
Archivos:
├── src/
│   ├── actions/
│   │   ├── bus.js                  # Orquestador central
│   │   ├── registry.js             # Carga de config
│   │   ├── executor.js             # Ejecutor con retry
│   │   ├── auditor.js              # Log de acciones
│   │   └── rollback.js             # Reversión si falla
│   │
│   ├── actions/handlers/
│   │   ├── whatsapp.js             # send_whatsapp
│   │   ├── marketman.js            # draft/create_po
│   │   ├── buk.js                  # schedule_shift
│   │   ├── chatwoot.js             # create_ticket
│   │   └── internal.js             # create_case, log_metric
```

### 3. Approval Workflow
```
Archivos:
├── src/
│   ├── services/
│   │   └── approvalService.js
│   │       - requestApproval(action, approvers)
│   │       - handleApproval(actionId, decision)
│   │       - autoApproveIfTimeout(actionId)
│   │
│   └── routes/
│       └── actions.js
│           POST /actions/:id/approve
│           POST /actions/:id/reject
```

### 4. Action Templates (Drafts)
```
Archivos:
├── src/
│   ├── actions/templates/
│   │   ├── staff_alert.js          # Mensaje a empleado
│   │   ├── purchase_order.js       # Orden de compra
│   │   ├── shift_request.js        # Solicitud de turno
│   │   └── customer_winback.js     # Mensaje a cliente
```

## Definition of Done
- [ ] LUCA puede crear borrador de PO en Marketman
- [ ] LUCA puede enviar WhatsApp a staff (con aprobación)
- [ ] Acciones críticas requieren doble confirmación
- [ ] Audit log completo de todas las acciones
- [ ] Límites diarios/montos funcionando

## Contexto para Siguiente Iteración
```
Estado: Sistema con capacidad de acción controlada
Próximo: Integrar todo en agentes especializados
Dependencias resueltas: Action Bus, Approvals, Handlers
```

---

# 🔷 ITERACIÓN 6: AGENTES ESPECIALIZADOS

## Objetivo
Construir agentes autónomos para cada dominio del negocio.

## Entregables

### 1. Agent Framework
```
Archivos:
├── src/
│   ├── agents/
│   │   ├── framework.js            # Base class para agentes
│   │   ├── orchestrator.js         # Coordinador de agentes
│   │   └── personality.js          # Personalidad LUCA
```

### 2. La Fiscalía (Revenue Protection)
```
Archivos:
├── src/
│   ├── agents/
│   │   └── fiscalia/
│   │       ├── agent.js            # Agente principal
│   │       ├── collusion.js        # Detector de colusión
│   │       ├── sweethearting.js    # Patrones de fraude
│   │       └── expediente.js       # Generador de expediente PDF
│   │
│   │   Capabilities:
│   │   - Detecta fraude cruzando cajera + mesero + cliente
│   │   - Genera expediente con evidencia para confrontar
│   │   - Envía a Andrés para revisión
```

### 3. El Headhunter (Staffing Dinámico)
```
Archivos:
├── src/
│   ├── agents/
│   │   └── headhunter/
│   │       ├── agent.js            # Agente principal
│   │       ├── predictor.js        # Predicción de necesidad
│   │       ├── matcher.js          # Match con eventuales
│   │       └── recruiter.js        # Envío de invitaciones
│   │
│   │   Capabilities:
│   │   - Detecta falta de personal para fecha futura
│   │   - Filtra eventuales confiables disponibles
│   │   - Envía WhatsApp individual con oferta de turno
│   │   - Recibe respuesta y actualiza Buk
```

### 4. El Mercader (Supply Chain)
```
Archivos:
├── src/
│   ├── agents/
│   │   └── mercader/
│   │       ├── agent.js            # Agente principal
│   │       ├── price_monitor.js    # Monitor de precios
│   │       ├── arbitrage.js        # Comparador de proveedores
│   │       └── po_generator.js     # Generador de POs
│   │
│   │   Capabilities:
│   │   - Monitorea precios de insumos clave
│   │   - Compara proveedores y sugiere cambio
│   │   - Genera PO con el mejor proveedor
│   │   - Calcula ahorro y lo reporta
```

### 5. El Showman (CX & Recovery)
```
Archivos:
├── src/
│   ├── agents/
│   │   └── showman/
│   │       ├── agent.js            # Agente principal
│   │       ├── churn_detector.js   # VIPs en riesgo
│   │       ├── personalizer.js     # Mensajes personalizados
│   │       └── campaign.js         # Campañas de recuperación
│   │
│   │   Capabilities:
│   │   - Detecta clientes VIP en riesgo (30+ días)
│   │   - Genera mensaje hiper-personalizado
│   │   - Pide aprobación en lote a Tany
│   │   - Mide conversión de recuperación
```

## Definition of Done
- [ ] Cada agente tiene loop: detectar → proponer → aprobar → ejecutar → medir
- [ ] La Fiscalía genera expedientes PDF automáticamente
- [ ] El Headhunter completa turnos con eventuales
- [ ] El Mercader ahorra dinero cambiando proveedores
- [ ] El Showman recupera clientes VIP

## Contexto para Siguiente Iteración
```
Estado: Agentes especializados funcionando
Próximo: Refinar UX y agregar audio briefing
Dependencias resueltas: Todos los agentes operativos
```

---

# 🔷 ITERACIÓN 7: EXPERIENCIA PREMIUM

## Objetivo
Pulir la experiencia: Audio Briefing, Feed inteligente, métricas de ROI.

## Entregables

### 1. Audio Briefing (The Morning Podcast)
```
Archivos:
├── src/
│   ├── services/
│   │   └── audioBriefing.js
│   │       - generateScript(userId)
│   │       - convertToAudio(script)  # OpenAI TTS
│   │       - sendViaWhatsApp(userId, audioUrl)
│   │
│   └── jobs/
│       └── morningPodcast.js       # Cron 8:00 AM
```

### 2. Smart Feed (Agrupación Inteligente)
```
Archivos:
├── src/
│   ├── services/
│   │   └── smartFeed.js
│   │       - groupSimilarActions(actions)
│   │       - prioritizeByImpact(cards)
│   │       - filterByPrefs(cards, userId)
│   │       - summarizeForBatch(actions)
```

### 3. ROI Tracking
```
Archivos:
├── src/
│   ├── services/
│   │   └── roiService.js
│   │       - trackActionOutcome(actionId, metrics)
│   │       - calculateSavings(period)
│   │       - generateROIReport(period)
│   │
│   └── routes/
│       └── roi.js
│           GET /roi/summary
│           GET /roi/by-agent
│           GET /roi/by-action-type
```

### 4. Feedback Loop
```
Archivos:
├── src/
│   ├── services/
│   │   └── feedbackService.js
│   │       - recordFeedback(findingId, label)
│   │       - calculatePrecision(detectorId)
│   │       - suggestThresholdAdjustment(detectorId)
│   │       - autoTuneIfApproved(detectorId)
```

### 5. Data Catalog UI
```
Archivos:
├── tower/
│   ├── app/
│   │   └── catalog/page.tsx        # Vista de Data Catalog
│   │       - Sources (estado de sync)
│   │       - Data Products (freshness)
│   │       - Metrics (cobertura)
│   │       - Detectors (precision/recall)
```

## Definition of Done
- [ ] Audio briefing de 2 minutos enviado a las 8:00 AM
- [ ] Feed agrupa 5+ acciones similares en 1 tarjeta
- [ ] Dashboard muestra ROI por agente y total
- [ ] Feedback mejora precision de detectores
- [ ] Data Catalog muestra salud del sistema

## Contexto para Siguiente Iteración
```
Estado: Experiencia pulida con audio y ROI
Próximo: Escalar a todas las fuentes (Marketman, Encuestas, etc.)
Dependencias resueltas: Audio, Feed, ROI, Catalog
```

---

# 🔷 ITERACIÓN 8: EXPANSIÓN DE FUENTES

## Objetivo
Onboard de fuentes adicionales: Marketman, Encuestas, Externos.

## Entregables

### 1. Marketman (CEDIS)
```
Archivos:
├── src/
│   ├── sources/
│   │   └── marketman/
│   │       ├── adapter.js          # API client
│   │       ├── sync.js             # Job de sync
│   │       └── mapping.js          # Mapeo a entidades LUCA
│   │
│   ├── data_products/
│   │   ├── dp_inventory_positions.sql
│   │   ├── dp_inventory_movements.sql
│   │   └── dp_purchase_orders.sql
│   │
│   ├── detectors/
│   │   └── inventory/
│   │       ├── stockout_risk.js
│   │       └── shrinkage_proxy.js
```

### 2. Encuestas (NPS/Quejas)
```
Archivos:
├── src/
│   ├── sources/
│   │   └── surveys/
│   │       ├── adapter.js          # Typeform/Google Forms
│   │       ├── sync.js
│   │       └── mapping.js
│   │
│   ├── data_products/
│   │   └── dp_survey_responses.sql
│   │
│   ├── detectors/
│   │   └── cx/
│   │       └── complaint_spike.js
```

### 3. Externos (Clima, Eventos, Reviews)
```
Archivos:
├── src/
│   ├── sources/
│   │   └── external/
│   │       ├── weather.js          # OpenWeather
│   │       ├── events.js           # Eventbrite/Local
│   │       └── reviews.js          # Google Maps scraper
│   │
│   ├── data_products/
│   │   ├── dp_weather_forecast.sql
│   │   └── dp_external_reviews.sql
```

### 4. Cross-Source Detectors
```
Archivos:
├── src/
│   ├── detectors/
│   │   └── cross/
│   │       ├── weather_impact.js   # Clima → Ventas
│   │       ├── nps_leading.js      # NPS → Ventas futuras
│   │       └── review_sentiment.js # Reviews → Alertas
```

## Definition of Done
- [ ] Marketman sincronizado con Data Products
- [ ] Alerta de stockout risk funcionando
- [ ] Encuestas integradas con spike detection
- [ ] Clima incluido en briefing y predicciones
- [ ] Process documentado: "Cómo agregar fuente nueva"

---

# 🔷 ITERACIÓN 9: AUTONOMÍA AVANZADA

## Objetivo
Incrementar nivel de autonomía: más acciones automáticas, menos aprobaciones.

## Entregables

### 1. Auto-Approval Rules
```
Archivos:
├── config/
│   └── autonomy_rules.yaml
│       rules:
│         - condition: "action.type == 'restock' && amount < 1000"
│           action: auto_approve
│         - condition: "detector.precision > 0.95"
│           action: reduce_approval_threshold
```

### 2. Batch Approval UI
```
Archivos:
├── tower/
│   ├── components/
│   │   └── BatchApprover.tsx       # Aprobar múltiples acciones
│   │       - "5 mensajes de recuperación" [APROBAR TODOS]
│   │       - "3 POs menores a $500" [APROBAR TODOS]
```

### 3. Confidence Escalation
```
Archivos:
├── src/
│   ├── services/
│   │   └── confidenceService.js
│   │       - calculateActionConfidence(action)
│   │       - routeByConfidence(action)
│   │         // >0.95 → auto
│   │         // 0.8-0.95 → approval
│   │         // <0.8 → suggest only
```

### 4. Learning from Outcomes
```
Archivos:
├── src/
│   ├── services/
│   │   └── learningService.js
│   │       - recordOutcome(actionId, result)
│   │       - updateConfidenceModel(detectorId)
│   │       - proposeNewRule(pattern)
```

## Definition of Done
- [ ] Acciones de bajo riesgo se ejecutan automáticamente
- [ ] Batch approval reduce tiempo de aprobación 80%
- [ ] Sistema aprende de outcomes y ajusta confianza
- [ ] Menos interrupciones para decisiones triviales

---

# 🔷 ITERACIÓN 10: ESCALA Y RESILENCIA

## Objetivo
Preparar el sistema para múltiples sucursales, alta disponibilidad.

## Entregables

### 1. Multi-Tenant Architecture
```
Archivos:
├── src/
│   ├── middleware/
│   │   └── tenantResolver.js       # Resolver por branch
│   │
│   ├── services/
│   │   └── branchContextService.js
│   │       - getConfig(branchId)
│   │       - getThresholds(branchId)
│   │       - getBaselines(branchId)
```

### 2. Hierarchical Agents
```
Archivos:
├── src/
│   ├── agents/
│   │   └── hierarchy/
│   │       ├── localAgent.js       # LUCA-Zavaleta
│   │       ├── centralAgent.js     # LUCA-Central
│   │       └── escalation.js       # Local → Central
```

### 3. Resilience & Monitoring
```
Archivos:
├── src/
│   ├── monitoring/
│   │   ├── healthCheck.js          # /health endpoint
│   │   ├── metrics.js              # Prometheus metrics
│   │   └── alerts.js               # System alerts
```

### 4. Performance Optimization
```
Archivos:
├── src/
│   ├── cache/
│   │   └── redis.js                # Cache layer
│   │
│   ├── queues/
│   │   └── bullmq.js               # Job queues
```

## Definition of Done
- [ ] Sistema soporta 20+ sucursales
- [ ] Agentes locales resuelven problemas menores
- [ ] Solo problemas sistémicos escalan a Central
- [ ] Uptime 99.5%+
- [ ] Latencia de alertas <30 segundos

---

## MÉTRICAS DE ÉXITO POR ITERACIÓN

| Iteración | Métrica Principal | Target |
|-----------|-------------------|--------|
| 0 | Data Products materializados | 5+ |
| 1 | Detectores con observabilidad | 6+ |
| 2 | Usuarios activos en Tower | 3 socios |
| 3 | Alertas entregadas <30s | 95% |
| 4 | Queries respondidas con contexto | 80% |
| 5 | Acciones ejecutadas por LUCA | 10/día |
| 6 | Agentes operativos | 4 |
| 7 | ROI medible reportado | $10K+ |
| 8 | Fuentes integradas | 6+ |
| 9 | Acciones auto-aprobadas | 50% |
| 10 | Sucursales soportadas | 20+ |

---

## ANTI-PATRONES A EVITAR

### ❌ NO hacer esto:
1. **Hardcodear por sucursal** → Usar config + data products
2. **Un detector = un archivo gigante** → Composición de reglas
3. **Aprobar todo manualmente** → Escalar autonomía gradualmente
4. **Alertas sin contexto** → Siempre incluir memoria/historial
5. **Acciones sin medición** → Todo tiene ROI trazable

### ✅ SÍ hacer esto:
1. **Registry-driven** → Todo en config, código genérico
2. **Observabilidad primero** → Runs/findings antes que features
3. **Human-in-the-loop configurable** → Auto → Approval → Critical
4. **Memoria persistente** → LUCA recuerda decisiones pasadas
5. **Unit economics** → Cada acción se mide en $ impacto

---

## HANDOFF ENTRE ITERACIONES

Cada iteración termina con un bloque de **contexto para la siguiente**:

```markdown
## Contexto para Siguiente Iteración

### Estado Actual
- [Lista de lo que funciona]

### Próximo Objetivo
- [Objetivo de siguiente iteración]

### Dependencias Resueltas
- [Qué ya no hay que construir]

### Archivos Clave
- [Rutas de archivos más importantes]

### Decisiones de Diseño
- [Por qué se hizo así]

### Deuda Técnica Conocida
- [Qué se dejó para después]
```

---

## PERSONALIDAD LUCA (Para Narrator/LLM)

```markdown
# Personalidad LUCA

## Identidad
- Nombre: LUCA (Lurks Under, Catches Anomalies)
- Rol: COO Digital, socio silencioso
- Metáfora: Monstruo marino que emerge con la verdad

## Tono
- Directo: No rodeos, va al grano
- Financiero: Piensa en EBITDA, no en volumen
- Leal: Defiende el negocio como si fuera suyo
- Humilde: Admite cuando no sabe

## Cuándo Habla
- Solo cuando hay algo que ver
- No por hablar
- Preferencia por silencio si todo está bien

## Formato de Comunicación
- Empieza con lo importante
- Datos primero, opinión después
- Siempre incluye acción sugerida
- Termina con pregunta si necesita input

## Ejemplo de Voz
"Jorge, detecté que Zavaleta perdió $4,850 en cortesías 
sospechosas esta semana. El 82% fueron en efectivo, 
concentradas en turno de Mariana. Armé el expediente. 
¿Se lo mando a Andrés para auditoría?"
```

---

*Documento generado para implementación iterativa con Claude Opus 4.5*
*Cada iteración = 1 sesión completa de Claude con entregables deployables*
