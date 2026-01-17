/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEEKLY LEARNING REPORT - Reporte Semanal de Aprendizaje
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Genera un reporte semanal de lo que LUCA aprendió:
 * - Performance de detectores
 * - Ajustes de umbrales
 * - Nuevos patterns descubiertos
 * - ROI generado
 * - Recomendaciones de mejora
 */

import { logger } from "@tagers/shared";
import { feedbackProcessor } from "../learning/FeedbackProcessor.js";
import { thresholdTuner } from "../learning/ThresholdTuner.js";
import { patternLearner } from "../learning/PatternLearner.js";
import { detectorMetrics, AnalysisPeriods } from "../metrics/DetectorMetrics.js";
import { actionMetrics } from "../metrics/ActionMetrics.js";
import { roiCalculator } from "../metrics/ROICalculator.js";

export class WeeklyLearningReport {
  constructor() {
    this.reportHistory = [];
  }

  /**
   * Genera el reporte semanal completo
   */
  async generate(options = {}) {
    const { weekEnding = new Date() } = options;

    logger.info("Generating weekly learning report");

    const report = {
      id: `WLR-${Date.now()}`,
      weekEnding: weekEnding.toISOString(),
      generatedAt: new Date().toISOString(),
      sections: {},
    };

    try {
      // 1. Resumen Ejecutivo
      report.sections.executiveSummary = await this.generateExecutiveSummary();

      // 2. Performance de Detectores
      report.sections.detectorPerformance = await this.generateDetectorSection();

      // 3. Ajustes de Umbrales
      report.sections.thresholdAdjustments = await this.generateThresholdSection();

      // 4. Patterns Descubiertos
      report.sections.patterns = await this.generatePatternsSection();

      // 5. Métricas de Acciones
      report.sections.actionMetrics = await this.generateActionsSection();

      // 6. ROI y Valor Generado
      report.sections.roi = await this.generateROISection();

      // 7. Feedback Recibido
      report.sections.feedback = await this.generateFeedbackSection();

      // 8. Recomendaciones
      report.sections.recommendations = await this.generateRecommendations(report);

      // Guardar en historial
      this.reportHistory.push(report);

      logger.info({ reportId: report.id }, "Weekly learning report generated");

      return report;

    } catch (err) {
      logger.error({ err: err?.message }, "Failed to generate weekly report");
      throw err;
    }
  }

  /**
   * Genera resumen ejecutivo
   */
  async generateExecutiveSummary() {
    const detectorReport = await detectorMetrics.generatePerformanceReport(AnalysisPeriods.WEEKLY);
    const roi = await roiCalculator.calculateROI({ period: "weekly" });
    const feedbackSummary = await feedbackProcessor.getSummary();

    return {
      title: "Resumen Ejecutivo",
      highlights: [
        {
          metric: "Precisión Promedio",
          value: detectorReport.summary.avgPrecision 
            ? `${Math.round(detectorReport.summary.avgPrecision * 100)}%`
            : "N/A",
          trend: this.getTrendEmoji(detectorReport.summary.improving - detectorReport.summary.declining),
        },
        {
          metric: "Valor Generado",
          value: `$${roi.totalImpact.toLocaleString()} MXN`,
          trend: roi.roi > 0 ? "📈" : "📉",
        },
        {
          metric: "ROI",
          value: roi.roi ? `${roi.roi}%` : "N/A",
          trend: roi.roi > 100 ? "🚀" : roi.roi > 0 ? "✅" : "⚠️",
        },
        {
          metric: "Feedback Procesado",
          value: feedbackSummary.processed,
          trend: "📊",
        },
      ],
      status: this.getOverallStatus(detectorReport, roi),
    };
  }

  /**
   * Genera sección de performance de detectores
   */
  async generateDetectorSection() {
    const report = await detectorMetrics.generatePerformanceReport(AnalysisPeriods.WEEKLY);

    return {
      title: "Performance de Detectores",
      summary: {
        totalDetectors: report.summary.totalDetectors,
        avgPrecision: report.summary.avgPrecision,
        avgRecall: report.summary.avgRecall,
        improving: report.summary.improving,
        declining: report.summary.declining,
        stable: report.summary.stable,
      },
      ranking: report.ranking.slice(0, 5),
      alerts: this.getDetectorAlerts(report),
    };
  }

