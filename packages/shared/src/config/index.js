/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG MODULE - Configuración base y helpers
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Configuración compartida entre KISS y LUCA.
 * Cada servicio extiende esta config con sus propios valores.
 * 
 * @version 1.0.0
 */

import dotenv from "dotenv";
dotenv.config();

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

export function parseBool(v, def = false) {
  if (typeof v !== "string") return def;
  return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

export function parseIntSafe(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

export function parseJsonSafe(v, def) {
  if (!v) return def;
  try {
    return JSON.parse(v);
  } catch (e) {
    return def;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BASE CONFIG (compartida por KISS y LUCA)
// ═══════════════════════════════════════════════════════════════════════════

export const baseConfig = {
  env: process.env.NODE_ENV || "development",
  isProduction: process.env.NODE_ENV === "production",
  
  // Database
  databaseUrl: process.env.DATABASE_URL || "",
  
  // Redis
  redisUrl: process.env.REDIS_URL || "redis://localhost:6379",
  
  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  openaiTimeoutMs: parseIntSafe(process.env.OPENAI_TIMEOUT_MS, 45000),
  openaiMaxRetries: parseIntSafe(process.env.OPENAI_MAX_RETRIES, 2),
  
  // HTTP
  httpTimeoutMs: parseIntSafe(process.env.HTTP_TIMEOUT_MS, 25000),
  
  // Chatwoot
  chatwoot: {
    enabled: parseBool(process.env.CHATWOOT_ENABLED, false),
    baseUrl: process.env.CHATWOOT_BASE_URL || "https://app.chatwoot.com",
    apiAccessToken: process.env.CHATWOOT_API_ACCESS_TOKEN || "",
    accountId: process.env.CHATWOOT_ACCOUNT_ID || "",
    webhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN || "",
  },
  
  // WhatsApp Business API
  whatsapp: {
    enabled: parseBool(process.env.WHATSAPP_ENABLED, false),
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || "",
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || "",
  },
  
  // Google Sheets (Config Hub)
  googleSheets: {
    enabled: parseBool(process.env.GOOGLE_SHEETS_ENABLED, false),
    credentialsJson: process.env.GOOGLE_SHEETS_CREDENTIALS_JSON || "",
    spreadsheetId: process.env.GOOGLE_SHEETS_SPREADSHEET_ID || "",
  },
  
  // LangSmith (Observability)
  langsmith: {
    enabled: parseBool(process.env.LANGSMITH_ENABLED, false),
    apiKey: process.env.LANGSMITH_API_KEY || "",
    project: process.env.LANGSMITH_PROJECT || "tagers-platform",
    endpoint: process.env.LANGSMITH_ENDPOINT || "https://api.smith.langchain.com",
  },
};

export default baseConfig;
