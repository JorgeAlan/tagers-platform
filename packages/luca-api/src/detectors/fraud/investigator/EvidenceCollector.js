/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EVIDENCE COLLECTOR - Recolecta Evidencia para Expediente
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Junta toda la evidencia necesaria para generar un expediente de fraude:
 * - Screenshots (simulado)
 * - Datos de transacciones
 * - Información del empleado
 * - Timeline de eventos
 * - Documentos de soporte
 */

import { logger, query } from "@tagers/shared";

export class EvidenceCollector {
  constructor() {
    this.evidenceTypes = [
      "transactions",      // Lista de transacciones sospechosas
      "employee_info",     // Información del empleado
      "customer_info",     // Información de clientes involucrados
      "timeline",          // Timeline de eventos
      "statistics",        // Estadísticas comparativas
      "patterns",          // Patrones detectados
    ];
  }

  /**
   * Recolecta toda la evidencia para un caso de fraude
   */
  async collect(finding, investigation) {
    logger.info({
      findingId: finding.finding_id,
      employeeId: finding.employee_id,
    }, "Collecting evidence for fraud case");
    
    const evidence = {
      collected_at: new Date().toISOString(),
      finding_id: finding.finding_id,
      case_type: "FRAUD",
      
      // Secciones de evidencia
      summary: null,
      transactions: null,
      employee: null,
      customers: null,
      timeline: null,
      statistics: null,
      patterns: null,
      supporting_documents: [],
    };
    
    try {
      // 1. Resumen ejecutivo
      evidence.summary = this.buildSummary(finding, investigation);
      
      // 2. Transacciones sospechosas
      evidence.transactions = await this.collectTransactions(finding);
      
      // 3. Información del empleado
      evidence.employee = await this.collectEmployeeInfo(finding, investigation);
      
      // 4. Clientes involucrados
      evidence.customers = await this.collectCustomerInfo(finding);
      
      // 5. Timeline de eventos
      evidence.timeline = this.buildTimeline(finding, evidence.transactions);
      
      // 6. Estadísticas
      evidence.statistics = this.collectStatistics(finding, investigation);
      
      // 7. Patrones
      evidence.patterns = this.collectPatterns(finding, investigation);
      
      // 8. Documentos de soporte (placeholders)
      evidence.supporting_documents = this.listSupportingDocuments(finding);
      
      evidence.status = "complete";
      
    } catch (err) {
      logger.error({
        findingId: finding.finding_id,
        error: err?.message,
      }, "Evidence collection failed");
      
      evidence.status = "partial";
      evidence.error = err?.message;
    }
    
    return evidence;
  }

  /**
   * Construye resumen ejecutivo
   */
  buildSummary(finding, investigation) {
    const patternsDetected = finding.patterns_detected || [finding.type];
    const confidencePct = Math.round(finding.confidence * 100);
    
    // Calcular impacto estimado
    const totalDiscount = this.calculateTotalDiscount(finding);
    
    return {
      title: `Reporte de Fraude - ${finding.employee_id}`,
      subtitle: finding.title,
      severity: finding.severity,
      confidence: finding.confidence,
      confidence_pct: confidencePct,
      
      headline: `Se detectaron ${patternsDetected.length} patrón(es) de posible fraude con ${confidencePct}% de confianza.`,
      
      key_findings: [
        `Empleado: ${finding.employee_id}`,
        `Sucursal: ${finding.branch_id}`,
        `Patrones detectados: ${patternsDetected.join(", ")}`,
        `Impacto estimado: $${totalDiscount.toFixed(2)} MXN`,
      ],
      
      recommended_action: investigation?.hypotheses?.[0]?.recommended_actions?.[0] 
        || "Investigar más a fondo",
      
      investigation_status: investigation?.status || "pending",
      primary_hypothesis: investigation?.hypotheses?.[0]?.hypothesis || "Pendiente de investigación",
    };
  }

