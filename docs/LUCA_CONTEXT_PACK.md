# 🦑 LUCA — CONTEXT PACK

**Propósito:** Este documento contiene TODO el contexto necesario para continuar el desarrollo de LUCA en cualquier sesión de Claude. Adjuntar junto con el Roadmap V3.

---

## 1. EL NEGOCIO: TAGERS

### Qué es
- Cadena de restaurantes/panaderías en México
- Especialidad: Roscas (pan tradicional), panadería, comida
- 6 sucursales actuales, planes de expansión

### Sucursales
| ID | Nombre | Ciudad | Características |
|----|--------|--------|-----------------|
| angelopolis | Angelópolis | Puebla | La más grande, 80 sillas |
| zavaleta | Zavaleta | Puebla | 60 sillas |
| sonata | Sonata | Puebla | 50 sillas |
| 15sur | 15 Sur | Puebla | 45 sillas |
| loreto | Loreto | Puebla | 40 sillas, solo 2 turnos |
| sanangel | San Ángel | CDMX | Remota, diferente cultura |

### Los Socios (Usuarios de LUCA)
| Usuario | Rol | Foco | Canal Preferido |
|---------|-----|------|-----------------|
| Jorge | Owner/CEO | Visión global, todas alertas, approval final | WhatsApp personal |
| Andrés | Audit | Fraude, control interno, costos, nómina | Control Tower |
| Tany | Ops | Operación diaria, staffing, ejecución | Control Tower + WA Grupo |

---

## 2. SISTEMAS EXISTENTES

### KISS (Ya en producción)
Sistema de atención al cliente con IA que Jorge ya tiene funcionando.

**Stack:**
- Node.js en Railway
- PostgreSQL en Railway
- Redis + BullMQ para queues
- Chatwoot para interfaz de agentes
- WhatsApp Business API, Instagram, Messenger
- OpenAI GPT-4o/GPT-4o-mini
- LangSmith para observabilidad
- Google Sheets para configuración (zero hardcode)

**Tablas KISS relevantes para LUCA:**
```sql
-- Conversaciones y eventos
conversation_events    -- Clasificación de mensajes con sentiment
conversation_facts     -- Hechos extraídos de conversaciones
conversation_messages  -- Mensajes raw
conversation_summaries -- Resúmenes de conversaciones

-- Agregaciones
insights_hourly        -- Métricas por hora
insights_daily         -- Métricas por día

-- Configuración
config_hub             -- Sync de Google Sheets
```

**Chatwoot Integration:**
- Webhook responses < 50ms
- Dashboard apps para mostrar contexto
- Notas privadas automáticas

### Redshift (Data Warehouse)
Contiene datos históricos de ventas, RRHH, operaciones.

**Tablas principales (ya existen):**
```sql
-- VENTAS
fct_sales_daily        -- Ventas diarias por sucursal
fct_sales_hourly       -- Ventas por hora
fct_menu_sales_daily   -- Ventas por producto
fct_orders             -- Detalle de órdenes

-- DESCUENTOS Y DEVOLUCIONES
descuentos_detalle     -- Descuentos a nivel línea con empleado
notas_credito          -- Devoluciones/refunds

-- RRHH (de Buk)
dim_employees          -- Catálogo de empleados
fct_turnover_events    -- Altas/bajas
fct_attendance         -- Asistencia
fct_payroll            -- Nómina

-- DIMENSIONES
dim_branches           -- Sucursales
dim_products           -- Productos
dim_time               -- Calendario
```

### WooCommerce
Tienda online para pedidos de roscas (especialmente en temporada).
- Órdenes
- Clientes
- Productos

### Buk
Sistema de RRHH externo.
- Nómina
- Asistencia
- Plantilla
- Rotación

### Marketman (Futuro)
Sistema de inventario/CEDIS - aún no integrado pero planeado.

---

## 3. ARQUITECTURA TÉCNICA ACTUAL

