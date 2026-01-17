/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DETECTOR METRICS - Métricas de Performance de Detectores
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Calcula y trackea métricas de cada detector:
 * - Precision (TP / (TP + FP))
 * - Recall (TP / (TP + FN))
 * - F1 Score
 * - False Positive Rate
 * - Time to Acknowledge
 * - Action Rate
 */

import { logger } from "@tagers/shared";
import { feedbackProcessor, FeedbackTypes } from "../learning/FeedbackProcessor.js";

/**
 * Períodos de análisis
 */
export const AnalysisPeriods = {
  DAILY: "daily",
  WEEKLY: "weekly",
  MONTHLY: "monthly",
  QUARTERLY: "quarterly",
};

/**
 * Cache de métricas
 */
const metricsCache = new Map();

export class DetectorMetrics {
  constructor() {
    this.history = new Map(); // detector -> array of metric snapshots
  }

  /**
   * Calcula todas las métricas para un detector
   */
  async calculateMetrics(detectorName, options = {}) {
    const { period = AnalysisPeriods.WEEKLY, startDate, endDate } = options;

    // Obtener feedback del período
    const feedback = await this.getFeedbackForPeriod(detectorName, {
      period,
      startDate,
      endDate,
    });

    // Contar por tipo
    const counts = this.countFeedback(feedback);

    // Calcular métricas
    const metrics = {
      detector: detectorName,
      period,
      calculatedAt: new Date().toISOString(),
      sampleSize: feedback.length,
      counts,
      
      // Métricas de clasificación
      precision: this.calculatePrecision(counts),
      recall: this.calculateRecall(counts),
      f1Score: this.calculateF1(counts),
      accuracy: this.calculateAccuracy(counts),
      falsePositiveRate: this.calculateFPRate(counts),
      falseNegativeRate: this.calculateFNRate(counts),
      
      // Métricas operacionales
      acknowledgementRate: this.calculateAckRate(counts),
      actionRate: this.calculateActionRate(counts),
      avgTimeToAcknowledge: await this.calculateAvgTimeToAck(detectorName, feedback),
      avgTimeToResolve: await this.calculateAvgTimeToResolve(detectorName, feedback),
      
      // Tendencia
      trend: await this.calculateTrend(detectorName, period),
    };

    // Guardar en caché
    metricsCache.set(`${detectorName}_${period}`, {
      metrics,
      cachedAt: Date.now(),
    });

    // Guardar en historial
    await this.saveToHistory(detectorName, metrics);

    return metrics;
  }

  /**
   * Cuenta feedback por tipo
   */
  countFeedback(feedback) {
    const counts = {
      TP: 0, FP: 0, TN: 0, FN: 0,
      ACK: 0, IGN: 0, ACT: 0, ESC: 0,
      total: feedback.length,
    };

    for (const f of feedback) {
      if (counts[f.label] !== undefined) {
        counts[f.label]++;
      }
    }

    return counts;
  }

  /**
   * Precision = TP / (TP + FP)
   */
  calculatePrecision(counts) {
    const denominator = counts.TP + counts.FP;
    if (denominator === 0) return null;
    return Math.round((counts.TP / denominator) * 1000) / 1000;
  }

  /**
   * Recall = TP / (TP + FN)
   */
  calculateRecall(counts) {
    const denominator = counts.TP + counts.FN;
    if (denominator === 0) return null;
    return Math.round((counts.TP / denominator) * 1000) / 1000;
  }

  /**
   * F1 = 2 * (Precision * Recall) / (Precision + Recall)
   */
  calculateF1(counts) {
    const precision = this.calculatePrecision(counts);
    const recall = this.calculateRecall(counts);
    
    if (precision === null || recall === null) return null;
    if (precision + recall === 0) return 0;
    
    return Math.round((2 * precision * recall / (precision + recall)) * 1000) / 1000;
  }