  /**
   * Calcula total de descuentos del finding
   */
  calculateTotalDiscount(finding) {
    let total = 0;
    
    // De la evidencia directa del finding
    if (finding.all_evidence) {
      for (const patternEvidence of Object.values(finding.all_evidence)) {
        if (patternEvidence.top_cash_discounts) {
          total += patternEvidence.top_cash_discounts.reduce((s, t) => s + (t.discount || 0), 0);
        }
        if (patternEvidence.topDiscounts) {
          total += patternEvidence.topDiscounts.reduce((s, t) => s + (t.discount_amount || 0), 0);
        }
      }
    }
    
    // De la evidencia del finding single
    if (finding.evidence?.topDiscounts) {
      total += finding.evidence.topDiscounts.reduce((s, t) => s + (t.discount_amount || 0), 0);
    }
    
    return total;
  }

  /**
   * Recolecta transacciones sospechosas
   */
  async collectTransactions(finding) {
    const transactions = [];
    
    // Extraer de la evidencia del finding
    if (finding.all_evidence) {
      for (const [patternType, patternEvidence] of Object.entries(finding.all_evidence)) {
        if (patternEvidence.topDiscounts) {
          for (const t of patternEvidence.topDiscounts) {
            transactions.push({
              ...t,
              source_pattern: patternType,
              flagged_for: this.getPatternDescription(patternType),
            });
          }
        }
        if (patternEvidence.top_cash_discounts) {
          for (const t of patternEvidence.top_cash_discounts) {
            transactions.push({
              ...t,
              source_pattern: patternType,
              flagged_for: this.getPatternDescription(patternType),
            });
          }
        }
        if (patternEvidence.transactions) {
          for (const t of patternEvidence.transactions) {
            transactions.push({
              ...t,
              source_pattern: patternType,
              flagged_for: this.getPatternDescription(patternType),
            });
          }
        }
      }
    }
    
    // De evidencia single
    if (finding.evidence?.topDiscounts) {
      for (const t of finding.evidence.topDiscounts) {
        transactions.push({
          ...t,
          source_pattern: finding.type,
          flagged_for: this.getPatternDescription(finding.type),
        });
      }
    }
    
    // Deduplicar por transaction_id
    const unique = {};
    for (const t of transactions) {
      const key = t.transaction_id;
      if (!unique[key]) {
        unique[key] = t;
      } else {
        // Combinar flags
        unique[key].flagged_for = [unique[key].flagged_for, t.flagged_for]
          .filter(Boolean)
          .join("; ");
      }
    }
    
    return {
      count: Object.keys(unique).length,
      total_discount: Object.values(unique).reduce((s, t) => s + (t.discount || t.discount_amount || 0), 0),
      list: Object.values(unique).sort((a, b) => 
        (b.discount || b.discount_amount || 0) - (a.discount || a.discount_amount || 0)
      ),
    };
  }

  /**
   * Recolecta información del empleado
   */
  async collectEmployeeInfo(finding, investigation) {
    const profile = investigation?.employee_profile || {};
    
    return {
      employee_id: finding.employee_id,
      name: profile.name || `Empleado ${finding.employee_id}`,
      role: profile.role || "No especificado",
      branch_id: finding.branch_id,
      hire_date: profile.hire_date,
      months_employed: profile.months_employed,
      status: profile.status || "active",
      
      // Métricas de la investigación
      metrics: {
        transaction_count: finding.evidence?.total_transactions || "N/A",
        discount_count: finding.evidence?.discounted_transactions || "N/A",
        discount_rate: finding.evidence?.discount_anomaly?.discountRate 
          ? `${(finding.evidence.discount_anomaly.discountRate * 100).toFixed(1)}%`
          : "N/A",
      },
      
      // Comparación con peers
      peer_comparison: investigation?.peer_comparison?.comparison || {},
    };
  }

  /**
   * Recolecta información de clientes involucrados
   */
  async collectCustomerInfo(finding) {
    const customers = [];
    
    // Extraer de evidencia de sweethearting
    if (finding.all_evidence?.sweethearting?.topRepeatCustomers) {
      for (const c of finding.all_evidence.sweethearting.topRepeatCustomers) {
        customers.push({
          customer_id: c.customer_id,
          transaction_count: c.transaction_count,
          discount_count: c.discount_count,
          total_discount: c.total_discount,
          dates: c.dates,
        });
      }
    }
    
    // Extraer de evidencia de colusión
    if (finding.all_evidence?.collusion?.customer_id) {
      customers.push({
        customer_id: finding.all_evidence.collusion.customer_id,
        transaction_count: finding.all_evidence.collusion.repeat_count,
        discount_count: finding.all_evidence.collusion.discount_count,
        total_discount: finding.all_evidence.collusion.total_discount_amount,
        possible_collusion: true,
      });
    }
    
    return {
      count: customers.length,
      list: customers,
    };
  }

