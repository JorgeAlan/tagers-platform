/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FEEDBACK PROCESSOR - Procesa Labels de Feedback
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Recolecta y procesa feedback del sistema:
 * 
 * 1. Explicit Labels    → Usuario marca TP/FP/TN/FN
 * 2. Implicit Signals   → Acción tomada o ignorada
 * 3. Outcome Measurement → Resultado medido
 * 
 * El feedback alimenta el aprendizaje del sistema.
 */

import { logger, query } from "@tagers/shared";

/**
 * Tipos de feedback
 */
export const FeedbackTypes = {
  // Etiquetas explícitas
  TRUE_POSITIVE: "TP",      // Alerta correcta, era un problema real
  FALSE_POSITIVE: "FP",     // Alerta incorrecta, no era problema
  TRUE_NEGATIVE: "TN",      // No alertó y no había problema
  FALSE_NEGATIVE: "FN",     // No alertó pero sí había problema
  
  // Señales implícitas
  ACKNOWLEDGED: "ACK",      // Usuario vio la alerta
  IGNORED: "IGN",           // Usuario ignoró la alerta
  ACTION_TAKEN: "ACT",      // Se tomó acción
  ESCALATED: "ESC",         // Se escaló el caso
  
  // Resultados
  RESOLVED: "RES",          // Problema resuelto
  RECURRING: "REC",         // Problema recurrió
  PREVENTED: "PRV",         // Problema prevenido
};

/**
 * Fuentes de feedback
 */
export const FeedbackSources = {
  USER_EXPLICIT: "user_explicit",     // Usuario marcó explícitamente
  USER_IMPLICIT: "user_implicit",     // Inferido de acciones del usuario
  SYSTEM_AUTO: "system_auto",         // Sistema detectó automáticamente
  OUTCOME_MEASURED: "outcome_measured", // Medido por resultado
};

/**
 * Store en memoria para feedback (usar Redis/DB en producción)
 */
const feedbackStore = new Map();

export class FeedbackProcessor {
  constructor() {
    this.listeners = [];
  }

