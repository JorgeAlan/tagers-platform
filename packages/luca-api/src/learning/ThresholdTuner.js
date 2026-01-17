/**
 * ═══════════════════════════════════════════════════════════════════════════
 * THRESHOLD TUNER - Ajuste Automático de Umbrales
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ajusta umbrales de detectores basado en feedback:
 * 
 * - Si FP_rate > 30% → Aumentar umbral 10%
 * - Si FN_rate > 20% → Reducir umbral 5%
 * - Máximo 3 ajustes automáticos por semana
 * - Cambios grandes requieren aprobación
 */

import { logger } from "@tagers/shared";
import { feedbackProcessor, FeedbackTypes } from "./FeedbackProcessor.js";

/**
 * Configuración de tuning
 */
const TUNING_CONFIG = {
  // Umbrales para disparar ajuste
  triggers: {
    fp_rate_max: 0.30,        // Si FP > 30%, subir umbral
    fn_rate_max: 0.20,        // Si FN > 20%, bajar umbral
    min_samples: 10,          // Mínimo de muestras para ajustar
  },

  // Límites de ajuste
  limits: {
    max_adjustment_percent: 20,   // Máximo ajuste por iteración
    min_adjustment_percent: 5,    // Mínimo ajuste significativo
    max_auto_adjustments: 3,      // Máximo ajustes automáticos por semana
    approval_threshold: 15,       // Requiere aprobación si > 15%
  },

  // Cooldown entre ajustes
  cooldown: {
    hours: 24,                    // Esperar 24h entre ajustes del mismo detector
  },
};

/**
 * Store de configuración de detectores
 */
const detectorConfigs = new Map();

/**
 * Historial de ajustes
 */
const adjustmentHistory = [];

export class ThresholdTuner {
  constructor() {
    this.config = TUNING_CONFIG;
    this.pendingAdjustments = new Map();
  }

  /**
   * Analiza un detector y sugiere ajustes
   */
  async analyzeDetector(detectorName) {
    logger.info({ detector: detectorName }, "Analyzing detector for threshold tuning");

    // Obtener métricas del detector
    const metrics = await feedbackProcessor.calculateDetectorMetrics(detectorName, {
      startDate: this.getAnalysisPeriodStart(),
    });

    // Verificar si hay suficientes muestras
    if (metrics.total_labeled < this.config.triggers.min_samples) {
      return {
        detector: detectorName,
        action: "INSUFFICIENT_DATA",
        reason: `Need ${this.config.triggers.min_samples} samples, have ${metrics.total_labeled}`,
        metrics,
      };
    }

    // Verificar cooldown
    if (this.isInCooldown(detectorName)) {
      return {
        detector: detectorName,
        action: "COOLDOWN",
        reason: "Recent adjustment, waiting cooldown period",
        metrics,
      };
    }

    // Calcular ajuste recomendado
    const recommendation = this.calculateRecommendation(metrics);

    return {
      detector: detectorName,
      ...recommendation,
      metrics,
    };
  }

  /**
   * Calcula la recomendación de ajuste
   */
  calculateRecommendation(metrics) {
    const { precision, recall, false_positive_rate } = metrics.metrics;

    // Si FP rate es muy alto, subir umbral
    if (false_positive_rate && false_positive_rate > this.config.triggers.fp_rate_max) {
      const excessFP = false_positive_rate - this.config.triggers.fp_rate_max;
      const adjustmentPercent = Math.min(
        excessFP * 50,  // 1% de exceso = 0.5% de ajuste
        this.config.limits.max_adjustment_percent
      );

      if (adjustmentPercent >= this.config.limits.min_adjustment_percent) {
        return {
          action: "INCREASE_THRESHOLD",
          direction: "up",
          percentChange: Math.round(adjustmentPercent * 10) / 10,
          reason: `FP rate (${(false_positive_rate * 100).toFixed(1)}%) exceeds ${this.config.triggers.fp_rate_max * 100}%`,
          requiresApproval: adjustmentPercent > this.config.limits.approval_threshold,
        };
      }
    }

    // Si recall es muy bajo (muchos FN), bajar umbral
    if (recall !== null && recall < (1 - this.config.triggers.fn_rate_max)) {
      const missRate = 1 - recall;
      const adjustmentPercent = Math.min(
        missRate * 25,  // 1% de miss = 0.25% de ajuste
        this.config.limits.max_adjustment_percent / 2  // Más conservador bajando
      );

      if (adjustmentPercent >= this.config.limits.min_adjustment_percent) {
        return {
          action: "DECREASE_THRESHOLD",
          direction: "down",
          percentChange: Math.round(adjustmentPercent * 10) / 10,
          reason: `Recall (${(recall * 100).toFixed(1)}%) is low, missing issues`,
          requiresApproval: adjustmentPercent > this.config.limits.approval_threshold / 2,
        };
      }
    }

    return {
      action: "NO_CHANGE",
      reason: "Detector performance within acceptable range",
    };
  }

