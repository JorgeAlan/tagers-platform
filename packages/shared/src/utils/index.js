/**
 * ═══════════════════════════════════════════════════════════════════════════
 * UTILS MODULE - Logger y utilidades compartidas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * @version 1.0.0
 */

// ═══════════════════════════════════════════════════════════════════════════
// LOGGER
// ═══════════════════════════════════════════════════════════════════════════

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

/**
 * Patrones regex para detectar y redactar PII
 */
const PII_PATTERNS = {
  phone: /(\+?52\s?)?[\d\s-]{10,14}/g,
  email: /[\w.-]+@[\w.-]+\.\w+/gi,
  apiKey: /(sk-|pk_|key_|token_)[a-zA-Z0-9]{20,}/gi,
};

const REDACT_KEYS = new Set([
  "phone", "phone_number", "phoneNumber", "telefono",
  "email", "email_address", "emailAddress", "correo",
  "apiKey", "api_key", "accessToken", "access_token",
  "refreshToken", "refresh_token", "password", "secret",
  "Authorization", "authorization", "rawBody",
]);

function redactObject(obj, depth = 0) {
  if (depth > 5) return obj;
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return redactString(String(obj));
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, depth + 1));
  }
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    if (REDACT_KEYS.has(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    
    if (typeof value === "object" && value !== null) {
      result[key] = redactObject(value, depth + 1);
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

function redactString(str) {
  if (typeof str !== "string" || str.length < 5) return str;
  
  let result = str;
  
  if (str.length > 200) {
    result = str.substring(0, 200) + "...[truncated]";
  }
  
  for (const [name, pattern] of Object.entries(PII_PATTERNS)) {
    result = result.replace(pattern, `[${name.toUpperCase()}_REDACTED]`);
  }
  
  return result;
}

const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const currentLevel = LOG_LEVELS[LOG_LEVEL] || LOG_LEVELS.info;

function formatLogEntry(level, data, msg) {
  const timestamp = new Date().toISOString();
  const safeData = typeof data === "object" ? redactObject(data) : {};
  
  return {
    timestamp,
    level,
    ...safeData,
    msg: msg || "",
  };
}

function outputLog(level, entry) {
  if (IS_PRODUCTION) {
    const output = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    const { timestamp, level: lvl, msg, ...rest } = entry;
    const time = timestamp.split("T")[1].replace("Z", "");
    const prefix = `[${time}] ${lvl.toUpperCase().padEnd(5)}`;
    const dataStr = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    
    const formatted = `${prefix} ${msg}${dataStr}`;
    
    if (lvl === "error" || lvl === "fatal") {
      console.error(formatted);
    } else if (lvl === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }
}

function createLogFn(level) {
  return (dataOrMsg, msg) => {
    if (LOG_LEVELS[level] < currentLevel) return;
    
    let data = {};
    let message = "";
    
    if (typeof dataOrMsg === "string") {
      message = dataOrMsg;
    } else if (typeof dataOrMsg === "object") {
      data = dataOrMsg || {};
      message = msg || "";
    }
    
    const entry = formatLogEntry(level, data, message);
    outputLog(level, entry);
  };
}

export const logger = {
  trace: createLogFn("trace"),
  debug: createLogFn("debug"),
  info: createLogFn("info"),
  warn: createLogFn("warn"),
  error: createLogFn("error"),
  fatal: createLogFn("fatal"),
  
  child: (bindings) => {
    const childFn = (level) => (dataOrMsg, msg) => {
      if (LOG_LEVELS[level] < currentLevel) return;
      
      let data = { ...bindings };
      let message = "";
      
      if (typeof dataOrMsg === "string") {
        message = dataOrMsg;
      } else if (typeof dataOrMsg === "object") {
        data = { ...bindings, ...dataOrMsg };
        message = msg || "";
      }
      
      const entry = formatLogEntry(level, data, message);
      outputLog(level, entry);
    };
    
    return {
      trace: childFn("trace"),
      debug: childFn("debug"),
      info: childFn("info"),
      warn: childFn("warn"),
      error: childFn("error"),
      fatal: childFn("fatal"),
      child: (moreBindings) => logger.child({ ...bindings, ...moreBindings }),
    };
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// OTHER UTILS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sleep helper
 */
export function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Retry helper
 */
export async function retry(fn, { maxRetries = 3, delayMs = 1000, backoff = 2 } = {}) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < maxRetries - 1) {
        await sleep(delayMs * Math.pow(backoff, i));
      }
    }
  }
  throw lastError;
}

/**
 * Generate UUID v4
 */
export function uuid() {
  return crypto.randomUUID();
}

/**
 * Format date as ISO string in Mexico timezone
 */
export function nowMexicoISO() {
  return new Date().toLocaleString('en-CA', { 
    timeZone: 'America/Mexico_City',
    hour12: false 
  }).replace(', ', 'T') + '-06:00';
}

export default {
  logger,
  sleep,
  retry,
  uuid,
  nowMexicoISO,
};
