/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SWEETHEARTING PATTERN - Descuentos a Conocidos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta cuando un empleado da descuentos excesivos, probablemente a
 * amigos, familiares o a sí mismo.
 * 
 * Señales:
 * - % descuento > 2σ vs peers
 * - Mismo cliente repite > 3 veces en 7 días
 * - Descuentos tipo "cortesía" frecuentes
 * - Alta proporción de efectivo en descuentos
 */

import { logger } from "@tagers/shared";

export const PATTERN_ID = "sweethearting";
export const PATTERN_NAME = "Descuentos a Conocidos (Sweethearting)";

// Configuración de umbrales
const THRESHOLDS = {
  discountStdDevMultiplier: 2,      // Descuento > 2 desviaciones estándar
  customerRepeatThreshold: 3,       // Mismo cliente 3+ veces
  customerRepeatDays: 7,            // En ventana de 7 días
  courtesyDiscountThreshold: 5,     // 5+ descuentos "cortesía" en periodo
  cashPreferenceThreshold: 0.7,     // 70%+ en efectivo
  minTransactionsForAnalysis: 20,   // Mínimo de transacciones para analizar
};

// Pesos para calcular confianza
const CONFIDENCE_WEIGHTS = {
  discountAnomaly: 0.35,
  customerRepeat: 0.30,
  cashPreference: 0.20,
  timePattern: 0.15,
};

/**
 * Analiza transacciones en busca de sweethearting
 * @param {Object} data - Datos de transacciones
 * @param {Object} scope - Scope del análisis (branch, dates)
 * @returns {Array} Findings de sweethearting
 */
export async function analyze(data, scope = {}) {
  const findings = [];
  
  const { transactions = [], employees = [] } = data;
  
  if (transactions.length < THRESHOLDS.minTransactionsForAnalysis) {
    logger.debug({ count: transactions.length }, "Insufficient transactions for sweethearting analysis");
    return findings;
  }
  
  // Agrupar transacciones por empleado
  const byEmployee = groupByEmployee(transactions);
  
  // Calcular estadísticas globales de descuentos
  const globalStats = calculateGlobalDiscountStats(transactions);
  
  for (const [employeeId, empTransactions] of Object.entries(byEmployee)) {
    const employeeFindings = await analyzeEmployee(
      employeeId, 
      empTransactions, 
      globalStats,
      scope
    );
    findings.push(...employeeFindings);
  }
  
  logger.info({ 
    employeesAnalyzed: Object.keys(byEmployee).length,
    findingsCount: findings.length 
  }, "Sweethearting analysis complete");
  
  return findings;
}

/**
 * Analiza un empleado individual
 */
async function analyzeEmployee(employeeId, transactions, globalStats, scope) {
  const findings = [];
  
  // 1. Verificar anomalía de descuentos
  const discountAnomaly = analyzeDiscountAnomaly(transactions, globalStats);
  
  // 2. Verificar repetición de clientes
  const customerRepeat = analyzeCustomerRepeat(transactions);
  
  // 3. Verificar preferencia de efectivo
  const cashPreference = analyzeCashPreference(transactions);
  
  // 4. Verificar patrón de tiempo
  const timePattern = analyzeTimePattern(transactions);
  
  // Calcular score de confianza compuesto
  const confidence = calculateConfidence({
    discountAnomaly,
    customerRepeat,
    cashPreference,
    timePattern,
  });
  
  // Si hay señales suficientes, crear finding
  if (confidence >= 0.6) {
    const severity = getSeverity(confidence);
    
    findings.push({
      type: PATTERN_ID,
      pattern_name: PATTERN_NAME,
      severity,
      confidence,
      employee_id: employeeId,
      branch_id: scope.branch_id,
      title: `Posible sweethearting detectado - Empleado ${employeeId}`,
      description: buildDescription(discountAnomaly, customerRepeat, cashPreference, timePattern),
      evidence: {
        discount_anomaly: discountAnomaly,
        customer_repeat: customerRepeat,
        cash_preference: cashPreference,
        time_pattern: timePattern,
        transaction_count: transactions.length,
        analysis_period: {
          from: scope.dateFrom,
          to: scope.dateTo,
        },
      },
      metric_value: discountAnomaly.avgDiscountPct,
      baseline_value: globalStats.avgDiscountPct,
      deviation_pct: discountAnomaly.deviationPct,
      signals: collectSignals(discountAnomaly, customerRepeat, cashPreference, timePattern),
    });
  }
  
  return findings;
}

/**
 * Analiza anomalía de descuentos vs peers
 */
