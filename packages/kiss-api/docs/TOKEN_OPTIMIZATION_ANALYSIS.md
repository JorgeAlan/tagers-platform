# 🔥 Análisis de Optimización de Tokens - Tagers KISS API

**Fecha:** 2026-01-14  
**Estado actual:** 3-9 llamadas de AI por mensaje  
**Objetivo:** 1 llamada de AI por mensaje (o 0 si hay cache hit)  
**Ahorro estimado:** 70-85% de costos de AI

---

## 1. DIAGNÓSTICO DEL PROBLEMA

### 1.1 Flujo Actual (Agentic Flow)

```
MENSAJE ENTRANTE
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  DISPATCHER (regex) → Decide si va a Agentic Flow           │
└──────────────────────────────────────────────────────────────┘
       │
       ▼ (Si no es trivial)
┌──────────────────────────────────────────────────────────────┐
│  ANALYZER (gpt-5.2) 🔴                                       │
│  - Analiza intent                                            │
│  - Detecta frustración                                       │
│  - Detecta loops                                             │
│  Prompt: ~2.5KB | Tokens output: ~1800                       │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  RETRIEVER (código)                                          │
│  - Busca en pgvector                                         │
│  - Prepara contexto                                          │
│  - No consume tokens de AI                                   │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  GENERATOR (gpt-5.2) 🔴                                      │
│  - Genera respuesta                                          │
│  - Incluye todo el contexto                                  │
│  Prompt: ~10KB | Tokens output: ~3000                        │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  VALIDATOR (gpt-5.2) 🔴                                      │
│  - Valida calidad                                            │
│  - Puede pedir revisión                                      │
│  Prompt: ~3KB | Tokens output: ~1500                         │
└──────────────────────────────────────────────────────────────┘
       │
       ▼ (Si needs_revision, repite hasta 3 veces)
┌──────────────────────────────────────────────────────────────┐
│  GENERATOR (gpt-5.2) 🔴 + VALIDATOR (gpt-5.2) 🔴            │
│  x1, x2, x3...                                               │
└──────────────────────────────────────────────────────────────┘
```

### 1.2 Consumo por Mensaje

| Paso | Modelo | Tokens Input | Tokens Output | Costo Estimado |
|------|--------|--------------|---------------|----------------|
| Analyzer | gpt-5.2 | ~3000 | ~500 | ~$0.012 |
| Generator | gpt-5.2 | ~12000 | ~800 | ~$0.040 |
| Validator | gpt-5.2 | ~4000 | ~400 | ~$0.015 |
| **TOTAL (mínimo)** | | ~19000 | ~1700 | **~$0.067** |
| **TOTAL (con revisiones)** | | ~35000 | ~3000 | **~$0.120** |

**Costo estimado por 1000 mensajes: $67 - $120 USD**

### 1.3 Problemas Identificados

1. **Modelos sobredimensionados**
   - Usando gpt-5.2 (el más caro) para TODAS las tareas
   - Clasificación simple no necesita el modelo más inteligente

2. **Llamadas redundantes**
   - Analyzer analiza intent → pero Dispatcher YA lo hizo con regex
   - Validator valida calidad → pero un buen prompt produce buena calidad
   - 3 pasos que podrían ser 1

3. **Prompts inflados**
   - `chatwoot_router_system.md`: 6KB de ejemplos
   - Mucha redundancia y repetición
   - Historia de conversación enviada completa en cada llamada

4. **Sin short-circuit efectivo**
   - Semantic cache existe pero no se usa en el flujo principal
   - Respuestas canned pasan por Generator+Validator aunque ya están listas

---

## 2. SOLUCIÓN PROPUESTA

### 2.1 Nuevo Flujo Simplificado

```
MENSAJE ENTRANTE
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  FAST PATH (código + regex)                                  │
│  - Saludos, despedidas, gracias → Respuesta directa          │
│  - Handoff explícito → Escalar                               │
│  - Flujo activo → Continuar flujo                            │
│  ⚡ 0 llamadas AI                                             │
└──────────────────────────────────────────────────────────────┘
       │
       ▼ (Si no es fast path)
┌──────────────────────────────────────────────────────────────┐
│  SEMANTIC CACHE CHECK                                        │
│  - Buscar pregunta similar (>0.85 similitud)                 │
│  - Si encontrada → Respuesta del cache                       │
│  ⚡ 0 llamadas AI                                             │
└──────────────────────────────────────────────────────────────┘
       │
       ▼ (Si no hay cache hit)
┌──────────────────────────────────────────────────────────────┐
│  CANNED RESPONSE CHECK (pgvector)                            │
│  - Buscar respuesta predefinida (>0.90 similitud)            │
│  - Si encontrada → Usar directamente                         │
│  ⚡ 0 llamadas AI                                             │
└──────────────────────────────────────────────────────────────┘
       │
       ▼ (Si necesita AI)
┌──────────────────────────────────────────────────────────────┐
│  SINGLE AI CALL (gpt-5-mini) ✅                              │
│  - Prompt compacto (~2KB)                                    │
│  - Contexto mínimo necesario                                 │
│  - Historia resumida (no completa)                           │
│  ⚡ 1 llamada AI                                              │
└──────────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────────┐
│  CACHE RESPONSE                                              │
│  - Guardar en semantic cache                                 │
│  - Disponible para futuras preguntas similares               │
└──────────────────────────────────────────────────────────────┘
```