  /**
   * Aplica un ajuste de umbral
   */
  async applyAdjustment(detectorName, adjustment, options = {}) {
    const { force = false, approvedBy } = options;

    // Verificar si requiere aprobación
    if (adjustment.requiresApproval && !force && !approvedBy) {
      // Guardar como pendiente
      this.pendingAdjustments.set(detectorName, {
        ...adjustment,
        requestedAt: new Date().toISOString(),
      });

      return {
        success: false,
        status: "PENDING_APPROVAL",
        adjustment,
      };
    }

    // Obtener config actual
    const currentConfig = await this.getDetectorConfig(detectorName);
    if (!currentConfig) {
      throw new Error(`No config found for detector: ${detectorName}`);
    }

    // Calcular nuevo valor
    const currentThreshold = currentConfig.threshold || 1.0;
    const multiplier = adjustment.direction === "up" 
      ? (1 + adjustment.percentChange / 100)
      : (1 - adjustment.percentChange / 100);
    const newThreshold = currentThreshold * multiplier;

    // Aplicar cambio
    const oldConfig = { ...currentConfig };
    currentConfig.threshold = newThreshold;
    currentConfig.lastAdjustedAt = new Date().toISOString();
    currentConfig.lastAdjustedBy = approvedBy || "auto";

    await this.saveDetectorConfig(detectorName, currentConfig);

    // Registrar en historial
    const historyEntry = {
      id: `ADJ-${Date.now()}`,
      detector: detectorName,
      timestamp: new Date().toISOString(),
      action: adjustment.action,
      direction: adjustment.direction,
      percentChange: adjustment.percentChange,
      reason: adjustment.reason,
      oldThreshold: currentThreshold,
      newThreshold,
      approvedBy: approvedBy || "auto",
    };

    adjustmentHistory.push(historyEntry);

    logger.info({
      detector: detectorName,
      oldThreshold: currentThreshold,
      newThreshold,
    }, "Threshold adjusted");

    return {
      success: true,
      status: "APPLIED",
      adjustment: historyEntry,
    };
  }

  /**
   * Aprueba un ajuste pendiente
   */
  async approveAdjustment(detectorName, approvedBy) {
    const pending = this.pendingAdjustments.get(detectorName);
    if (!pending) {
      throw new Error(`No pending adjustment for detector: ${detectorName}`);
    }

    const result = await this.applyAdjustment(detectorName, pending, {
      force: true,
      approvedBy,
    });

    this.pendingAdjustments.delete(detectorName);

    return result;
  }

  /**
   * Rechaza un ajuste pendiente
   */
  async rejectAdjustment(detectorName, rejectedBy, reason) {
    const pending = this.pendingAdjustments.get(detectorName);
    if (!pending) {
      throw new Error(`No pending adjustment for detector: ${detectorName}`);
    }

    const rejection = {
      ...pending,
      status: "REJECTED",
      rejectedBy,
      rejectionReason: reason,
      rejectedAt: new Date().toISOString(),
    };

    adjustmentHistory.push(rejection);
    this.pendingAdjustments.delete(detectorName);

    logger.info({ detector: detectorName, rejectedBy }, "Adjustment rejected");

    return rejection;
  }