function analyzeDiscountAnomaly(transactions, globalStats) {
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  
  if (discountedTxs.length === 0) {
    return { detected: false, score: 0 };
  }
  
  const avgDiscountPct = discountedTxs.reduce((sum, t) => 
    sum + (t.discount_amount / t.subtotal * 100), 0) / discountedTxs.length;
  
  const discountRate = discountedTxs.length / transactions.length;
  
  // Calcular z-score
  const zScore = (avgDiscountPct - globalStats.avgDiscountPct) / globalStats.stdDevDiscountPct;
  
  const deviationPct = ((avgDiscountPct - globalStats.avgDiscountPct) / globalStats.avgDiscountPct) * 100;
  
  // Detectar si está por encima del umbral
  const detected = zScore > THRESHOLDS.discountStdDevMultiplier;
  
  // Score normalizado (0-1)
  const score = Math.min(1, Math.max(0, zScore / 4));
  
  return {
    detected,
    score,
    avgDiscountPct,
    globalAvgDiscountPct: globalStats.avgDiscountPct,
    zScore,
    deviationPct,
    discountRate,
    discountedTransactions: discountedTxs.length,
    totalTransactions: transactions.length,
    // Top descuentos para evidencia
    topDiscounts: discountedTxs
      .sort((a, b) => (b.discount_amount / b.subtotal) - (a.discount_amount / a.subtotal))
      .slice(0, 5)
      .map(t => ({
        transaction_id: t.transaction_id,
        date: t.date,
        discount_pct: (t.discount_amount / t.subtotal * 100).toFixed(1),
        discount_amount: t.discount_amount,
        discount_reason: t.discount_reason,
      })),
  };
}

/**
 * Analiza repetición de clientes
 */
function analyzeCustomerRepeat(transactions) {
  // Agrupar por cliente (usando identificador de cliente si existe)
  const byCustomer = {};
  
  for (const t of transactions) {
    // Usar customer_id, o combinación de teléfono/nombre si no hay ID
    const customerId = t.customer_id || t.customer_phone || t.customer_name || null;
    
    if (!customerId) continue;
    
    if (!byCustomer[customerId]) {
      byCustomer[customerId] = [];
    }
    byCustomer[customerId].push(t);
  }
  
  // Encontrar clientes que repiten mucho con descuentos
  const repeatCustomers = Object.entries(byCustomer)
    .filter(([_, txs]) => {
      const hasDiscounts = txs.some(t => t.discount_amount > 0);
      return txs.length >= THRESHOLDS.customerRepeatThreshold && hasDiscounts;
    })
    .map(([customerId, txs]) => ({
      customer_id: customerId,
      transaction_count: txs.length,
      discount_count: txs.filter(t => t.discount_amount > 0).length,
      total_discount: txs.reduce((sum, t) => sum + (t.discount_amount || 0), 0),
      dates: [...new Set(txs.map(t => t.date))],
    }))
    .sort((a, b) => b.transaction_count - a.transaction_count);
  
  const detected = repeatCustomers.length > 0;
  const score = Math.min(1, repeatCustomers.length / 3);
  
  return {
    detected,
    score,
    repeatCustomerCount: repeatCustomers.length,
    topRepeatCustomers: repeatCustomers.slice(0, 5),
    totalUniqueCustomers: Object.keys(byCustomer).length,
  };
}

/**
 * Analiza preferencia de efectivo en descuentos
 */
function analyzeCashPreference(transactions) {
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  
  if (discountedTxs.length === 0) {
    return { detected: false, score: 0 };
  }
  
  const cashDiscounts = discountedTxs.filter(t => 
    t.payment_method === "cash" || t.payment_method === "efectivo"
  );
  
  const cashPct = cashDiscounts.length / discountedTxs.length;
  
  // Comparar con % global de efectivo
  const allCashTxs = transactions.filter(t => 
    t.payment_method === "cash" || t.payment_method === "efectivo"
  );
  const globalCashPct = allCashTxs.length / transactions.length;
  
  const detected = cashPct > THRESHOLDS.cashPreferenceThreshold;
  const score = Math.min(1, (cashPct - globalCashPct) / 0.3);
  
  return {
    detected,
    score: Math.max(0, score),
    cashPctInDiscounts: cashPct,
    globalCashPct,
    cashDiscountCount: cashDiscounts.length,
    totalDiscountCount: discountedTxs.length,
  };
}

/**
 * Analiza patrón de tiempo (descuentos concentrados en horarios específicos)
 */
function analyzeTimePattern(transactions) {
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  
  if (discountedTxs.length < 5) {
    return { detected: false, score: 0 };
  }
  
  // Agrupar por hora del día
  const byHour = {};
  for (const t of discountedTxs) {
    const hour = new Date(t.created_at || t.date).getHours();
    byHour[hour] = (byHour[hour] || 0) + 1;
  }
  
  // Calcular coeficiente de Gini (concentración)
  const counts = Object.values(byHour);
  const gini = calculateGiniCoefficient(counts);
  
  // Encontrar hora pico
  const peakHour = Object.entries(byHour)
    .sort((a, b) => b[1] - a[1])[0];
  
  // Detectar si hay concentración anormal
  const detected = gini > 0.5;
  const score = Math.min(1, gini);
  
  return {
    detected,
    score,
    giniCoefficient: gini,
    peakHour: peakHour ? parseInt(peakHour[0]) : null,
    peakHourCount: peakHour ? peakHour[1] : 0,
    distributionByHour: byHour,
  };
}

/**
 * Calcula confianza compuesta
 */
