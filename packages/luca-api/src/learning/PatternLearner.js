/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PATTERN LEARNER - Aprende Nuevos Patterns
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Descubre nuevos patterns a partir de:
 * - False Negatives (problemas no detectados)
 * - Casos exitosos (qué funcionó)
 * - Análisis de datos históricos
 * 
 * Los patterns descubiertos se convierten en reglas para detectores.
 */

import { logger } from "@tagers/shared";
import { feedbackProcessor, FeedbackTypes } from "./FeedbackProcessor.js";

/**
 * Tipos de patterns
 */
export const PatternTypes = {
  SEQUENCE: "sequence",       // Secuencia de eventos
  THRESHOLD: "threshold",     // Umbral en métrica
  COMBINATION: "combination", // Combinación de condiciones
  TEMPORAL: "temporal",       // Patrón temporal
  BEHAVIORAL: "behavioral",   // Comportamiento
};

/**
 * Estados de patterns
 */
export const PatternStates = {
  DISCOVERED: "discovered",   // Recién descubierto
  VALIDATING: "validating",   // En validación
  APPROVED: "approved",       // Aprobado para uso
  REJECTED: "rejected",       // Rechazado
  ACTIVE: "active",           // Activo en detector
  DEPRECATED: "deprecated",   // Obsoleto
};

/**
 * Store de patterns descubiertos
 */
const patternStore = new Map();

export class PatternLearner {
  constructor() {
    this.discoveryQueue = [];
    this.validationResults = new Map();
  }

  /**
   * Analiza un False Negative para descubrir patterns
   */
  async analyzefalseNegative(fnFeedback) {
    logger.info({ feedbackId: fnFeedback.id }, "Analyzing false negative for patterns");

    // Obtener contexto del caso
    const caseContext = await this.getCaseContext(fnFeedback.caseId || fnFeedback.findingId);

    if (!caseContext) {
      logger.warn("No case context available for FN analysis");
      return null;
    }

    // Buscar patterns en los datos
    const potentialPatterns = await this.extractPatterns(caseContext);

    // Validar contra datos históricos
    const validPatterns = [];
    for (const pattern of potentialPatterns) {
      const validation = await this.validatePattern(pattern);
      if (validation.isValid) {
        validPatterns.push({
          ...pattern,
          validation,
        });
      }
    }

    // Registrar patterns descubiertos
    for (const pattern of validPatterns) {
      await this.registerPattern(pattern, fnFeedback);
    }

    return validPatterns;
  }

  /**
   * Extrae patterns potenciales de un contexto
   */
  async extractPatterns(context) {
    const patterns = [];

    // Buscar patterns de umbral
    const thresholdPatterns = this.findThresholdPatterns(context);
    patterns.push(...thresholdPatterns);

    // Buscar patterns de secuencia
    const sequencePatterns = this.findSequencePatterns(context);
    patterns.push(...sequencePatterns);

    // Buscar patterns temporales
    const temporalPatterns = this.findTemporalPatterns(context);
    patterns.push(...temporalPatterns);

    // Buscar combinaciones
    const combinationPatterns = this.findCombinationPatterns(context);
    patterns.push(...combinationPatterns);

    return patterns;
  }

