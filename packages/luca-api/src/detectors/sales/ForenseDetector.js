/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FORENSE DETECTOR - Detecta Días Malos que Requieren Autopsia
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta automáticamente días con caídas significativas de ventas:
 * - Comparación vs mismo día semana anterior
 * - Comparación vs baseline (promedio móvil)
 * - Comparación vs meta
 * - Detección de patrones anómalos
 * 
 * Triggers:
 * - Caída >15% vs semana pasada
 * - Caída >20% vs meta
 * - Caída en múltiples métricas simultáneamente
 */

import { logger, query } from "@tagers/shared";
import { BaseDetector } from "../engine/BaseDetector.js";
import { getBranchList, getAllDailyGoals } from "../../config/lucaConfig.js";

/**
 * Umbrales de detección
 */
const DETECTION_THRESHOLDS = {
  vs_last_week: -15,      // Caída vs mismo día semana pasada
  vs_baseline: -15,       // Caída vs promedio móvil 4 semanas
  vs_goal: -20,           // Caída vs meta
  vs_yesterday: -25,      // Caída abrupta vs ayer
  min_severity_score: 30, // Score mínimo para generar finding
};

/**
 * Pesos para calcular severity score
 */
const SEVERITY_WEIGHTS = {
  vs_last_week: 0.30,
  vs_baseline: 0.25,
  vs_goal: 0.25,
  traffic_drop: 0.10,
  ticket_drop: 0.10,
};

export class ForenseDetector extends BaseDetector {
  constructor() {
    super({
      id: "forense",
      name: "El Forense",
      description: "Detecta días con caídas de ventas que requieren autopsia",
      category: "sales",
      version: "1.0.0",
      schedule: "0 6 * * *", // 6 AM diario
    });
  }

  /**
   * Ejecuta detección de días malos
   */
  async execute(context = {}) {
    const runId = `forense_${Date.now()}`;
    const findings = [];

    logger.info({ runId, context }, "ForenseDetector starting");

    try {
      // Determinar fecha a analizar (ayer por default)
      const targetDate = context.date 
        ? new Date(context.date) 
        : new Date(Date.now() - 24 * 60 * 60 * 1000);
      
      const dateStr = targetDate.toISOString().split("T")[0];

      // Obtener sucursales a analizar
      const branches = context.branch_id 
        ? [{ id: context.branch_id }]
        : await getBranchList();

      // Obtener metas
      const goals = await getAllDailyGoals();

      // Analizar cada sucursal
      for (const branch of branches) {
        const analysis = await this.analyzeBranch(branch.id, targetDate, goals[branch.id]);
        
        if (analysis.requiresAutopsy) {
          findings.push({
            finding_id: `${runId}_${branch.id}`,
            detector_id: this.config.id,
            branch_id: branch.id,
            date: dateStr,
            severity: this.calculateSeverity(analysis.severityScore),
            confidence: analysis.confidence,
            severity_score: analysis.severityScore,
            title: `Caída de ventas en ${branch.id}`,
            description: this.generateDescription(analysis),
            metrics: analysis.metrics,
            comparisons: analysis.comparisons,
            triggers: analysis.triggers,
            requires_autopsy: true,
            metadata: {
              detected_at: new Date().toISOString(),
              thresholds_used: DETECTION_THRESHOLDS,
            },
          });
        }
      }

      logger.info({
        runId,
        findingsCount: findings.length,
        date: dateStr,
      }, "ForenseDetector completed");

      return {
        runId,
        detector: this.config.id,
        executedAt: new Date().toISOString(),
        date: dateStr,
        findings,
        summary: {
          branches_analyzed: branches.length,
          anomalies_detected: findings.length,
          branches_with_issues: findings.map(f => f.branch_id),
        },
      };

    } catch (err) {
      logger.error({ runId, err: err?.message }, "ForenseDetector failed");
      throw err;
    }
  }

