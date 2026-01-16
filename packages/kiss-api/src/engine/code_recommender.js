import fs from "fs";
import path from "path";
import { createStructuredJSON } from "../openai_client.js";
import { routeTask } from "../model_router.js";
import { validateCodeRecommendation } from "../utils/validate.js";
import { getBeaconSourceCounts, saveSystemRecommendation } from "../db/repo.js";

function safeReadFile(p, maxChars = 12000) {
  try {
    const raw = fs.readFileSync(p, "utf-8");
    return raw.length > maxChars ? raw.slice(0, maxChars) + "\n/* ...truncated... */\n" : raw;
  } catch (e) {
    return null;
  }
}

function resolvePath(relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  return path.join(process.cwd(), relOrAbs);
}

export async function runCodeRecommendation({ component = "kiss-api", focusPaths = [], notes = "" }) {
  const counts = await getBeaconSourceCounts(7);

  const files = [];
  for (const p of focusPaths.slice(0, 12)) {
    const abs = resolvePath(p);
    if (!abs) continue;
    const content = safeReadFile(abs);
    if (!content) continue;
    files.push({ path: p, content });
  }

  const task = routeTask("code_recommendation");
  const instructions = fs.readFileSync(resolvePath("prompts/code_recommender_system.md"), "utf-8");

  const inputObject = {
    component,
    notes,
    beacon_source_counts: counts,
    files,
  };

  const res = await createStructuredJSON({
    ...task,
    schemaKey: "code_recommendation",
    schemaName: "code_recommendation",
    instructions,
    inputObject,
    metadata: { task: "code_recommendation", component },
  });

  const json = res.parsed;

  const ok = validateCodeRecommendation(json);
  if (!ok) {
    const err = validateCodeRecommendation.errors?.[0]?.message || "Schema validation failed";
    throw new Error(err);
  }

  await saveSystemRecommendation({
    component,
    title: json.title,
    risk_level: json.risk_level,
    confidence: json.confidence,
    model_used: task.model,
    response_id: res.response_id,
    payload: json,
  });

  return { recommendation: json, response_id: res.response_id };
}
