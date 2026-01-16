import fs from "fs";
import path from "path";
import { createStructuredJSON } from "../openai_client_tania.js";
import { routeTask } from "../model_router.js";
import { validateIncidentReport } from "../utils/validate.js";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

function loadPrompt(rel) {
  const p = path.join(__dirname, "..", "..", rel);
  return fs.readFileSync(p, "utf-8");
}

export async function generateIncidentReport(payload) {
  const task = routeTask("incident_report");
  const instructions = loadPrompt("prompts/incident_report_system.md");

  const res = await createStructuredJSON({
    ...task,
    schemaKey: "incident_report",
    schemaName: "incident_report",
    instructions,
    inputObject: payload,
    metadata: {
      task: "incident_report",
      conversation_id: payload?.chatwoot_context?.conversation_id ? String(payload.chatwoot_context.conversation_id) : undefined,
    },
  });

  const report = res.parsed;
  if (!validateIncidentReport(report)) {
    const err = validateIncidentReport.errors?.[0]?.message || "incident_report schema validation failed";
    throw new Error(err);
  }

  return report;
}
