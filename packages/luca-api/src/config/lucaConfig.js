/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA CONFIG - Configuración Dinámica desde Google Sheets
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO-HARDCODE: Toda la configuración viene de Google Sheets.
 * Este archivo solo define los defaults y la estructura.
 * En runtime, se sobrescribe con datos de Sheets.
 * 
 * Google Sheets esperados:
 * - LUCA_CONFIG_BRANCHES: Configuración de sucursales
 * - LUCA_CONFIG_USERS: Configuración de usuarios/socios
 * - LUCA_CONFIG_NOTIFICATIONS: Preferencias de notificación
 */

import { logger } from "@tagers/shared";

// ═══════════════════════════════════════════════════════════════════════════
// CACHE DE CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

let configCache = {
  branches: null,
  users: null,
  lastFetch: null,
};

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutos

// ═══════════════════════════════════════════════════════════════════════════
// SUCURSALES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene configuración de sucursales
 * En producción: fetch desde Google Sheets
 */
export async function getBranches() {
  // Verificar cache
  if (configCache.branches && !isCacheStale()) {
    return configCache.branches;
  }

  try {
    // TODO: Fetch desde Google Sheets
    // const sheetsUrl = process.env.LUCA_CONFIG_BRANCHES_URL;
    // const response = await fetch(sheetsUrl);
    // const data = await response.json();
    // configCache.branches = parseBranchesFromSheets(data);
    
    // Por ahora, usar env var o defaults
    const branchesJson = process.env.LUCA_BRANCHES_CONFIG;
    if (branchesJson) {
      configCache.branches = JSON.parse(branchesJson);
    } else {
      // Default que se sobrescribirá con Sheets
      configCache.branches = getDefaultBranches();
    }
    
    configCache.lastFetch = Date.now();
    return configCache.branches;
    
  } catch (err) {
    logger.warn({ err: err?.message }, "Failed to fetch branches config, using defaults");
    return getDefaultBranches();
  }
}

/**
 * Obtiene nombre de sucursal por ID
 */
export async function getBranchName(branchId) {
  const branches = await getBranches();
  return branches[branchId]?.name || branchId;
}

/**
 * Obtiene todas las sucursales como array
 */
export async function getBranchList() {
  const branches = await getBranches();
  return Object.entries(branches).map(([id, config]) => ({
    id,
    ...config,
  }));
}

/**
 * Defaults - SE SOBRESCRIBEN CON GOOGLE SHEETS
 */
