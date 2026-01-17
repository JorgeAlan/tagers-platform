/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACTION METRICS - Métricas de Éxito de Acciones
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Trackea el éxito de las acciones ejecutadas:
 * - Success Rate por tipo de acción
 * - Tiempo de ejecución
 * - Tasa de aprobación
 * - Impacto medido
 */

import { logger } from "@tagers/shared";

/**
 * Estados de acciones para métricas
 */
export const ActionOutcomes = {
  SUCCESS: "success",           // Acción exitosa
  PARTIAL_SUCCESS: "partial",   // Parcialmente exitoso
  FAILED: "failed",             // Falló
  REJECTED: "rejected",         // Rechazado por usuario
  EXPIRED: "expired",           // Expiró sin acción
  CANCELLED: "cancelled",       // Cancelado
};

/**
 * Store de métricas de acciones
 */
const actionMetricsStore = new Map();

export class ActionMetrics {
  constructor() {
    this.history = [];
  }

  /**
   * Registra el resultado de una acción
   */
  async recordActionOutcome(data) {
    const {
      actionId,
      actionType,
      outcome,
      executionTimeMs,
      impactValue,
      impactType,
      metadata,
    } = data;

    const record = {
      id: `AM-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      actionId,
      actionType,
      outcome,
      executionTimeMs,
      impactValue,
      impactType,
      metadata,
      timestamp: new Date().toISOString(),
    };

    this.history.push(record);
    actionMetricsStore.set(actionId, record);

    logger.info({ actionId, outcome }, "Action outcome recorded");

    return record;
  }

  /**
   * Calcula métricas por tipo de acción
   */
  async calculateMetricsByType(actionType, options = {}) {
    const { startDate, endDate } = options;
    
    let records = this.history.filter(r => r.actionType === actionType);

    // Filtrar por fecha si se especifica
    if (startDate) {
      records = records.filter(r => new Date(r.timestamp) >= new Date(startDate));
    }
    if (endDate) {
      records = records.filter(r => new Date(r.timestamp) <= new Date(endDate));
    }

    const total = records.length;
    if (total === 0) {
      return {
        actionType,
        total: 0,
        metrics: null,
      };
    }

    // Contar por outcome
    const byOutcome = {};
    for (const r of records) {
      byOutcome[r.outcome] = (byOutcome[r.outcome] || 0) + 1;
    }

    // Calcular métricas
    const successful = (byOutcome[ActionOutcomes.SUCCESS] || 0) + 
                       (byOutcome[ActionOutcomes.PARTIAL_SUCCESS] || 0) * 0.5;
    
    const successRate = successful / total;

    // Tiempo promedio de ejecución
    const withTime = records.filter(r => r.executionTimeMs);
    const avgExecutionTime = withTime.length > 0
      ? withTime.reduce((sum, r) => sum + r.executionTimeMs, 0) / withTime.length
      : null;

    // Impacto total
    const withImpact = records.filter(r => r.impactValue !== undefined);
    const totalImpact = withImpact.reduce((sum, r) => sum + (r.impactValue || 0), 0);
    const avgImpact = withImpact.length > 0 ? totalImpact / withImpact.length : null;

    return {
      actionType,
      total,
      byOutcome,
      metrics: {
        successRate: Math.round(successRate * 1000) / 1000,
        avgExecutionTimeMs: avgExecutionTime ? Math.round(avgExecutionTime) : null,
        totalImpactValue: totalImpact,
        avgImpactValue: avgImpact ? Math.round(avgImpact * 100) / 100 : null,
      },
    };
  }

  /**
   * Calcula métricas de aprobación
   */
  async calculateApprovalMetrics(options = {}) {
    const { startDate, endDate, groupBy = "type" } = options;

    // TODO: Obtener de ActionBus/DB
    // Mock data por ahora
    const approvalData = [
      { type: "DRAFT_PURCHASE_ORDER", proposed: 50, approved: 45, rejected: 3, expired: 2 },
      { type: "CONTACT_EVENTUAL_STAFF", proposed: 30, approved: 28, rejected: 1, expired: 1 },
      { type: "NOTIFY_SOCIO", proposed: 100, approved: 95, rejected: 2, expired: 3 },
    ];

    const results = approvalData.map(d => ({
      actionType: d.type,
      proposed: d.proposed,
      approved: d.approved,
      rejected: d.rejected,
      expired: d.expired,
      approvalRate: Math.round((d.approved / d.proposed) * 1000) / 1000,
      rejectionRate: Math.round((d.rejected / d.proposed) * 1000) / 1000,
    }));

    // Calcular totales
    const totals = {
      totalProposed: approvalData.reduce((sum, d) => sum + d.proposed, 0),
      totalApproved: approvalData.reduce((sum, d) => sum + d.approved, 0),
      totalRejected: approvalData.reduce((sum, d) => sum + d.rejected, 0),
    };

    totals.overallApprovalRate = Math.round(
      (totals.totalApproved / totals.totalProposed) * 1000
    ) / 1000;

    return {
      byType: results,
      totals,
      period: { startDate, endDate },
    };
  }

  /**
   * Calcula tiempo promedio de respuesta a acciones pendientes
   */
  async calculateResponseTime(options = {}) {
    const { actionType, autonomyLevel } = options;

    // TODO: Calcular desde datos reales
    // Mock por ahora
    const responseData = {
      AUTO: { avgMinutes: 0, count: 50 },
      DRAFT: { avgMinutes: 30, count: 80 },
      APPROVAL: { avgMinutes: 120, count: 40 },
      CRITICAL: { avgMinutes: 240, count: 10 },
    };

    return responseData;
  }

  /**
   * Obtiene resumen de acciones por período
   */
  async getActionSummary(options = {}) {
    const { period = "weekly" } = options;

    // Calcular fecha de inicio
    const startDate = new Date();
    switch (period) {
      case "daily":
        startDate.setDate(startDate.getDate() - 1);
        break;
      case "weekly":
        startDate.setDate(startDate.getDate() - 7);
        break;
      case "monthly":
        startDate.setMonth(startDate.getMonth() - 1);
        break;
    }

    const records = this.history.filter(
      r => new Date(r.timestamp) >= startDate
    );

    // Agrupar por tipo
    const byType = {};
    for (const r of records) {
      if (!byType[r.actionType]) {
        byType[r.actionType] = { total: 0, success: 0, failed: 0 };
      }
      byType[r.actionType].total++;
      if (r.outcome === ActionOutcomes.SUCCESS) {
        byType[r.actionType].success++;
      } else if (r.outcome === ActionOutcomes.FAILED) {
        byType[r.actionType].failed++;
      }
    }

    // Calcular success rates
    for (const type of Object.keys(byType)) {
      byType[type].successRate = byType[type].total > 0
        ? Math.round((byType[type].success / byType[type].total) * 100)
        : 0;
    }

    return {
      period,
      startDate: startDate.toISOString(),
      endDate: new Date().toISOString(),
      totalActions: records.length,
      byType,
      overallSuccessRate: records.length > 0
        ? Math.round(
            (records.filter(r => r.outcome === ActionOutcomes.SUCCESS).length / records.length) * 100
          )
        : 0,
    };
  }

  /**
   * Obtiene top acciones por impacto
   */
  async getTopActionsByImpact(limit = 10) {
    return this.history
      .filter(r => r.impactValue && r.impactValue > 0)
      .sort((a, b) => b.impactValue - a.impactValue)
      .slice(0, limit)
      .map(r => ({
        actionId: r.actionId,
        actionType: r.actionType,
        impactValue: r.impactValue,
        impactType: r.impactType,
        timestamp: r.timestamp,
      }));
  }

  /**
   * Genera reporte de acciones
   */
  async generateReport(options = {}) {
    const { period = "weekly" } = options;

    const summary = await this.getActionSummary({ period });
    const approvalMetrics = await this.calculateApprovalMetrics();
    const responseTime = await this.calculateResponseTime();
    const topByImpact = await this.getTopActionsByImpact(5);

    return {
      period,
      generatedAt: new Date().toISOString(),
      summary,
      approvalMetrics,
      responseTime,
      topByImpact,
    };
  }
}

export const actionMetrics = new ActionMetrics();

export default ActionMetrics;