  /**
   * Ejecuta análisis y ajuste automático para todos los detectores
   */
  async runAutoTuning() {
    logger.info("Running auto-tuning for all detectors");

    const results = {
      timestamp: new Date().toISOString(),
      analyzed: [],
      adjusted: [],
      pending: [],
      skipped: [],
    };

    // Obtener lista de detectores activos
    const detectors = await this.getActiveDetectors();

    // Verificar límite semanal de ajustes
    const weeklyAdjustments = this.getWeeklyAdjustmentCount();
    if (weeklyAdjustments >= this.config.limits.max_auto_adjustments) {
      logger.warn({ weeklyAdjustments }, "Weekly auto-adjustment limit reached");
      results.limitReached = true;
      return results;
    }

    for (const detector of detectors) {
      const analysis = await this.analyzeDetector(detector.name);
      results.analyzed.push(analysis);

      if (analysis.action === "NO_CHANGE" || 
          analysis.action === "INSUFFICIENT_DATA" ||
          analysis.action === "COOLDOWN") {
        results.skipped.push({
          detector: detector.name,
          reason: analysis.action,
        });
        continue;
      }

      // Intentar aplicar ajuste
      if (!analysis.requiresApproval) {
        try {
          const result = await this.applyAdjustment(detector.name, analysis);
          if (result.success) {
            results.adjusted.push(result.adjustment);
          }
        } catch (err) {
          logger.warn({ detector: detector.name, err: err?.message }, "Auto-adjustment failed");
        }
      } else {
        results.pending.push({
          detector: detector.name,
          adjustment: analysis,
        });
      }
    }

    logger.info({
      analyzed: results.analyzed.length,
      adjusted: results.adjusted.length,
      pending: results.pending.length,
    }, "Auto-tuning completed");

    return results;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  getAnalysisPeriodStart() {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    return date.toISOString();
  }

  isInCooldown(detectorName) {
    const config = detectorConfigs.get(detectorName);
    if (!config?.lastAdjustedAt) return false;

    const lastAdjusted = new Date(config.lastAdjustedAt);
    const cooldownMs = this.config.cooldown.hours * 60 * 60 * 1000;
    return (Date.now() - lastAdjusted.getTime()) < cooldownMs;
  }

  getWeeklyAdjustmentCount() {
    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    return adjustmentHistory.filter(
      a => new Date(a.timestamp) > weekAgo && a.approvedBy === "auto"
    ).length;
  }

  async getDetectorConfig(detectorName) {
    let config = detectorConfigs.get(detectorName);
    if (!config) {
      // Config por defecto
      config = {
        name: detectorName,
        threshold: 1.0,
        enabled: true,
      };
      detectorConfigs.set(detectorName, config);
    }
    return config;
  }

  async saveDetectorConfig(detectorName, config) {
    detectorConfigs.set(detectorName, config);
    // TODO: Persistir en DB
  }

  async getActiveDetectors() {
    // TODO: Obtener de registro de detectores
    return [
      { name: "fraud_detector" },
      { name: "anomaly_detector" },
      { name: "churn_risk_detector" },
    ];
  }

  /**
   * Obtiene historial de ajustes
   */
  getAdjustmentHistory(options = {}) {
    const { detector, limit = 50 } = options;
    
    let history = [...adjustmentHistory];
    
    if (detector) {
      history = history.filter(h => h.detector === detector);
    }

    return history.slice(-limit);
  }

  /**
   * Obtiene ajustes pendientes
   */
  getPendingAdjustments() {
    return Array.from(this.pendingAdjustments.entries()).map(([detector, adj]) => ({
      detector,
      ...adj,
    }));
  }

  /**
   * Obtiene estado del tuner
   */
  getStatus() {
    return {
      config: this.config,
      weeklyAdjustments: this.getWeeklyAdjustmentCount(),
      weeklyLimit: this.config.limits.max_auto_adjustments,
      pendingApprovals: this.pendingAdjustments.size,
      totalAdjustments: adjustmentHistory.length,
    };
  }
}

export const thresholdTuner = new ThresholdTuner();

export default ThresholdTuner;
