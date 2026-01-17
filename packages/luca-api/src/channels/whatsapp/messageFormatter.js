/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MESSAGE FORMATTER - Formateo de mensajes para WhatsApp
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Formatea diferentes tipos de contenido para que se vean bien en WhatsApp.
 * Incluye formateo de alertas, briefings, reportes, etc.
 * 
 * ZERO-HARDCODE: Nombres de sucursales vienen de lucaConfig
 */

import { logger } from "@tagers/shared";
import { getBranchName } from "../../config/lucaConfig.js";

/**
 * Emojis para diferentes contextos
 */
const EMOJIS = {
  // Severidades
  CRITICAL: "🚨",
  HIGH: "⚠️",
  MEDIUM: "📌",
  LOW: "ℹ️",
  
  // Tipos de contenido
  sales: "💰",
  alert: "🔔",
  case: "📁",
  action: "✅",
  fraud: "🔍",
  staff: "👥",
  weather: "🌤️",
  calendar: "📅",
  branch: "🏪",
  
  // Estados
  up: "📈",
  down: "📉",
  same: "➡️",
  good: "✅",
  bad: "❌",
  warning: "⚠️",
};

/**
 * Formatea un número como moneda mexicana
 */
export function formatCurrency(amount, showSign = false) {
  const formatted = new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.abs(amount));
  
  if (showSign && amount !== 0) {
    return amount > 0 ? `+${formatted}` : `-${formatted}`;
  }
  
  return formatted;
}

/**
 * Formatea un porcentaje
 */
export function formatPercent(value, showSign = true) {
  const formatted = Math.abs(value).toFixed(1) + "%";
  
  if (showSign && value !== 0) {
    return value > 0 ? `+${formatted}` : `-${formatted}`;
  }
  
  return formatted;
}

/**
 * Formatea una fecha para humanos
 */
export function formatDate(date, format = "short") {
  const d = new Date(date);
  
  if (format === "short") {
    return d.toLocaleDateString("es-MX", { day: "numeric", month: "short" });
  }
  if (format === "long") {
    return d.toLocaleDateString("es-MX", { 
      weekday: "long", 
      day: "numeric", 
      month: "long" 
    });
  }
  if (format === "time") {
    return d.toLocaleTimeString("es-MX", { 
      hour: "2-digit", 
      minute: "2-digit" 
    });
  }
  
  return d.toLocaleDateString("es-MX");
}

/**
 * Formatea una alerta para WhatsApp
 */
export async function formatAlert(alert) {
  const emoji = EMOJIS[alert.severity] || "🔔";
  const branchName = alert.branch_id ? await getBranchName(alert.branch_id) : null;
  
  let text = `${emoji} *${alert.title}*\n\n`;
  text += alert.message + "\n\n";
  
  if (branchName) {
    text += `🏪 ${branchName}\n`;
  }
  
  if (alert.metric_value != null && alert.baseline_value != null) {
    const direction = alert.metric_value > alert.baseline_value ? "up" : "down";
    text += `${EMOJIS[direction]} ${formatPercent(alert.deviation_pct)} vs normal\n`;
  }
  
  text += `\n_${formatDate(alert.created_at, "time")} • ${alert.alert_type}_`;
  
  return text;
}

/**
 * Formatea un caso para WhatsApp
 */
export async function formatCase(caso) {
  const emoji = EMOJIS[caso.severity] || "📁";
  const branchName = caso.scope?.branch_id ? await getBranchName(caso.scope.branch_id) : null;
  
  let text = `${emoji} *${caso.title}*\n\n`;
  
  if (caso.description) {
    text += caso.description + "\n\n";
  }
  
  text += `📋 Estado: ${getStateLabel(caso.state)}\n`;
  
  if (branchName) {
    text += `🏪 Sucursal: ${branchName}\n`;
  }
  
  if (caso.assigned_to) {
    text += `👤 Asignado: ${caso.assigned_to}\n`;
  }
  
  text += `\n_Caso: ${caso.case_id}_`;
  
  return text;
}

/**
 * Formatea una solicitud de aprobación
 */
export function formatApprovalRequest(action, caso) {
  let text = `📋 *Solicitud de Aprobación*\n\n`;
  text += `*${action.title}*\n\n`;
  text += action.description + "\n\n";
  
  if (caso) {
    text += `🔗 Caso: ${caso.title}\n`;
    text += `⚠️ Severidad: ${caso.severity}\n`;
  }
  
  if (action.expected_impact) {
    text += `\n💡 *Impacto esperado:* ${action.expected_impact.description}\n`;
  }
  
  text += `\n_Responde "aprobar" o "rechazar"_`;
  
  return text;
}

/**
 * Formatea un resumen de ventas
 */
export function formatSalesSummary(sales) {
  let text = `💰 *Ventas de Ayer*\n\n`;
  
  // Total
  const totalEmoji = sales.vs_goal >= 0 ? EMOJIS.up : EMOJIS.down;
  text += `Total: *${formatCurrency(sales.total)}*\n`;
  text += `${totalEmoji} ${formatPercent(sales.vs_goal)} vs meta\n\n`;
  
  // Por sucursal
  if (sales.by_branch?.length > 0) {
    text += `📊 *Por sucursal:*\n`;
    for (const branch of sales.by_branch) {
      const icon = branch.vs_goal >= 0 ? "✅" : "❌";
      text += `${icon} ${getBranchName(branch.branch_id)}: ${formatCurrency(branch.total)} (${formatPercent(branch.vs_goal)})\n`;
    }
  }
  
  return text;
}

