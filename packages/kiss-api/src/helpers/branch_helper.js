/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRANCH HELPER - Sucursales con nombres bonitos desde Config Hub
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { getConfig } from "../config-hub/sync-service.js";
import { listBranches } from "../hitl/branch_registry.js";
import { logger } from "../utils/logger.js";

// Mapeo de branch_id a nombres bonitos (fallback)
const BRANCH_DISPLAY_NAMES = {
  "SAN_ANGEL": "San Ángel (CDMX)",
  "ANGELOPOLIS": "Angelópolis (Puebla)",
  "SONATA": "Sonata (Puebla)", 
  "ZAVALETA": "Zavaleta (Puebla)",
  "5_SUR": "5 Sur (Puebla)",
  "HQ": "Oficinas Centrales"
};

/**
 * Obtiene sucursales con nombres bonitos
 * Prioridad: Config Hub > branch_registry > hardcoded
 */
export function getFormattedBranches({ includeHQ = false } = {}) {
  let branches = [];
  let source = "none";
  
  // 1. Intentar Config Hub
  try {
    const hubConfig = getConfig();
    if (hubConfig?.branches?.length > 0) {
      branches = hubConfig.branches
        .filter(b => b.enabled && (includeHQ || b.branch_id !== "HQ"))
        .map(b => ({
          branch_id: b.branch_id,
          nombre: b.name || b.short_name || BRANCH_DISPLAY_NAMES[b.branch_id] || b.branch_id,
          slug: b.branch_id.toLowerCase().replace("_", "-"),
          city: b.city || "",
          address: b.address || ""
        }));
      source = "config_hub";
    }
  } catch (e) {
    logger.warn({ err: e.message }, "Failed to get branches from Config Hub");
  }
  
  // 2. Fallback a branch_registry
  if (branches.length === 0) {
    try {
      const registryBranches = listBranches();
      branches = registryBranches
        .filter(b => includeHQ || b.branch_id !== "HQ")
        .map(b => ({
          branch_id: b.branch_id,
          nombre: b.name || BRANCH_DISPLAY_NAMES[b.branch_id] || b.branch_id,
          slug: b.branch_id.toLowerCase().replace("_", "-"),
          city: b.city || "",
          address: ""
        }));
      source = "branch_registry";
    } catch (e) {
      logger.warn({ err: e.message }, "Failed to get branches from registry");
    }
  }
  
  // 3. Fallback hardcodeado
  if (branches.length === 0) {
    branches = Object.entries(BRANCH_DISPLAY_NAMES)
      .filter(([id]) => includeHQ || id !== "HQ")
      .map(([id, name]) => ({
        branch_id: id,
        nombre: name,
        slug: id.toLowerCase().replace("_", "-"),
        city: name.includes("CDMX") ? "CDMX" : "Puebla",
        address: ""
      }));
    source = "hardcoded";
  }
  
  logger.debug({ source, count: branches.length }, "Branches loaded");
  
  return { branches, source };
}

/**
 * Genera lista numerada de sucursales
 */
export function formatBranchList(branches = null) {
  // Si no se pasan branches, obtenerlos del Config Hub
  if (!branches?.length) {
    const { branches: hubBranches } = getFormattedBranches();
    branches = hubBranches;
  }
  
  // Si aún no hay branches (error de Config Hub), retornar mensaje genérico
  if (!branches?.length) {
    return "Consulta nuestras sucursales en tagers.com";
  }
  
  return branches
    .map((b, i) => `${i + 1}. ${b.nombre}`)
    .join("\n");
}

/**
 * Genera mensaje de pregunta de sucursal
 */
export function getBranchQuestionMessage() {
  const { branches } = getFormattedBranches();
  const list = formatBranchList(branches);
  
  return `¿En qué sucursal te gustaría recoger?\n\n${list}\n\nResponde con el número o el nombre de la sucursal.`;
}

/**
 * Genera mensaje de error cuando no se identifica sucursal
 */
export function getBranchErrorMessage() {
  const { branches } = getFormattedBranches();
  const list = formatBranchList(branches);
  
  return `No identifiqué la sucursal. Estas son nuestras opciones:\n\n${list}\n\n¿Cuál prefieres?`;
}

/**
 * Busca sucursal por número o texto
 */
export function findBranchByInput(input, availableBranches = null) {
  const { branches } = availableBranches 
    ? { branches: availableBranches }
    : getFormattedBranches();
  
  const text = String(input || "").trim().toLowerCase();
  
  // 1. Por número
  const num = parseInt(text, 10);
  if (!isNaN(num) && num >= 1 && num <= branches.length) {
    return branches[num - 1];
  }
  
  // 2. Por nombre parcial
  const found = branches.find(b => {
    const nombre = (b.nombre || "").toLowerCase();
    const branchId = (b.branch_id || "").toLowerCase();
    const slug = (b.slug || "").toLowerCase();
    
    return nombre.includes(text) || 
           text.includes(nombre.split(" ")[0]) ||
           branchId.includes(text.replace(/\s+/g, "_")) ||
           slug.includes(text.replace(/\s+/g, "-")) ||
           text.includes("angel") && branchId.includes("angel") ||
           text.includes("sonata") && branchId.includes("sonata") ||
           text.includes("zavaleta") && branchId.includes("zavaleta") ||
           text.includes("5 sur") && branchId.includes("5_sur") ||
           text.includes("cinco") && branchId.includes("5_sur");
  });
  
  return found || null;
}

export default {
  getFormattedBranches,
  formatBranchList,
  getBranchQuestionMessage,
  getBranchErrorMessage,
  findBranchByInput,
  BRANCH_DISPLAY_NAMES
};