  /**
   * Analiza una sucursal para detectar anomalías
   */
  async analyzeBranch(branchId, date, dailyGoal = 70000) {
    const dateStr = date.toISOString().split("T")[0];
    
    // Fechas de comparación
    const lastWeek = new Date(date);
    lastWeek.setDate(lastWeek.getDate() - 7);
    
    const yesterday = new Date(date);
    yesterday.setDate(yesterday.getDate() - 1);

    // Obtener métricas
    const metrics = await this.getBranchMetrics(branchId, dateStr);
    const lastWeekMetrics = await this.getBranchMetrics(branchId, lastWeek.toISOString().split("T")[0]);
    const yesterdayMetrics = await this.getBranchMetrics(branchId, yesterday.toISOString().split("T")[0]);
    const baselineMetrics = await this.getBaselineMetrics(branchId, date);

    // Si no hay datos del día, no hay anomalía que detectar
    if (!metrics || metrics.total === 0) {
      return { requiresAutopsy: false, reason: "no_data" };
    }

    // Calcular comparaciones
    const comparisons = {
      vs_last_week: lastWeekMetrics?.total 
        ? ((metrics.total - lastWeekMetrics.total) / lastWeekMetrics.total) * 100 
        : null,
      vs_baseline: baselineMetrics?.avg_total 
        ? ((metrics.total - baselineMetrics.avg_total) / baselineMetrics.avg_total) * 100 
        : null,
      vs_goal: dailyGoal 
        ? ((metrics.total - dailyGoal) / dailyGoal) * 100 
        : null,
      vs_yesterday: yesterdayMetrics?.total 
        ? ((metrics.total - yesterdayMetrics.total) / yesterdayMetrics.total) * 100 
        : null,
      traffic_change: lastWeekMetrics?.order_count 
        ? ((metrics.order_count - lastWeekMetrics.order_count) / lastWeekMetrics.order_count) * 100 
        : null,
      ticket_change: lastWeekMetrics?.avg_ticket 
        ? ((metrics.avg_ticket - lastWeekMetrics.avg_ticket) / lastWeekMetrics.avg_ticket) * 100 
        : null,
    };

    // Determinar qué umbrales se cruzaron
    const triggers = [];
    
    if (comparisons.vs_last_week !== null && comparisons.vs_last_week <= DETECTION_THRESHOLDS.vs_last_week) {
      triggers.push({ type: "vs_last_week", value: comparisons.vs_last_week, threshold: DETECTION_THRESHOLDS.vs_last_week });
    }
    if (comparisons.vs_baseline !== null && comparisons.vs_baseline <= DETECTION_THRESHOLDS.vs_baseline) {
      triggers.push({ type: "vs_baseline", value: comparisons.vs_baseline, threshold: DETECTION_THRESHOLDS.vs_baseline });
    }
    if (comparisons.vs_goal !== null && comparisons.vs_goal <= DETECTION_THRESHOLDS.vs_goal) {
      triggers.push({ type: "vs_goal", value: comparisons.vs_goal, threshold: DETECTION_THRESHOLDS.vs_goal });
    }
    if (comparisons.vs_yesterday !== null && comparisons.vs_yesterday <= DETECTION_THRESHOLDS.vs_yesterday) {
      triggers.push({ type: "vs_yesterday", value: comparisons.vs_yesterday, threshold: DETECTION_THRESHOLDS.vs_yesterday });
    }

    // Calcular severity score
    const severityScore = this.calculateSeverityScore(comparisons);
    
    // Calcular confidence basado en datos disponibles
    const confidence = this.calculateConfidence(comparisons, lastWeekMetrics, baselineMetrics);

    return {
      requiresAutopsy: triggers.length > 0 && severityScore >= DETECTION_THRESHOLDS.min_severity_score,
      metrics,
      comparisons,
      triggers,
      severityScore,
      confidence,
      lastWeekMetrics,
      baselineMetrics,
    };
  }

  /**
   * Obtiene métricas de una sucursal para una fecha
   */
  async getBranchMetrics(branchId, dateStr) {
    try {
      const result = await query(`
        SELECT 
          SUM(total) as total,
          COUNT(*) as order_count,
          AVG(total) as avg_ticket,
          SUM(discount_amount) as total_discounts,
          SUM(CASE WHEN is_refund THEN total ELSE 0 END) as refunds
        FROM transactions
        WHERE branch_id = $1 AND DATE(created_at) = $2
      `, [branchId, dateStr]);

      if (result.rows[0]?.total) {
        return {
          total: parseFloat(result.rows[0].total) || 0,
          order_count: parseInt(result.rows[0].order_count) || 0,
          avg_ticket: parseFloat(result.rows[0].avg_ticket) || 0,
          total_discounts: parseFloat(result.rows[0].total_discounts) || 0,
          refunds: parseFloat(result.rows[0].refunds) || 0,
        };
      }
    } catch (err) {
      logger.debug({ branchId, dateStr, err: err?.message }, "Failed to get metrics from DB");
    }

    // Datos mock para desarrollo
    return this.getMockMetrics(branchId, dateStr);
  }

  /**
   * Obtiene baseline (promedio móvil 4 semanas, mismo día)
   */
  async getBaselineMetrics(branchId, date) {
    const dayOfWeek = date.getDay();
    
    try {
      const result = await query(`
        SELECT 
          AVG(daily_total) as avg_total,
          AVG(daily_orders) as avg_orders,
          AVG(daily_ticket) as avg_ticket,
          STDDEV(daily_total) as stddev_total
        FROM (
          SELECT 
            DATE(created_at) as day,
            SUM(total) as daily_total,
            COUNT(*) as daily_orders,
            AVG(total) as daily_ticket
          FROM transactions
          WHERE branch_id = $1 
            AND EXTRACT(DOW FROM created_at) = $2
            AND created_at >= $3::date - INTERVAL '28 days'
            AND created_at < $3::date
          GROUP BY DATE(created_at)
        ) daily
      `, [branchId, dayOfWeek, date.toISOString().split("T")[0]]);

      if (result.rows[0]?.avg_total) {
        return {
          avg_total: parseFloat(result.rows[0].avg_total),
          avg_orders: parseFloat(result.rows[0].avg_orders),
          avg_ticket: parseFloat(result.rows[0].avg_ticket),
          stddev_total: parseFloat(result.rows[0].stddev_total) || 0,
        };
      }
    } catch (err) {
      logger.debug({ branchId, err: err?.message }, "Failed to get baseline from DB");
    }

    // Mock baseline
    return this.getMockBaseline(branchId);
  }

