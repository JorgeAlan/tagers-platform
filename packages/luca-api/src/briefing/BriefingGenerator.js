/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRIEFING GENERATOR - Genera el Morning Briefing
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Genera briefings personalizados para cada socio basado en:
 * - Su rol y preferencias
 * - Datos de ventas
 * - Alertas y casos
 * - Contexto del día (clima, eventos)
 */

import { logger, query } from "@tagers/shared";
import { salesSection } from "./sections/salesSection.js";
import { alertsSection } from "./sections/alertsSection.js";
import { casesSection } from "./sections/casesSection.js";
import { contextSection } from "./sections/contextSection.js";
import { BriefingNarrator } from "./BriefingNarrator.js";

/**
 * Tipos de briefing disponibles
 */
export const BriefingTypes = {
  FULL: "FULL",           // Completo (para Jorge)
  HEADLINES: "HEADLINES", // Solo titulares (para Andrés)
  OPERATIONAL: "OPERATIONAL", // Operacional (para Tany)
};

/**
 * Secciones por tipo de briefing
 */
const BRIEFING_SECTIONS = {
  FULL: [
    "greeting",
    "sales_summary",
    "top_performers",
    "attention_needed",
    "open_cases",
    "pending_approvals",
    "today_context",
    "closing",
  ],
  HEADLINES: [
    "greeting",
    "one_liner_sales",
    "critical_alerts",
    "audit_items",
    "closing",
  ],
  OPERATIONAL: [
    "greeting",
    "sales_summary",
    "staffing_today",
    "attention_needed",
    "ops_alerts",
    "today_context",
    "closing",
  ],
};

export class BriefingGenerator {
  constructor() {
    this.narrator = new BriefingNarrator();
  }

  /**
   * Genera un briefing completo para un usuario
   */
  async generate(userId, briefingType = BriefingTypes.FULL, options = {}) {
    const date = options.date || new Date();
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);

    logger.info({ userId, briefingType }, "Generating briefing");

