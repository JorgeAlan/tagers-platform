import dotenv from "dotenv";
dotenv.config();

function parseBool(v, def = false) {
  if (typeof v !== "string") return def;
  return ["1", "true", "yes", "y", "on"].includes(v.toLowerCase());
}

function parseIntSafe(v, def) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

function parseJsonSafe(v, def) {
  if (!v) return def;
  try {
    return JSON.parse(v);
  } catch (e) {
    return def;
  }
}

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseIntSafe(process.env.PORT, 8787),

  // OpenAI
  openaiApiKey: process.env.OPENAI_API_KEY || "",
  // Optional separate key for CS/Tania flows
  openaiApiKeyTania: (process.env.OPENAI_API_KEY_TANIA || process.env.OPENAI_API_KEY || ""),
  openaiStore: parseBool(process.env.OPENAI_STORE, false),
  // Safety/performance guardrails
  // Premium default: prioritize reliability (avoid hanging requests).
  openaiTimeoutMs: parseIntSafe(process.env.OPENAI_TIMEOUT_MS, 45000),
  openaiMaxRetries: parseIntSafe(process.env.OPENAI_MAX_RETRIES, 2),
  httpTimeoutMs: parseIntSafe(process.env.HTTP_TIMEOUT_MS, 25000),

  // KISS shared secret (HMAC for ingest + list endpoints)
  tagersSharedSecret: process.env.TAGERS_SHARED_SECRET || "",

  // DB (Postgres)
  databaseUrl: process.env.DATABASE_URL || "",

  // CORS (HTTP routes)
  allowedOrigins: (process.env.KISS_ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),

  // Chatwoot (optional module for HITL chat)
  chatwoot: {
    enabled: parseBool(process.env.CHATWOOT_ENABLED, false),
    baseUrl: process.env.CHATWOOT_BASE_URL || "https://app.chatwoot.com",
    apiAccessToken: process.env.CHATWOOT_API_ACCESS_TOKEN || "", // header: api_access_token
    accountId: process.env.CHATWOOT_ACCOUNT_ID || "", // optional if webhook payload provides it
    webhookToken: process.env.CHATWOOT_WEBHOOK_TOKEN || "", // validate inbound webhooks (?token= or header)
    // optional: only handle events from these inbox ids (comma-separated)
    inboxAllowlist: (process.env.CHATWOOT_INBOX_ALLOWLIST || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  },

  // HITL (Socket.io + Staff PWA)
  hitl: {
    enabled: parseBool(process.env.HITL_ENABLED, false),
    requestTtlMs: parseIntSafe(process.env.HITL_REQUEST_TTL_MS, 45000),
    // Branch tokens JSON example:
    // {"SONATA":"TAGERS_SONATA_sk_live_xxx","SAN_ANGEL":"TAGERS_SAN_ANGEL_sk_live_xxx"}
    branchTokens: parseJsonSafe(process.env.HITL_BRANCH_TOKENS_JSON, {}),
    // Allowed origins for socket.io
    allowedOrigins: (process.env.HITL_ALLOWED_ORIGINS || "")
      .split(",")
      .map(s => s.trim())
      .filter(Boolean),
  },

  // Branch registry file path (bundled)
  branchesConfigPath: process.env.TAGERS_BRANCHES_CONFIG_PATH || "config/branches.json",

  // WordPress CS public API (Tania context)
  wp: {
    baseUrl: process.env.WP_BASE_URL || "", // e.g. https://tagers.com
    csToken: process.env.WP_CS_TOKEN || "", // X-Tagers-CS-Token
    infoCacheMs: parseIntSafe(process.env.WP_INFO_CACHE_MS, 0),
  },

  // Service recovery (semáforo emocional)
  serviceRecovery: {
    enabled: parseBool(process.env.SERVICE_RECOVERY_ENABLED, true),
    escalationDelayMs: parseIntSafe(process.env.SERVICE_RECOVERY_ESCALATION_MS, 180000),
    telegram: {
      botToken: process.env.SERVICE_RECOVERY_TELEGRAM_BOT_TOKEN || "",
      chatId: process.env.SERVICE_RECOVERY_TELEGRAM_CHAT_ID || "",
    },
  },

  // Auto recommendation engine (optional)
  autorec: {
    enabled: parseBool(process.env.AUTOREC_ENABLED, false),
    // Cron string (node-cron). Example: "0 3 * * *" (03:00 daily)
    cron: process.env.AUTOREC_CRON || "",
    // Where to route the recommendation (KISS instruction target)
    targetApp: process.env.AUTOREC_TARGET_APP || "APP_AUDIT",
  },
};