  /**
   * Accuracy = (TP + TN) / Total
   */
  calculateAccuracy(counts) {
    const total = counts.TP + counts.FP + counts.TN + counts.FN;
    if (total === 0) return null;
    return Math.round(((counts.TP + counts.TN) / total) * 1000) / 1000;
  }

  /**
   * FP Rate = FP / (FP + TN)
   */
  calculateFPRate(counts) {
    const denominator = counts.FP + counts.TN;
    if (denominator === 0) return null;
    return Math.round((counts.FP / denominator) * 1000) / 1000;
  }

  /**
   * FN Rate = FN / (FN + TP)
   */
  calculateFNRate(counts) {
    const denominator = counts.FN + counts.TP;
    if (denominator === 0) return null;
    return Math.round((counts.FN / denominator) * 1000) / 1000;
  }

  /**
   * Acknowledgement Rate = ACK / (ACK + IGN)
   */
  calculateAckRate(counts) {
    const denominator = counts.ACK + counts.IGN;
    if (denominator === 0) return null;
    return Math.round((counts.ACK / denominator) * 1000) / 1000;
  }

  /**
   * Action Rate = ACT / ACK
   */
  calculateActionRate(counts) {
    if (counts.ACK === 0) return null;
    return Math.round((counts.ACT / counts.ACK) * 1000) / 1000;
  }

  /**
   * Calcula tiempo promedio hasta acknowledging
   */
  async calculateAvgTimeToAck(detectorName, feedback) {
    const ackFeedback = feedback.filter(f => f.label === FeedbackTypes.ACKNOWLEDGED);
    
    if (ackFeedback.length === 0) return null;

    // TODO: Calcular desde timestamps reales
    // Por ahora, mock
    return Math.round(Math.random() * 60 + 10); // 10-70 minutos
  }

  /**
   * Calcula tiempo promedio hasta resolución
   */
  async calculateAvgTimeToResolve(detectorName, feedback) {
    const resolvedFeedback = feedback.filter(f => f.label === FeedbackTypes.RESOLVED);
    
    if (resolvedFeedback.length === 0) return null;

    // TODO: Calcular desde timestamps reales
    return Math.round(Math.random() * 240 + 60); // 60-300 minutos
  }

  /**
   * Calcula tendencia comparando con período anterior
   */
  async calculateTrend(detectorName, period) {
    const history = this.history.get(detectorName) || [];
    
    if (history.length < 2) {
      return { direction: "stable", change: 0 };
    }

    const current = history[history.length - 1];
    const previous = history[history.length - 2];

    if (!current.precision || !previous.precision) {
      return { direction: "unknown", change: null };
    }

    const change = current.precision - previous.precision;
    const direction = change > 0.05 ? "improving" : 
                     change < -0.05 ? "declining" : "stable";

    return {
      direction,
      change: Math.round(change * 100) / 100,
      previousPrecision: previous.precision,
      currentPrecision: current.precision,
    };
  }

  /**
   * Obtiene feedback para un período
   */
  async getFeedbackForPeriod(detectorName, options) {
    const { period, startDate, endDate } = options;

    // Calcular fechas basado en período
    let start = startDate;
    let end = endDate || new Date();

    if (!start) {
      start = new Date();
      switch (period) {
        case AnalysisPeriods.DAILY:
          start.setDate(start.getDate() - 1);
          break;
        case AnalysisPeriods.WEEKLY:
          start.setDate(start.getDate() - 7);
          break;
        case AnalysisPeriods.MONTHLY:
          start.setMonth(start.getMonth() - 1);
          break;
        case AnalysisPeriods.QUARTERLY:
          start.setMonth(start.getMonth() - 3);
          break;
      }
    }

    return await feedbackProcessor.getFeedbackForDetector(detectorName, {
      startDate: start,
      endDate: end,
    });
  }

  /**
   * Guarda métricas en historial
   */
  async saveToHistory(detectorName, metrics) {
    if (!this.history.has(detectorName)) {
      this.history.set(detectorName, []);
    }

    const history = this.history.get(detectorName);
    history.push({
      ...metrics,
      savedAt: new Date().toISOString(),
    });

    // Mantener últimos 52 registros (1 año semanal)
    if (history.length > 52) {
      history.shift();
    }
  }

