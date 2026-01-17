/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COLLUSION PATTERN - Posible Colusión
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta cuando una combinación específica de cajero + mesero + cliente
 * se repite frecuentemente, especialmente con descuentos aplicados.
 * 
 * Señales:
 * - Misma combinación (cajero, mesero, cliente) > 3 veces
 * - Descuento aplicado en cada ocasión
 * - Varianza baja en montos (pedidos similares)
 */

import { logger } from "@tagers/shared";

export const PATTERN_ID = "collusion";
export const PATTERN_NAME = "Posible Colusión";

const THRESHOLDS = {
  comboRepeatMin: 3,             // Misma combinación 3+ veces
  discountRateInCombo: 0.7,      // 70%+ con descuento
  amountVarianceThreshold: 0.3,  // Varianza baja en montos
  minTransactionsForAnalysis: 50,
  timeWindowDays: 30,            // Ventana de análisis
};

const CONFIDENCE_WEIGHTS = {
  comboRepeat: 0.45,
  discountRate: 0.35,
  amountVariance: 0.20,
};

/**
 * Analiza transacciones en busca de colusión
 */
export async function analyze(data, scope = {}) {
  const findings = [];
  const { transactions = [] } = data;
  
  if (transactions.length < THRESHOLDS.minTransactionsForAnalysis) {
    return findings;
  }
  
  // Encontrar combinaciones sospechosas
  const combos = findSuspiciousCombos(transactions);
  
  for (const combo of combos) {
    const finding = analyzeCombo(combo, scope);
    if (finding) {
      findings.push(finding);
    }
  }
  
  logger.info({ 
    pattern: PATTERN_ID,
    findingsCount: findings.length,
    combosAnalyzed: combos.length,
  }, "Collusion analysis complete");
  
  return findings;
}

/**
 * Encuentra combinaciones que se repiten frecuentemente
 */
function findSuspiciousCombos(transactions) {
  // Crear key para cada combinación
  const comboMap = {};
  
  for (const t of transactions) {
    const cashierId = t.cashier_id || t.employee_id || "unknown";
    const serverId = t.server_id || t.waiter_id || "none";
    const customerId = t.customer_id || t.customer_phone || t.customer_name || "anonymous";
    
    // Solo considerar si hay identificación del cliente
    if (customerId === "anonymous") continue;
    
    const key = `${cashierId}|${serverId}|${customerId}`;
    
    if (!comboMap[key]) {
      comboMap[key] = {
        key,
        cashier_id: cashierId,
        server_id: serverId,
        customer_id: customerId,
        transactions: [],
      };
    }
    
    comboMap[key].transactions.push(t);
  }
  
  // Filtrar por umbral de repetición
  return Object.values(comboMap)
    .filter(combo => combo.transactions.length >= THRESHOLDS.comboRepeatMin)
    .sort((a, b) => b.transactions.length - a.transactions.length);
}

/**
 * Analiza una combinación específica
 */
