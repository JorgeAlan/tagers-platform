/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASH PREFERENCE PATTERN - Preferencia por Efectivo
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta cuando un empleado tiene preferencia anormal por efectivo,
 * especialmente en transacciones con descuento. Esto puede indicar
 * que está dando cortesías no registradas o manipulando transacciones.
 * 
 * Señales:
 * - % efectivo en descuentos > 80%
 * - % efectivo del empleado > peers + 30%
 * - Monto promedio en efectivo menor que tarjeta
 */

import { logger } from "@tagers/shared";

export const PATTERN_ID = "cash_preference";
export const PATTERN_NAME = "Preferencia por Efectivo";

const THRESHOLDS = {
  cashPctInDiscounts: 0.80,      // 80%+ de descuentos en efectivo
  cashPctVsPeers: 0.30,          // 30% más efectivo que peers
  minTransactions: 30,           // Mínimo para analizar
  minDiscountedTxs: 5,           // Mínimo de transacciones con descuento
  cashAvgTicketRatio: 0.7,       // Ticket promedio en efectivo < 70% del ticket tarjeta
};

const CONFIDENCE_WEIGHTS = {
  cashInDiscounts: 0.40,
  vsPeers: 0.35,
  ticketDifference: 0.25,
};

/**
 * Analiza transacciones en busca de preferencia de efectivo sospechosa
 */
export async function analyze(data, scope = {}) {
  const findings = [];
  const { transactions = [] } = data;
  
  if (transactions.length < THRESHOLDS.minTransactions) {
    return findings;
  }
  
  // Calcular estadísticas globales
  const globalStats = calculateGlobalCashStats(transactions);
  
  // Agrupar por empleado
  const byEmployee = groupByEmployee(transactions);
  
  for (const [employeeId, empTxs] of Object.entries(byEmployee)) {
    const finding = analyzeEmployee(employeeId, empTxs, globalStats, scope);
    if (finding) {
      findings.push(finding);
    }
  }
  
  logger.info({ 
    pattern: PATTERN_ID,
    findingsCount: findings.length 
  }, "Cash preference analysis complete");
  
  return findings;
}

