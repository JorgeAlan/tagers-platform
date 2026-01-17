/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ROI CALCULATOR - Calculadora de Retorno de Inversión
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Valores desde ConfigLoader (Google Sheets)
 * 
 * Calcula:
 * - ROI de acciones tomadas
 * - Ahorro por detección de fraude
 * - Valor de retención de clientes
 * - Costo vs beneficio de LUCA
 */

import { logger } from "@tagers/shared";
import { configLoader } from "../config/ConfigLoader.js";

export class ROICalculator {
  /**
   * Obtiene valor de referencia desde config
   */
  getValue(key, defaultValue = 0) {
    return configLoader.getRoiValue(key, defaultValue);
  }

  /**
   * Obtiene todos los valores de referencia
   */
  getAllValues() {
    return configLoader.getAllRoiValues();
  }

  /**
   * Calcula ROI de una acción de fraude
   */
  calculateFraudROI(fraudAmount, actionCost = 0) {
    const recoveryRate = this.getValue("fraud_recovery_rate", 0.7);
    const investigationCost = this.getValue("fraud_investigation_cost", 500);
    
    const recovered = fraudAmount * recoveryRate;
    const totalCost = actionCost + investigationCost;
    const netBenefit = recovered - totalCost;
    const roi = totalCost > 0 ? (netBenefit / totalCost) * 100 : 0;

    return {
      fraudAmount,
      recovered,
      recoveryRate,
      costs: {
        action: actionCost,
        investigation: investigationCost,
        total: totalCost,
      },
      netBenefit,
      roi: Math.round(roi),
      roiFormatted: `${Math.round(roi)}%`,
    };
  }

  /**
   * Calcula ROI de retención de cliente
   */
  calculateRetentionROI(customersRetained, actionCost = 0) {
    const clv = this.getValue("customer_lifetime_value", 5000);
    const churnPreventionRate = this.getValue("churn_prevention_rate", 0.3);
    
    const expectedRetention = customersRetained * churnPreventionRate;
    const valueRetained = expectedRetention * clv;
    const netBenefit = valueRetained - actionCost;
    const roi = actionCost > 0 ? (netBenefit / actionCost) * 100 : 0;

    return {
      customersTargeted: customersRetained,
      expectedRetained: Math.round(expectedRetention),
      churnPreventionRate,
      valueRetained,
      clv,
      actionCost,
      netBenefit,
      roi: Math.round(roi),
      roiFormatted: `${Math.round(roi)}%`,
    };
  }

  /**
   * Calcula ROI de optimización de staffing
   */
  calculateStaffingROI(hoursSaved, qualityImpact = 0) {
    const hourlyCost = this.getValue("hourly_employee_cost", 150);
    const turnoverCost = this.getValue("employee_turnover_cost", 15000);
    
    const laborSavings = hoursSaved * hourlyCost;
    const qualityCost = qualityImpact * turnoverCost * 0.1; // 10% riesgo de rotación por sobrecarga
    const netBenefit = laborSavings - qualityCost;

    return {
      hoursSaved,
      hourlyCost,
      laborSavings,
      qualityImpact,
      qualityCost,
      netBenefit,
      netBenefitFormatted: `$${netBenefit.toLocaleString()} MXN`,
    };
  }