  /**
   * Busca patterns de umbral en métricas
   */
  findThresholdPatterns(context) {
    const patterns = [];
    const { metrics } = context;

    if (!metrics) return patterns;

    // Buscar métricas con valores anómalos
    for (const [metric, value] of Object.entries(metrics)) {
      // Si el valor está fuera de rango normal
      if (this.isAnomaly(metric, value)) {
        patterns.push({
          id: `PTN-THR-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          type: PatternTypes.THRESHOLD,
          name: `${metric}_threshold`,
          description: `${metric} value ${value} indicates potential issue`,
          conditions: [{
            field: metric,
            operator: value > 0 ? "gt" : "lt",
            value: Math.abs(value) * 0.8, // 80% del valor observado
          }],
          confidence: 0.6,
          source: "fn_analysis",
        });
      }
    }

    return patterns;
  }

  /**
   * Busca patterns de secuencia de eventos
   */
  findSequencePatterns(context) {
    const patterns = [];
    const { events } = context;

    if (!events || events.length < 2) return patterns;

    // Buscar secuencias comunes
    const sequences = this.findCommonSequences(events, 2);

    for (const seq of sequences) {
      patterns.push({
        id: `PTN-SEQ-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        type: PatternTypes.SEQUENCE,
        name: `sequence_${seq.events.join("_")}`,
        description: `Sequence of ${seq.events.join(" → ")} detected`,
        conditions: seq.events.map((event, i) => ({
          field: `event_${i}`,
          operator: "eq",
          value: event,
          order: i,
        })),
        timeWindow: seq.timeWindow || "1h",
        confidence: 0.5,
        source: "fn_analysis",
      });
    }

    return patterns;
  }

  /**
   * Busca patterns temporales
   */
  findTemporalPatterns(context) {
    const patterns = [];
    const { timestamp } = context;

    if (!timestamp) return patterns;

    const date = new Date(timestamp);
    const hour = date.getHours();
    const dayOfWeek = date.getDay();

    // Pattern de hora del día
    if (hour >= 11 && hour <= 14) {
      patterns.push({
        id: `PTN-TMP-${Date.now()}-lunch`,
        type: PatternTypes.TEMPORAL,
        name: "lunch_hour_pattern",
        description: "Issue during lunch hours (11am-2pm)",
        conditions: [{
          field: "hour",
          operator: "between",
          value: [11, 14],
        }],
        confidence: 0.4,
        source: "fn_analysis",
      });
    }

    // Pattern de fin de semana
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      patterns.push({
        id: `PTN-TMP-${Date.now()}-weekend`,
        type: PatternTypes.TEMPORAL,
        name: "weekend_pattern",
        description: "Issue during weekend",
        conditions: [{
          field: "dayOfWeek",
          operator: "in",
          value: [0, 6],
        }],
        confidence: 0.4,
        source: "fn_analysis",
      });
    }

    return patterns;
  }

