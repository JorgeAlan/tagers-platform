import fs from "fs";
import path from "path";
// Ajv default export validates draft-07. Our schemas declare draft 2020-12.
// Use Ajv 2020 build to avoid "no schema with key or ref .../draft/2020-12".
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(new URL(import.meta.url).pathname);

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

function loadSchema(relPath) {
  const p = path.join(__dirname, "..", relPath);
  const raw = fs.readFileSync(p, "utf-8");
  return JSON.parse(raw);
}

const beaconSchema = loadSchema("schemas/beacon.schema.json");
const instructionSchema = loadSchema("schemas/kiss_instruction.schema.json");
const signalSchema = loadSchema("schemas/kiss_signal.schema.json");

const chatwootIntentSchema = loadSchema("schemas/chatwoot_intent.schema.json");
const hitlCustomerReplySchema = loadSchema("schemas/hitl_customer_reply.schema.json");
const sentimentResultSchema = loadSchema("schemas/sentiment_result.schema.json");
const taniaReplySchema = loadSchema("schemas/tania_reply.schema.json");
const incidentReportSchema = loadSchema("schemas/incident_report.schema.json");
const codeRecommendationSchema = loadSchema("schemas/code_recommendation.schema.json");

export const validateBeacon = ajv.compile(beaconSchema);
export const validateInstruction = ajv.compile(instructionSchema);
export const validateSignal = ajv.compile(signalSchema);
export const validateChatwootIntent = ajv.compile(chatwootIntentSchema);
export const validateHitlCustomerReply = ajv.compile(hitlCustomerReplySchema);
export const validateSentimentResult = ajv.compile(sentimentResultSchema);
export const validateTaniaReply = ajv.compile(taniaReplySchema);
export const validateIncidentReport = ajv.compile(incidentReportSchema);
export const validateCodeRecommendation = ajv.compile(codeRecommendationSchema);

export function formatAjvErrors(errors) {
  return (errors || []).map(e => ({
    path: e.instancePath || e.schemaPath,
    message: e.message,
  }));
}
