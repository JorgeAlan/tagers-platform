/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA FISCALÍA AGENT - Orquestador de Detección de Fraude
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * "El fiscal del pueblo que nunca duerme."
 * 
 * Este agente orquesta el flujo completo de detección de fraude:
 * 
 * 1. detect()      → Ejecuta patterns de fraude
 * 2. investigate() → Profundiza en findings
 * 3. diagnose()    → Genera hipótesis y diagnóstico
 * 4. recommend()   → Propone acciones específicas
 * 5. generateExpediente() → Crea PDF con toda la evidencia
 * 
 * Cada paso agrega valor y contexto al anterior.
 */

import { logger, query } from "@tagers/shared";
import { FiscaliaDetector } from "../detectors/fraud/FiscaliaDetector.js";
import FraudInvestigator from "../detectors/fraud/investigator/FraudInvestigator.js";
import EvidenceCollector from "../detectors/fraud/investigator/EvidenceCollector.js";
import { createCase, addEvidence, addHypothesis, diagnose, recommendAction } from "../services/caseService.js";
import { createAlert } from "../services/alertService.js";

export class FiscaliaAgent {
  constructor(config = {}) {
    this.name = "La Fiscalía";
    this.detector = new FiscaliaDetector(config);
    this.investigator = FraudInvestigator;
    this.evidenceCollector = EvidenceCollector;
    
    // Config
    this.autoInvestigate = config.autoInvestigate !== false;
    this.autoCreateCase = config.autoCreateCase !== false;
    this.minSeverityForCase = config.minSeverityForCase || "HIGH";
  }