  /**
   * Registra feedback explícito del usuario
   */
  async recordExplicitFeedback(data) {
    const { findingId, caseId, label, userId, comment } = data;

    if (!findingId && !caseId) {
      throw new Error("findingId or caseId required");
    }

    if (!Object.values(FeedbackTypes).includes(label)) {
      throw new Error(`Invalid label: ${label}`);
    }

    const feedback = {
      id: `FB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      findingId,
      caseId,
      label,
      source: FeedbackSources.USER_EXPLICIT,
      userId,
      comment,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    await this.storeFeedback(feedback);
    await this.notifyListeners(feedback);

    logger.info({ feedbackId: feedback.id, label }, "Explicit feedback recorded");

    return feedback;
  }

  /**
   * Registra señal implícita de comportamiento
   */
  async recordImplicitSignal(data) {
    const { findingId, caseId, signal, metadata } = data;

    const feedback = {
      id: `FB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      findingId,
      caseId,
      label: signal,
      source: FeedbackSources.USER_IMPLICIT,
      metadata,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    await this.storeFeedback(feedback);

    logger.debug({ feedbackId: feedback.id, signal }, "Implicit signal recorded");

    return feedback;
  }

  /**
   * Registra resultado medido
   */
  async recordOutcome(data) {
    const { findingId, caseId, outcome, measurementType, value, metadata } = data;

    const feedback = {
      id: `FB-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      findingId,
      caseId,
      label: outcome,
      source: FeedbackSources.OUTCOME_MEASURED,
      measurementType,
      value,
      metadata,
      timestamp: new Date().toISOString(),
      processed: false,
    };

    await this.storeFeedback(feedback);

    logger.info({ feedbackId: feedback.id, outcome }, "Outcome recorded");

    return feedback;
  }

  /**
   * Auto-etiqueta basado en tiempo sin acción
   */
  async autoLabelStaleFindings(options = {}) {
    const { maxAgeDays = 7, label = FeedbackTypes.IGNORED } = options;

    const staleFindings = await this.getStaleFindings(maxAgeDays);
    const labeled = [];

    for (const finding of staleFindings) {
      const feedback = await this.recordImplicitSignal({
        findingId: finding.id,
        signal: label,
        metadata: {
          reason: "auto_labeled_stale",
          age_days: finding.ageDays,
        },
      });
      labeled.push(feedback);
    }

    logger.info({ count: labeled.length }, "Auto-labeled stale findings");

    return labeled;
  }

  /**
   * Obtiene feedback por finding
   */
  async getFeedbackForFinding(findingId) {
    const all = Array.from(feedbackStore.values());
    return all.filter(f => f.findingId === findingId);
  }

  /**
   * Obtiene feedback por caso
   */
  async getFeedbackForCase(caseId) {
    const all = Array.from(feedbackStore.values());
    return all.filter(f => f.caseId === caseId);
  }

  /**
   * Obtiene feedback por detector
   */
  async getFeedbackForDetector(detectorName, options = {}) {
    const { startDate, endDate, limit = 1000 } = options;
    
    // TODO: Implementar con query a DB
    const all = Array.from(feedbackStore.values());
    return all.slice(0, limit);
  }

  /**
   * Calcula métricas de un detector basado en feedback
   */
  async calculateDetectorMetrics(detectorName, options = {}) {
    const feedback = await this.getFeedbackForDetector(detectorName, options);
    
    const counts = {
      TP: 0, FP: 0, TN: 0, FN: 0,
      ACK: 0, IGN: 0, ACT: 0,
    };

    for (const f of feedback) {
      if (counts[f.label] !== undefined) {
        counts[f.label]++;
      }
    }

    const total = counts.TP + counts.FP + counts.TN + counts.FN;
    const predicted_positive = counts.TP + counts.FP;
    const actual_positive = counts.TP + counts.FN;

    return {
      detector: detectorName,
      total_labeled: total,
      counts,
      metrics: {
        precision: predicted_positive > 0 
          ? counts.TP / predicted_positive 
          : null,
        recall: actual_positive > 0 
          ? counts.TP / actual_positive 
          : null,
        accuracy: total > 0 
          ? (counts.TP + counts.TN) / total 
          : null,
        false_positive_rate: (counts.FP + counts.TN) > 0 
          ? counts.FP / (counts.FP + counts.TN) 
          : null,
        acknowledgement_rate: (counts.ACK + counts.IGN) > 0 
          ? counts.ACK / (counts.ACK + counts.IGN) 
          : null,
        action_rate: counts.ACK > 0 
          ? counts.ACT / counts.ACK 
          : null,
      },
      period: options,
    };
  }

  /**
   * Procesa feedback pendiente
   */
  async processPendingFeedback() {
    const pending = Array.from(feedbackStore.values())
      .filter(f => !f.processed);

    logger.info({ count: pending.length }, "Processing pending feedback");

    for (const feedback of pending) {
      try {
        await this.processFeedback(feedback);
        feedback.processed = true;
        feedback.processedAt = new Date().toISOString();
      } catch (err) {
        logger.warn({ feedbackId: feedback.id, err: err?.message }, "Failed to process feedback");
      }
    }

    return pending.length;
  }

  /**
   * Procesa un feedback individual
   */
  async processFeedback(feedback) {
    // Actualizar estadísticas del detector
    // TODO: Actualizar en DB

    // Si es FP, puede disparar ajuste de umbral
    if (feedback.label === FeedbackTypes.FALSE_POSITIVE) {
      await this.notifyThresholdTuner(feedback);
    }

    // Si es FN, puede disparar búsqueda de nuevos patterns
    if (feedback.label === FeedbackTypes.FALSE_NEGATIVE) {
      await this.notifyPatternLearner(feedback);
    }

    logger.debug({ feedbackId: feedback.id }, "Feedback processed");
  }

  /**
   * Notifica al ThresholdTuner sobre FP
   */
  async notifyThresholdTuner(feedback) {
    // TODO: Integrar con ThresholdTuner
    logger.debug({ feedbackId: feedback.id }, "Notified threshold tuner");
  }

  /**
   * Notifica al PatternLearner sobre FN
   */
  async notifyPatternLearner(feedback) {
    // TODO: Integrar con PatternLearner
    logger.debug({ feedbackId: feedback.id }, "Notified pattern learner");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  async storeFeedback(feedback) {
    feedbackStore.set(feedback.id, feedback);
    // TODO: Persistir en DB
  }

  async getStaleFindings(maxAgeDays) {
    // TODO: Obtener de DB
    return [];
  }

  async notifyListeners(feedback) {
    for (const listener of this.listeners) {
      try {
        await listener(feedback);
      } catch (err) {
        logger.warn({ err: err?.message }, "Feedback listener error");
      }
    }
  }

  onFeedback(callback) {
    this.listeners.push(callback);
  }

  /**
   * Obtiene resumen de feedback
   */
  async getSummary(options = {}) {
    const all = Array.from(feedbackStore.values());
    
    const byLabel = {};
    const bySource = {};
    
    for (const f of all) {
      byLabel[f.label] = (byLabel[f.label] || 0) + 1;
      bySource[f.source] = (bySource[f.source] || 0) + 1;
    }

    return {
      total: all.length,
      processed: all.filter(f => f.processed).length,
      pending: all.filter(f => !f.processed).length,
      byLabel,
      bySource,
    };
  }
}

export const feedbackProcessor = new FeedbackProcessor();

export default FeedbackProcessor;
