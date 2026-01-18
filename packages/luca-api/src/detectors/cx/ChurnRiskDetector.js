/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHURN RISK DETECTOR - Detecta Clientes en Riesgo de Churn
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta clientes que muestran señales de abandono:
 * - Disminución en frecuencia de visitas
 * - Aumento en días desde última compra
 * - Caída en ticket promedio
 * - Patrones de comportamiento pre-churn
 */

import { logger } from "@tagers/shared";
import { BaseDetector } from "../../engine/BaseDetector.js";
import { calculateHealthScore, detectChurnSignals } from "../../agents/CustomerHealthScore.js";

/**
 * Configuración del detector
 */
const DETECTOR_CONFIG = {
  // Umbrales de detección
  thresholds: {
    healthScoreCritical: 0.3,    // Alertar si score < 0.3
    healthScoreWarning: 0.5,     // Advertir si score < 0.5
    minSignalsToAlert: 2,        // Mínimo de señales para alerta
    frequencyDropPercent: 50,    // Caída en frecuencia
    recencyDaysWarning: 30,      // Días sin visita para advertencia
    recencyDaysCritical: 60,     // Días sin visita crítico
  },

  // Configuración de análisis
  analysis: {
    lookbackDays: 90,            // Días de historial a analizar
    minPurchases: 3,             // Compras mínimas para considerar
    vipThreshold: 4,             // Visitas/mes para ser VIP
  },

  // Segmentación de clientes
  segments: {
    VIP: { minVisitsPerMonth: 4, priority: "CRITICAL" },
    REGULAR: { minVisitsPerMonth: 2, priority: "HIGH" },
    OCCASIONAL: { minVisitsPerMonth: 1, priority: "MEDIUM" },
    RARE: { minVisitsPerMonth: 0, priority: "LOW" },
  },
};

export class ChurnRiskDetector extends BaseDetector {
  constructor() {
    super({
      name: "churn_risk_detector",
      description: "Detecta clientes en riesgo de abandono",
      category: "cx",
      schedule: "0 8 * * *", // Diario a las 8am
    });
    this.config = DETECTOR_CONFIG;
  }

  /**
   * Ejecuta la detección
   */
  async detect(context = {}) {
    logger.info({ context }, "ChurnRiskDetector running");

    const findings = [];

    try {
      // Obtener clientes para análisis
      const customers = await this.getCustomersToAnalyze(context);

      for (const customer of customers) {
        // Calcular health score
        const health = calculateHealthScore(customer);

        // Obtener historial
        const history = await this.getCustomerHistory(customer.customerId);

        // Detectar señales de churn
        const signals = detectChurnSignals(customer, history);

        // Determinar si crear finding
        const shouldAlert = this.shouldCreateAlert(health, signals, customer);

        if (shouldAlert) {
          findings.push(this.createFinding(customer, health, signals, history));
        }
      }

      // Agregar resumen
      const summary = this.createSummary(findings, customers.length);

      return {
        detector: this.name,
        timestamp: new Date().toISOString(),
        findings,
        summary,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "ChurnRiskDetector failed");
      throw err;
    }
  }

  /**
   * Determina si se debe crear alerta
   */
  shouldCreateAlert(health, signals, customer) {
    // Alerta crítica si score muy bajo
    if (health.score < this.config.thresholds.healthScoreCritical) {
      return true;
    }

    // Alerta si hay suficientes señales
    if (signals.length >= this.config.thresholds.minSignalsToAlert) {
      return true;
    }

    // Alerta si es VIP y muestra señales de warning
    const isVIP = customer.visitsLast30Days >= this.config.analysis.vipThreshold ||
                  customer.wasVIP;
    if (isVIP && health.score < this.config.thresholds.healthScoreWarning) {
      return true;
    }

    return false;
  }

  /**
   * Crea un finding
   */
  createFinding(customer, health, signals, history) {
    // Determinar severidad
    let severity = "MEDIUM";
    let priority = "MEDIUM";

    if (health.score < this.config.thresholds.healthScoreCritical) {
      severity = "HIGH";
      priority = "HIGH";
    }

    // VIP sube la prioridad
    if (customer.wasVIP || history.wasVIP) {
      if (severity === "HIGH") severity = "CRITICAL";
      else severity = "HIGH";
      priority = "CRITICAL";
    }

    // Señales de alta severidad suben prioridad
    const hasHighSeveritySignal = signals.some(s => s.severity === "HIGH");
    if (hasHighSeveritySignal && severity !== "CRITICAL") {
      severity = "HIGH";
    }

    return {
      findingId: `CHURN-${customer.customerId}-${Date.now()}`,
      type: "CHURN_RISK",
      severity,
      priority,
      
      customer: {
        id: customer.customerId,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        segment: this.determineSegment(customer, history),
      },

      healthScore: {
        score: health.score,
        category: health.category,
        components: health.components,
      },

      signals: signals.map(s => ({
        type: s.type,
        severity: s.severity,
        message: s.message,
        value: s.value,
      })),

      context: {
        daysSinceLastVisit: customer.daysSinceLastVisit,
        visitsLast30Days: customer.visitsLast30Days,
        avgSentiment: customer.avgSentiment,
        favoriteProduct: customer.favoriteProduct,
        frequentBranch: customer.frequentBranch,
        lifetimeValue: history.lifetimeValue,
        wasVIP: history.wasVIP,
      },

      recommendation: {
        action: health.action,
        urgency: priority,
        suggestedMessage: this.getSuggestedApproach(health, signals, customer),
      },

      detectedAt: new Date().toISOString(),
    };
  }