  /**
   * Genera sección de ajustes de umbrales
   */
  async generateThresholdSection() {
    const history = thresholdTuner.getAdjustmentHistory({ limit: 10 });
    const pending = thresholdTuner.getPendingAdjustments();
    const status = thresholdTuner.getStatus();

    return {
      title: "Ajustes de Umbrales",
      summary: {
        adjustmentsThisWeek: status.weeklyAdjustments,
        weeklyLimit: status.weeklyLimit,
        pendingApprovals: pending.length,
      },
      recentAdjustments: history.slice(0, 5).map(h => ({
        detector: h.detector,
        direction: h.direction,
        percentChange: h.percentChange,
        reason: h.reason,
        timestamp: h.timestamp,
      })),
      pendingApprovals: pending,
    };
  }

  /**
   * Genera sección de patterns
   */
  async generatePatternsSection() {
    const summary = patternLearner.getSummary();
    const discovered = patternLearner.getPatternsByState("discovered");
    const approved = patternLearner.getPatternsByState("approved");

    return {
      title: "Patterns Descubiertos",
      summary,
      newDiscoveries: discovered.slice(0, 5).map(p => ({
        id: p.id,
        type: p.type,
        name: p.name,
        description: p.description,
        confidence: p.confidence,
      })),
      recentlyApproved: approved.slice(-3).map(p => ({
        id: p.id,
        name: p.name,
        approvedAt: p.approvedAt,
      })),
    };
  }

  /**
   * Genera sección de métricas de acciones
   */
  async generateActionsSection() {
    const report = await actionMetrics.generateReport({ period: "weekly" });

    return {
      title: "Métricas de Acciones",
      summary: report.summary,
      approvalMetrics: report.approvalMetrics.totals,
      topByImpact: report.topByImpact,
    };
  }

  /**
   * Genera sección de ROI
   */
  async generateROISection() {
    const report = await roiCalculator.generateROIReport({ period: "weekly" });

    return {
      title: "ROI y Valor Generado",
      summary: report.summary,
      breakdown: report.breakdown,
      topImpacts: report.topImpacts,
    };
  }

  /**
   * Genera sección de feedback
   */
  async generateFeedbackSection() {
    const summary = await feedbackProcessor.getSummary();

    return {
      title: "Feedback Recibido",
      summary,
      insights: this.getFeedbackInsights(summary),
    };
  }