function analyzeCombo(combo, scope) {
  const { transactions } = combo;
  
  // 1. Tasa de descuento en la combinación
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  const discountRate = discountedTxs.length / transactions.length;
  const discountRateDetected = discountRate >= THRESHOLDS.discountRateInCombo;
  
  // 2. Repetición de combinación
  const repeatCount = transactions.length;
  const repeatScore = Math.min(1, (repeatCount - THRESHOLDS.comboRepeatMin) / 7);
  
  // 3. Varianza en montos (baja = sospechoso)
  const amounts = transactions.map(t => t.total || t.subtotal);
  const avgAmount = amounts.reduce((a, b) => a + b, 0) / amounts.length;
  const variance = amounts.reduce((sum, a) => sum + Math.pow(a - avgAmount, 2), 0) / amounts.length;
  const coeffOfVariation = avgAmount > 0 ? Math.sqrt(variance) / avgAmount : 0;
  const lowVarianceDetected = coeffOfVariation < THRESHOLDS.amountVarianceThreshold;
  
  // Calcular scores
  const signals = {
    comboRepeat: {
      detected: true, // Ya filtrado
      score: repeatScore,
      value: repeatCount,
    },
    discountRate: {
      detected: discountRateDetected,
      score: discountRateDetected ? Math.min(1, discountRate / 0.9) : 0,
      value: discountRate,
    },
    amountVariance: {
      detected: lowVarianceDetected,
      score: lowVarianceDetected ? Math.min(1, (THRESHOLDS.amountVarianceThreshold - coeffOfVariation) / 0.2) : 0,
      value: coeffOfVariation,
    },
  };
  
  // Calcular confianza
  let confidence = 0;
  confidence += CONFIDENCE_WEIGHTS.comboRepeat * signals.comboRepeat.score;
  if (signals.discountRate.detected) {
    confidence += CONFIDENCE_WEIGHTS.discountRate * signals.discountRate.score;
  }
  if (signals.amountVariance.detected) {
    confidence += CONFIDENCE_WEIGHTS.amountVariance * signals.amountVariance.score;
  }
  
  // Bonus por todas las señales juntas
  const signalCount = [
    true, // comboRepeat siempre presente
    signals.discountRate.detected,
    signals.amountVariance.detected,
  ].filter(Boolean).length;
  
  if (signalCount === 3) {
    confidence = Math.min(1, confidence * 1.3);
  }
  
  // Umbral mínimo
  if (confidence < 0.55) {
    return null;
  }
  
  const severity = getSeverity(confidence);
  
  // Determinar empleados involucrados
  const employees = [combo.cashier_id];
  if (combo.server_id !== "none") {
    employees.push(combo.server_id);
  }
  
  // Calcular total de pérdida
  const totalDiscount = discountedTxs.reduce((sum, t) => sum + (t.discount_amount || 0), 0);
  
  return {
    type: PATTERN_ID,
    pattern_name: PATTERN_NAME,
    severity,
    confidence: Math.round(confidence * 100) / 100,
    employee_id: combo.cashier_id, // Empleado principal
    employees_involved: employees,
    customer_id: combo.customer_id,
    branch_id: scope.branch_id,
    title: `Posible colusión detectada - ${repeatCount} transacciones con misma combinación`,
    description: buildDescription(signals, combo, discountedTxs.length, totalDiscount),
    evidence: {
      combo_key: combo.key,
      cashier_id: combo.cashier_id,
      server_id: combo.server_id,
      customer_id: combo.customer_id,
      repeat_count: repeatCount,
      discount_count: discountedTxs.length,
      discount_rate: discountRate,
      total_discount_amount: totalDiscount,
      avg_amount: avgAmount,
      coeff_of_variation: coeffOfVariation,
      transactions: transactions.map(t => ({
        transaction_id: t.transaction_id,
        date: t.date,
        total: t.total,
        discount: t.discount_amount || 0,
        discount_reason: t.discount_reason,
        payment_method: t.payment_method,
      })),
      date_range: {
        first: transactions[0]?.date,
        last: transactions[transactions.length - 1]?.date,
      },
    },
    metric_value: repeatCount,
    baseline_value: 1,
    deviation_pct: ((repeatCount - 1) / 1) * 100,
    signals: Object.entries(signals)
      .filter(([_, s]) => s.detected)
      .map(([type, s]) => ({
        type,
        value: s.value,
        severity: s.score > 0.7 ? "high" : "medium",
      })),
  };
}

function getSeverity(confidence) {
  if (confidence >= 0.85) return "CRITICAL";
  if (confidence >= 0.70) return "HIGH";
  if (confidence >= 0.55) return "MEDIUM";
  return "LOW";
}

function buildDescription(signals, combo, discountCount, totalDiscount) {
  const parts = [];
  
  parts.push(`${signals.comboRepeat.value} transacciones con misma combinación cajero-mesero-cliente`);
  
  if (signals.discountRate.detected) {
    parts.push(`${discountCount} con descuento (${(signals.discountRate.value * 100).toFixed(0)}%)`);
  }
  
  if (totalDiscount > 0) {
    parts.push(`Total descuentos: $${totalDiscount.toFixed(2)}`);
  }
  
  if (signals.amountVariance.detected) {
    parts.push(`Montos muy similares entre transacciones`);
  }
  
  return parts.join(". ") + ".";
}

export default {
  PATTERN_ID,
  PATTERN_NAME,
  THRESHOLDS,
  analyze,
};
