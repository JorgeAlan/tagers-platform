/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA CONFIG - Configuración específica de LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Extiende la configuración base de @tagers/shared con valores
 * específicos para LUCA.
 * 
 * @version 0.1.0
 */

import { baseConfig, parseBool, parseIntSafe } from "@tagers/shared";

export const config = {
  ...baseConfig,
  
  // LUCA specific
  port: parseIntSafe(process.env.LUCA_PORT || process.env.PORT, 3001),
  
  // CORS
  allowedOrigins: (process.env.LUCA_ALLOWED_ORIGINS || process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean),
  
  // Morning Briefing
  briefing: {
    enabled: parseBool(process.env.LUCA_BRIEFING_ENABLED, true),
    cronSchedule: process.env.LUCA_BRIEFING_CRON || "0 8 * * *", // 8:00 AM
    timezone: process.env.LUCA_TIMEZONE || "America/Mexico_City",
  },
  
  // Detectors
  detectors: {
    enabled: parseBool(process.env.LUCA_DETECTORS_ENABLED, true),
    fraudScanCron: process.env.LUCA_FRAUD_SCAN_CRON || "0 */4 * * *", // Every 4 hours
    salesSyncCron: process.env.LUCA_SALES_SYNC_CRON || "*/15 * * * *", // Every 15 min
  },
  
  // Redshift (Data Warehouse)
  redshift: {
    enabled: parseBool(process.env.REDSHIFT_ENABLED, false),
    host: process.env.REDSHIFT_HOST || "",
    port: parseIntSafe(process.env.REDSHIFT_PORT, 5439),
    database: process.env.REDSHIFT_DATABASE || "",
    user: process.env.REDSHIFT_USER || "",
    password: process.env.REDSHIFT_PASSWORD || "",
  },
  
  // Control Tower
  tower: {
    enabled: parseBool(process.env.LUCA_TOWER_ENABLED, true),
    jwtSecret: process.env.LUCA_JWT_SECRET || "luca-tower-secret-change-me",
    sessionTtlHours: parseIntSafe(process.env.LUCA_SESSION_TTL_HOURS, 24),
  },
  
  // Notifications
  notifications: {
    // Jorge's WhatsApp for briefings
    jorgeWhatsapp: process.env.LUCA_JORGE_WHATSAPP || "",
    // Group WhatsApp for critical alerts
    groupWhatsapp: process.env.LUCA_GROUP_WHATSAPP || "",
  },
};

export default config;