  /**
   * Determina el segmento del cliente
   */
  determineSegment(customer, history) {
    const avgVisits = history.avgVisitsPerMonth || customer.visitsLast30Days;

    for (const [segment, config] of Object.entries(this.config.segments)) {
      if (avgVisits >= config.minVisitsPerMonth) {
        return segment;
      }
    }
    return "RARE";
  }

  /**
   * Sugiere approach según situación
   */
  getSuggestedApproach(health, signals, customer) {
    // Si hay queja no resuelta
    const hasComplaint = signals.some(s => s.type === "UNRESOLVED_COMPLAINT");
    if (hasComplaint) {
      return "Resolver queja primero, luego ofrecer compensación";
    }

    // Si fue VIP
    if (customer.wasVIP) {
      return "Contacto directo reconociendo su importancia pasada";
    }

    // Según health score
    if (health.score < 0.2) {
      return "Campaña de reactivación agresiva con incentivo significativo";
    } else if (health.score < 0.4) {
      return "Win-back con oferta personalizada basada en producto favorito";
    } else {
      return "Check-in amigable preguntando cómo están";
    }
  }

  /**
   * Crea resumen de detección
   */
  createSummary(findings, totalAnalyzed) {
    const bySeverity = {
      CRITICAL: findings.filter(f => f.severity === "CRITICAL").length,
      HIGH: findings.filter(f => f.severity === "HIGH").length,
      MEDIUM: findings.filter(f => f.severity === "MEDIUM").length,
      LOW: findings.filter(f => f.severity === "LOW").length,
    };

    const bySegment = {};
    for (const finding of findings) {
      const segment = finding.customer.segment;
      bySegment[segment] = (bySegment[segment] || 0) + 1;
    }

    // Top señales
    const signalCounts = {};
    for (const finding of findings) {
      for (const signal of finding.signals) {
        signalCounts[signal.type] = (signalCounts[signal.type] || 0) + 1;
      }
    }

    const topSignals = Object.entries(signalCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([type, count]) => ({ type, count }));

    return {
      totalAnalyzed,
      atRiskCount: findings.length,
      riskRate: totalAnalyzed > 0 
        ? Math.round((findings.length / totalAnalyzed) * 100) 
        : 0,
      bySeverity,
      bySegment,
      topSignals,
      avgHealthScore: findings.length > 0
        ? Math.round(findings.reduce((sum, f) => sum + f.healthScore.score, 0) / findings.length * 100) / 100
        : null,
    };
  }

  /**
   * Obtiene clientes para análisis
   */
  async getCustomersToAnalyze(context) {
    // TODO: Obtener de Redshift
    // Por ahora, mock data
    return [
      {
        customerId: "CUST001",
        name: "María García",
        phone: "5255123456701",
        email: "maria@email.com",
        daysSinceLastVisit: 45,
        visitsLast30Days: 0,
        avgTicketRatio: 1.2,
        avgSentiment: 3.5,
        interactionsLast30Days: 1,
        favoriteProduct: "Café Americano",
        frequentBranch: "San Ángel",
      },
      {
        customerId: "CUST002",
        name: "Ana Martínez",
        phone: "5255123456703",
        email: "ana@email.com",
        daysSinceLastVisit: 65,
        visitsLast30Days: 0,
        avgTicketRatio: 1.8,
        avgSentiment: 2.5,
        interactionsLast30Days: 2,
        favoriteProduct: "Pastel de chocolate",
        frequentBranch: "Polanco",
        unresolvedComplaints: 1,
        wasVIP: true,
      },
      {
        customerId: "CUST005",
        name: "Laura Torres",
        phone: "5255123456705",
        email: "laura@email.com",
        daysSinceLastVisit: 90,
        visitsLast30Days: 0,
        avgTicketRatio: 0.6,
        avgSentiment: 3.0,
        interactionsLast30Days: 0,
        frequentBranch: "Roma",
      },
    ];
  }

  /**
   * Obtiene historial de cliente
   */
  async getCustomerHistory(customerId) {
    // TODO: Obtener de Redshift
    return {
      avgVisitsPerMonth: Math.floor(Math.random() * 4) + 1,
      avgTicket: 120 + Math.floor(Math.random() * 100),
      lifetimeValue: 1000 + Math.floor(Math.random() * 5000),
      firstPurchase: "2024-01-15",
      totalPurchases: 20 + Math.floor(Math.random() * 50),
      wasVIP: Math.random() > 0.7,
    };
  }
}

export const churnRiskDetector = new ChurnRiskDetector();

export default ChurnRiskDetector;
