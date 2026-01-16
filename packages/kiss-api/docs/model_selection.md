# Selección de modelos OpenAI para Tagers (costo vs coherencia)

Este documento define una **política operativa** para elegir modelo + `service_tier` según el tipo de tarea en Tagers Ops.

La idea: **no pagar GPT-5.2 para todo**. Usar modelos baratos para tareas simples, y reservar modelos caros para decisiones con impacto (inventario, VIP, peak shaving, reputación).

---

## 1) Concepto clave: 2 etapas (barato primero, caro solo si hace falta)

### Etapa A — Normalización (barata)
- Objetivo: convertir input humano (texto/voz) o logs ruidosos en un JSON limpio y consistente.
- Modelo recomendado: **gpt-5-nano** (o **gpt-5-mini** si la señal es ambigua).

### Etapa B — Decisión operativa (coherencia)
- Objetivo: aplicar reglas duras + resolver conflictos de señales + producir instrucciones.
- Modelo recomendado: **gpt-5.2** (y `priority` si es crítico).

---

## 2) Mapa de tareas → modelo

| Tarea | Ejemplos | Modelo | service_tier | Motivo |
|---|---|---|---|---|
| Clasificación simple | Razón de cancelación, etiqueta de merma, “sí/no” | gpt-5-nano | flex | Barato + suficiente |
| Extracción estructurada | Parsear beacon humano → campos | gpt-5-nano | flex | Structured outputs reduce errores |
| Resumen corto | Nota de voz/WhatsApp → 2 líneas | gpt-5-mini | default | Mejor redacción + robustez |
| Instrucción operativa | “Qué debe hacer el runner” con FIFO | gpt-5-mini | default | Buen balance costo/calidad |
| Decisión de inventario / VIP | Reservas, proteger stock, override | gpt-5.2 | default | Mayor coherencia y control |
| Crisis / alta presión | VIP, medios, “se va a hacer viral” | gpt-5.2 | priority | Latencia consistente + calidad |

---

## 3) Fallback automático (si falla el JSON o baja confianza)

Orden recomendado (y compatible con Structured Outputs):
1. gpt-5-nano → 2. gpt-5-mini → 3. gpt-5.2 → 4. gpt-5.1 → 5. gpt-4.1

Nota: `gpt-5.2-pro` no es un buen fallback para este stack porque **no soporta Structured Outputs** (json_schema) según la documentación actual.

---

## 4) Parámetros recomendados

### Sampling (temperature/top_p/logprobs)

En la familia GPT-5, **los parámetros de sampling no son universales**.

Regla práctica (resumen de compatibilidad):

* **GPT-5.2 / GPT-5.1**: `temperature`, `top_p`, `logprobs` **solo** son válidos cuando `reasoning.effort = "none"`.
* **Modelos GPT-5 anteriores** (`gpt-5`, `gpt-5-mini`, `gpt-5-nano`): estos parámetros pueden ser **rechazados** si se envían.

Por eso, en la suite **por defecto no enviamos `temperature`** y nos apoyamos en:

* Structured Outputs estricto (`json_schema`)
* `reasoning.effort` (para tareas críticas)
* `text.verbosity` (low/medium/high) para controlar longitud

### Defaults recomendados

* `store`: false (por defecto)
* Structured Outputs (JSON Schema estricto) siempre que sea posible

---

## 5) Reglas de oro

1) **No uses LLM para calcular reglas duras** (FIFO / vida útil / ventanas).  
   Implementa esas reglas en código; usa el LLM para interpretar señales humanas.

2) **No bloquees el POS esperando un LLM** si no es necesario.  
   Para POS, preferir: registrar beacon → responder rápido → procesar async.

3) **VIP / reputación** siempre es “alto riesgo”.  
   Ahí sí usa modelo fuerte.

---

## 6) Archivo de configuración
La política real que usa el microservicio vive en: `src/model_policy.json`.