### 2.2 Consumo Optimizado por Mensaje

| Escenario | Llamadas AI | Tokens Input | Tokens Output | Costo Est. |
|-----------|-------------|--------------|---------------|------------|
| Fast path (40% mensajes) | 0 | 0 | 0 | $0 |
| Cache hit (30% mensajes) | 0 | 0 | 0 | $0 |
| Canned match (15% mensajes) | 0 | 0 | 0 | $0 |
| AI necesario (15% mensajes) | 1 | ~4000 | ~500 | ~$0.008 |
| **PROMEDIO** | 0.15 | ~600 | ~75 | **~$0.0012** |

**Costo estimado por 1000 mensajes: ~$1.20 USD**

### 2.3 Ahorro

| Métrica | Actual | Optimizado | Ahorro |
|---------|--------|------------|--------|
| Llamadas AI / mensaje | 3-9 | 0.15 | **95%** |
| Tokens input / mensaje | 19000-35000 | ~600 | **97%** |
| Costo / 1000 mensajes | $67-120 | ~$1.20 | **98%** |

---

## 3. CAMBIOS TÉCNICOS

### 3.1 Actualizar `model_policy.json`

```json
{
  "tasks": {
    "tania_reply_simple": {
      "model": "gpt-5-mini",  // Cambio de gpt-5.2
      "max_output_tokens": 800,
      "temperature": 0.3
    },
    "tania_reply_complex": {
      "model": "gpt-5.2",  // Solo para casos complejos
      "max_output_tokens": 1500,
      "temperature": 0.3
    }
  }
}
```

### 3.2 Crear `agentic_flow_optimized.js`

Ver archivo adjunto: Flujo simplificado con 1 llamada.

### 3.3 Crear `prompt_tania_compact.md`

Prompt reducido de 3.3KB a ~1KB.

### 3.4 Actualizar `dispatcher.js`

Agregar checks de cache y canned responses antes de delegar.

---

## 4. MÉTRICAS DE ÉXITO

1. **Llamadas AI por mensaje**: < 0.3 promedio
2. **Cache hit rate**: > 40%
3. **Costo por 1000 mensajes**: < $5 USD
4. **Latencia P95**: < 500ms (vs 2-5s actual)
5. **Calidad de respuestas**: Mantener o mejorar (medido por thumbs up/down)

---

## 5. PLAN DE IMPLEMENTACIÓN

### Fase 1: Quick Wins (1-2 horas)
- [ ] Cambiar modelos de gpt-5.2 a gpt-5-mini para Analyzer y Validator
- [ ] Desactivar Validator (flag en env)
- [ ] Reducir MAX_REVISIONS a 1

### Fase 2: Optimización Core (4-6 horas)
- [ ] Implementar semantic cache check en dispatcher
- [ ] Implementar canned response short-circuit
- [ ] Crear prompt compacto

### Fase 3: Flujo Simplificado (8 horas)
- [ ] Crear agentic_flow_optimized.js
- [ ] Eliminar Analyzer redundante
- [ ] Combinar lógica en una sola llamada

### Fase 4: Monitoreo
- [ ] Dashboard de token usage
- [ ] Alertas de regresión de calidad
- [ ] A/B testing nuevo vs viejo

---

## 6. RIESGOS Y MITIGACIÓN

| Riesgo | Mitigación |
|--------|------------|
| Menor calidad de respuestas | A/B testing, rollback fácil |
| Cache sirve respuestas obsoletas | TTL cortos, invalidación por categoría |
| gpt-5-mini no es suficiente | Escalamiento dinámico a gpt-5.2 por complejidad |

---

## CONCLUSIÓN

El sistema actual gasta 50-100x más tokens de lo necesario. Con las optimizaciones propuestas:

- **Costo mensual**: De ~$2000-4000 a ~$50-100
- **Latencia**: De 2-5s a <500ms
- **Calidad**: Igual o mejor (prompts más focalizados)

La clave es: **usar AI solo cuando realmente lo necesitas**.