function analyzeEmployee(employeeId, transactions, globalStats, scope) {
  // 1. Porcentaje de efectivo en descuentos
  const discountedTxs = transactions.filter(t => t.discount_amount > 0);
  
  if (discountedTxs.length < THRESHOLDS.minDiscountedTxs) {
    return null;
  }
  
  const cashInDiscounts = discountedTxs.filter(t => 
    t.payment_method === "cash" || t.payment_method === "efectivo"
  );
  const cashPctInDiscounts = cashInDiscounts.length / discountedTxs.length;
  
  // 2. Porcentaje de efectivo general vs peers
  const allCash = transactions.filter(t => 
    t.payment_method === "cash" || t.payment_method === "efectivo"
  );
  const employeeCashPct = allCash.length / transactions.length;
  const vsPeersDiff = employeeCashPct - globalStats.cashPct;
  
  // 3. Diferencia en ticket promedio (efectivo vs tarjeta)
  const cashTickets = allCash.map(t => t.total || t.subtotal);
  const cardTxs = transactions.filter(t => 
    t.payment_method !== "cash" && t.payment_method !== "efectivo"
  );
  const cardTickets = cardTxs.map(t => t.total || t.subtotal);
  
  const avgCashTicket = cashTickets.length > 0 
    ? cashTickets.reduce((a, b) => a + b, 0) / cashTickets.length 
    : 0;
  const avgCardTicket = cardTickets.length > 0 
    ? cardTickets.reduce((a, b) => a + b, 0) / cardTickets.length 
    : avgCashTicket;
  
  const ticketRatio = avgCardTicket > 0 ? avgCashTicket / avgCardTicket : 1;
  
  // Calcular scores
  const signals = {
    cashInDiscounts: {
      detected: cashPctInDiscounts >= THRESHOLDS.cashPctInDiscounts,
      score: Math.min(1, cashPctInDiscounts / THRESHOLDS.cashPctInDiscounts),
      value: cashPctInDiscounts,
    },
    vsPeers: {
      detected: vsPeersDiff >= THRESHOLDS.cashPctVsPeers,
      score: Math.min(1, vsPeersDiff / THRESHOLDS.cashPctVsPeers),
      value: vsPeersDiff,
    },
    ticketDifference: {
      detected: ticketRatio <= THRESHOLDS.cashAvgTicketRatio,
      score: ticketRatio <= THRESHOLDS.cashAvgTicketRatio 
        ? Math.min(1, (THRESHOLDS.cashAvgTicketRatio - ticketRatio) / 0.3)
        : 0,
      value: ticketRatio,
    },
  };
  
  // Calcular confianza
  let confidence = 0;
  if (signals.cashInDiscounts.detected) {
    confidence += CONFIDENCE_WEIGHTS.cashInDiscounts * signals.cashInDiscounts.score;
  }
  if (signals.vsPeers.detected) {
    confidence += CONFIDENCE_WEIGHTS.vsPeers * signals.vsPeers.score;
  }
  if (signals.ticketDifference.detected) {
    confidence += CONFIDENCE_WEIGHTS.ticketDifference * signals.ticketDifference.score;
  }
  
  // Umbral mínimo
  if (confidence < 0.55) {
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
    title: `Preferencia anormal por efectivo - Empleado ${employeeId}`,
    description: buildDescription(signals, employeeCashPct, globalStats.cashPct),
    evidence: {
      cash_pct_in_discounts: cashPctInDiscounts,
      employee_cash_pct: employeeCashPct,
      global_cash_pct: globalStats.cashPct,
      vs_peers_diff: vsPeersDiff,
      avg_cash_ticket: avgCashTicket,
      avg_card_ticket: avgCardTicket,
      ticket_ratio: ticketRatio,
      cash_transactions: allCash.length,
      discounted_transactions: discountedTxs.length,
      cash_in_discounts: cashInDiscounts.length,
      total_transactions: transactions.length,
      top_cash_discounts: cashInDiscounts
        .sort((a, b) => b.discount_amount - a.discount_amount)
        .slice(0, 5)
        .map(t => ({
          transaction_id: t.transaction_id,
          date: t.date,
          total: t.total,
          discount: t.discount_amount,
          discount_reason: t.discount_reason,
        })),
    },
    metric_value: cashPctInDiscounts * 100,
    baseline_value: globalStats.cashPct * 100,
    deviation_pct: ((cashPctInDiscounts - globalStats.cashPct) / globalStats.cashPct) * 100,
    signals: Object.entries(signals)
      .filter(([_, s]) => s.detected)
      .map(([type, s]) => ({
        type,
        value: s.value,
        severity: s.score > 0.8 ? "high" : "medium",
      })),
  };
}

function calculateGlobalCashStats(transactions) {
  const cashTxs = transactions.filter(t => 
    t.payment_method === "cash" || t.payment_method === "efectivo"
  );
  
  return {
    cashPct: cashTxs.length / transactions.length,
    cashCount: cashTxs.length,
    totalCount: transactions.length,
  };
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
  if (confidence >= 0.85) return "CRITICAL";
  if (confidence >= 0.70) return "HIGH";
  if (confidence >= 0.55) return "MEDIUM";
  return "LOW";
}

function buildDescription(signals, employeeCashPct, globalCashPct) {
  const parts = [];
  
  if (signals.cashInDiscounts.detected) {
    parts.push(`${(signals.cashInDiscounts.value * 100).toFixed(0)}% de descuentos pagados en efectivo`);
  }
  if (signals.vsPeers.detected) {
    parts.push(`${(signals.vsPeers.value * 100).toFixed(0)}% más efectivo que el promedio`);
  }
  if (signals.ticketDifference.detected) {
    parts.push(`Ticket promedio en efectivo ${((1 - signals.ticketDifference.value) * 100).toFixed(0)}% menor que tarjeta`);
  }
  
  return parts.join(". ") + ".";
}

export default {
  PATTERN_ID,
  PATTERN_NAME,
  THRESHOLDS,
  analyze,
};