  /**
   * Construye timeline de eventos
   */
  buildTimeline(finding, transactions) {
    const events = [];
    
    // Agregar transacciones como eventos
    for (const t of transactions?.list || []) {
      events.push({
        date: t.date,
        time: t.time || t.created_at,
        type: "transaction",
        description: `Transacción ${t.transaction_id}: $${t.discount || t.discount_amount || 0} descuento`,
        details: {
          total: t.total,
          discount_reason: t.discount_reason,
          flagged_for: t.flagged_for,
        },
      });
    }
    
    // Ordenar cronológicamente
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    
    return {
      event_count: events.length,
      date_range: events.length > 0 ? {
        from: events[0].date,
        to: events[events.length - 1].date,
      } : null,
      events: events.slice(0, 20), // Limitar a 20 eventos
    };
  }

  /**
   * Recolecta estadísticas
   */
  collectStatistics(finding, investigation) {
    return {
      // Del finding
      confidence: finding.confidence,
      severity: finding.severity,
      patterns_detected: finding.patterns_detected || [finding.type],
      
      // De la evidencia
      discount_anomaly: {
        avg_discount_pct: finding.evidence?.discount_anomaly?.avgDiscountPct,
        global_avg_discount_pct: finding.evidence?.discount_anomaly?.globalAvgDiscountPct,
        z_score: finding.evidence?.discount_anomaly?.zScore,
      },
      
      cash_preference: {
        cash_pct_in_discounts: finding.all_evidence?.cash_preference?.cash_pct_in_discounts,
        global_cash_pct: finding.all_evidence?.cash_preference?.global_cash_pct,
      },
      
      time_concentration: {
        gini_coefficient: finding.all_evidence?.time_concentration?.gini_coefficient,
        peak_hour: finding.all_evidence?.time_concentration?.peak_hour,
      },
      
      // De la investigación
      risk_indicators: investigation?.risk_indicators || [],
      confidence_adjustment: investigation?.confidence_adjustment || 0,
    };
  }

  /**
   * Recolecta patrones detectados
   */
  collectPatterns(finding, investigation) {
    const patterns = [];
    
    // Patrones del finding
    for (const signal of finding.all_signals || finding.signals || []) {
      patterns.push({
        type: signal.type,
        severity: signal.severity,
        value: signal.value,
        description: signal.description || this.getPatternDescription(signal.type),
      });
    }
    
    // Patrones adicionales de la investigación
    for (const pattern of investigation?.pattern_analysis || []) {
      patterns.push({
        type: pattern.type,
        severity: pattern.severity,
        description: pattern.description,
        note: pattern.note,
        source: "investigation",
      });
    }
    
    return patterns;
  }

  /**
   * Lista documentos de soporte necesarios
   */
  listSupportingDocuments(finding) {
    const docs = [];
    
    docs.push({
      type: "video_footage",
      description: "Grabaciones de cámaras de seguridad",
      status: "pending_review",
      priority: "high",
      suggested_dates: finding.evidence?.analysis_period || {},
    });
    
    docs.push({
      type: "shift_records",
      description: "Registros de turnos del empleado",
      status: "to_collect",
      priority: "medium",
    });
    
    docs.push({
      type: "policy_acknowledgment",
      description: "Confirmación de lectura de políticas de descuento",
      status: "to_verify",
      priority: "low",
    });
    
    return docs;
  }

  /**
   * Obtiene descripción legible del patrón
   */
  getPatternDescription(patternType) {
    const descriptions = {
      sweethearting: "Descuentos a conocidos",
      cash_preference: "Preferencia por efectivo",
      time_concentration: "Concentración horaria",
      collusion: "Posible colusión",
      discount_anomaly: "Anomalía en descuentos",
      customer_repeat: "Cliente repetido",
      new_employee_anomaly: "Empleado nuevo con anomalías",
      peer_outlier: "Diferente a compañeros",
      increasing_trend: "Tendencia creciente",
      day_concentration: "Concentración por día",
    };
    
    return descriptions[patternType] || patternType;
  }
}

export default new EvidenceCollector();
