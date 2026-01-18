/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FORENSE AGENT - Orquesta Autopsias de Días Malos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El Forense investiga por qué cayeron las ventas:
 * 
 * 1. detectAnomaly()     → Encuentra la caída (ForenseDetector)
 * 2. runAutopsy()        → Investiga todas las dimensiones
 * 3. checkDimensions()   → Traffic, ticket, mix, descuentos, etc.
 * 4. correlateSignals()  → Cruza con KISS, staff, factores externos
 * 5. generateHypotheses() → Ranking de causas probables
 * 6. findSimilarCases()  → Busca en memoria si pasó antes
 * 
 * Flujo: DETECT → AUTOPSY → DIAGNOSE → RECOMMEND → LEARN
 */

import { logger, query } from "@tagers/shared";
import { ForenseDetector } from "../detectors/sales/ForenseDetector.js";
import { memoryService, MemoryTypes } from "../memory/MemoryService.js";
import caseService from "../services/caseService.js";
import { getBranchName } from "../config/lucaConfig.js";

/**
 * Checklist de dimensiones para la autopsia
 */
const AUTOPSY_DIMENSIONS = {
  TRAFFIC: {
    id: "traffic",
    question: "¿Llegaron menos clientes?",
    metric: "order_count",
    threshold: -10, // % de caída para ser significativo
    weight: 0.25,
  },
  TICKET: {
    id: "ticket",
    question: "¿Gastaron menos por visita?",
    metric: "avg_ticket",
    threshold: -8,
    weight: 0.20,
  },
  CHANNEL_MIX: {
    id: "channel_mix",
    question: "¿Cambió el mix de canales?",
    metric: "channel_distribution",
    threshold: 15, // % de cambio absoluto
    weight: 0.10,
  },
  DISCOUNTS: {
    id: "discounts",
    question: "¿Hubo más descuentos de lo normal?",
    metric: "discount_pct",
    threshold: 5, // % de incremento
    weight: 0.15,
  },
  REFUNDS: {
    id: "refunds",
    question: "¿Hubo más devoluciones?",
    metric: "refund_pct",
    threshold: 3,
    weight: 0.10,
  },
  STAFFING: {
    id: "staffing",
    question: "¿Faltó personal?",
    metric: "staff_vs_expected",
    threshold: -15,
    weight: 0.15,
  },
  EXTERNAL: {
    id: "external",
    question: "¿Hubo factor externo (clima, evento, competencia)?",
    metric: "external_events",
    threshold: null, // Cualitativo
    weight: 0.05,
  },
};

/**
 * Plantillas de hipótesis
 */
const HYPOTHESIS_TEMPLATES = {
  TRAFFIC_DROP_EXTERNAL: {
    id: "traffic_drop_external",
    title: "Caída de tráfico por factor externo",
    description: "Menos clientes llegaron debido a condiciones externas (clima, evento en la zona, etc.)",
    baseConfidence: 0.6,
    requiredSignals: ["traffic_drop", "external_factor"],
  },
  TRAFFIC_DROP_OPERATIONS: {
    id: "traffic_drop_operations", 
    title: "Caída de tráfico por problemas operativos",
    description: "Menos clientes llegaron posiblemente por servicio lento, faltantes o mala experiencia previa",
    baseConfidence: 0.5,
    requiredSignals: ["traffic_drop", "staffing_issue"],
  },
  TICKET_DROP_MIX: {
    id: "ticket_drop_mix",
    title: "Caída de ticket por cambio en mix de productos",
    description: "Los clientes compraron productos de menor valor en promedio",
    baseConfidence: 0.5,
    requiredSignals: ["ticket_drop"],
  },
  EXCESSIVE_DISCOUNTS: {
    id: "excessive_discounts",
    title: "Impacto negativo por exceso de descuentos",
    description: "Se dieron más descuentos de lo normal, afectando el revenue neto",
    baseConfidence: 0.7,
    requiredSignals: ["discount_spike"],
  },
  STAFFING_IMPACT: {
    id: "staffing_impact",
    title: "Impacto por falta de personal",
    description: "La falta de personal afectó la capacidad de atención y ventas",
    baseConfidence: 0.65,
    requiredSignals: ["staffing_issue"],
  },
  COMBINED_FACTORS: {
    id: "combined_factors",
    title: "Múltiples factores combinados",
    description: "La caída se debe a una combinación de factores",
    baseConfidence: 0.4,
    requiredSignals: [],
  },
};

export class ForenseAgent {
  constructor() {
    this.detector = new ForenseDetector();
  }