  /**
   * Calcula ROI general de LUCA
   */
  calculateLUCAROI(period = "monthly", metrics = {}) {
    const {
      fraudDetected = 0,
      customersRetained = 0,
      staffingHoursSaved = 0,
      inventoryWastePrevented = 0,
    } = metrics;

    // Costos de LUCA
    const openaiCost = this.getValue("openai_monthly_cost", 5000);
    const infrastructureCost = this.getValue("infrastructure_monthly_cost", 3000);
    const maintenanceCost = this.getValue("maintenance_monthly_cost", 2000);
    const totalCost = openaiCost + infrastructureCost + maintenanceCost;

    // Beneficios
    const fraudROI = this.calculateFraudROI(fraudDetected);
    const retentionROI = this.calculateRetentionROI(customersRetained);
    const staffingROI = this.calculateStaffingROI(staffingHoursSaved);
    const inventorySavings = inventoryWastePrevented * this.getValue("avg_margin", 0.35);

    const totalBenefits = 
      fraudROI.netBenefit + 
      retentionROI.netBenefit + 
      staffingROI.netBenefit + 
      inventorySavings;

    const netROI = totalBenefits - totalCost;
    const roiPercent = totalCost > 0 ? (netROI / totalCost) * 100 : 0;

    return {
      period,
      costs: {
        openai: openaiCost,
        infrastructure: infrastructureCost,
        maintenance: maintenanceCost,
        total: totalCost,
      },
      benefits: {
        fraud: fraudROI.netBenefit,
        retention: retentionROI.netBenefit,
        staffing: staffingROI.netBenefit,
        inventory: inventorySavings,
        total: totalBenefits,
      },
      netROI,
      roiPercent: Math.round(roiPercent),
      roiFormatted: `${Math.round(roiPercent)}%`,
      breakdown: {
        fraud: fraudROI,
        retention: retentionROI,
        staffing: staffingROI,
      },
    };
  }

  /**
   * Estima ROI futuro basado en historial
   */
  estimateFutureROI(historicalMetrics, months = 12) {
    // Promedio mensual de métricas
    const avgMonthly = {
      fraudDetected: historicalMetrics.totalFraudDetected / (historicalMetrics.months || 1),
      customersRetained: historicalMetrics.totalCustomersRetained / (historicalMetrics.months || 1),
      staffingHoursSaved: historicalMetrics.totalHoursSaved / (historicalMetrics.months || 1),
      inventoryWastePrevented: historicalMetrics.totalWastePrevented / (historicalMetrics.months || 1),
    };

    const projections = [];
    let cumulativeROI = 0;

    for (let i = 1; i <= months; i++) {
      const monthROI = this.calculateLUCAROI("monthly", avgMonthly);
      cumulativeROI += monthROI.netROI;
      
      projections.push({
        month: i,
        monthlyROI: monthROI.netROI,
        cumulativeROI,
      });
    }

    return {
      basedOnMonths: historicalMetrics.months,
      avgMonthlyMetrics: avgMonthly,
      projectedMonths: months,
      projections,
      totalProjectedROI: cumulativeROI,
      avgMonthlyROI: Math.round(cumulativeROI / months),
    };
  }

  /**
   * Genera reporte de ROI para dashboard
   */
  generateROIReport(metrics = {}) {
    const monthly = this.calculateLUCAROI("monthly", metrics);
    
    return {
      generated: new Date().toISOString(),
      summary: {
        totalCost: monthly.costs.total,
        totalBenefits: monthly.benefits.total,
        netROI: monthly.netROI,
        roiPercent: monthly.roiPercent,
        status: monthly.roiPercent > 100 ? "profitable" : monthly.roiPercent > 0 ? "positive" : "negative",
      },
      breakdown: monthly.breakdown,
      recommendations: this.generateRecommendations(monthly),
    };
  }

  /**
   * Genera recomendaciones basadas en ROI
   */
  generateRecommendations(roi) {
    const recommendations = [];

    if (roi.breakdown.fraud.netBenefit < roi.costs.total * 0.3) {
      recommendations.push({
        area: "fraud",
        priority: "HIGH",
        action: "Aumentar detección de fraude",
        potential: "Activar más patrones de detección",
      });
    }

    if (roi.breakdown.retention.netBenefit < roi.costs.total * 0.2) {
      recommendations.push({
        area: "retention",
        priority: "MEDIUM",
        action: "Mejorar retención",
        potential: "Activar campañas de win-back más agresivas",
      });
    }

    if (roi.breakdown.staffing.netBenefit < roi.costs.total * 0.1) {
      recommendations.push({
        area: "staffing",
        priority: "LOW",
        action: "Optimizar staffing",
        potential: "Revisar umbrales de optimización",
      });
    }

    return recommendations;
  }
}

export const roiCalculator = new ROICalculator();

export default ROICalculator;
