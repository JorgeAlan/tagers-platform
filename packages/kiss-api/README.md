# 🚀 Token Optimization - Instalación Completa

## Archivos para reemplazar

```
src/
├── tania/
│   ├── agentic_flow.js           ← REEMPLAZAR (Quick Wins)
│   ├── agentic_flow_optimized.js ← NUEVO (Flujo optimizado)
│   └── agentic_flow_selector.js  ← NUEVO (Switch automático)
├── workers/
│   └── aiWorker.js               ← REEMPLAZAR (imports actualizados)
├── routes/
│   ├── admin.js                  ← REEMPLAZAR (imports actualizados)
│   └── chatwoot.js               ← REEMPLAZAR (imports actualizados)
└── model_policy_optimized.json   ← NUEVO (opcional, para después)

.env.example                      ← REEMPLAZAR (nuevas variables)
docs/TOKEN_OPTIMIZATION_ANALYSIS.md ← NUEVO (documentación)
```

---

## Instalación

### Paso 1: Copia los archivos
Arrastra las carpetas `src/` y `docs/` a tu repo, reemplazando los existentes.
También reemplaza `.env.example`.

### Paso 2: Variables en Railway

```env
# Quick Wins (Fase 1 - activos por default)
SKIP_RESPONSE_VALIDATOR=true
MAX_RESPONSE_REVISIONS=0
MAX_CONVERSATION_HISTORY=5

# Flujo Optimizado (Fase 2 - activo por default)
OPTIMIZED_AGENTIC_FLOW=true
```

### Paso 3: Commit + Push
Desde GitHub Desktop, commit y push. Railway redeploya automáticamente.

---

## Qué hace cada variable

| Variable | Efecto | Ahorro |
|----------|--------|--------|
| `SKIP_RESPONSE_VALIDATOR=true` | Salta validación AI | 1 llamada/msg |
| `MAX_RESPONSE_REVISIONS=0` | Sin loop de revisiones | 0-2 llamadas/msg |
| `MAX_CONVERSATION_HISTORY=5` | Menos historial | ~2500 tokens/msg |
| `OPTIMIZED_AGENTIC_FLOW=true` | Usa flujo nuevo | 95% total |

---

## Comportamiento después del deploy

1. **Selector automático**: aiWorker.js ahora usa `agentic_flow_selector.js`
2. **Flujo nuevo por default**: Con `OPTIMIZED_AGENTIC_FLOW=true`, usa el flujo de 1 llamada AI
3. **Fallback automático**: Si el flujo nuevo falla, cae al viejo automáticamente
4. **Quick Wins siempre activos**: Las 3 variables aplican al flujo viejo también

---

## Rollback

### Si hay problemas de calidad:
```env
OPTIMIZED_AGENTIC_FLOW=false
```
Esto desactiva el flujo nuevo y usa el viejo (con Quick Wins).

### Si hay problemas graves:
Revierte el commit en GitHub Desktop. Los archivos viejos restauran todo.

---

## Monitoreo en LangSmith

Después del deploy, busca en los traces:
- `flow: "optimized"` → Flujo nuevo funcionando
- `flow: "legacy"` → Flujo viejo (fallback)
- `aiCalls: 1` → Éxito de optimización

---

## Ahorro esperado

| Métrica | Antes | Después |
|---------|-------|---------|
| Llamadas AI/mensaje | 3-9 | 0.2-1 |
| Tokens/mensaje | 19,000-35,000 | ~600 |
| Costo/1000 mensajes | $67-120 | ~$1.20 |
| Latencia | 2-5 segundos | <500ms |

**Ahorro total: ~95%**