  /**
   * Busca combinaciones de condiciones
   */
  findCombinationPatterns(context) {
    const patterns = [];
    const { metrics, metadata } = context;

    // Buscar combinaciones significativas
    // Ejemplo: alto volumen + hora pico + empleado nuevo
    const conditions = [];

    if (metrics?.volume && metrics.volume > 1.5) {
      conditions.push({
        field: "volume",
        operator: "gt",
        value: 1.5,
      });
    }

    if (metadata?.employee_tenure && metadata.employee_tenure < 30) {
      conditions.push({
        field: "employee_tenure_days",
        operator: "lt",
        value: 30,
      });
    }

    if (conditions.length >= 2) {
      patterns.push({
        id: `PTN-CMB-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
        type: PatternTypes.COMBINATION,
        name: `combo_${conditions.length}_conditions`,
        description: `Combination of ${conditions.length} risk factors`,
        conditions,
        operator: "AND",
        confidence: 0.5,
        source: "fn_analysis",
      });
    }

    return patterns;
  }

  /**
   * Valida un pattern contra datos históricos
   */
  async validatePattern(pattern) {
    // Buscar casos históricos que coincidan con el pattern
    const matches = await this.findHistoricalMatches(pattern);

    // Calcular métricas del pattern
    const truePositives = matches.filter(m => m.wasIssue).length;
    const falsePositives = matches.filter(m => !m.wasIssue).length;
    const total = matches.length;

    if (total === 0) {
      return {
        isValid: false,
        reason: "No historical data to validate",
      };
    }

    const precision = total > 0 ? truePositives / total : 0;
    const minPrecision = 0.5; // Mínimo 50% precisión

    return {
      isValid: precision >= minPrecision,
      precision,
      sampleSize: total,
      truePositives,
      falsePositives,
      reason: precision >= minPrecision 
        ? `Pattern has ${(precision * 100).toFixed(1)}% precision`
        : `Precision ${(precision * 100).toFixed(1)}% below minimum ${minPrecision * 100}%`,
    };
  }

  /**
   * Registra un pattern descubierto
   */
  async registerPattern(pattern, sourceFeedback) {
    const registeredPattern = {
      ...pattern,
      state: PatternStates.DISCOVERED,
      discoveredAt: new Date().toISOString(),
      sourceFeedbackId: sourceFeedback?.id,
      usageCount: 0,
    };

    patternStore.set(pattern.id, registeredPattern);

    logger.info({
      patternId: pattern.id,
      type: pattern.type,
      confidence: pattern.confidence,
    }, "New pattern registered");

    return registeredPattern;
  }

  /**
   * Aprueba un pattern para uso
   */
  async approvePattern(patternId, approvedBy) {
    const pattern = patternStore.get(patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${patternId}`);
    }

    pattern.state = PatternStates.APPROVED;
    pattern.approvedBy = approvedBy;
    pattern.approvedAt = new Date().toISOString();

    logger.info({ patternId, approvedBy }, "Pattern approved");

    return pattern;
  }

  /**
   * Rechaza un pattern
   */
  async rejectPattern(patternId, rejectedBy, reason) {
    const pattern = patternStore.get(patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${patternId}`);
    }

    pattern.state = PatternStates.REJECTED;
    pattern.rejectedBy = rejectedBy;
    pattern.rejectionReason = reason;
    pattern.rejectedAt = new Date().toISOString();

    logger.info({ patternId, rejectedBy, reason }, "Pattern rejected");

    return pattern;
  }

  /**
   * Activa un pattern en un detector
   */
  async activatePattern(patternId, detectorName) {
    const pattern = patternStore.get(patternId);
    if (!pattern) {
      throw new Error(`Pattern not found: ${patternId}`);
    }

    if (pattern.state !== PatternStates.APPROVED) {
      throw new Error(`Pattern must be approved before activation`);
    }

    pattern.state = PatternStates.ACTIVE;
    pattern.activeInDetector = detectorName;
    pattern.activatedAt = new Date().toISOString();

    // TODO: Añadir al detector

    logger.info({ patternId, detectorName }, "Pattern activated");

    return pattern;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  async getCaseContext(caseId) {
    // TODO: Obtener de DB
    return {
      caseId,
      timestamp: new Date().toISOString(),
      metrics: {
        volume: 1.8,
        cancellation_rate: 0.15,
        avg_ticket: 85,
      },
      events: ["login", "multiple_cancellations", "large_refund"],
      metadata: {
        employee_tenure: 15,
        branch: "SUC01",
      },
    };
  }

  async findHistoricalMatches(pattern) {
    // TODO: Buscar en datos históricos
    return [
      { id: "case1", wasIssue: true },
      { id: "case2", wasIssue: true },
      { id: "case3", wasIssue: false },
    ];
  }

  isAnomaly(metric, value) {
    // TODO: Usar estadísticas históricas
    // Por ahora, umbral simple
    return Math.abs(value) > 2; // Más de 2 desviaciones
  }

  findCommonSequences(events, minLength) {
    // Simplificado: retornar la secuencia como está
    if (events.length < minLength) return [];
    return [{
      events: events.slice(0, minLength),
      timeWindow: "1h",
    }];
  }

  /**
   * Obtiene patterns por estado
   */
  getPatternsByState(state) {
    return Array.from(patternStore.values())
      .filter(p => p.state === state);
  }

  /**
   * Obtiene todos los patterns
   */
  getAllPatterns() {
    return Array.from(patternStore.values());
  }

  /**
   * Obtiene un pattern por ID
   */
  getPattern(patternId) {
    return patternStore.get(patternId);
  }

  /**
   * Obtiene resumen de patterns
   */
  getSummary() {
    const all = this.getAllPatterns();

    const byState = {};
    const byType = {};

    for (const p of all) {
      byState[p.state] = (byState[p.state] || 0) + 1;
      byType[p.type] = (byType[p.type] || 0) + 1;
    }

    return {
      total: all.length,
      byState,
      byType,
      pendingReview: all.filter(p => p.state === PatternStates.DISCOVERED).length,
    };
  }
}

export const patternLearner = new PatternLearner();

export default PatternLearner;