  /**
   * Obtiene métricas de caché si están frescas
   */
  getCachedMetrics(detectorName, period, maxAgeMinutes = 60) {
    const cached = metricsCache.get(`${detectorName}_${period}`);
    if (!cached) return null;

    const ageMs = Date.now() - cached.cachedAt;
    if (ageMs > maxAgeMinutes * 60 * 1000) return null;

    return cached.metrics;
  }

  /**
   * Calcula métricas para todos los detectores
   */
  async calculateAllDetectorMetrics(options = {}) {
    const { period = AnalysisPeriods.WEEKLY } = options;
    
    // Obtener lista de detectores
    const detectors = await this.getActiveDetectors();
    
    const results = [];
    for (const detector of detectors) {
      try {
        const metrics = await this.calculateMetrics(detector.name, { period });
        results.push(metrics);
      } catch (err) {
        logger.warn({ detector: detector.name, err: err?.message }, "Failed to calculate metrics");
      }
    }

    return results;
  }

  /**
   * Obtiene ranking de detectores por performance
   */
  async getDetectorRanking(period = AnalysisPeriods.WEEKLY) {
    const allMetrics = await this.calculateAllDetectorMetrics({ period });
    
    // Ordenar por F1 score (o precision si no hay F1)
    return allMetrics
      .filter(m => m.f1Score !== null || m.precision !== null)
      .sort((a, b) => {
        const scoreA = a.f1Score ?? a.precision ?? 0;
        const scoreB = b.f1Score ?? b.precision ?? 0;
        return scoreB - scoreA;
      })
      .map((m, index) => ({
        rank: index + 1,
        detector: m.detector,
        f1Score: m.f1Score,
        precision: m.precision,
        recall: m.recall,
        sampleSize: m.sampleSize,
        trend: m.trend?.direction,
      }));
  }

  /**
   * Obtiene detectores activos
   */
  async getActiveDetectors() {
    // TODO: Obtener de registro de detectores
    return [
      { name: "fraud_detector" },
      { name: "anomaly_detector" },
      { name: "churn_risk_detector" },
      { name: "complaint_spike_detector" },
      { name: "sentiment_drop_detector" },
    ];
  }

  /**
   * Obtiene historial de un detector
   */
  getHistory(detectorName, limit = 12) {
    const history = this.history.get(detectorName) || [];
    return history.slice(-limit);
  }

  /**
   * Genera reporte de performance
   */
  async generatePerformanceReport(period = AnalysisPeriods.WEEKLY) {
    const allMetrics = await this.calculateAllDetectorMetrics({ period });
    const ranking = await this.getDetectorRanking(period);

    // Calcular promedios globales
    const validMetrics = allMetrics.filter(m => m.precision !== null);
    const avgPrecision = validMetrics.length > 0
      ? validMetrics.reduce((sum, m) => sum + m.precision, 0) / validMetrics.length
      : null;
    const avgRecall = validMetrics.filter(m => m.recall !== null).length > 0
      ? validMetrics.filter(m => m.recall !== null).reduce((sum, m) => sum + m.recall, 0) / validMetrics.filter(m => m.recall !== null).length
      : null;

    return {
      period,
      generatedAt: new Date().toISOString(),
      summary: {
        totalDetectors: allMetrics.length,
        avgPrecision: avgPrecision ? Math.round(avgPrecision * 100) / 100 : null,
        avgRecall: avgRecall ? Math.round(avgRecall * 100) / 100 : null,
        improving: ranking.filter(r => r.trend === "improving").length,
        declining: ranking.filter(r => r.trend === "declining").length,
        stable: ranking.filter(r => r.trend === "stable").length,
      },
      ranking,
      details: allMetrics,
    };
  }
}

export const detectorMetrics = new DetectorMetrics();

export default DetectorMetrics;
