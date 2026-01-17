/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FRAUD INVESTIGATOR - Profundiza en Findings de Fraude
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cuando La Fiscalía detecta algo sospechoso, el Investigator profundiza:
 * - Busca más contexto sobre el empleado
 * - Analiza historial completo
 * - Busca patrones adicionales
 * - Genera hipótesis
 */

import { logger, query } from "@tagers/shared";

export class FraudInvestigator {
  constructor() {
    this.investigationDepth = {
      LIGHT: { historyDays: 30, compareEmployees: 3 },
      MEDIUM: { historyDays: 60, compareEmployees: 5 },
      DEEP: { historyDays: 90, compareEmployees: 10 },
    };
  }

  /**
   * Investiga un finding de fraude
   */
  async investigate(finding, depth = "MEDIUM") {
    const config = this.investigationDepth[depth];
    
    logger.info({
      findingId: finding.finding_id,
      employeeId: finding.employee_id,
      depth,
    }, "Starting fraud investigation");
    
    const investigation = {
      finding_id: finding.finding_id,
      employee_id: finding.employee_id,
      investigation_depth: depth,
      started_at: new Date().toISOString(),
      
      // Secciones de la investigación
      employee_profile: null,
      historical_analysis: null,
      peer_comparison: null,
      pattern_analysis: null,
      risk_indicators: [],
      hypotheses: [],
      confidence_adjustment: 0,
    };
    
    try {
      // 1. Perfil del empleado
      investigation.employee_profile = await this.buildEmployeeProfile(
        finding.employee_id, 
        finding.branch_id
      );
      
      // 2. Análisis histórico
      investigation.historical_analysis = await this.analyzeHistory(
        finding.employee_id,
        config.historyDays
      );
      
      // 3. Comparación con peers
      investigation.peer_comparison = await this.compareToPeers(
        finding.employee_id,
        finding.branch_id,
        config.compareEmployees
      );
      
      // 4. Análisis de patrones adicionales
      investigation.pattern_analysis = this.analyzeAdditionalPatterns(
        finding,
        investigation.historical_analysis
      );
      
      // 5. Identificar indicadores de riesgo
      investigation.risk_indicators = this.identifyRiskIndicators(
        investigation
      );
      
      // 6. Generar hipótesis
      investigation.hypotheses = this.generateHypotheses(
        finding,
        investigation
      );
      
      // 7. Ajustar confianza basado en investigación
      investigation.confidence_adjustment = this.calculateConfidenceAdjustment(
        investigation
      );
      
      investigation.completed_at = new Date().toISOString();
      investigation.status = "completed";
      
    } catch (err) {
      logger.error({
        findingId: finding.finding_id,
        error: err?.message,
      }, "Investigation failed");
      
      investigation.status = "failed";
      investigation.error = err?.message;
    }
    
    return investigation;
  }

  /**
   * Construye perfil del empleado
   */
  async buildEmployeeProfile(employeeId, branchId) {
    try {
      // Intentar cargar de DB
      const result = await query(`
        SELECT 
          employee_id,
          name,
          role,
          branch_id,
          hire_date,
          status
        FROM employees
        WHERE employee_id = $1
      `, [employeeId]);
      
      if (result.rows.length > 0) {
        const emp = result.rows[0];
        const hireDate = new Date(emp.hire_date);
        const monthsEmployed = Math.floor(
          (Date.now() - hireDate.getTime()) / (1000 * 60 * 60 * 24 * 30)
        );
        
        return {
          employee_id: emp.employee_id,
          name: emp.name,
          role: emp.role,
          branch_id: emp.branch_id,
          hire_date: emp.hire_date,
          months_employed: monthsEmployed,
          is_new_employee: monthsEmployed < 3,
          status: emp.status,
        };
      }
    } catch (err) {
      // DB no disponible
    }
    
    // Perfil simulado si no hay datos
    return {
      employee_id: employeeId,
      name: `Empleado ${employeeId}`,
      role: "cajero",
      branch_id: branchId,
      hire_date: null,
      months_employed: null,
      is_new_employee: false,
      status: "active",
    };
  }

