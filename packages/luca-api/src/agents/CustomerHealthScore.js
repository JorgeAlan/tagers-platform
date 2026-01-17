/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTOMER HEALTH SCORE - Cálculo de Salud del Cliente
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Score compuesto basado en RFM (Recency, Frequency, Monetary) + Sentiment + Engagement
 * 
 * Componentes:
 * - RECENCY (30%)    → Días desde última visita
 * - FREQUENCY (25%)  → Visitas por mes
 * - MONETARY (20%)   → Ticket promedio vs promedio tienda
 * - SENTIMENT (15%)  → Score de interacciones (KISS, encuestas, reviews)
 * - ENGAGEMENT (10%) → Interacciones por mes
 */

import { logger } from "@tagers/shared";

/**
 * Configuración de componentes del Health Score
 */
export const HealthScoreConfig = {
  // ═══════════════════════════════════════════════════════════════════════════
  // RECENCY - Cuándo fue su última visita (30% del score)
  // ═══════════════════════════════════════════════════════════════════════════
  RECENCY: {
    weight: 0.30,
    calculation: "days_since_last_visit",
    thresholds: [
      { name: "healthy", maxDays: 14, score: 1.0 },
      { name: "warning", maxDays: 30, score: 0.7 },
      { name: "risk", maxDays: 60, score: 0.4 },
      { name: "churned", maxDays: Infinity, score: 0.1 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FREQUENCY - Visitas por mes (25% del score)
  // ═══════════════════════════════════════════════════════════════════════════
  FREQUENCY: {
    weight: 0.25,
    calculation: "visits_per_30d",
    thresholds: [
      { name: "vip", minVisits: 4, score: 1.0 },
      { name: "regular", minVisits: 2, score: 0.8 },
      { name: "occasional", minVisits: 1, score: 0.5 },
      { name: "rare", minVisits: 0, score: 0.2 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MONETARY - Valor del cliente (20% del score)
  // ═══════════════════════════════════════════════════════════════════════════
  MONETARY: {
    weight: 0.20,
    calculation: "avg_ticket_vs_store_avg",
    thresholds: [
      { name: "high", minRatio: 1.5, score: 1.0 },
      { name: "medium", minRatio: 0.8, score: 0.7 },
      { name: "low", minRatio: 0, score: 0.4 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SENTIMENT - Satisfacción del cliente (15% del score)
  // ═══════════════════════════════════════════════════════════════════════════
  SENTIMENT: {
    weight: 0.15,
    calculation: "avg_sentiment_score",
    thresholds: [
      { name: "positive", minScore: 4, score: 1.0 },
      { name: "neutral", minScore: 3, score: 0.6 },
      { name: "negative", minScore: 0, score: 0.2 },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ENGAGEMENT - Interacción con la marca (10% del score)
  // ═══════════════════════════════════════════════════════════════════════════
  ENGAGEMENT: {
    weight: 0.10,
    calculation: "interactions_per_30d",
    thresholds: [
      { name: "engaged", minInteractions: 2, score: 1.0 },
      { name: "passive", minInteractions: 0, score: 0.5 },
    ],
  },
};

/**
 * Categorías de salud basadas en el score total
 */
export const HealthCategories = {
  HEALTHY: { minScore: 0.7, action: "nurture", color: "green", emoji: "💚" },
  AT_RISK: { minScore: 0.4, action: "winback_light", color: "yellow", emoji: "💛" },
  CHURNING: { minScore: 0.2, action: "winback_aggressive", color: "orange", emoji: "🧡" },
  CHURNED: { minScore: 0, action: "reactivation_campaign", color: "red", emoji: "❤️" },
};

/**
 * Calcula el score de un componente específico
 */
function calculateComponentScore(componentName, value) {
  const config = HealthScoreConfig[componentName];
  
  if (!config) {
    logger.warn({ componentName }, "Unknown health score component");
    return 0.5; // Default neutral
  }

  // Encontrar el threshold aplicable
  for (const threshold of config.thresholds) {
    let matches = false;

    switch (componentName) {
      case "RECENCY":
        matches = value <= threshold.maxDays;
        break;
      case "FREQUENCY":
        matches = value >= threshold.minVisits;
        break;
      case "MONETARY":
        matches = value >= threshold.minRatio;
        break;
      case "SENTIMENT":
        matches = value >= threshold.minScore;
        break;
      case "ENGAGEMENT":
        matches = value >= threshold.minInteractions;
        break;
    }

    if (matches) {
      return threshold.score;
    }
  }

  // Último threshold como fallback
  return config.thresholds[config.thresholds.length - 1].score;
}

/**
 * Calcula el Health Score completo de un cliente
 */
export function calculateHealthScore(customerData) {
  const {
    daysSinceLastVisit = 999,
    visitsLast30Days = 0,
    avgTicketRatio = 0.5,    // ratio vs promedio tienda
    avgSentiment = 3,        // 1-5 scale
    interactionsLast30Days = 0,
  } = customerData;

  // Calcular score de cada componente
  const components = {
    recency: {
      value: daysSinceLastVisit,
      score: calculateComponentScore("RECENCY", daysSinceLastVisit),
      weight: HealthScoreConfig.RECENCY.weight,
    },
    frequency: {
      value: visitsLast30Days,
      score: calculateComponentScore("FREQUENCY", visitsLast30Days),
      weight: HealthScoreConfig.FREQUENCY.weight,
    },
    monetary: {
      value: avgTicketRatio,
      score: calculateComponentScore("MONETARY", avgTicketRatio),
      weight: HealthScoreConfig.MONETARY.weight,
    },
    sentiment: {
      value: avgSentiment,
      score: calculateComponentScore("SENTIMENT", avgSentiment),
      weight: HealthScoreConfig.SENTIMENT.weight,
    },
    engagement: {
      value: interactionsLast30Days,
      score: calculateComponentScore("ENGAGEMENT", interactionsLast30Days),
      weight: HealthScoreConfig.ENGAGEMENT.weight,
    },
  };

  // Calcular score total ponderado
  const totalScore = Object.values(components).reduce(
    (sum, c) => sum + c.score * c.weight,
    0
  );

  // Determinar categoría
  let category = "CHURNED";
  for (const [name, config] of Object.entries(HealthCategories)) {
    if (totalScore >= config.minScore) {
      category = name;
      break;
    }
  }

  const categoryConfig = HealthCategories[category];

  return {
    score: Math.round(totalScore * 100) / 100,
    category,
    action: categoryConfig.action,
    color: categoryConfig.color,
    emoji: categoryConfig.emoji,
    components,
    calculatedAt: new Date().toISOString(),
  };
}

/**
 * Determina la acción recomendada basada en el health score
 */
export function getRecommendedAction(healthScore) {
  const actions = {
    nurture: {
      type: "NURTURE",
      priority: "LOW",
      description: "Cliente saludable - mantener engagement",
      tactics: ["loyalty_rewards", "exclusive_offers", "birthday_reminder"],
    },
    winback_light: {
      type: "WINBACK_LIGHT",
      priority: "MEDIUM",
      description: "Cliente en riesgo - acción preventiva",
      tactics: ["personalized_offer", "check_in_message", "feedback_request"],
    },
    winback_aggressive: {
      type: "WINBACK_AGGRESSIVE",
      priority: "HIGH",
      description: "Cliente perdiendo - acción urgente",
      tactics: ["significant_discount", "direct_call", "special_experience"],
    },
    reactivation_campaign: {
      type: "REACTIVATION",
      priority: "CRITICAL",
      description: "Cliente perdido - campaña de reactivación",
      tactics: ["we_miss_you", "major_incentive", "new_product_announcement"],
    },
  };

  return actions[healthScore.action] || actions.nurture;
}

/**
 * Calcula el potencial de recuperación (win-back probability)
 */
export function calculateWinbackPotential(healthScore, customerHistory) {
  let potential = 0.5; // Base 50%

  // Ajustar por health score actual
  if (healthScore.score >= 0.4) potential += 0.2;
  else if (healthScore.score >= 0.2) potential += 0.1;
  else potential -= 0.1;

  // Ajustar por historial
  if (customerHistory) {
    // Si fue VIP antes, más probabilidad
    if (customerHistory.wasVIP) potential += 0.15;
    
    // Si respondió a win-backs anteriores
    if (customerHistory.respondedToWinback) potential += 0.2;
    
    // Si tuvo mala experiencia reciente, menos probabilidad
    if (customerHistory.hadBadExperience) potential -= 0.2;
    
    // Tiempo como cliente
    if (customerHistory.monthsAsCustomer > 12) potential += 0.1;
    else if (customerHistory.monthsAsCustomer > 6) potential += 0.05;
  }

  return Math.max(0, Math.min(1, potential));
}

/**
 * Detecta señales de churn en un cliente
 */
export function detectChurnSignals(currentData, historicalData) {
  const signals = [];

  // Señal 1: Caída en frecuencia
  if (historicalData.avgVisitsPerMonth && currentData.visitsLast30Days) {
    const frequencyDrop = 1 - (currentData.visitsLast30Days / historicalData.avgVisitsPerMonth);
    if (frequencyDrop > 0.5) {
      signals.push({
        type: "FREQUENCY_DROP",
        severity: frequencyDrop > 0.7 ? "HIGH" : "MEDIUM",
        value: Math.round(frequencyDrop * 100),
        message: `Frecuencia cayó ${Math.round(frequencyDrop * 100)}%`,
      });
    }
  }

  // Señal 2: Aumento en días desde última visita
  if (currentData.daysSinceLastVisit > 30) {
    signals.push({
      type: "RECENCY_WARNING",
      severity: currentData.daysSinceLastVisit > 60 ? "HIGH" : "MEDIUM",
      value: currentData.daysSinceLastVisit,
      message: `${currentData.daysSinceLastVisit} días sin visitar`,
    });
  }

  // Señal 3: Caída en ticket promedio
  if (historicalData.avgTicket && currentData.lastTicket) {
    const ticketDrop = 1 - (currentData.lastTicket / historicalData.avgTicket);
    if (ticketDrop > 0.3) {
      signals.push({
        type: "TICKET_DROP",
        severity: ticketDrop > 0.5 ? "MEDIUM" : "LOW",
        value: Math.round(ticketDrop * 100),
        message: `Ticket cayó ${Math.round(ticketDrop * 100)}%`,
      });
    }
  }

  // Señal 4: Sentimiento negativo reciente
  if (currentData.recentSentiment && currentData.recentSentiment < 3) {
    signals.push({
      type: "NEGATIVE_SENTIMENT",
      severity: currentData.recentSentiment < 2 ? "HIGH" : "MEDIUM",
      value: currentData.recentSentiment,
      message: `Sentimiento reciente bajo (${currentData.recentSentiment}/5)`,
    });
  }

  // Señal 5: Queja no resuelta
  if (currentData.unresolvedComplaints > 0) {
    signals.push({
      type: "UNRESOLVED_COMPLAINT",
      severity: "HIGH",
      value: currentData.unresolvedComplaints,
      message: `${currentData.unresolvedComplaints} queja(s) sin resolver`,
    });
  }

  return signals;
}

/**
 * Segmenta clientes por health score
 */
export function segmentCustomers(customers) {
  const segments = {
    HEALTHY: [],
    AT_RISK: [],
    CHURNING: [],
    CHURNED: [],
  };

  for (const customer of customers) {
    const health = calculateHealthScore(customer);
    segments[health.category].push({
      ...customer,
      healthScore: health,
    });
  }

  return segments;
}

export default {
  HealthScoreConfig,
  HealthCategories,
  calculateHealthScore,
  getRecommendedAction,
  calculateWinbackPotential,
  detectChurnSignals,
  segmentCustomers,
};
