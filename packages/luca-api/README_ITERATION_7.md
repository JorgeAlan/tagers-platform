# 🔍 LUCA Iteración 7: "El Forense"

**Autopsias de Días Malos + Memoria Vectorial** - LUCA ahora investiga y recuerda.

## Qué es El Forense

El Forense es el segundo detector inteligente de LUCA que:

1. **Detecta automáticamente días con caídas significativas de ventas**
2. **Ejecuta autopsia completa** revisando múltiples dimensiones
3. **Genera hipótesis rankeadas** sobre las causas probables
4. **Busca en memoria** si algo similar ocurrió antes
5. **Aprende de cada caso** para mejorar diagnósticos futuros

## Arquitectura

```
ITERACIÓN_7/
├── src/
│   ├── detectors/
│   │   └── sales/
│   │       └── ForenseDetector.js     # Detecta días malos
│   │
│   ├── agents/
│   │   └── ForenseAgent.js            # Orquesta la autopsia
│   │
│   ├── memory/
│   │   ├── MemoryService.js           # Interface a pgvector
│   │   ├── embeddings.js              # OpenAI embeddings
│   │   └── ingestion/
│   │       ├── caseIngestion.js       # Indexa casos cerrados
│   │       └── contextIngestion.js    # Indexa conocimiento
│   │
│   ├── knowledge/
│   │   ├── seasonality.json           # Patrones estacionales
│   │   ├── events_impact.json         # Impacto de eventos
│   │   └── branch_profiles.json       # Perfil de sucursales
│   │
│   └── routes/
│       └── forense.js                 # API endpoints
```

## Flujo del Forense

```
1. DETECT        → ForenseDetector encuentra caídas >15%
      ↓
2. AUTOPSY       → Revisa 8 dimensiones
      ↓
3. DIAGNOSE      → Genera hipótesis rankeadas
      ↓
4. SIMILAR CASES → Busca en memoria con pgvector
      ↓
5. RECOMMEND     → Propone acciones basadas en diagnóstico
      ↓
6. LEARN         → Almacena autopsia para futuro
```

## Dimensiones de la Autopsia

El Forense revisa 8 dimensiones en cada autopsia:

| Dimensión | Pregunta | Umbral |
|-----------|----------|--------|
| **TRAFFIC** | ¿Llegaron menos clientes? | -10% |
| **TICKET** | ¿Gastaron menos por visita? | -8% |
| **CHANNEL_MIX** | ¿Cambió el mix de canales? | ±15% |
| **DISCOUNTS** | ¿Hubo más descuentos? | +5% |
| **REFUNDS** | ¿Hubo más devoluciones? | +3% |
| **STAFFING** | ¿Faltó personal? | -15% |
| **EXTERNAL** | ¿Factor externo? | Cualitativo |

## Hipótesis que Genera

El Forense puede generar estas hipótesis:

| ID | Hipótesis | Señales Requeridas |
|----|-----------|-------------------|
| `traffic_drop_external` | Caída por factor externo (clima, evento) | traffic_drop + external_factor |
| `traffic_drop_operations` | Caída por problemas operativos | traffic_drop + staffing_issue |
| `ticket_drop_mix` | Caída por cambio en mix de productos | ticket_drop |
| `excessive_discounts` | Impacto por exceso de descuentos | discount_spike |
| `staffing_impact` | Impacto por falta de personal | staffing_issue |
| `combined_factors` | Múltiples factores combinados | 2+ señales |

## Memoria Vectorial (pgvector)

LUCA ahora tiene memoria de largo plazo usando PostgreSQL + pgvector:

```sql
-- Tabla de memorias
CREATE TABLE luca_memories (
  memory_id TEXT PRIMARY KEY,
  memory_type TEXT NOT NULL,        -- case, autopsy, knowledge, context
  content TEXT NOT NULL,            -- Texto para embedding
  embedding vector(1536),           -- OpenAI embedding
  metadata JSONB,                   -- Datos estructurados
  branch_id TEXT,
  created_at TIMESTAMPTZ
);

-- Índice para búsqueda semántica
CREATE INDEX ON luca_memories 
  USING ivfflat (embedding vector_cosine_ops);
```

### Tipos de Memoria

| Tipo | Contenido |
|------|-----------|
| `case` | Casos cerrados con resolución |
| `autopsy` | Autopsias completadas |
| `knowledge` | Conocimiento estático (estacionalidad, eventos) |
| `context` | Insights y contexto manual |