  /**
   * Analiza historial del empleado
   */
  async analyzeHistory(employeeId, days) {
    try {
      const result = await query(`
        SELECT 
          DATE(created_at) as date,
          COUNT(*) as transaction_count,
          SUM(CASE WHEN discount_amount > 0 THEN 1 ELSE 0 END) as discount_count,
          SUM(discount_amount) as total_discount,
          SUM(total) as total_sales,
          SUM(CASE WHEN payment_method = 'cash' THEN 1 ELSE 0 END) as cash_count
        FROM transactions
        WHERE employee_id = $1
          AND created_at > NOW() - INTERVAL '${days} days'
        GROUP BY DATE(created_at)
        ORDER BY date DESC
      `, [employeeId]);
      
      const dailyStats = result.rows;
      
      // Calcular tendencias
      if (dailyStats.length > 7) {
        const recent = dailyStats.slice(0, 7);
        const older = dailyStats.slice(7);
        
        const recentAvgDiscount = recent.reduce((s, d) => s + d.discount_count, 0) / recent.length;
        const olderAvgDiscount = older.length > 0 
          ? older.reduce((s, d) => s + d.discount_count, 0) / older.length 
          : recentAvgDiscount;
        
        return {
          days_analyzed: days,
          total_days_with_data: dailyStats.length,
          daily_stats: dailyStats,
          trends: {
            discount_trend: recentAvgDiscount > olderAvgDiscount * 1.3 ? "increasing" : "stable",
            recent_avg_discounts: recentAvgDiscount,
            older_avg_discounts: olderAvgDiscount,
          },
        };
      }
      
      return {
        days_analyzed: days,
        total_days_with_data: dailyStats.length,
        daily_stats: dailyStats,
        trends: { discount_trend: "insufficient_data" },
      };
      
    } catch (err) {
      return {
        days_analyzed: days,
        total_days_with_data: 0,
        daily_stats: [],
        trends: { discount_trend: "no_data" },
        error: err?.message,
      };
    }
  }

  /**
   * Compara con peers (otros empleados)
   */
  async compareToPeers(employeeId, branchId, peerCount) {
    try {
      const result = await query(`
        SELECT 
          employee_id,
          COUNT(*) as transaction_count,
          SUM(CASE WHEN discount_amount > 0 THEN 1 ELSE 0 END) as discount_count,
          ROUND(AVG(discount_amount), 2) as avg_discount,
          ROUND(SUM(CASE WHEN payment_method = 'cash' THEN 1 ELSE 0 END)::numeric / COUNT(*)::numeric * 100, 1) as cash_pct
        FROM transactions
        WHERE branch_id = $1
          AND created_at > NOW() - INTERVAL '30 days'
        GROUP BY employee_id
        HAVING COUNT(*) > 20
        ORDER BY discount_count DESC
        LIMIT $2
      `, [branchId, peerCount + 1]);
      
      const peers = result.rows;
      const target = peers.find(p => p.employee_id === employeeId);
      const others = peers.filter(p => p.employee_id !== employeeId);
      
      if (target && others.length > 0) {
        const avgPeerDiscountRate = others.reduce((s, p) => 
          s + (p.discount_count / p.transaction_count), 0) / others.length;
        const targetDiscountRate = target.discount_count / target.transaction_count;
        
        return {
          target_employee: target,
          peers: others,
          comparison: {
            discount_rate_vs_peers: targetDiscountRate / avgPeerDiscountRate,
            is_outlier: targetDiscountRate > avgPeerDiscountRate * 2,
            rank: peers.findIndex(p => p.employee_id === employeeId) + 1,
          },
        };
      }
      
      return { 
        target_employee: target,
        peers: others,
        comparison: { insufficient_data: true },
      };
      
    } catch (err) {
      return { 
        error: err?.message,
        comparison: { insufficient_data: true },
      };
    }
  }

  /**
   * Analiza patrones adicionales no cubiertos por el detector
   */
  analyzeAdditionalPatterns(finding, historicalAnalysis) {
    const patterns = [];
    
    // Patrón: Aumento reciente de descuentos
    if (historicalAnalysis?.trends?.discount_trend === "increasing") {
      patterns.push({
        type: "recent_increase",
        description: "Aumento reciente en frecuencia de descuentos",
        severity: "medium",
      });
    }
    
    // Patrón: Empleado nuevo
    if (finding.evidence?.months_employed < 3) {
      patterns.push({
        type: "new_employee",
        description: "Empleado con menos de 3 meses",
        severity: "low",
        note: "Puede requerir capacitación adicional",
      });
    }
    
    // Patrón: Concentración en días específicos
    if (historicalAnalysis?.daily_stats?.length > 0) {
      const dayOfWeekCounts = {};
      for (const stat of historicalAnalysis.daily_stats) {
        const dow = new Date(stat.date).getDay();
        dayOfWeekCounts[dow] = (dayOfWeekCounts[dow] || 0) + stat.discount_count;
      }
      
      const maxDay = Object.entries(dayOfWeekCounts)
        .sort((a, b) => b[1] - a[1])[0];
      const total = Object.values(dayOfWeekCounts).reduce((a, b) => a + b, 0);
      
      if (maxDay && maxDay[1] > total * 0.4) {
        const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
        patterns.push({
          type: "day_concentration",
          description: `Descuentos concentrados en ${dayNames[maxDay[0]]}`,
          severity: "medium",
          detail: { day: maxDay[0], percentage: (maxDay[1] / total * 100).toFixed(0) },
        });
      }
    }
    
    return patterns;
  }

