/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TIME CONCENTRATION PATTERN - Concentración Horaria
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta cuando descuentos/cortesías se concentran en horarios específicos,
 * especialmente durante horas de baja supervisión.
 * 
 * Señales:
 * - Descuentos concentrados en horas específicas (alto Gini)
 * - Horarios coinciden con baja supervisión
 * - Patrón diferente al del resto de empleados
 */

import { logger } from "@tagers/shared";

export const PATTERN_ID = "time_concentration";
export const PATTERN_NAME = "Concentración Horaria";

const THRESHOLDS = {
  giniThreshold: 0.5,            // Coeficiente de Gini > 0.5 indica concentración
  minDiscountedTxs: 10,          // Mínimo de transacciones con descuento
  lowSupervisionHours: [7, 8, 21, 22, 23], // Horas de baja supervisión
  peakHourPct: 0.40,             // 40%+ en una sola hora
};

const CONFIDENCE_WEIGHTS = {
  giniConcentration: 0.35,
  lowSupervisionMatch: 0.40,
  peakHourExcess: 0.25,
};

/**
 * Analiza transacciones en busca de concentración horaria sospechosa
 */
export async function analyze(data, scope = {}) {
  const findings = [];
  const { transactions = [] } = data;
  
  // Agrupar por empleado
  const byEmployee = groupByEmployee(transactions);
  
  // Calcular distribución global como baseline
  const globalDistribution = calculateHourDistribution(
    transactions.filter(t => t.discount_amount > 0)
  );
  
  for (const [employeeId, empTxs] of Object.entries(byEmployee)) {
    const finding = analyzeEmployee(employeeId, empTxs, globalDistribution, scope);
    if (finding) {
      findings.push(finding);
    }
  }
  
  logger.info({ 
    pattern: PATTERN_ID,
    findingsCount: findings.length 
  }, "Time concentration analysis complete");
  
  return findings;
}

function analyzeEmployee(employeeId, transactions, globalDistribution, scope) {
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  
  if (discountedTxs.length < THRESHOLDS.minDiscountedTxs) {
    return null;
  }
  
  // Calcular distribución horaria del empleado
  const empDistribution = calculateHourDistribution(discountedTxs);
  
  // 1. Coeficiente de Gini (concentración)
  const gini = calculateGiniCoefficient(Object.values(empDistribution.byHour));
  const giniDetected = gini > THRESHOLDS.giniThreshold;
  
  // 2. Match con horas de baja supervisión
  const lowSupervisionCount = THRESHOLDS.lowSupervisionHours
    .reduce((sum, h) => sum + (empDistribution.byHour[h] || 0), 0);
  const lowSupervisionPct = lowSupervisionCount / discountedTxs.length;
  const lowSupervisionDetected = lowSupervisionPct > 0.4;
  
  // 3. Concentración excesiva en hora pico
  const peakHourPct = empDistribution.peakHourCount / discountedTxs.length;
  const peakHourDetected = peakHourPct > THRESHOLDS.peakHourPct;
  
  // Calcular scores
  const signals = {
    giniConcentration: {
      detected: giniDetected,
      score: Math.min(1, gini / 0.8),
      value: gini,
    },
    lowSupervisionMatch: {
      detected: lowSupervisionDetected,
      score: Math.min(1, lowSupervisionPct / 0.6),
      value: lowSupervisionPct,
    },
    peakHourExcess: {
      detected: peakHourDetected,
      score: Math.min(1, peakHourPct / 0.6),
      value: peakHourPct,
    },
  };
  
  // Calcular confianza
  let confidence = 0;
  if (signals.giniConcentration.detected) {
    confidence += CONFIDENCE_WEIGHTS.giniConcentration * signals.giniConcentration.score;
  }
  if (signals.lowSupervisionMatch.detected) {
    confidence += CONFIDENCE_WEIGHTS.lowSupervisionMatch * signals.lowSupervisionMatch.score;
  }
  if (signals.peakHourExcess.detected) {
    confidence += CONFIDENCE_WEIGHTS.peakHourExcess * signals.peakHourExcess.score;
  }
  
  // Umbral mínimo
  if (confidence < 0.50) {
    return null;
  }
  
  const severity = getSeverity(confidence);
  
  return {
    type: PATTERN_ID,
    pattern_name: PATTERN_NAME,
    severity,
    confidence: Math.round(confidence * 100) / 100,
    employee_id: employeeId,
    branch_id: scope.branch_id,
    title: `Descuentos concentrados en horarios específicos - Empleado ${employeeId}`,
    description: buildDescription(signals, empDistribution),
    evidence: {
      gini_coefficient: gini,
      peak_hour: empDistribution.peakHour,
      peak_hour_count: empDistribution.peakHourCount,
      peak_hour_pct: peakHourPct,
      low_supervision_pct: lowSupervisionPct,
      distribution_by_hour: empDistribution.byHour,
      discounted_transactions: discountedTxs.length,
      total_transactions: transactions.length,
      // Detalle de descuentos en hora pico
      peak_hour_discounts: discountedTxs
        .filter(t => {
          const hour = new Date(t.created_at || t.date).getHours();
          return hour === empDistribution.peakHour;
        })
        .slice(0, 5)
        .map(t => ({
          transaction_id: t.transaction_id,
          date: t.date,
          time: t.created_at,
          discount: t.discount_amount,
          discount_reason: t.discount_reason,
        })),
    },
    metric_value: gini * 100,
    baseline_value: 30, // Gini esperado ~0.3 para distribución normal
    deviation_pct: ((gini - 0.3) / 0.3) * 100,
    signals: Object.entries(signals)
      .filter(([_, s]) => s.detected)
      .map(([type, s]) => ({
        type,
        value: s.value,
        severity: s.score > 0.7 ? "high" : "medium",
      })),
  };
}