## Conocimiento Base

### seasonality.json
Patrones mensuales y semanales:
- Enero: -10% (excepto Reyes +50%)
- Diciembre: +40% (Navidad +60-100%)
- Sábado: +30% vs promedio
- Día de las Madres: +80% en pasteles

### events_impact.json
Impacto de eventos externos:
- Lluvia fuerte: -15-25%
- Manifestación: -30-50%
- Partido México: -20% durante
- Puente largo: -25-35% en zonas residenciales

### branch_profiles.json
Perfil de cada sucursal:
- Zona (Sur, Centro, Poniente)
- Horarios pico
- Productos estrella
- Consideraciones especiales

## API Endpoints

### Ejecutar Forense
```bash
# Flujo completo
POST /api/luca/forense/run
{
  "branch_id": "SUC01",  # Opcional, todas si no se especifica
  "date": "2026-01-16"   # Opcional, ayer si no se especifica
}

# Solo detección
POST /api/luca/forense/detect
{
  "branch_id": "SUC03",
  "date": "2026-01-16"
}

# Autopsia en finding específico
POST /api/luca/forense/autopsy
{
  "finding": { ... }
}
```

### Memoria
```bash
# Buscar en memoria
POST /api/luca/forense/memory/search
{
  "query": "caída de ventas por lluvia",
  "type": "autopsy",
  "limit": 5
}

# Casos similares
POST /api/luca/forense/memory/similar-cases
{
  "finding": { ... },
  "branch_id": "SUC01"
}

# Indexar conocimiento base
POST /api/luca/forense/memory/index-knowledge

# Indexar casos cerrados
POST /api/luca/forense/memory/index-cases

# Estadísticas de memoria
GET /api/luca/forense/memory/stats
```

### Conocimiento
```bash
GET /api/luca/forense/knowledge/seasonality
GET /api/luca/forense/knowledge/events
GET /api/luca/forense/knowledge/branches
```

## Variables de Entorno

```bash
# OpenAI para embeddings
OPENAI_API_KEY=sk-...

# PostgreSQL con pgvector (ya configurado)
DATABASE_URL=postgres://...
```

## Ejemplo de Resultado

```javascript
// POST /api/luca/forense/run
{
  "runId": "forense_agent_1737144000000",
  "status": "completed",
  "phases": {
    "detect": {
      "findings": [{
        "branch_id": "SUC03",
        "date": "2026-01-16",
        "severity": "HIGH",
        "severity_score": 65,
        "comparisons": {
          "vs_last_week": -18.5,
          "vs_goal": -22.3
        }
      }]
    },
    "autopsies": [{
      "branch_id": "SUC03",
      "autopsy": {
        "signals": [
          { "dimension": "traffic", "change": -15.2 },
          { "dimension": "staffing", "change": -20 }
        ]
      },
      "diagnosis": {
        "primaryHypothesis": {
          "id": "traffic_drop_operations",
          "title": "Caída de tráfico por problemas operativos",
          "confidence": 0.72
        }
      },
      "similarCases": {
        "found": 2,
        "cases": [...]
      },
      "recommendations": {
        "recommendations": [
          {
            "action": "REVIEW_OPERATIONS",
            "title": "Revisar operaciones",
            "priority": "HIGH"
          }
        ]
      }
    }]
  },
  "cases_created": ["CASE-2026-001"]
}
```

## Checklist de Completitud

- [x] ForenseDetector detecta caídas >15% automáticamente
- [x] Autopsia revisa las 8 dimensiones
- [x] Genera hipótesis rankeadas con confidence
- [x] Vector DB configurado (pgvector)
- [x] Casos cerrados se pueden indexar
- [x] Búsqueda semántica "esto ya pasó antes"
- [x] Conocimiento estacional cargado
- [x] API endpoints completos
- [ ] Integración con datos reales de Redshift
- [ ] Integración con BUK para staffing
- [ ] Integración con API de clima

## Próxima Iteración

**Iteración 8: "Las Manos"** - Action Bus + Ejecución
- LUCA puede escribir, no solo leer
- Human-in-the-loop con niveles de autonomía
- Handlers para WhatsApp, Chatwoot, Sheets

---

🔍 **"El Forense no solo detecta problemas, los investiga y aprende de ellos."**