  /**
   * Identifica indicadores de riesgo
   */
  identifyRiskIndicators(investigation) {
    const indicators = [];
    
    // Nuevo empleado + comportamiento anómalo
    if (investigation.employee_profile?.is_new_employee) {
      indicators.push({
        type: "new_employee_anomaly",
        level: "medium",
        description: "Comportamiento anómalo en empleado nuevo",
      });
    }
    
    // Outlier vs peers
    if (investigation.peer_comparison?.comparison?.is_outlier) {
      indicators.push({
        type: "peer_outlier",
        level: "high",
        description: "Significativamente diferente a compañeros",
      });
    }
    
    // Tendencia creciente
    if (investigation.historical_analysis?.trends?.discount_trend === "increasing") {
      indicators.push({
        type: "increasing_trend",
        level: "medium",
        description: "Tendencia creciente en descuentos",
      });
    }
    
    // Múltiples patrones detectados
    if (investigation.pattern_analysis?.length > 2) {
      indicators.push({
        type: "multiple_patterns",
        level: "high",
        description: "Múltiples patrones sospechosos",
      });
    }
    
    return indicators;
  }

  /**
   * Genera hipótesis sobre la causa
   */
  generateHypotheses(finding, investigation) {
    const hypotheses = [];
    
    // Hipótesis 1: Fraude intencional
    if (investigation.risk_indicators.some(i => i.level === "high")) {
      hypotheses.push({
        id: "h1_intentional_fraud",
        hypothesis: "Fraude intencional",
        description: "El empleado está dando descuentos no autorizados de forma deliberada",
        confidence: 0.7,
        supporting_evidence: [
          finding.patterns_detected?.join(", ") || finding.type,
          ...investigation.risk_indicators.map(i => i.description),
        ],
        recommended_actions: [
          "Revisar cámaras de seguridad",
          "Auditar transacciones manualmente",
          "Entrevista con el empleado",
        ],
      });
    }
    
    // Hipótesis 2: Desconocimiento de políticas
    if (investigation.employee_profile?.is_new_employee) {
      hypotheses.push({
        id: "h2_policy_ignorance",
        hypothesis: "Desconocimiento de políticas",
        description: "El empleado no conoce bien las políticas de descuento",
        confidence: 0.4,
        supporting_evidence: [
          "Empleado con menos de 3 meses",
        ],
        recommended_actions: [
          "Re-capacitar sobre políticas de descuento",
          "Supervisión cercana por 2 semanas",
        ],
      });
    }
    
    // Hipótesis 3: Presión externa
    hypotheses.push({
      id: "h3_external_pressure",
      hypothesis: "Presión de clientes o compañeros",
      description: "El empleado está cediendo a presión para dar descuentos",
      confidence: 0.3,
      supporting_evidence: [
        "Clientes repetidos con descuentos",
      ],
      recommended_actions: [
        "Entrevista confidencial con el empleado",
        "Revisar si hay quejas de clientes rechazadas",
      ],
    });
    
    // Ordenar por confianza
    return hypotheses.sort((a, b) => b.confidence - a.confidence);
  }

  /**
   * Calcula ajuste de confianza basado en investigación
   */
  calculateConfidenceAdjustment(investigation) {
    let adjustment = 0;
    
    // Aumentar si hay indicadores de riesgo alto
    const highRiskCount = investigation.risk_indicators.filter(i => i.level === "high").length;
    adjustment += highRiskCount * 0.05;
    
    // Aumentar si es outlier vs peers
    if (investigation.peer_comparison?.comparison?.is_outlier) {
      adjustment += 0.1;
    }
    
    // Aumentar si hay tendencia creciente
    if (investigation.historical_analysis?.trends?.discount_trend === "increasing") {
      adjustment += 0.05;
    }
    
    // Reducir si es empleado muy nuevo (puede ser error)
    if (investigation.employee_profile?.months_employed < 1) {
      adjustment -= 0.05;
    }
    
    return Math.round(adjustment * 100) / 100;
  }
}

export default new FraudInvestigator();
