/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRIEFING NARRATOR - Escribe en el Estilo de LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * LUCA tiene una personalidad específica:
 * - Profesional pero cercano
 * - Directo y conciso
 * - Usa ocasionalmente emojis
 * - Menciona datos concretos
 * - No es excesivamente formal ni informal
 * 
 * ZERO-HARDCODE: Nombres de sucursales y usuarios vienen de lucaConfig
 */

import { logger } from "@tagers/shared";
import { getBranchName, getUser } from "../config/lucaConfig.js";

// Cache para nombres (se llena al inicio)
let branchNamesCache = {};
let userNamesCache = {};

/**
 * Precarga nombres para uso sync en templates
 */
export async function preloadNames() {
  const { getBranches, getUsers } = await import("../config/lucaConfig.js");
  
  const branches = await getBranches();
  for (const [id, config] of Object.entries(branches)) {
    branchNamesCache[id] = config.name;
  }
  
  const users = await getUsers();
  for (const [id, config] of Object.entries(users)) {
    userNamesCache[id] = config.name;
  }
}

/**
 * Obtiene nombre de sucursal (sync con cache)
 */
function getBranchNameSync(branchId) {
  return branchNamesCache[branchId] || branchId;
}

/**
 * Obtiene nombre de usuario (sync con cache)
 */
function getUserNameSync(userId) {
  return userNamesCache[userId] || userId;
}

export class BriefingNarrator {
  constructor() {
    this.greetings = [
      "Buenos días",
      "¡Buenos días",
      "Buen día",
    ];
    
    this.closings = [
      "¡Que tengas un excelente día!",
      "¡Éxito hoy!",
      "¡A darle!",
      "Aquí estaré si necesitas algo.",
    ];
  }

  /**
   * Genera saludo personalizado
   */
  generateGreeting(userId, date) {
    const name = getUserNameSync(userId);
    const dayOfWeek = new Date(date).getDay();
    
    // Lunes especial
    if (dayOfWeek === 1) {
      return `¡Buenos días ${name}! Arrancamos la semana.`;
    }
    
    // Viernes especial
    if (dayOfWeek === 5) {
      return `¡Buenos días ${name}! Último día de la semana.`;
    }
    
    const greeting = this.greetings[Math.floor(Math.random() * this.greetings.length)];
    return `${greeting} ${name}!`;
  }

  /**
   * Narra resumen de ventas
   */
  narrateSales(sales) {
    const { total, vs_goal, vs_last_week } = sales;
    const totalFormatted = this.formatCurrency(total);
    
    let text = `💰 *Ventas de ayer:* ${totalFormatted}`;
    
    // Agregar comparación vs meta
    if (vs_goal != null) {
      const emoji = vs_goal >= 0 ? "📈" : "📉";
      const sign = vs_goal >= 0 ? "+" : "";
      text += `\n${emoji} ${sign}${vs_goal.toFixed(1)}% vs meta`;
    }
    
    // Agregar comparación vs semana pasada
    if (vs_last_week != null) {
      const weekEmoji = vs_last_week >= 0 ? "↗️" : "↘️";
      const sign = vs_last_week >= 0 ? "+" : "";
      text += ` (${sign}${vs_last_week.toFixed(1)}% vs semana pasada)`;
    }
    
    return text;
  }

  /**
   * Narra ventas en una línea (para HEADLINES)
   */
  narrateSalesOneLine(sales) {
    const { total, vs_goal } = sales;
    const totalFormatted = this.formatCurrency(total);
    const sign = vs_goal >= 0 ? "+" : "";
    return `${totalFormatted} (${sign}${vs_goal?.toFixed(1) || 0}%)`;
  }

  /**
   * Narra top performers
   */
  narrateTopPerformers(branches) {
    if (branches.length === 0) return null;
    
    let text = `🏆 *Las mejores ayer:*\n`;
    
    for (const branch of branches) {
      const name = getBranchNameSync(branch.branch_id);
      const sign = branch.vs_goal >= 0 ? "+" : "";
      text += `  • ${name}: ${sign}${branch.vs_goal.toFixed(1)}%\n`;
    }
    
    return text.trim();
  }

  /**
   * Narra sucursales que necesitan atención
   */
  narrateAttentionNeeded(branches) {
    if (branches.length === 0) return null;
    
    let text = `⚠️ *Necesitan atención:*\n`;
    
    for (const branch of branches) {
      const name = getBranchNameSync(branch.branch_id);
      text += `  • ${name}: ${branch.vs_goal.toFixed(1)}%\n`;
    }
    
    return text.trim();
  }