function getDefaultBranches() {
  return {
    SUC01: { name: "San Ángel", daily_goal: 80000, timezone: "America/Mexico_City" },
    SUC02: { name: "Coyoacán", daily_goal: 70000, timezone: "America/Mexico_City" },
    SUC03: { name: "Condesa", daily_goal: 90000, timezone: "America/Mexico_City" },
    SUC04: { name: "Polanco", daily_goal: 100000, timezone: "America/Mexico_City" },
    SUC05: { name: "Roma", daily_goal: 60000, timezone: "America/Mexico_City" },
    SUC06: { name: "Juárez", daily_goal: 50000, timezone: "America/Mexico_City" },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// USUARIOS / SOCIOS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene configuración de usuarios
 * En producción: fetch desde Google Sheets
 */
export async function getUsers() {
  // Verificar cache
  if (configCache.users && !isCacheStale()) {
    return configCache.users;
  }

  try {
    // TODO: Fetch desde Google Sheets
    // const sheetsUrl = process.env.LUCA_CONFIG_USERS_URL;
    
    // Por ahora, usar env var o defaults
    const usersJson = process.env.LUCA_USERS_CONFIG;
    if (usersJson) {
      configCache.users = JSON.parse(usersJson);
    } else {
      configCache.users = getDefaultUsers();
    }
    
    configCache.lastFetch = Date.now();
    return configCache.users;
    
  } catch (err) {
    logger.warn({ err: err?.message }, "Failed to fetch users config, using defaults");
    return getDefaultUsers();
  }
}

/**
 * Obtiene un usuario específico
 */
export async function getUser(userId) {
  const users = await getUsers();
  return users[userId] || null;
}

/**
 * Obtiene usuarios por rol
 */
export async function getUsersByRole(role) {
  const users = await getUsers();
  return Object.entries(users)
    .filter(([_, user]) => user.role === role)
    .map(([id, user]) => ({ id, ...user }));
}

/**
 * Defaults - SE SOBRESCRIBEN CON GOOGLE SHEETS
 * NOTA: Los 3 socios son dueños, todos reciben FULL briefing
 */
function getDefaultUsers() {
  return {
    jorge: {
      name: "Jorge",
      phone: process.env.JORGE_PHONE || "",
      email: "jorge@tagers.mx",
      role: "owner",
      channels: ["whatsapp", "push"],
      briefing_type: "FULL",
      severity_threshold: "LOW",
      quiet_hours: { enabled: true, start: 22, end: 7 },
      critical_override: true,
    },
    andres: {
      name: "Andrés",
      phone: process.env.ANDRES_PHONE || "",
      email: "andres@tagers.mx",
      role: "owner",
      channels: ["whatsapp", "push"],
      briefing_type: "FULL",
      severity_threshold: "LOW",
      quiet_hours: { enabled: true, start: 22, end: 7 },
      critical_override: true,
    },
    tany: {
      name: "Tany",
      phone: process.env.TANY_PHONE || "",
      email: "tany@tagers.mx",
      role: "owner",
      channels: ["whatsapp", "push"],
      briefing_type: "FULL",
      severity_threshold: "LOW",
      quiet_hours: { enabled: true, start: 22, end: 7 },
      critical_override: true,
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// METAS DE VENTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene meta diaria de una sucursal
 */
export async function getDailyGoal(branchId) {
  const branches = await getBranches();
  return branches[branchId]?.daily_goal || 70000;
}

/**
 * Obtiene todas las metas
 */
export async function getAllDailyGoals() {
  const branches = await getBranches();
  const goals = {};
  for (const [id, config] of Object.entries(branches)) {
    goals[id] = config.daily_goal;
  }
  return goals;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function isCacheStale() {
  if (!configCache.lastFetch) return true;
  return (Date.now() - configCache.lastFetch) > CACHE_TTL_MS;
}

/**
 * Fuerza recarga de configuración
 */
export function invalidateConfigCache() {
  configCache = {
    branches: null,
    users: null,
    lastFetch: null,
  };
  logger.info("Config cache invalidated");
}

/**
 * Parsea configuración de sucursales desde Google Sheets
 * Espera formato: [{ branch_id, name, daily_goal, timezone }, ...]
 */
export function parseBranchesFromSheets(rows) {
  const branches = {};
  for (const row of rows) {
    if (row.branch_id) {
      branches[row.branch_id] = {
        name: row.name || row.branch_id,
        daily_goal: parseInt(row.daily_goal) || 70000,
        timezone: row.timezone || "America/Mexico_City",
      };
    }
  }
  return branches;
}

/**
 * Parsea configuración de usuarios desde Google Sheets
 * Espera formato: [{ user_id, name, phone, email, role, channels, ... }, ...]
 */
export function parseUsersFromSheets(rows) {
  const users = {};
  for (const row of rows) {
    if (row.user_id) {
      users[row.user_id] = {
        name: row.name || row.user_id,
        phone: row.phone || "",
        email: row.email || "",
        role: row.role || "owner",
        channels: row.channels ? row.channels.split(",").map(c => c.trim()) : ["whatsapp"],
        briefing_type: row.briefing_type || "FULL",
        severity_threshold: row.severity_threshold || "LOW",
        quiet_hours: {
          enabled: row.quiet_hours_enabled !== "false",
          start: parseInt(row.quiet_hours_start) || 22,
          end: parseInt(row.quiet_hours_end) || 7,
        },
        critical_override: row.critical_override !== "false",
        topics: row.topics ? row.topics.split(",").map(t => t.trim()) : null,
      };
    }
  }
  return users;
}

export default {
  getBranches,
  getBranchName,
  getBranchList,
  getUsers,
  getUser,
  getUsersByRole,
  getDailyGoal,
  getAllDailyGoals,
  invalidateConfigCache,
  parseBranchesFromSheets,
  parseUsersFromSheets,
};