    try {
      // Obtener datos necesarios
      const data = await this.gatherData(userId, yesterday, options);

      // Seleccionar secciones según tipo
      const sectionNames = BRIEFING_SECTIONS[briefingType] || BRIEFING_SECTIONS.HEADLINES;

      // Generar cada sección
      const sections = [];
      for (const sectionName of sectionNames) {
        const section = await this.generateSection(sectionName, data, userId);
        if (section) {
          sections.push(section);
        }
      }

      // Construir briefing final
      const briefing = {
        userId,
        briefingType,
        generatedAt: new Date().toISOString(),
        date: yesterday.toISOString().split("T")[0],
        sections,
        closing: this.narrator.generateClosing(data),
        
        // Datos resumidos para uso en templates
        sales: data.sales?.total ? {
          total: data.sales.total.total,
          vs_goal: data.sales.total.vs_goal,
        } : null,
        criticalAlerts: data.alerts?.critical || [],
        pendingApprovals: data.approvals?.pending?.length || 0,
      };

      logger.info({
        userId,
        briefingType,
        sectionsCount: sections.length,
      }, "Briefing generated");

      return briefing;

    } catch (err) {
      logger.error({ userId, err: err?.message }, "Briefing generation failed");
      throw err;
    }
  }

  /**
   * Recolecta todos los datos necesarios para el briefing
   */
  async gatherData(userId, date, options = {}) {
    const data = {};

    // Datos de ventas
    try {
      data.sales = await salesSection.getData(date);
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get sales data");
      data.sales = null;
    }

    // Alertas
    try {
      data.alerts = await alertsSection.getData();
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get alerts data");
      data.alerts = null;
    }

    // Casos
    try {
      data.cases = await casesSection.getData(userId);
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get cases data");
      data.cases = null;
    }

    // Aprobaciones pendientes
    try {
      data.approvals = await this.getPendingApprovals(userId);
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get approvals data");
      data.approvals = null;
    }

    // Contexto del día
    try {
      data.context = await contextSection.getData(date);
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get context data");
      data.context = null;
    }

    // Metadata
    data.date = date;
    data.userId = userId;

    return data;
  }

  /**
   * Genera una sección específica
   */
  async generateSection(sectionName, data, userId) {
    switch (sectionName) {
      case "greeting":
        return {
          type: "greeting",
          text: this.narrator.generateGreeting(userId, data.date),
        };

      case "sales_summary":
        if (!data.sales?.total) return null;
        return {
          type: "sales_summary",
          data: data.sales.total,
          text: this.narrator.narrateSales(data.sales.total),
        };

      case "one_liner_sales":
        if (!data.sales?.total) return null;
        return {
          type: "one_liner_sales",
          data: data.sales.total,
          text: this.narrator.narrateSalesOneLine(data.sales.total),
        };

      case "top_performers":
        if (!data.sales?.byBranch) return null;
        const top = data.sales.byBranch
          .filter(b => b.vs_goal >= 0)
          .sort((a, b) => b.vs_goal - a.vs_goal)
          .slice(0, 3);
        if (top.length === 0) return null;
        return {
          type: "top_performers",
          data: top,
          text: this.narrator.narrateTopPerformers(top),
        };

      case "attention_needed":
        if (!data.sales?.byBranch) return null;
        const needAttention = data.sales.byBranch
          .filter(b => b.vs_goal < -10)
          .sort((a, b) => a.vs_goal - b.vs_goal)
          .slice(0, 3);
        if (needAttention.length === 0) return null;
        return {
          type: "attention_needed",
          data: needAttention,
          text: this.narrator.narrateAttentionNeeded(needAttention),
        };

      case "open_cases":
        if (!data.cases) return null;
        return {
          type: "open_cases",
          data: {
            count: data.cases.open?.length || 0,
            critical: data.cases.critical?.length || 0,
          },
          text: this.narrator.narrateOpenCases(data.cases),
        };

      case "pending_approvals":
        if (!data.approvals?.pending?.length) return null;
        return {
          type: "pending_approvals",
          data: {
            count: data.approvals.pending.length,
            items: data.approvals.pending.slice(0, 3),
          },
          text: this.narrator.narratePendingApprovals(data.approvals.pending),
        };

      case "critical_alerts":
        const critical = data.alerts?.critical || [];
        if (critical.length === 0) return null;
        return {
          type: "critical_alerts",
          data: critical,
          text: this.narrator.narrateCriticalAlerts(critical),
        };

      case "ops_alerts":
        const ops = data.alerts?.operational || [];
        if (ops.length === 0) return null;
        return {
          type: "ops_alerts",
          data: ops,
          text: this.narrator.narrateOpsAlerts(ops),
        };

      case "audit_items":
        const auditItems = data.cases?.audit || [];
        if (auditItems.length === 0) return null;
        return {
          type: "audit_items",
          data: auditItems,
          text: this.narrator.narrateAuditItems(auditItems),
        };

      case "staffing_today":
        // TODO: Integrar con datos de BUK
        return null;

      case "today_context":
        if (!data.context) return null;
        return {
          type: "today_context",
          data: data.context,
          text: this.narrator.narrateContext(data.context),
        };

      case "closing":
        return {
          type: "closing",
          text: this.narrator.generateClosing(data),
        };

      default:
        return null;
    }
  }

  /**
   * Obtiene aprobaciones pendientes para un usuario
   */
  async getPendingApprovals(userId) {
    try {
      const result = await query(`
        SELECT a.*, c.title as case_title, c.severity as case_severity
        FROM luca_actions a
        JOIN luca_cases c ON a.case_id = c.case_id
        WHERE a.state = 'PENDING'
          AND a.requires_approval = true
        ORDER BY 
          CASE c.severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          a.created_at ASC
        LIMIT 10
      `);

      return {
        pending: result.rows,
        count: result.rows.length,
      };
    } catch (err) {
      return { pending: [], count: 0 };
    }
  }

  /**
   * Genera un briefing de emergencia (no programado)
   */
  async generateEmergencyBriefing(alert, targetUsers) {
    return {
      type: "EMERGENCY",
      generatedAt: new Date().toISOString(),
      alert,
      message: this.narrator.narrateEmergency(alert),
      targetUsers,
    };
  }
}

// Export singleton
export const briefingGenerator = new BriefingGenerator();

export default BriefingGenerator;