  /**
   * Ejecuta el flujo completo del Forense
   */
  async run(context = {}) {
    const runId = `forense_agent_${Date.now()}`;
    logger.info({ runId, context }, "ForenseAgent starting");

    const results = {
      runId,
      startedAt: new Date().toISOString(),
      phases: {},
      cases_created: [],
      alerts_created: [],
    };

    try {
      // Fase 1: DETECT
      results.phases.detect = await this.detect(context);
      
      if (results.phases.detect.findings.length === 0) {
        results.status = "no_anomalies";
        results.completedAt = new Date().toISOString();
        logger.info({ runId }, "No anomalies detected");
        return results;
      }

      // Fase 2-5 para cada hallazgo
      for (const finding of results.phases.detect.findings) {
        // Fase 2: AUTOPSY
        const autopsy = await this.runAutopsy(finding);
        
        // Fase 3: DIAGNOSE
        const diagnosis = await this.diagnose(finding, autopsy);
        
        // Fase 4: FIND SIMILAR
        const similarCases = await this.findSimilarCases(finding, autopsy);
        
        // Fase 5: RECOMMEND
        const recommendations = await this.recommend(finding, autopsy, diagnosis, similarCases);
        
        // Crear caso si es suficientemente severo
        if (finding.severity === "CRITICAL" || finding.severity === "HIGH") {
          const caseResult = await this.createCase(finding, autopsy, diagnosis, recommendations);
          results.cases_created.push(caseResult);
        }

        // Almacenar autopsia en memoria para futuras referencias
        await this.storeAutopsyInMemory(finding, autopsy, diagnosis);

        // Agregar resultados
        if (!results.phases.autopsies) results.phases.autopsies = [];
        results.phases.autopsies.push({
          branch_id: finding.branch_id,
          date: finding.date,
          autopsy,
          diagnosis,
          similarCases,
          recommendations,
        });
      }

      results.status = "completed";
      results.completedAt = new Date().toISOString();

      logger.info({
        runId,
        findingsCount: results.phases.detect.findings.length,
        casesCreated: results.cases_created.length,
      }, "ForenseAgent completed");

      return results;

    } catch (err) {
      logger.error({ runId, err: err?.message }, "ForenseAgent failed");
      results.status = "error";
      results.error = err?.message;
      return results;
    }
  }

  /**
   * Fase 1: Detectar anomalías
   */
  async detect(context) {
    logger.info("Phase 1: DETECT");
    return this.detector.execute(context);
  }

  /**
   * Fase 2: Ejecutar autopsia completa
   */
  async runAutopsy(finding) {
    logger.info({ branch: finding.branch_id, date: finding.date }, "Phase 2: AUTOPSY");

    const autopsy = {
      finding_id: finding.finding_id,
      branch_id: finding.branch_id,
      date: finding.date,
      dimensions: {},
      signals: [],
      executedAt: new Date().toISOString(),
    };

    // Revisar cada dimensión
    for (const [key, dimension] of Object.entries(AUTOPSY_DIMENSIONS)) {
      const result = await this.checkDimension(dimension, finding);
      autopsy.dimensions[dimension.id] = result;

      if (result.isSignificant) {
        autopsy.signals.push({
          dimension: dimension.id,
          question: dimension.question,
          value: result.value,
          change: result.change,
          significance: result.significance,
        });
      }
    }

    // Correlacionar señales
    autopsy.correlations = await this.correlateSignals(autopsy.signals, finding);

    return autopsy;
  }

  /**
   * Revisa una dimensión específica
   */
  async checkDimension(dimension, finding) {
    const result = {
      dimension: dimension.id,
      question: dimension.question,
      value: null,
      baseline: null,
      change: null,
      isSignificant: false,
      significance: 0,
      details: null,
    };

    try {
      switch (dimension.id) {
        case "traffic":
          result.value = finding.metrics?.order_count;
          result.change = finding.comparisons?.traffic_change;
          break;

        case "ticket":
          result.value = finding.metrics?.avg_ticket;
          result.change = finding.comparisons?.ticket_change;
          break;

        case "discounts":
          result.value = await this.getDiscountRate(finding.branch_id, finding.date);
          result.baseline = await this.getBaselineDiscountRate(finding.branch_id);
          result.change = result.baseline ? ((result.value - result.baseline) / result.baseline) * 100 : null;
          break;

        case "refunds":
          result.value = await this.getRefundRate(finding.branch_id, finding.date);
          result.baseline = await this.getBaselineRefundRate(finding.branch_id);
          result.change = result.baseline ? ((result.value - result.baseline) / result.baseline) * 100 : null;
          break;

        case "staffing":
          const staffing = await this.getStaffingData(finding.branch_id, finding.date);
          result.value = staffing?.actual;
          result.baseline = staffing?.expected;
          result.change = staffing?.variance;
          break;

        case "external":
          const external = await this.checkExternalFactors(finding.branch_id, finding.date);
          result.value = external.factors;
          result.isSignificant = external.factors.length > 0;
          result.details = external;
          break;

        case "channel_mix":
          // TODO: Implementar cuando tengamos datos de canales
          result.value = null;
          break;
      }

      // Determinar si es significativo
      if (dimension.threshold !== null && result.change !== null) {
        if (dimension.threshold < 0) {
          result.isSignificant = result.change <= dimension.threshold;
        } else {
          result.isSignificant = Math.abs(result.change) >= dimension.threshold;
        }
        result.significance = Math.abs(result.change) / Math.abs(dimension.threshold);
      }

    } catch (err) {
      logger.warn({ dimension: dimension.id, err: err?.message }, "Failed to check dimension");
    }

    return result;
  }