/**
 * Formatea el briefing completo
 */
export function formatBriefing(briefing, recipientName) {
  let text = `☀️ *Buenos días, ${recipientName}*\n`;
  text += `📅 ${formatDate(new Date(), "long")}\n\n`;
  
  // Secciones
  for (const section of briefing.sections) {
    text += formatBriefingSection(section) + "\n";
  }
  
  // Cierre
  text += `\n_${briefing.closing || "¡Que tengas un excelente día!"}_\n`;
  text += `_— LUCA 🦑_`;
  
  return text;
}

/**
 * Formatea una sección del briefing
 */
function formatBriefingSection(section) {
  let text = "";
  
  switch (section.type) {
    case "sales_summary":
      text += `💰 *Ventas ayer:* ${formatCurrency(section.data.total)} (${formatPercent(section.data.vs_goal)} vs meta)\n`;
      break;
      
    case "top_performers":
      if (section.data.length > 0) {
        text += `🏆 *Top:* ${section.data.map(b => getBranchNameSync(b.branch_id)).join(", ")}\n`;
      }
      break;
      
    case "attention_needed":
      if (section.data.length > 0) {
        text += `⚠️ *Atención:* ${section.data.map(b => getBranchNameSync(b.branch_id)).join(", ")}\n`;
      }
      break;
      
    case "open_cases":
      if (section.data.count > 0) {
        text += `📁 *Casos abiertos:* ${section.data.count}`;
        if (section.data.critical > 0) {
          text += ` (${section.data.critical} críticos)`;
        }
        text += "\n";
      }
      break;
      
    case "pending_approvals":
      if (section.data.count > 0) {
        text += `✋ *Pendientes de aprobación:* ${section.data.count}\n`;
      }
      break;
      
    case "critical_alerts":
      if (section.data.length > 0) {
        text += `🚨 *Alertas críticas:* ${section.data.length}\n`;
        for (const alert of section.data.slice(0, 3)) {
          text += `  • ${alert.title}\n`;
        }
      }
      break;
      
    case "today_context":
      if (section.data.weather) {
        text += `🌤️ *Clima:* ${section.data.weather}\n`;
      }
      if (section.data.events?.length > 0) {
        text += `📅 *Eventos:* ${section.data.events.join(", ")}\n`;
      }
      break;
      
    default:
      if (section.text) {
        text += section.text + "\n";
      }
  }
  
  return text;
}

/**
 * Formatea el briefing de solo titulares
 */
export function formatHeadlines(briefing, recipientName) {
  let text = `☀️ Buenos días ${recipientName}\n\n`;
  
  // Ventas en una línea
  if (briefing.sales) {
    text += `📊 *Ayer:* ${formatCurrency(briefing.sales.total)} (${formatPercent(briefing.sales.vs_goal)})\n\n`;
  }
  
  // Alertas críticas
  if (briefing.criticalAlerts?.length > 0) {
    text += `🚨 ${briefing.criticalAlerts.length} alerta(s) crítica(s)\n`;
  }
  
  // Pendientes
  if (briefing.pendingApprovals > 0) {
    text += `✋ ${briefing.pendingApprovals} pendiente(s) de aprobación\n`;
  }
  
  text += `\n_LUCA 🦑_`;
  
  return text;
}

/**
 * Formatea texto para que se vea bien en WhatsApp
 * (máximo 4096 caracteres por mensaje)
 */
export function truncateForWhatsApp(text, maxLength = 4000) {
  if (text.length <= maxLength) return text;
  
  const truncated = text.substring(0, maxLength - 20);
  const lastNewline = truncated.lastIndexOf("\n");
  
  if (lastNewline > maxLength - 200) {
    return truncated.substring(0, lastNewline) + "\n\n_... (mensaje truncado)_";
  }
  
  return truncated + "\n\n_... (mensaje truncado)_";
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

// getBranchName viene de lucaConfig.js (async con cache)
// Para uso sync en templates, usar getBranchNameSync con fallback

let branchNamesCache = null;

/**
 * Versión sync de getBranchName (usa cache, fallback a ID)
 * Útil para formateo rápido donde no podemos usar async
 */
export function getBranchNameSync(branchId) {
  if (branchNamesCache && branchNamesCache[branchId]) {
    return branchNamesCache[branchId];
  }
  return branchId; // Fallback al ID si no hay cache
}

/**
 * Precarga cache de nombres de sucursales
 * Llamar al inicio o cuando se necesite formateo sync
 */
export async function preloadBranchNames() {
  const { getBranches } = await import("../../config/lucaConfig.js");
  const branches = await getBranches();
  branchNamesCache = {};
  for (const [id, config] of Object.entries(branches)) {
    branchNamesCache[id] = config.name;
  }
  return branchNamesCache;
}

function getStateLabel(state) {
  const labels = {
    OPEN: "Abierto",
    INVESTIGATING: "En investigación",
    DIAGNOSED: "Diagnosticado",
    RECOMMENDED: "Con recomendación",
    APPROVED: "Aprobado",
    EXECUTING: "Ejecutando",
    EXECUTED: "Ejecutado",
    CLOSED: "Cerrado",
    ARCHIVED: "Archivado",
    REJECTED: "Rechazado",
  };
  return labels[state] || state;
}

export default {
  formatAlert,
  formatCase,
  formatApprovalRequest,
  formatSalesSummary,
  formatBriefing,
  formatHeadlines,
  formatCurrency,
  formatPercent,
  formatDate,
  truncateForWhatsApp,
  getBranchNameSync,
  preloadBranchNames,
  EMOJIS,
};