  /**
   * Calcula severity score (0-100)
   */
  calculateSeverityScore(comparisons) {
    let score = 0;

    // Contribución de cada comparación (convertir negativo a positivo para score)
    if (comparisons.vs_last_week !== null && comparisons.vs_last_week < 0) {
      score += Math.min(Math.abs(comparisons.vs_last_week) * 2, 30) * SEVERITY_WEIGHTS.vs_last_week / 0.30;
    }
    if (comparisons.vs_baseline !== null && comparisons.vs_baseline < 0) {
      score += Math.min(Math.abs(comparisons.vs_baseline) * 2, 25) * SEVERITY_WEIGHTS.vs_baseline / 0.25;
    }
    if (comparisons.vs_goal !== null && comparisons.vs_goal < 0) {
      score += Math.min(Math.abs(comparisons.vs_goal) * 1.5, 25) * SEVERITY_WEIGHTS.vs_goal / 0.25;
    }
    if (comparisons.traffic_change !== null && comparisons.traffic_change < 0) {
      score += Math.min(Math.abs(comparisons.traffic_change) * 1, 10) * SEVERITY_WEIGHTS.traffic_drop / 0.10;
    }
    if (comparisons.ticket_change !== null && comparisons.ticket_change < 0) {
      score += Math.min(Math.abs(comparisons.ticket_change) * 1, 10) * SEVERITY_WEIGHTS.ticket_drop / 0.10;
    }

    return Math.min(Math.round(score), 100);
  }

  /**
   * Calcula confidence basado en datos disponibles
   */
  calculateConfidence(comparisons, lastWeekData, baselineData) {
    let confidence = 0.5; // Base

    // Más datos = más confianza
    if (lastWeekData?.total > 0) confidence += 0.2;
    if (baselineData?.avg_total > 0) confidence += 0.2;
    if (comparisons.vs_goal !== null) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  /**
   * Determina severidad a partir del score
   */
  calculateSeverity(score) {
    if (score >= 80) return "CRITICAL";
    if (score >= 60) return "HIGH";
    if (score >= 40) return "MEDIUM";
    return "LOW";
  }

  /**
   * Genera descripción del hallazgo
   */
  generateDescription(analysis) {
    const parts = [];

    if (analysis.comparisons.vs_last_week !== null) {
      parts.push(`${analysis.comparisons.vs_last_week.toFixed(1)}% vs mismo día semana pasada`);
    }
    if (analysis.comparisons.vs_goal !== null) {
      parts.push(`${analysis.comparisons.vs_goal.toFixed(1)}% vs meta`);
    }
    if (analysis.comparisons.traffic_change !== null && analysis.comparisons.traffic_change < -10) {
      parts.push(`tráfico cayó ${Math.abs(analysis.comparisons.traffic_change).toFixed(1)}%`);
    }
    if (analysis.comparisons.ticket_change !== null && analysis.comparisons.ticket_change < -10) {
      parts.push(`ticket promedio cayó ${Math.abs(analysis.comparisons.ticket_change).toFixed(1)}%`);
    }

    return `Caída detectada: ${parts.join(", ")}. Requiere autopsia para determinar causas.`;
  }

  /**
   * Datos mock para desarrollo
   */
  getMockMetrics(branchId, dateStr) {
    const date = new Date(dateStr);
    const dayOfWeek = date.getDay();
    
    // Base según día de semana
    const baseByDay = {
      0: 45000, // Domingo
      1: 55000, // Lunes
      2: 60000, // Martes
      3: 65000, // Miércoles
      4: 70000, // Jueves
      5: 85000, // Viernes
      6: 95000, // Sábado
    };

    const base = baseByDay[dayOfWeek] || 70000;
    
    // Simular caída aleatoria para testing
    const variation = branchId === "SUC03" ? -0.25 : (-0.1 + Math.random() * 0.3);
    const total = Math.round(base * (1 + variation));
    const orderCount = Math.round(total / (150 + Math.random() * 50));

    return {
      total,
      order_count: orderCount,
      avg_ticket: total / orderCount,
      total_discounts: total * 0.05,
      refunds: total * 0.02,
    };
  }

  getMockBaseline(branchId) {
    return {
      avg_total: 75000,
      avg_orders: 450,
      avg_ticket: 166,
      stddev_total: 8000,
    };
  }
}

export default ForenseDetector;