  /**
   * Correlaciona señales encontradas
   */
  async correlateSignals(signals, finding) {
    const correlations = [];

    // Buscar patrones conocidos
    const hasTrafficDrop = signals.some(s => s.dimension === "traffic");
    const hasTicketDrop = signals.some(s => s.dimension === "ticket");
    const hasDiscountSpike = signals.some(s => s.dimension === "discounts");
    const hasStaffingIssue = signals.some(s => s.dimension === "staffing");
    const hasExternalFactor = signals.some(s => s.dimension === "external");

    if (hasTrafficDrop && hasStaffingIssue) {
      correlations.push({
        pattern: "staffing_traffic",
        description: "Falta de personal correlacionada con menor tráfico",
        strength: 0.7,
      });
    }

    if (hasTicketDrop && hasDiscountSpike) {
      correlations.push({
        pattern: "discount_ticket",
        description: "Descuentos excesivos correlacionados con menor ticket",
        strength: 0.8,
      });
    }

    if (hasTrafficDrop && hasExternalFactor) {
      correlations.push({
        pattern: "external_traffic",
        description: "Factor externo correlacionado con caída de tráfico",
        strength: 0.75,
      });
    }

    return correlations;
  }

  /**
   * Fase 3: Generar diagnóstico con hipótesis
   */
  async diagnose(finding, autopsy) {
    logger.info({ branch: finding.branch_id }, "Phase 3: DIAGNOSE");

    const hypotheses = [];
    const signals = new Set(autopsy.signals.map(s => {
      if (s.dimension === "traffic") return "traffic_drop";
      if (s.dimension === "ticket") return "ticket_drop";
      if (s.dimension === "discounts") return "discount_spike";
      if (s.dimension === "staffing") return "staffing_issue";
      if (s.dimension === "external") return "external_factor";
      return s.dimension;
    }));

    // Evaluar cada template de hipótesis
    for (const [key, template] of Object.entries(HYPOTHESIS_TEMPLATES)) {
      const matchingSignals = template.requiredSignals.filter(s => signals.has(s));
      
      if (matchingSignals.length === template.requiredSignals.length || 
          (template.requiredSignals.length === 0 && signals.size >= 2)) {
        
        // Calcular confidence ajustado
        let confidence = template.baseConfidence;
        
        // Más señales matching = más confianza
        if (template.requiredSignals.length > 0) {
          confidence += (matchingSignals.length / template.requiredSignals.length) * 0.2;
        }
        
        // Ajustar por severidad del finding
        if (finding.severity === "CRITICAL") confidence += 0.1;
        if (finding.severity === "HIGH") confidence += 0.05;
        
        // Ajustar por correlaciones encontradas
        const relatedCorrelations = autopsy.correlations.filter(c => 
          template.requiredSignals.some(s => c.pattern.includes(s.split("_")[0]))
        );
        confidence += relatedCorrelations.length * 0.05;
        
        hypotheses.push({
          ...template,
          confidence: Math.min(confidence, 0.95),
          matchingSignals,
          supportingEvidence: autopsy.signals.filter(s => 
            matchingSignals.includes(`${s.dimension}_drop`) || 
            matchingSignals.includes(`${s.dimension}_spike`) ||
            matchingSignals.includes(`${s.dimension}_issue`) ||
            matchingSignals.includes(`${s.dimension}_factor`)
          ),
        });
      }
    }

    // Ordenar por confidence
    hypotheses.sort((a, b) => b.confidence - a.confidence);

    // Seleccionar hipótesis principal
    const primaryHypothesis = hypotheses[0] || {
      id: "unknown",
      title: "Causa no determinada",
      description: "No se encontraron señales claras que expliquen la caída",
      confidence: 0.3,
    };

    return {
      primaryHypothesis,
      alternativeHypotheses: hypotheses.slice(1, 3),
      allHypotheses: hypotheses,
      signalsAnalyzed: autopsy.signals.length,
      correlationsFound: autopsy.correlations.length,
      diagnosedAt: new Date().toISOString(),
    };
  }

