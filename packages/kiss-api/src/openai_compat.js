// Centralized OpenAI parameter compatibility helpers.
//
// Motivation:
// - GPT-5.2 / GPT-5.1 only support sampling params (temperature/top_p/logprobs)
//   when reasoning.effort is set to "none".
// - Older GPT-5 family models (gpt-5, gpt-5-mini, gpt-5-nano) reject these
//   params entirely.
//
// We keep this logic in one place to reduce regressions when OpenAI updates
// model/parameter compatibility.

export function normalizeServiceTier(service_tier) {
  if (!service_tier) return undefined;
  const t = String(service_tier).toLowerCase().trim();
  // The API accepts: auto | default | flex | priority
  // Older internal docs may have used "standard".
  if (t === "standard") return "default";
  if (["auto", "default", "flex", "priority"].includes(t)) return t;
  // Unknown value: pass through (may be supported in the future).
  return service_tier;
}

export function isGpt52Family(model) {
  return String(model || "").startsWith("gpt-5.2");
}

export function isGpt51Family(model) {
  return String(model || "").startsWith("gpt-5.1");
}

export function isOlderGpt5Family(model) {
  const m = String(model || "");
  return m.startsWith("gpt-5") && !m.startsWith("gpt-5.1") && !m.startsWith("gpt-5.2");
}

export function isGpt52Pro(model) {
  return String(model || "").startsWith("gpt-5.2-pro");
}

export function modelSupportsReasoningParam(model) {
  const m = String(model || "");
  // Reasoning controls exist for reasoning model families (GPT-5, o-series, etc.).
  // Non-reasoning GPT models (e.g. gpt-4.1) should not receive `reasoning`.
  return m.startsWith("gpt-5") || m.startsWith("o");
}

// NOTE: as of the current OpenAI docs, GPT-5.2 pro does not support Structured Outputs.
// We guard to avoid accidental misconfiguration (it would otherwise fail at runtime).
export function assertStructuredOutputsSupported(model) {
  if (isGpt52Pro(model)) {
    throw new Error(
      "Model gpt-5.2-pro does not support Structured Outputs (json_schema). " +
        "Use gpt-5.2 (or gpt-5.1 / gpt-5 / gpt-5-mini / gpt-5-nano) for schema-constrained responses."
    );
  }
}

function cloneReasoning(reasoning) {
  if (!reasoning || typeof reasoning !== "object") return undefined;
  const out = { ...reasoning };
  // Only keep known key(s) for now.
  if (out.effort == null) delete out.effort;
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeReasoningForModel(model, reasoning) {
  const r = cloneReasoning(reasoning);
  if (!r) return undefined;

  // gpt-5.2-pro supports: medium | high | xhigh (no none/low)
  if (isGpt52Pro(model)) {
    const eff = String(r.effort || "").toLowerCase();
    if (!["medium", "high", "xhigh"].includes(eff)) {
      r.effort = "medium";
    }
    return r;
  }

  // For other models, pass through. Model-specific validation happens server-side.
  return r;
}

export function sanitizeSamplingParams({ model, reasoning, temperature, top_p, logprobs }) {
  const m = String(model || "");
  const warnings = [];

  const out = {};
  const supportsReasoning = modelSupportsReasoningParam(model);
  const r = supportsReasoning ? sanitizeReasoningForModel(model, reasoning) : undefined;
  if (r) out.reasoning = r;
  if (!supportsReasoning && reasoning) {
    warnings.push(`Reasoning params are not supported for model ${m}; dropping them.`);
  }

  const hasTemp = typeof temperature === "number";
  const hasTopP = typeof top_p === "number";
  const hasLogprobs = typeof logprobs === "number" || typeof logprobs === "boolean";

  // Sampling params are only supported for GPT-5.2/GPT-5.1 when reasoning effort is "none".
  // Older GPT-5 family models reject them completely.
  const eff = String(r?.effort || "").toLowerCase();
  const is52or51 = isGpt52Family(m) || isGpt51Family(m);

  if (isOlderGpt5Family(m) || isGpt52Pro(m)) {
    if (hasTemp || hasTopP || hasLogprobs) {
      warnings.push(
        `Sampling params (temperature/top_p/logprobs) are not supported for model ${m}; dropping them.`
      );
    }
    return { params: out, warnings };
  }

  if (is52or51) {
    // If the caller tries to send sampling params with non-none reasoning, drop them.
    // If effort wasn't specified, we *do not* auto-force "none" here; that is policy-driven.
    if (eff !== "none") {
      if (hasTemp || hasTopP || hasLogprobs) {
        warnings.push(
          `Sampling params are only supported for ${m} when reasoning.effort="none"; dropping them (effort=${eff || "(unset)"}).`
        );
      }
      return { params: out, warnings };
    }

    if (hasTemp) out.temperature = temperature;
    if (hasTopP) out.top_p = top_p;
    if (hasLogprobs) out.logprobs = logprobs;

    return { params: out, warnings };
  }

  // Non GPT-5 models: allow sampling params if provided.
  if (hasTemp) out.temperature = temperature;
  if (hasTopP) out.top_p = top_p;
  if (hasLogprobs) out.logprobs = logprobs;

  return { params: out, warnings };
}
