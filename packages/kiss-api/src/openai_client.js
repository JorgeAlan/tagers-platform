import fs from "fs";
import path from "path";
import OpenAI from "openai";
import { config } from "./config.js";
import { logger } from "./utils/logger.js";
import { assertStructuredOutputsSupported, normalizeServiceTier, sanitizeSamplingParams } from "./openai_compat.js";

// ═══════════════════════════════════════════════════════════════════════════
// LANGSMITH INTEGRATION - traceable para Responses API
// ═══════════════════════════════════════════════════════════════════════════
import { traceable } from "langsmith/traceable";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function loadJSON(rel) {
  const p = path.join(__dirname, rel);
  return JSON.parse(fs.readFileSync(p, "utf-8"));
}

const SCHEMAS = {
  kiss_signal: loadJSON("./schemas/kiss_signal.schema.json"),
  kiss_instruction: loadJSON("./schemas/kiss_instruction.schema.json"),
  kiss_instruction_openai: loadJSON("./schemas/kiss_instruction_openai.schema.json"),
  chatwoot_intent: loadJSON("./schemas/chatwoot_intent.schema.json"),
  hitl_customer_reply: loadJSON("./schemas/hitl_customer_reply.schema.json"),
  sentiment_result: loadJSON("./schemas/sentiment_result.schema.json"),
  tania_reply: loadJSON("./schemas/tania_reply.schema.json"),
  incident_report: loadJSON("./schemas/incident_report.schema.json"),
  code_recommendation: loadJSON("./schemas/code_recommendation.schema.json"),
  conversation_summary: loadJSON("./schemas/conversation_summary.schema.json"),
};

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTE OPENAI
// ═══════════════════════════════════════════════════════════════════════════

let _client = null;
let _langsmithLogged = false;

function isLangSmithEnabled() {
  return process.env.LANGCHAIN_TRACING_V2 === "true" && process.env.LANGCHAIN_API_KEY;
}

export function getOpenAIClient() {
  if (_client) return _client;
  if (!config.openaiApiKey) {
    throw new Error("OPENAI_API_KEY is not set. The KISS API cannot call OpenAI.");
  }
  
  _client = new OpenAI({
    apiKey: config.openaiApiKey,
    timeout: config.openaiTimeoutMs,
    maxRetries: config.openaiMaxRetries,
  });
  
  // Log LangSmith status una sola vez
  if (!_langsmithLogged) {
    _langsmithLogged = true;
    if (isLangSmithEnabled()) {
      logger.info({
        msg: "LangSmith tracing enabled (traceable mode)",
        project: process.env.LANGCHAIN_PROJECT || "default",
      });
    } else {
      logger.debug({ msg: "LangSmith tracing not enabled" });
    }
  }
  
  return _client;
}

/**
 * Extract output text from OpenAI Responses API response.
 */