### Infraestructura
```
Railway (Hosting)
├── KISS API (Node.js)
│   ├── Express server
│   ├── BullMQ workers
│   └── Chatwoot webhooks
│
├── PostgreSQL (KISS)
│   └── Conversaciones, insights, config
│
└── Redis
    └── Queues, cache, rate limiting

Redshift (AWS)
└── Data warehouse (ventas, RRHH, ops)

Google Sheets
└── Configuración dinámica (zero hardcode)

WhatsApp Business API
└── Cloud API para mensajes
```

### Patrones de Código Establecidos
Jorge sigue estos patrones en KISS que deben mantenerse en LUCA:

1. **Zero Hardcode:** Todo configurable desde Google Sheets
2. **Governor/Dispatcher Pattern:** Separación HTTP vs lógica de negocio
3. **BullMQ para async:** Webhook responde rápido, procesamiento en background
4. **Graceful shutdown:** Manejo limpio de SIGTERM
5. **Auto-migration:** Base de datos se migra automáticamente al deploy
6. **LangSmith tracing:** Observabilidad de llamadas LLM

### Credenciales Necesarias (Jorge las tiene)
- `OPENAI_API_KEY`
- `LANGSMITH_API_KEY`
- `REDSHIFT_*` (host, port, user, password, database)
- `CHATWOOT_*` (api_key, account_id, inbox_id)
- `WHATSAPP_*` (phone_number_id, access_token)
- `GOOGLE_SHEETS_*` (credentials JSON)
- Railway PostgreSQL URL
- Railway Redis URL

---

## 4. SCHEMA SQL CREADO (Iteración 0 parcial)

Ya se creó el schema base en sesión anterior. Incluye:

```sql
-- Core LUCA
luca_cases            -- Casos de investigación
luca_alerts           -- Alertas
luca_actions          -- Acciones propuestas/ejecutadas
luca_memory_episodes  -- Memoria episódica
luca_playbooks        -- Reglas de acción

-- Control Tower
tower_users           -- Usuarios y permisos
tower_sessions        -- Sesiones

-- Sync tables
sync_sales_daily      -- Espejo de Redshift
sync_sales_hourly
sync_descuentos
sync_turnover

-- Audit
luca_audit_log        -- Log completo
```

**Archivo:** `luca_schema_fase0.sql` (ya entregado)

---

## 5. GOOGLE SHEET: LUCA_CONFIG

Estructura definida para configuración dinámica:

### Hojas
1. **sources** - Fuentes de datos registradas
2. **datasets** - Datasets por fuente
3. **data_products** - Productos de datos canónicos
4. **metrics** - Métricas definidas
5. **detectors** - Detectores registrados
6. **playbooks** - Reglas de acción
7. **alertas_umbrales** - Thresholds por métrica
8. **preferencias_socios** - Config por usuario
9. **sucursales** - Datos de sucursales

---

## 6. DECISIONES DE DISEÑO TOMADAS

### Por qué PWA y no App Nativa
- 1 codebase vs 2
- Deploy instantáneo vs App Store review
- $0 vs $124/año en fees
- Push notifications funcionan igual

### Por qué LangGraph para orquestación
- State machines con checkpoints
- Investigaciones pueden durar horas/días
- Human-in-the-loop nativo
- Reproducibilidad y auditoría

### Por qué Vector DB para memoria
- RAG para respuestas contextuales
- Búsqueda semántica de casos similares
- Contexto operativo persistente
- Manuales y políticas buscables

### Por qué Action Bus con niveles
- AUTO: Bajo riesgo, ejecuta solo
- APPROVAL: Medio riesgo, propone y espera
- CRITICAL: Alto riesgo, solo sugiere
- Permite escalar autonomía gradualmente

---

## 7. EJEMPLOS DE DATOS REALES

### Ejemplo: Descuento sospechoso
```json
{
  "fecha": "2026-01-14",
  "sucursal": "zavaleta",
  "empleado": "Mariana García",
  "empleado_id": "emp_847",
  "tipo_descuento": "cortesia",
  "monto": 185.00,
  "metodo_pago": "efectivo",
  "hora": 19,
  "orden_id": "ORD-2026-847291"
}
```

### Ejemplo: Venta diaria
```json
{
  "fecha": "2026-01-14",
  "sucursal": "angelopolis",
  "venta_total": 142350.00,
  "num_ordenes": 847,
  "ticket_promedio": 168.12,
  "venta_dine_in": 89000.00,
  "venta_delivery": 35000.00,
  "venta_para_llevar": 18350.00
}
```