  /**
   * Narra casos abiertos
   */
  narrateOpenCases(cases) {
    const { open, critical } = cases;
    const openCount = open?.length || 0;
    const criticalCount = critical?.length || 0;
    
    if (openCount === 0) {
      return "📁 Sin casos abiertos. ¡Todo en orden!";
    }
    
    let text = `📁 *${openCount} caso(s) abierto(s)*`;
    
    if (criticalCount > 0) {
      text += ` (${criticalCount} crítico(s))`;
    }
    
    // Mencionar el más importante
    if (critical?.length > 0) {
      const topCase = critical[0];
      text += `\n  🚨 ${topCase.title}`;
    }
    
    return text;
  }

  /**
   * Narra aprobaciones pendientes
   */
  narratePendingApprovals(approvals) {
    if (approvals.length === 0) return null;
    
    let text = `✋ *${approvals.length} aprobación(es) pendiente(s):*\n`;
    
    for (const approval of approvals.slice(0, 3)) {
      text += `  • ${approval.title}\n`;
    }
    
    if (approvals.length > 3) {
      text += `  _...y ${approvals.length - 3} más_`;
    }
    
    return text.trim();
  }

  /**
   * Narra alertas críticas
   */
  narrateCriticalAlerts(alerts) {
    if (alerts.length === 0) return null;
    
    let text = `🚨 *${alerts.length} alerta(s) crítica(s):*\n`;
    
    for (const alert of alerts.slice(0, 3)) {
      const branch = getBranchNameSync(alert.branch_id);
      text += `  • ${alert.title}`;
      if (branch) text += ` (${branch})`;
      text += "\n";
    }
    
    return text.trim();
  }

  /**
   * Narra alertas operativas
   */
  narrateOpsAlerts(alerts) {
    if (alerts.length === 0) return null;
    
    let text = `🔔 *Alertas operativas:*\n`;
    
    for (const alert of alerts.slice(0, 5)) {
      const emoji = alert.severity === "HIGH" ? "⚠️" : "ℹ️";
      text += `  ${emoji} ${alert.title}\n`;
    }
    
    return text.trim();
  }

  /**
   * Narra items de auditoría (para Andrés)
   */
  narrateAuditItems(items) {
    if (items.length === 0) return null;
    
    let text = `📋 *Pendientes de auditoría:*\n`;
    
    for (const item of items.slice(0, 5)) {
      text += `  • ${item.title}\n`;
    }
    
    return text.trim();
  }

  /**
   * Narra contexto del día
   */
  narrateContext(context) {
    const parts = [];
    
    if (context.weather) {
      parts.push(`🌤️ ${context.weather}`);
    }
    
    if (context.events?.length > 0) {
      parts.push(`📅 ${context.events.join(", ")}`);
    }
    
    if (context.notes?.length > 0) {
      for (const note of context.notes) {
        parts.push(`💡 ${note}`);
      }
    }
    
    return parts.length > 0 ? parts.join("\n") : null;
  }

  /**
   * Genera cierre del briefing
   */
  generateClosing(data) {
    // Personalizar cierre según situación
    const criticalCount = data.alerts?.critical?.length || 0;
    const pendingCount = data.approvals?.pending?.length || 0;
    
    if (criticalCount > 0) {
      return "Hay alertas que requieren tu atención. Aquí estaré.";
    }
    
    if (pendingCount > 0) {
      return `Tienes ${pendingCount} pendiente(s) de aprobar. ¡Éxito hoy!`;
    }
    
    // Cierre aleatorio
    return this.closings[Math.floor(Math.random() * this.closings.length)];
  }

  /**
   * Narra alerta de emergencia
   */
  narrateEmergency(alert) {
    const branch = getBranchNameSync(alert.branch_id);
    
    let text = `🚨 *ALERTA URGENTE*\n\n`;
    text += `*${alert.title}*\n\n`;
    text += alert.message + "\n\n";
    
    if (branch) {
      text += `📍 ${branch}\n`;
    }
    
    text += `\n_${new Date().toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" })}_`;
    
    return text;
  }

  /**
   * Formatea moneda
   */
  formatCurrency(amount) {
    return new Intl.NumberFormat("es-MX", {
      style: "currency",
      currency: "MXN",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  }
}

export default BriefingNarrator;