  /**
   * Ejecuta el flujo completo
   */
  async run(scope = {}) {
    logger.info({ scope }, "🔍 La Fiscalía iniciando investigación");
    
    const result = {
      agent: this.name,
      started_at: new Date().toISOString(),
      scope,
      phases: {},
      cases_created: [],
      alerts_created: [],
      errors: [],
    };
    
    try {
      // 1. DETECT - Buscar patrones de fraude
      result.phases.detect = await this.detect(scope);
      
      if (result.phases.detect.findings.length === 0) {
        logger.info("No fraud patterns detected");
        result.completed_at = new Date().toISOString();
        result.status = "completed_no_findings";
        return result;
      }
      
      // 2. INVESTIGATE - Profundizar en cada finding
      if (this.autoInvestigate) {
        result.phases.investigate = await this.investigateAll(result.phases.detect.findings);
      }
      
      // 3. DIAGNOSE - Generar diagnósticos
      result.phases.diagnose = await this.diagnoseAll(
        result.phases.detect.findings,
        result.phases.investigate?.investigations || []
      );
      
      // 4. RECOMMEND - Proponer acciones
      result.phases.recommend = await this.recommendAll(
        result.phases.diagnose.diagnoses
      );
      
      // 5. CREATE CASES/ALERTS
      if (this.autoCreateCase) {
        const { cases, alerts } = await this.createCasesAndAlerts(
          result.phases.diagnose.diagnoses,
          result.phases.recommend.recommendations
        );
        result.cases_created = cases;
        result.alerts_created = alerts;
      }
      
      result.completed_at = new Date().toISOString();
      result.status = "completed";
      
      logger.info({
        findings: result.phases.detect.findings.length,
        casesCreated: result.cases_created.length,
        alertsCreated: result.alerts_created.length,
      }, "✅ La Fiscalía completó investigación");
      
    } catch (err) {
      logger.error({ error: err?.message }, "La Fiscalía failed");
      result.status = "failed";
      result.errors.push(err?.message);
    }
    
    return result;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 1: DETECT
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Ejecuta detección de patrones de fraude
   */
  async detect(scope = {}) {
    logger.info("Phase 1: Detection");
    
    const startTime = Date.now();
    const result = await this.detector.execute(scope);
    
    return {
      duration_ms: Date.now() - startTime,
      run_id: result.runId,
      findings: result.findings,
      findings_count: result.findings.length,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 2: INVESTIGATE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Investiga todos los findings
   */
  async investigateAll(findings) {
    logger.info({ count: findings.length }, "Phase 2: Investigation");
    
    const investigations = [];
    
    for (const finding of findings) {
      // Determinar profundidad basada en severidad
      const depth = this.getInvestigationDepth(finding.severity);
      
      const investigation = await this.investigator.investigate(finding, depth);
      investigations.push({
        finding_id: finding.finding_id,
        employee_id: finding.employee_id,
        investigation,
      });
    }
    
    return {
      investigations_count: investigations.length,
      investigations,
    };
  }

  /**
   * Determina profundidad de investigación según severidad
   */
  getInvestigationDepth(severity) {
    switch (severity) {
      case "CRITICAL": return "DEEP";
      case "HIGH": return "MEDIUM";
      default: return "LIGHT";
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 3: DIAGNOSE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Genera diagnósticos para todos los findings
   */
  async diagnoseAll(findings, investigations) {
    logger.info({ count: findings.length }, "Phase 3: Diagnosis");
    
    const diagnoses = [];
    
    for (const finding of findings) {
      const investigation = investigations.find(i => i.finding_id === finding.finding_id);
      
      const diagnosis = await this.generateDiagnosis(finding, investigation?.investigation);
      diagnoses.push(diagnosis);
    }
    
    return {
      diagnoses_count: diagnoses.length,
      diagnoses,
    };
  }

  /**
   * Genera diagnóstico para un finding
   */
  async generateDiagnosis(finding, investigation) {
    // Recolectar evidencia
    const evidence = await this.evidenceCollector.collect(finding, investigation);
    
    // Seleccionar hipótesis principal
    const hypotheses = investigation?.hypotheses || [];
    const primaryHypothesis = hypotheses[0] || {
      hypothesis: "Posible fraude",
      confidence: finding.confidence,
      description: finding.description,
    };
    
    // Ajustar confianza final
    const confidenceAdjustment = investigation?.confidence_adjustment || 0;
    const finalConfidence = Math.min(1, finding.confidence + confidenceAdjustment);
    
    return {
      finding_id: finding.finding_id,
      employee_id: finding.employee_id,
      branch_id: finding.branch_id,
      
      // Diagnóstico
      diagnosis: {
        conclusion: primaryHypothesis.hypothesis,
        confidence: finalConfidence,
        severity: this.adjustSeverity(finding.severity, confidenceAdjustment),
        description: primaryHypothesis.description,
      },
      
      // Hipótesis ordenadas
      hypotheses: hypotheses.map((h, i) => ({
        rank: i + 1,
        ...h,
      })),
      
      // Evidencia
      evidence,
      
      // Risk score final
      risk_score: Math.round(finalConfidence * 100),
    };
  }

  /**
   * Ajusta severidad basada en investigación
   */
  adjustSeverity(currentSeverity, adjustment) {
    const severities = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const currentIndex = severities.indexOf(currentSeverity);
    
    if (adjustment > 0.05 && currentIndex < severities.length - 1) {
      return severities[currentIndex + 1];
    }
    if (adjustment < -0.05 && currentIndex > 0) {
      return severities[currentIndex - 1];
    }
    
    return currentSeverity;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 4: RECOMMEND
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Genera recomendaciones para todos los diagnósticos
   */
  async recommendAll(diagnoses) {
    logger.info({ count: diagnoses.length }, "Phase 4: Recommendations");
    
    const recommendations = [];
    
    for (const diagnosis of diagnoses) {
      const recs = this.generateRecommendations(diagnosis);
      recommendations.push({
        finding_id: diagnosis.finding_id,
        employee_id: diagnosis.employee_id,
        recommendations: recs,
      });
    }
    
    return {
      recommendations_count: recommendations.length,
      recommendations,
    };
  }

  /**
   * Genera recomendaciones específicas
   */
  generateRecommendations(diagnosis) {
    const recommendations = [];
    const severity = diagnosis.diagnosis.severity;
    const riskScore = diagnosis.risk_score;
    
    // Recomendación 1: Investigación inmediata (siempre para HIGH/CRITICAL)
    if (severity === "CRITICAL" || severity === "HIGH") {
      recommendations.push({
        type: "IMMEDIATE_INVESTIGATION",
        title: "Investigación inmediata requerida",
        description: `Iniciar investigación formal del empleado ${diagnosis.employee_id}`,
        priority: "HIGH",
        approval_level: severity === "CRITICAL" ? "CRITICAL" : "APPROVAL",
        params: {
          employee_id: diagnosis.employee_id,
          branch_id: diagnosis.branch_id,
        },
      });
    }
    
    // Recomendación 2: Revisión de cámaras
    recommendations.push({
      type: "VIDEO_REVIEW",
      title: "Revisar grabaciones de seguridad",
      description: "Solicitar y revisar videos de las fechas con transacciones sospechosas",
      priority: severity === "CRITICAL" ? "HIGH" : "MEDIUM",
      approval_level: "APPROVAL",
      params: {
        dates: diagnosis.evidence?.timeline?.date_range,
        branch_id: diagnosis.branch_id,
      },
    });
    
    // Recomendación 3: Notificar a gerente
    recommendations.push({
      type: "NOTIFY_MANAGER",
      title: "Notificar al gerente de sucursal",
      description: `Informar al gerente de ${diagnosis.branch_id} sobre la situación`,
      priority: "MEDIUM",
      approval_level: "AUTO",
      params: {
        branch_id: diagnosis.branch_id,
        message_template: "fraud_alert",
      },
    });
    
    // Recomendación 4: Generar expediente
    recommendations.push({
      type: "GENERATE_EXPEDIENTE",
      title: "Generar expediente de fraude",
      description: "Compilar toda la evidencia en un expediente PDF formal",
      priority: "HIGH",
      approval_level: "AUTO",
      params: {
        finding_id: diagnosis.finding_id,
        include_transactions: true,
        include_statistics: true,
      },
    });
    
    // Recomendación 5: Acción disciplinaria (solo CRITICAL)
    if (severity === "CRITICAL" && riskScore >= 85) {
      recommendations.push({
        type: "DISCIPLINARY_ACTION",
        title: "Considerar acción disciplinaria",
        description: "Evaluar suspensión temporal mientras se completa la investigación",
        priority: "HIGH",
        approval_level: "CRITICAL", // Requiere aprobación del owner
        params: {
          employee_id: diagnosis.employee_id,
          suggested_action: "suspension",
          reason: diagnosis.diagnosis.conclusion,
        },
      });
    }
    
    // Recomendación 6: Capacitación (para casos menos severos)
    if (severity === "LOW" || severity === "MEDIUM") {
      recommendations.push({
        type: "SCHEDULE_TRAINING",
        title: "Programar re-capacitación",
        description: "Agendar capacitación sobre políticas de descuento",
        priority: "LOW",
        approval_level: "AUTO",
        params: {
          employee_id: diagnosis.employee_id,
          training_type: "discount_policies",
        },
      });
    }
    
    return recommendations;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PHASE 5: CREATE CASES & ALERTS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Crea casos y alertas basados en diagnósticos
   */
  async createCasesAndAlerts(diagnoses, recommendations) {
    const cases = [];
    const alerts = [];
    
    for (let i = 0; i < diagnoses.length; i++) {
      const diagnosis = diagnoses[i];
      const recs = recommendations[i]?.recommendations || [];
      
      const shouldCreateCase = this.shouldCreateCase(diagnosis);
      
      if (shouldCreateCase) {
        try {
          const newCase = await this.createFraudCase(diagnosis, recs);
          cases.push(newCase);
        } catch (err) {
          logger.error({
            findingId: diagnosis.finding_id,
            error: err?.message,
          }, "Failed to create fraud case");
        }
      } else {
        // Crear alert en lugar de case
        try {
          const alert = await this.createFraudAlert(diagnosis);
          alerts.push(alert);
        } catch (err) {
          logger.error({
            findingId: diagnosis.finding_id,
            error: err?.message,
          }, "Failed to create fraud alert");
        }
      }
    }
    
    return { cases, alerts };
  }

  /**
   * Determina si debe crear caso o solo alerta
   */
  shouldCreateCase(diagnosis) {
    const severityOrder = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
    const diagnosisIndex = severityOrder.indexOf(diagnosis.diagnosis.severity);
    const minIndex = severityOrder.indexOf(this.minSeverityForCase);
    
    return diagnosisIndex >= minIndex;
  }

  /**
   * Crea un caso de fraude
   */
  async createFraudCase(diagnosis, recommendations) {
    // Crear el caso
    const newCase = await createCase({
      caseType: "FRAUD",
      severity: diagnosis.diagnosis.severity,
      title: `Posible fraude: ${diagnosis.diagnosis.conclusion} - ${diagnosis.employee_id}`,
      description: diagnosis.diagnosis.description,
      scope: {
        branch_id: diagnosis.branch_id,
        employee_id: diagnosis.employee_id,
      },
      source: "detector",
      detectorId: "fiscalia_fraud_v1",
      createdBy: this.name,
    });
    
    // Agregar evidencia
    await addEvidence(newCase.case_id, {
      type: "fraud_analysis",
      finding_id: diagnosis.finding_id,
      data: diagnosis.evidence,
      added_by: this.name,
    });
    
    // Agregar hipótesis
    for (const h of diagnosis.hypotheses) {
      await addHypothesis(newCase.case_id, {
        hypothesis: h.hypothesis,
        confidence: h.confidence,
        supporting_evidence: h.supporting_evidence || [],
        proposed_by: this.name,
      });
    }
    
    // Agregar recomendaciones como acciones
    for (const rec of recommendations) {
      await recommendAction(newCase.case_id, {
        actionType: rec.type,
        title: rec.title,
        description: rec.description,
        severity: rec.priority,
        approvalLevel: rec.approval_level,
        params: rec.params,
        expectedImpact: {
          type: "risk_reduction",
          description: "Reducir riesgo de pérdida por fraude",
        },
        createdBy: this.name,
      });
    }
    
    logger.info({
      caseId: newCase.case_id,
      employeeId: diagnosis.employee_id,
      severity: diagnosis.diagnosis.severity,
    }, "Fraud case created");
    
    return newCase;
  }

  /**
   * Crea una alerta de fraude (para casos menos severos)
   */
  async createFraudAlert(diagnosis) {
    const alert = await createAlert({
      alertType: "FRAUD_POTENTIAL",
      severity: diagnosis.diagnosis.severity,
      title: `Posible fraude: ${diagnosis.employee_id}`,
      message: diagnosis.diagnosis.description,
      branchId: diagnosis.branch_id,
      fingerprint: `fraud-${diagnosis.employee_id}-${diagnosis.finding_id}`,
      source: "detector",
      detectorId: "fiscalia_fraud_v1",
      metadata: {
        employee_id: diagnosis.employee_id,
        risk_score: diagnosis.risk_score,
        patterns: diagnosis.evidence?.patterns,
      },
    });
    
    logger.info({
      alertId: alert.alert_id,
      employeeId: diagnosis.employee_id,
    }, "Fraud alert created");
    
    return alert;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPEDIENTE GENERATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Genera expediente PDF de un caso de fraude
   */
  async generateExpediente(caseId) {
    logger.info({ caseId }, "Generating fraud expediente");
    
    // En producción, esto usaría un servicio de PDF (puppeteer, pdfkit, etc.)
    // Por ahora retornamos la estructura del expediente
    
    try {
      // Cargar datos del caso
      const caseData = await query(
        "SELECT * FROM luca_cases WHERE case_id = $1",
        [caseId]
      );
      
      if (caseData.rows.length === 0) {
        throw new Error("Case not found");
      }
      
      const caso = caseData.rows[0];
      
      // Cargar acciones
      const actionsData = await query(
        "SELECT * FROM luca_actions WHERE case_id = $1 ORDER BY created_at",
        [caseId]
      );
      
      // Cargar timeline
      const auditData = await query(`
        SELECT * FROM luca_audit_log 
        WHERE target_type = 'case' AND target_id = $1
        ORDER BY created_at
      `, [caseId]);
      
      const expediente = {
        metadata: {
          case_id: caseId,
          generated_at: new Date().toISOString(),
          generated_by: this.name,
          version: "1.0",
        },
        
        // Carátula
        cover: {
          title: "EXPEDIENTE DE FRAUDE",
          subtitle: caso.title,
          case_id: caseId,
          severity: caso.severity,
          status: caso.state,
          created_at: caso.created_at,
        },
        
        // Resumen ejecutivo
        executive_summary: {
          conclusion: caso.diagnosis?.conclusion || caso.title,
          severity: caso.severity,
          employee_id: caso.scope?.employee_id,
          branch_id: caso.scope?.branch_id,
          risk_level: caso.severity === "CRITICAL" ? "Muy Alto" : 
                      caso.severity === "HIGH" ? "Alto" : "Moderado",
        },
        
        // Evidencia
        evidence: caso.evidence || [],
        
        // Hipótesis
        hypotheses: caso.hypotheses || [],
        
        // Diagnóstico
        diagnosis: caso.diagnosis,
        
        // Acciones recomendadas
        recommended_actions: actionsData.rows.map(a => ({
          action_type: a.action_type,
          title: a.title,
          description: a.description,
          status: a.state,
          requires_approval: a.requires_approval,
        })),
        
        // Timeline
        timeline: auditData.rows.map(a => ({
          date: a.created_at,
          action: a.action,
          actor: a.actor_id,
          details: a.changes,
        })),
        
        // Firmas (placeholder)
        signatures: {
          investigator: { name: this.name, signed: true, date: new Date().toISOString() },
          reviewer: { name: null, signed: false, date: null },
          approver: { name: null, signed: false, date: null },
        },
      };
      
      // En producción, aquí generaríamos el PDF real
      // return await generatePDF(expediente, 'expediente_fraude');
      
      return {
        status: "generated",
        expediente,
        // pdf_url: '/outputs/expediente_' + caseId + '.pdf',
        note: "PDF generation pending implementation",
      };
      
    } catch (err) {
      logger.error({ caseId, error: err?.message }, "Failed to generate expediente");
      throw err;
    }
  }
}

// Export singleton
export const fiscaliaAgent = new FiscaliaAgent();

export default FiscaliaAgent;