function calculateConfidence(signals) {
  let confidence = 0;
  
  if (signals.discountAnomaly.detected) {
    confidence += CONFIDENCE_WEIGHTS.discountAnomaly * signals.discountAnomaly.score;
  }
  if (signals.customerRepeat.detected) {
    confidence += CONFIDENCE_WEIGHTS.customerRepeat * signals.customerRepeat.score;
  }
  if (signals.cashPreference.detected) {
    confidence += CONFIDENCE_WEIGHTS.cashPreference * signals.cashPreference.score;
  }
  if (signals.timePattern.detected) {
    confidence += CONFIDENCE_WEIGHTS.timePattern * signals.timePattern.score;
  }
  
  // Bonus por múltiples señales
  const signalCount = [
    signals.discountAnomaly.detected,
    signals.customerRepeat.detected,
    signals.cashPreference.detected,
    signals.timePattern.detected,
  ].filter(Boolean).length;
  
  if (signalCount >= 3) {
    confidence = Math.min(1, confidence * 1.2);
  }
  
  return Math.round(confidence * 100) / 100;
}

/**
 * Determina severidad basada en confianza
 */
function getSeverity(confidence) {
  if (confidence >= 0.85) return "CRITICAL";
  if (confidence >= 0.75) return "HIGH";
  if (confidence >= 0.65) return "MEDIUM";
  return "LOW";
}

/**
 * Construye descripción legible
 */
function buildDescription(discountAnomaly, customerRepeat, cashPreference, timePattern) {
  const parts = [];
  
  if (discountAnomaly.detected) {
    parts.push(`Descuentos ${discountAnomaly.deviationPct.toFixed(0)}% superiores al promedio`);
  }
  if (customerRepeat.detected) {
    parts.push(`${customerRepeat.repeatCustomerCount} cliente(s) repiten frecuentemente con descuentos`);
  }
  if (cashPreference.detected) {
    parts.push(`${(cashPreference.cashPctInDiscounts * 100).toFixed(0)}% de descuentos en efectivo`);
  }
  if (timePattern.detected) {
    parts.push(`Descuentos concentrados alrededor de las ${timePattern.peakHour}:00`);
  }
  
  return parts.join(". ") + ".";
}

/**
 * Recolecta señales detectadas
 */
function collectSignals(discountAnomaly, customerRepeat, cashPreference, timePattern) {
  const signals = [];
  
  if (discountAnomaly.detected) {
    signals.push({
      type: "discount_anomaly",
      description: `Z-score: ${discountAnomaly.zScore.toFixed(2)}`,
      severity: discountAnomaly.zScore > 3 ? "high" : "medium",
    });
  }
  if (customerRepeat.detected) {
    signals.push({
      type: "customer_repeat",
      description: `${customerRepeat.repeatCustomerCount} clientes repetidos`,
      severity: customerRepeat.repeatCustomerCount > 3 ? "high" : "medium",
    });
  }
  if (cashPreference.detected) {
    signals.push({
      type: "cash_preference",
      description: `${(cashPreference.cashPctInDiscounts * 100).toFixed(0)}% efectivo en descuentos`,
      severity: cashPreference.cashPctInDiscounts > 0.85 ? "high" : "medium",
    });
  }
  if (timePattern.detected) {
    signals.push({
      type: "time_concentration",
      description: `Gini: ${timePattern.giniCoefficient.toFixed(2)}`,
      severity: timePattern.giniCoefficient > 0.7 ? "high" : "medium",
    });
  }
  
  return signals;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function groupByEmployee(transactions) {
  return transactions.reduce((acc, t) => {
    const empId = t.employee_id || t.cashier_id || "unknown";
    if (!acc[empId]) acc[empId] = [];
    acc[empId].push(t);
    return acc;
  }, {});
}

function calculateGlobalDiscountStats(transactions) {
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  
  if (discountedTxs.length === 0) {
    return { avgDiscountPct: 0, stdDevDiscountPct: 1 };
  }
  
  const discountPcts = discountedTxs.map(t => t.discount_amount / t.subtotal * 100);
  
  const avg = discountPcts.reduce((a, b) => a + b, 0) / discountPcts.length;
  const variance = discountPcts.reduce((sum, p) => sum + Math.pow(p - avg, 2), 0) / discountPcts.length;
  const stdDev = Math.sqrt(variance) || 1;
  
  return {
    avgDiscountPct: avg,
    stdDevDiscountPct: stdDev,
    discountRate: discountedTxs.length / transactions.length,
  };
}

function calculateGiniCoefficient(values) {
  if (values.length === 0) return 0;
  
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const sum = sorted.reduce((a, b) => a + b, 0);
  
  if (sum === 0) return 0;
  
  let giniSum = 0;
  for (let i = 0; i < n; i++) {
    giniSum += (2 * (i + 1) - n - 1) * sorted[i];
  }
  
  return giniSum / (n * sum);
}

export default {
  PATTERN_ID,
  PATTERN_NAME,
  THRESHOLDS,
  CONFIDENCE_WEIGHTS,
  analyze,
};