### Ejemplo: Conversación KISS (sentiment)
```json
{
  "conversation_id": "conv_98472",
  "timestamp": "2026-01-14T19:30:00Z",
  "channel": "whatsapp",
  "sentiment_score": 2.1,
  "intent": "queja",
  "extracted_issue": "pan duro",
  "sucursal_mencionada": "sanangel"
}
```

---

## 8. MÉTRICAS BASELINE (Para detectores)

### Ventas por sucursal (promedio diario)
| Sucursal | Baseline | Variación normal |
|----------|----------|------------------|
| Angelópolis | $95,000 | ±15% |
| Zavaleta | $85,000 | ±15% |
| Sonata | $80,000 | ±15% |
| 15 Sur | $75,000 | ±15% |
| Loreto | $50,000 | ±20% |
| San Ángel | $45,000 | ±20% |

### Descuentos por empleado (promedio semanal)
- Normal: 10-15 descuentos/semana
- Alerta amarilla: >25 descuentos
- Alerta roja: >40 descuentos

### % Efectivo en descuentos
- Normal: 40-50%
- Sospechoso: >70%
- Crítico: >85%

### Sentiment score (KISS)
- Excelente: >4.5
- Bueno: 4.0-4.5
- Atención: 3.5-4.0
- Crítico: <3.5

---

## 9. FORMATO DE IDs

### Cases
`CF-YYYY-MM-DD-NNN`
Ejemplo: `CF-2026-01-15-001`

### Alerts
`AL-YYYY-MM-DD-NNN`
Ejemplo: `AL-2026-01-15-001`

### Actions
`ACT-YYYY-MM-DD-NNN`
Ejemplo: `ACT-2026-01-15-001`

### Episodes (Memory)
`EP-YYYY-MM-DD-NNN`
Ejemplo: `EP-2026-01-15-001`

### Runs (Detector executions)
`RUN-YYYY-MM-DD-HHMMSS-DDD`
Ejemplo: `RUN-2026-01-15-083000-FRD` (FRD = fraud detector)

---

## 10. PERSONALIDAD LUCA

```
Nombre: LUCA (Lurks Under, Catches Anomalies)
Emoji: 🦑
Tono: Directo, financiero, leal, humilde
Metáfora: Monstruo marino que emerge con la verdad

Reglas de comunicación:
- Solo habla cuando hay algo que ver
- Datos primero, opinión después
- Siempre incluye acción sugerida
- Admite cuando no sabe
- Defiende el EBITDA, no el volumen
```

---

## 11. ESTADO ACTUAL DEL PROYECTO

### ✅ Completado
- Consolidación de roadmaps V1 + V2 + V3
- Schema SQL de base de datos
- Prototipo visual de Control Tower (React)
- Definición de arquitectura de 5 capas
- Definición de 10 iteraciones

### 🔄 En progreso
- Nada (esperando inicio de Iteración 0)

### ⏳ Pendiente
- Iteración 0: Fundación de datos
- Iteración 1-10: Todo el resto

---

## 12. CÓMO CONTINUAR EN NUEVA SESIÓN

### Archivos a adjuntar:
1. `LUCA_ROADMAP_DEFINITIVO_V3.md` (este roadmap)
2. `LUCA_CONTEXT_PACK.md` (este documento)

### Prompt sugerido:
```
Continuemos con LUCA. Adjunto el roadmap y context pack.

Estamos en: [Iteración X]
Último entregable: [descripción]
Siguiente paso: [lo que sigue]

[Cualquier contexto adicional relevante]
```

### Si hay código previo:
Mencionar qué archivos ya existen y dónde están en el repo.

---

## 13. CONTACTO Y RECURSOS

### Repositorio (cuando exista)
`github.com/[org]/luca` (por definir)

### Documentación relacionada
- Schema Redshift completo (Jorge lo tiene)
- Manuales de operación Tagers (para Vector DB)
- Políticas de descuentos (para playbooks)

---

*Context Pack v1.0 - Generado para desarrollo iterativo con Claude Opus 4.5*