function calculateHourDistribution(transactions) {
  const byHour = {};
  
  for (let h = 0; h < 24; h++) {
    byHour[h] = 0;
  }
  
  for (const t of transactions) {
    const hour = new Date(t.created_at || t.date).getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  }
  
  // Encontrar hora pico
  const peakEntry = Object.entries(byHour)
    .sort((a, b) => b[1] - a[1])[0];
  
  return {
    byHour,
    peakHour: peakEntry ? parseInt(peakEntry[0]) : 12,
    peakHourCount: peakEntry ? peakEntry[1] : 0,
  };
}

function calculateGiniCoefficient(values) {
  const filtered = values.filter(v => v > 0);
  if (filtered.length === 0) return 0;
  
  const sorted = [...filtered].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  if (sum === 0) return 0;
  
  let giniSum = 0;
  for (let i = 0; i < n; i++) {
    giniSum += (2 * (i + 1) - n - 1) * sorted[i];
  }
  
  return giniSum / (n * sum);
}

function groupByEmployee(transactions) {
  return transactions.reduce((acc, t) => {
    const empId = t.employee_id || t.cashier_id || "unknown";
    if (!acc[empId]) acc[empId] = [];
    acc[empId].push(t);
    return acc;
  }, {});
}

function getSeverity(confidence) {
  if (confidence >= 0.80) return "CRITICAL";
  if (confidence >= 0.65) return "HIGH";
  if (confidence >= 0.50) return "MEDIUM";
  return "LOW";
}

function buildDescription(signals, distribution) {
  const parts = [];
  
  if (signals.giniConcentration.detected) {
    parts.push(`Alta concentración de descuentos (Gini: ${signals.giniConcentration.value.toFixed(2)})`);
  }
  if (signals.peakHourExcess.detected) {
    parts.push(`${(signals.peakHourExcess.value * 100).toFixed(0)}% de descuentos a las ${distribution.peakHour}:00`);
  }
  if (signals.lowSupervisionMatch.detected) {
    parts.push(`${(signals.lowSupervisionMatch.value * 100).toFixed(0)}% en horarios de baja supervisión`);
  }
  
  return parts.join(". ") + ".";
}

export default {
  PATTERN_ID,
  PATTERN_NAME,
  THRESHOLDS,
  analyze,
};
