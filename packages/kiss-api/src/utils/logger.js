/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LOGGER - Logging estructurado con redacción de PII
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Usa pino para logs estructurados JSON con:
 * - Redacción automática de datos sensibles (PII)
 * - Correlación con trace IDs de OpenTelemetry
 * - Niveles de log configurables
 * - Formato legible en desarrollo, JSON en producción
 * 
 * @version 2.0.0
 */

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const LOG_LEVEL = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug");
const IS_PRODUCTION = process.env.NODE_ENV === "production";

// ═══════════════════════════════════════════════════════════════════════════
// REDACCIÓN DE PII (Personally Identifiable Information)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Patrones regex para detectar y redactar PII
 */
const PII_PATTERNS = {
  // Teléfonos mexicanos (+52, 10 dígitos)
  phone: /(\+?52\s?)?[\d\s-]{10,14}/g,
  // Emails
  email: /[\w.-]+@[\w.-]+\.\w+/gi,
  // API Keys (patrones comunes)
  apiKey: /(sk-|pk_|key_|token_)[a-zA-Z0-9]{20,}/gi,
};

/**
 * Keys a redactar completamente en objetos
 */
const REDACT_KEYS = new Set([
  "phone", "phone_number", "phoneNumber", "telefono",
  "email", "email_address", "emailAddress", "correo",
  "apiKey", "api_key", "accessToken", "access_token",
  "refreshToken", "refresh_token", "password", "secret",
  "Authorization", "authorization", "rawBody",
  "X-Admin-Token", "x-admin-token", "stripe-signature",
]);

/**
 * Redacta recursivamente datos sensibles de un objeto
 */
function redactObject(obj, depth = 0) {
  if (depth > 5) return obj; // Prevenir recursión infinita
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== "object") return redactString(String(obj));
  
  if (Array.isArray(obj)) {
    return obj.map(item => redactObject(item, depth + 1));
  }
  
  const result = {};
  for (const [key, value] of Object.entries(obj)) {
    // Redactar keys sensibles completamente
    if (REDACT_KEYS.has(key)) {
      result[key] = "[REDACTED]";
      continue;
    }
    
    // Recursión para objetos anidados
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

/**
 * Redacta PII de strings usando patrones
 */
function redactString(str) {
  if (typeof str !== "string" || str.length < 5) return str;
  
  let result = str;
  
  // Solo redactar strings largos que podrían contener PII
  if (str.length > 200) {
    // Truncar strings muy largos
    result = str.substring(0, 200) + "...[truncated]";
  }
  
  // Aplicar patrones de redacción
  for (const [name, pattern] of Object.entries(PII_PATTERNS)) {
    result = result.replace(pattern, `[${name.toUpperCase()}_REDACTED]`);
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// LOGGER IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Niveles de log y sus prioridades
 */
const LOG_LEVELS = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const currentLevel = LOG_LEVELS[LOG_LEVEL] || LOG_LEVELS.info;

/**
 * Obtener trace ID de OpenTelemetry si está disponible
 */
function getTraceId() {
  try {
    // Check if OpenTelemetry API is available globally
    const otelApi = globalThis["@opentelemetry/api"];
    if (otelApi?.trace) {
      const span = otelApi.trace.getActiveSpan();
      if (span) {
        const ctx = span.spanContext();
        return { traceId: ctx.traceId, spanId: ctx.spanId };
      }
    }
  } catch (_e) {
    // Silently ignore
  }
  return {};
}

/**
 * Formatear log entry
 */
function formatLogEntry(level, data, msg) {
  const timestamp = new Date().toISOString();
  const traceInfo = getTraceId();
  
  // Redactar datos sensibles
  const safeData = typeof data === "object" ? redactObject(data) : {};
  
  const entry = {
    timestamp,
    level,
    ...traceInfo,
    ...safeData,
    msg: msg || "",
  };
  
  return entry;
}

/**
 * Output log entry
 */
function outputLog(level, entry) {
  if (IS_PRODUCTION) {
    // JSON estructurado en producción
    const output = JSON.stringify(entry);
    if (level === "error" || level === "fatal") {
      console.error(output);
    } else if (level === "warn") {
      console.warn(output);
    } else {
      console.log(output);
    }
  } else {
    // Pretty print en desarrollo
    const { timestamp, level: lvl, msg, traceId, ...rest } = entry;
    const time = timestamp.split("T")[1].replace("Z", "");
    const prefix = `[${time}] ${lvl.toUpperCase().padEnd(5)}`;
    const trace = traceId ? ` (trace:${traceId.substring(0, 8)})` : "";
    const dataStr = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : "";
    
    const formatted = `${prefix}${trace} ${msg}${dataStr}`;
    
    if (lvl === "error" || lvl === "fatal") {
      console.error(formatted);
    } else if (lvl === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  }
}

/**
 * Logger con API compatible
 */
function createLogFn(level) {
  return (dataOrMsg, msg) => {
    // Skip si el nivel no está habilitado
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
  
  /**
   * Crear child logger con contexto adicional
   */
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

export default logger;