function extractOutputText(resp) {
  if (typeof resp?.output_text === "string" && resp.output_text.length) {
    return resp.output_text;
  }

  const parts = [];
  const out = resp?.output;

  if (Array.isArray(out)) {
    for (const item of out) {
      if (!item) continue;
      if (item.type === "message" && Array.isArray(item.content)) {
        for (const c of item.content) {
          if (c?.type === "output_text" && typeof c.text === "string") {
            parts.push(c.text);
          }
        }
        continue;
      }
      if (item.type === "output_text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
  }

  return parts.join("");
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL: createStructuredJSON (con traceable integrado)
// ═══════════════════════════════════════════════════════════════════════════

export async function createStructuredJSON({
  model,
  service_tier,
  instructions,
  inputObject,
  schemaKey,
  schemaName,
  temperature,
  max_output_tokens = 700,
  store = false,
  metadata = {},
  reasoning,
  text,
  top_p,
  logprobs,
}) {
  const openai = getOpenAIClient();
  const schema = SCHEMAS[schemaKey];
  if (!schema) throw new Error(`Unknown schemaKey: ${schemaKey}`);

  assertStructuredOutputsSupported(model);

  const normalizedServiceTier = normalizeServiceTier(service_tier);
  const { params: compatParams, warnings } = sanitizeSamplingParams({
    model,
    reasoning,
    temperature,
    top_p,
    logprobs,
  });

  if (warnings?.length) {
    logger.warn({ warnings, model }, "OpenAI param compatibility: adjusted request params");
  }

  const effectiveSchemaName = schemaName || schema.title || schemaKey;

  // ═══════════════════════════════════════════════════════════════════════
  // Función interna que hace la llamada real a OpenAI
  // ═══════════════════════════════════════════════════════════════════════
  async function _doOpenAICall({ maxTokens }) {
    const resp = await openai.responses.create({
      model,
      service_tier: normalizedServiceTier,
      store,
      max_output_tokens: maxTokens,
      instructions,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(inputObject),
            },
          ],
        },
      ],
      text: {
        ...(text || {}),
        format: {
          type: "json_schema",
          name: effectiveSchemaName,
          schema,
          strict: true,
        },
      },
      metadata,
      ...compatParams,
    });

    const raw = extractOutputText(resp);
    return { resp, raw };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Wrappear con traceable si LangSmith está habilitado
  // ═══════════════════════════════════════════════════════════════════════
  const callOnce = isLangSmithEnabled()
    ? traceable(
        async ({ maxTokens }) => _doOpenAICall({ maxTokens }),
        {
          name: metadata?.task || schemaKey || "openai-responses",
          run_type: "llm",
          metadata: {
            model,
            schemaKey,
            service: "tagers-kiss-api",
            ...metadata,
          },
        }
      )
    : _doOpenAICall;

  function isIncompleteMaxTokens(resp) {
    return (
      resp?.status === "incomplete" &&
      resp?.incomplete_details &&
      resp.incomplete_details.reason === "max_output_tokens"
    );
  }

  // 1) First attempt
  let attempt = await callOnce({ maxTokens: max_output_tokens });

  // 2) Retry if ran out of tokens
  if (!attempt.raw && isIncompleteMaxTokens(attempt.resp)) {
    const retryMax = Math.min(Math.max(max_output_tokens * 4, 1200), 25000);
    logger.warn(
      {
        resp_id: attempt.resp?.id,
        model,
        max_output_tokens,
        retry_max_output_tokens: retryMax,
        usage: attempt.resp?.usage || null,
      },
      "OpenAI response incomplete (ran out of tokens during reasoning). Retrying with higher max_output_tokens"
    );
    attempt = await callOnce({ maxTokens: retryMax });
  }

  if (!attempt.raw) {
    logger.warn(
      {
        resp_id: attempt.resp?.id,
        status: attempt.resp?.status,
        incomplete_details: attempt.resp?.incomplete_details,
        output: attempt.resp?.output,
        usage: attempt.resp?.usage || null,
      },
      "No output_text found in response"
    );
    throw new Error("Model did not return output text");
  }

  let parsed = null;
  try {
    parsed = JSON.parse(attempt.raw);
  } catch (e) {
    if (isIncompleteMaxTokens(attempt.resp)) {
      const retryMax = Math.min(Math.max(max_output_tokens * 4, 1200), 25000);
      logger.warn(
        {
          resp_id: attempt.resp?.id,
          model,
          max_output_tokens,
          retry_max_output_tokens: retryMax,
          usage: attempt.resp?.usage || null,
        },
        "OpenAI returned incomplete/partial JSON (max_output_tokens). Retrying with higher max_output_tokens"
      );
      const retry = await callOnce({ maxTokens: retryMax });
      try {
        parsed = JSON.parse(retry.raw);
        attempt = retry;
      } catch (e2) {
        const err = new Error("Failed to parse structured JSON output from OpenAI (after retry).");
        err.cause = e2;
        err.raw = retry.raw;
        err.response_id = retry.resp?.id;
        throw err;
      }
    } else {
      const err = new Error("Failed to parse structured JSON output from OpenAI.");
      err.cause = e;
      err.raw = attempt.raw;
      err.response_id = attempt.resp?.id;
      throw err;
    }
  }

  return {
    parsed,
    response_id: attempt.resp?.id,
    service_tier_used: attempt.resp?.service_tier || service_tier,
    model_used: model,
  };
}