  /**
   * Fase 4: Buscar casos similares en memoria
   */
  async findSimilarCases(finding, autopsy) {
    logger.info({ branch: finding.branch_id }, "Phase 4: FIND SIMILAR CASES");

    try {
      // Buscar autopsias similares
      const characteristics = {
        traffic_drop: autopsy.signals.some(s => s.dimension === "traffic"),
        ticket_drop: autopsy.signals.some(s => s.dimension === "ticket"),
        discount_spike: autopsy.signals.some(s => s.dimension === "discounts"),
        staffing_issue: autopsy.signals.some(s => s.dimension === "staffing"),
        external_factor: autopsy.signals.some(s => s.dimension === "external"),
      };

      const similar = await memoryService.findSimilarAutopsies(characteristics, {
        branchId: finding.branch_id,
        limit: 3,
      });

      return {
        found: similar.length,
        cases: similar.map(c => ({
          memoryId: c.memoryId,
          similarity: c.similarity,
          content: c.content,
          metadata: c.metadata,
          date: c.metadata?.date,
          resolution: c.metadata?.resolution,
        })),
        hasHistoricalContext: similar.length > 0,
      };

    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to find similar cases");
      return { found: 0, cases: [], hasHistoricalContext: false };
    }
  }

  /**
   * Fase 5: Generar recomendaciones
   */
  async recommend(finding, autopsy, diagnosis, similarCases) {
    logger.info({ branch: finding.branch_id }, "Phase 5: RECOMMEND");

    const recommendations = [];
    const branchName = await getBranchName(finding.branch_id);

    // Recomendaciones basadas en la hipótesis principal
    switch (diagnosis.primaryHypothesis.id) {
      case "traffic_drop_external":
        recommendations.push({
          action: "INVESTIGATE_EXTERNAL",
          title: "Investigar factor externo",
          description: `Verificar si hubo eventos, clima adverso o situaciones en la zona de ${branchName}`,
          priority: "MEDIUM",
          type: "INVESTIGATION",
        });
        break;

      case "traffic_drop_operations":
        recommendations.push({
          action: "REVIEW_OPERATIONS",
          title: "Revisar operaciones",
          description: "Analizar tiempos de servicio, disponibilidad de productos y experiencia del cliente",
          priority: "HIGH",
          type: "OPERATIONS",
        });
        break;

      case "excessive_discounts":
        recommendations.push({
          action: "AUDIT_DISCOUNTS",
          title: "Auditar descuentos",
          description: "Revisar descuentos aplicados, verificar autorizaciones y detectar posibles anomalías",
          priority: "HIGH",
          type: "AUDIT",
        });
        break;

      case "staffing_impact":
        recommendations.push({
          action: "REVIEW_STAFFING",
          title: "Revisar programación de personal",
          description: "Verificar faltas, analizar carga de trabajo y ajustar programación",
          priority: "HIGH",
          type: "HR",
        });
        break;
    }

    // Recomendación general siempre presente
    recommendations.push({
      action: "FOLLOW_UP",
      title: "Dar seguimiento",
      description: `Monitorear ventas de ${branchName} los próximos días para confirmar si fue incidente aislado`,
      priority: "MEDIUM",
      type: "MONITORING",
    });

    // Si hay casos similares con resolución, aprender de ellos
    if (similarCases.cases?.length > 0) {
      const resolved = similarCases.cases.find(c => c.resolution);
      if (resolved) {
        recommendations.push({
          action: "APPLY_HISTORICAL_LEARNING",
          title: "Aplicar aprendizaje histórico",
          description: `Caso similar resuelto anteriormente: ${resolved.resolution}`,
          priority: "MEDIUM",
          type: "LEARNING",
          reference: resolved.memoryId,
        });
      }
    }

    return {
      recommendations,
      basedOn: diagnosis.primaryHypothesis.title,
      confidence: diagnosis.primaryHypothesis.confidence,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Crear caso a partir de los hallazgos
   */
  async createCase(finding, autopsy, diagnosis, recommendations) {
    const branchName = await getBranchName(finding.branch_id);

    const caso = {
      title: `Autopsia: Caída de ventas en ${branchName} (${finding.date})`,
      description: `${diagnosis.primaryHypothesis.description}\n\nSeñales detectadas: ${autopsy.signals.map(s => s.question).join(", ")}`,
      case_type: "AUTOPSY",
      severity: finding.severity,
      scope: {
        branch_id: finding.branch_id,
        date: finding.date,
      },
      source: {
        detector: "forense",
        finding_id: finding.finding_id,
      },
    };

    try {
      const created = await caseService.createCase(caso);
      
      // Agregar evidencia
      await caseService.addEvidence(created.case_id, {
        type: "AUTOPSY_REPORT",
        content: JSON.stringify({ autopsy, diagnosis }, null, 2),
        source: "forense_agent",
      });

      // Agregar hipótesis
      await caseService.addHypothesis(created.case_id, {
        title: diagnosis.primaryHypothesis.title,
        description: diagnosis.primaryHypothesis.description,
        confidence: diagnosis.primaryHypothesis.confidence,
        supporting_evidence: diagnosis.primaryHypothesis.supportingEvidence,
      });

      // Agregar acciones recomendadas
      for (const rec of recommendations.recommendations) {
        await caseService.recommendAction(created.case_id, {
          title: rec.title,
          description: rec.description,
          action_type: rec.type,
          priority: rec.priority,
        });
      }

      return {
        case_id: created.case_id,
        status: "created",
      };

    } catch (err) {
      logger.error({ err: err?.message }, "Failed to create case");
      return { status: "error", error: err?.message };
    }
  }

  /**
   * Almacena autopsia en memoria para futuras referencias
   */
  async storeAutopsyInMemory(finding, autopsy, diagnosis) {
    const content = [
      `Autopsia de caída de ventas en ${finding.branch_id}`,
      `Fecha: ${finding.date}`,
      `Severidad: ${finding.severity}`,
      `Señales: ${autopsy.signals.map(s => s.question).join(", ")}`,
      `Diagnóstico: ${diagnosis.primaryHypothesis.title}`,
      `Descripción: ${diagnosis.primaryHypothesis.description}`,
    ].join(". ");

    await memoryService.store({
      type: MemoryTypes.AUTOPSY,
      content,
      metadata: {
        date: finding.date,
        branch_id: finding.branch_id,
        severity: finding.severity,
        signals: autopsy.signals.map(s => s.dimension),
        hypothesis: diagnosis.primaryHypothesis.id,
        confidence: diagnosis.primaryHypothesis.confidence,
      },
      sourceId: finding.finding_id,
      sourceType: "forense_detector",
      branchId: finding.branch_id,
    });

    logger.info({ findingId: finding.finding_id }, "Autopsy stored in memory");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS PARA OBTENER DATOS
  // ═══════════════════════════════════════════════════════════════════════════

  async getDiscountRate(branchId, date) {
    try {
      const result = await query(`
        SELECT 
          SUM(discount_amount) / NULLIF(SUM(total + discount_amount), 0) * 100 as discount_rate
        FROM transactions
        WHERE branch_id = $1 AND DATE(created_at) = $2
      `, [branchId, date]);
      return parseFloat(result.rows[0]?.discount_rate) || 0;
    } catch {
      return Math.random() * 10; // Mock
    }
  }

  async getBaselineDiscountRate(branchId) {
    try {
      const result = await query(`
        SELECT AVG(daily_rate) as avg_rate FROM (
          SELECT DATE(created_at), 
                 SUM(discount_amount) / NULLIF(SUM(total + discount_amount), 0) * 100 as daily_rate
          FROM transactions
          WHERE branch_id = $1 AND created_at >= NOW() - INTERVAL '30 days'
          GROUP BY DATE(created_at)
        ) daily
      `, [branchId]);
      return parseFloat(result.rows[0]?.avg_rate) || 5;
    } catch {
      return 5; // Mock
    }
  }

  async getRefundRate(branchId, date) {
    return Math.random() * 3; // Mock
  }

  async getBaselineRefundRate(branchId) {
    return 1.5; // Mock
  }

  async getStaffingData(branchId, date) {
    // Mock - en producción vendría de BUK
    return {
      actual: 4,
      expected: 5,
      variance: -20,
    };
  }

  async checkExternalFactors(branchId, date) {
    // Mock - en producción integraría con APIs de clima, eventos, etc.
    const factors = [];
    
    // Simular factor externo ocasional
    if (Math.random() > 0.7) {
      factors.push({
        type: "weather",
        description: "Lluvia intensa reportada en la zona",
      });
    }

    return { factors };
  }
}

export default ForenseAgent;