  /**
   * Genera recomendaciones basadas en el reporte
   */
  async generateRecommendations(report) {
    const recommendations = [];

    // Basado en detectores
    const detectors = report.sections.detectorPerformance;
    if (detectors) {
      // Detectores con baja precisión
      const lowPrecision = detectors.ranking.filter(d => d.precision && d.precision < 0.6);
      for (const d of lowPrecision.slice(0, 2)) {
        recommendations.push({
          priority: "HIGH",
          category: "detector_tuning",
          title: `Revisar ${d.detector}`,
          description: `Precisión de ${Math.round(d.precision * 100)}% está por debajo del objetivo. Considerar ajustar umbrales o añadir exclusiones.`,
        });
      }

      // Detectores declinando
      const declining = detectors.ranking.filter(d => d.trend === "declining");
      for (const d of declining.slice(0, 2)) {
        recommendations.push({
          priority: "MEDIUM",
          category: "investigation",
          title: `Investigar declive en ${d.detector}`,
          description: `El detector muestra tendencia negativa. Analizar cambios recientes o nuevos patrones de datos.`,
        });
      }
    }

    // Basado en patterns
    const patterns = report.sections.patterns;
    if (patterns && patterns.summary.pendingReview > 0) {
      recommendations.push({
        priority: "MEDIUM",
        category: "patterns",
        title: "Revisar patterns pendientes",
        description: `Hay ${patterns.summary.pendingReview} patterns esperando revisión. Evaluarlos para mejorar detección.`,
      });
    }

    // Basado en feedback
    const feedback = report.sections.feedback;
    if (feedback && feedback.summary.byLabel) {
      const fpRate = (feedback.summary.byLabel.FP || 0) / 
                     ((feedback.summary.byLabel.FP || 0) + (feedback.summary.byLabel.TP || 0) || 1);
      if (fpRate > 0.3) {
        recommendations.push({
          priority: "HIGH",
          category: "accuracy",
          title: "Reducir falsos positivos",
          description: `Tasa de FP del ${Math.round(fpRate * 100)}% es alta. Revisar configuración de detectores más ruidosos.`,
        });
      }
    }

    // Basado en ROI
    const roi = report.sections.roi;
    if (roi && roi.summary.roi < 50) {
      recommendations.push({
        priority: "MEDIUM",
        category: "value",
        title: "Incrementar valor generado",
        description: `ROI de ${roi.summary.roi}% puede mejorarse. Enfocar en detectores con mayor impacto potencial.`,
      });
    }

    return {
      title: "Recomendaciones",
      count: recommendations.length,
      items: recommendations.sort((a, b) => 
        a.priority === "HIGH" ? -1 : b.priority === "HIGH" ? 1 : 0
      ),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  getTrendEmoji(delta) {
    if (delta > 0) return "📈";
    if (delta < 0) return "📉";
    return "➡️";
  }

  getOverallStatus(detectorReport, roi) {
    if (detectorReport.summary.avgPrecision >= 0.8 && roi.roi > 100) {
      return { status: "EXCELLENT", emoji: "🌟", message: "Excelente semana" };
    }
    if (detectorReport.summary.avgPrecision >= 0.6 && roi.roi > 0) {
      return { status: "GOOD", emoji: "✅", message: "Buen desempeño" };
    }
    if (detectorReport.summary.declining > detectorReport.summary.improving) {
      return { status: "NEEDS_ATTENTION", emoji: "⚠️", message: "Requiere atención" };
    }
    return { status: "OK", emoji: "👍", message: "Normal" };
  }

  getDetectorAlerts(report) {
    const alerts = [];

    // Alertar sobre detectores con baja precisión
    for (const d of report.ranking) {
      if (d.precision && d.precision < 0.5) {
        alerts.push({
          detector: d.detector,
          issue: "LOW_PRECISION",
          value: d.precision,
          message: `Precisión crítica: ${Math.round(d.precision * 100)}%`,
        });
      }
    }

    return alerts;
  }

  getFeedbackInsights(summary) {
    const insights = [];

    if (summary.byLabel) {
      const tp = summary.byLabel.TP || 0;
      const fp = summary.byLabel.FP || 0;
      
      if (tp + fp > 0) {
        const precision = tp / (tp + fp);
        insights.push({
          type: "precision",
          value: Math.round(precision * 100),
          message: `${Math.round(precision * 100)}% de alertas etiquetadas fueron correctas`,
        });
      }
    }

    return insights;
  }

  /**
   * Obtiene historial de reportes
   */
  getReportHistory(limit = 12) {
    return this.reportHistory.slice(-limit);
  }

  /**
   * Formatea reporte para texto/email
   */
  formatAsText(report) {
    const lines = [];

    lines.push("═══════════════════════════════════════════════════════════════");
    lines.push("📊 REPORTE SEMANAL DE APRENDIZAJE - LUCA");
    lines.push(`Semana terminando: ${report.weekEnding}`);
    lines.push("═══════════════════════════════════════════════════════════════");
    lines.push("");

    // Resumen ejecutivo
    const exec = report.sections.executiveSummary;
    lines.push(`Estado general: ${exec.status.emoji} ${exec.status.message}`);
    lines.push("");
    for (const h of exec.highlights) {
      lines.push(`${h.trend} ${h.metric}: ${h.value}`);
    }
    lines.push("");

    // Recomendaciones
    const recs = report.sections.recommendations;
    if (recs && recs.items.length > 0) {
      lines.push("📌 RECOMENDACIONES:");
      for (const rec of recs.items) {
        const priority = rec.priority === "HIGH" ? "🔴" : "🟡";
        lines.push(`${priority} ${rec.title}`);
        lines.push(`   ${rec.description}`);
      }
    }

    return lines.join("\n");
  }
}

export const weeklyLearningReport = new WeeklyLearningReport();

export default WeeklyLearningReport;
