/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SALES ANOMALY DETECTOR - "El Forense"
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta anomalías en ventas:
 * - Caídas significativas vs baseline
 * - Picos inusuales (también puede ser problema)
 * - Patrones por hora anormales
 * 
 * Thresholds configurables en registry_detectors.thresholds:
 * - drop_threshold_pct: -15 (alerta si cae más de 15%)
 * - spike_threshold_pct: 30 (alerta si sube más de 30%)
 * - critical_drop_pct: -25 (crítico si cae más de 25%)
 */

import { BaseDetector } from "../BaseDetector.js";
import { logger } from "@tagers/shared";

export class SalesAnomalyDetector extends BaseDetector {
  constructor(config) {
    super(config);
    
    // Defaults para thresholds
    this.dropThreshold = this.thresholds.drop_threshold_pct || -15;
    this.spikeThreshold = this.thresholds.spike_threshold_pct || 30;
    this.criticalDropThreshold = this.thresholds.critical_drop_pct || -25;
    this.minDataPoints = this.thresholds.min_data_points || 5;
  }

  /**
   * Analiza los datos y genera findings
   */
  async analyze(data, scope) {
    const findings = [];
    
    // 1. Análisis de ventas diarias
    if (data.salesDaily && data.salesDaily.length > 0) {
      const dailyFindings = this.analyzeDailySales(data.salesDaily);
      findings.push(...dailyFindings);
    }
    
    // 2. Análisis de ventas por hora (si hay datos de hoy)
    if (data.salesHourly && data.salesHourly.length > 0) {
      const hourlyFindings = this.analyzeHourlySales(data.salesHourly);
      findings.push(...hourlyFindings);
    }
    
    logger.info({
      detector: this.detectorId,
      dailyRecords: data.salesDaily?.length || 0,
      hourlyRecords: data.salesHourly?.length || 0,
      findingsGenerated: findings.length,
    }, "Sales analysis completed");
    
    return findings;
  }

  /**
   * Analiza ventas diarias por sucursal
   */
  analyzeDailySales(salesDaily) {
    const findings = [];
    
    // Agrupar por sucursal
    const byBranch = this.groupBy(salesDaily, "branch_id");
    
    for (const [branchId, records] of Object.entries(byBranch)) {
      if (records.length < this.minDataPoints) continue;
      
      // Ordenar por fecha (más reciente primero)
      records.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));
      
      // Último día vs promedio de los anteriores
      const latest = records[0];
      const historical = records.slice(1);
      
      if (historical.length < 3) continue;
      
      // Calcular baseline (promedio de días anteriores)
      const baselineValues = historical.map(r => parseFloat(r.venta_total) || 0);
      const baseline = this.calculateBaseline(baselineValues);
      const stdDev = this.calculateStdDev(baselineValues, baseline);
      
      const currentValue = parseFloat(latest.venta_total) || 0;
      
      if (baseline === 0) continue;
      
      // Calcular variación porcentual
      const deviationPct = ((currentValue - baseline) / baseline) * 100;
      
      // Detectar anomalías
      if (deviationPct <= this.criticalDropThreshold) {
        findings.push({
          type: "anomaly",
          severity: "critical",
          confidence: 0.95,
          title: `🚨 Caída CRÍTICA de ventas en ${branchId}`,
          description: `Las ventas del ${latest.fecha} cayeron ${Math.abs(deviationPct).toFixed(1)}% vs el promedio histórico. ` +
                      `Venta actual: $${currentValue.toLocaleString()}, Baseline: $${baseline.toLocaleString()}`,
          branch_id: branchId,
          metric_id: "sales_total",
          metric_value: currentValue,
          baseline_value: baseline,
          deviation_pct: deviationPct,
          date_range: { date: latest.fecha },
          evidence: {
            current: { date: latest.fecha, value: currentValue },
            baseline: { days: historical.length, average: baseline, stdDev },
            historical: historical.slice(0, 5).map(r => ({
              date: r.fecha,
              value: parseFloat(r.venta_total),
            })),
          },
        });
      } else if (deviationPct <= this.dropThreshold) {
        findings.push({
          type: "anomaly",
          severity: "high",
          confidence: 0.85,
          title: `⚠️ Caída de ventas en ${branchId}`,
          description: `Las ventas del ${latest.fecha} cayeron ${Math.abs(deviationPct).toFixed(1)}% vs el promedio histórico. ` +
                      `Venta actual: $${currentValue.toLocaleString()}, Baseline: $${baseline.toLocaleString()}`,
          branch_id: branchId,
          metric_id: "sales_total",
          metric_value: currentValue,
          baseline_value: baseline,
          deviation_pct: deviationPct,
          date_range: { date: latest.fecha },
          evidence: {
            current: { date: latest.fecha, value: currentValue },
            baseline: { days: historical.length, average: baseline, stdDev },
          },
        });
      } else if (deviationPct >= this.spikeThreshold) {
        findings.push({
          type: "anomaly",
          severity: "medium",
          confidence: 0.8,
          title: `📈 Pico inusual de ventas en ${branchId}`,
          description: `Las ventas del ${latest.fecha} subieron ${deviationPct.toFixed(1)}% vs el promedio histórico. ` +
                      `Venta actual: $${currentValue.toLocaleString()}, Baseline: $${baseline.toLocaleString()}. ` +
                      `Verificar si es válido o posible error.`,
          branch_id: branchId,
          metric_id: "sales_total",
          metric_value: currentValue,
          baseline_value: baseline,
          deviation_pct: deviationPct,
          date_range: { date: latest.fecha },
          evidence: {
            current: { date: latest.fecha, value: currentValue },
            baseline: { days: historical.length, average: baseline, stdDev },
          },
        });
      }
      
      // Detectar tendencia negativa (varios días consecutivos de caída)
      const trend = this.detectTrend(records.slice(0, 5));
      if (trend.isNegative && trend.consecutiveDays >= 3) {
        findings.push({
          type: "pattern",
          severity: "medium",
          confidence: 0.75,
          title: `📉 Tendencia negativa en ${branchId}`,
          description: `Las ventas han caído ${trend.consecutiveDays} días consecutivos. ` +
                      `Caída acumulada: ${trend.totalDrop.toFixed(1)}%`,
          branch_id: branchId,
          metric_id: "sales_trend",
          metric_value: trend.totalDrop,
          evidence: {
            consecutiveDays: trend.consecutiveDays,
            values: trend.values,
          },
        });
      }
    }
    
    return findings;
  }

  /**
   * Analiza ventas por hora del día actual
   */
  analyzeHourlySales(salesHourly) {
    const findings = [];
    const today = new Date().toISOString().split("T")[0];
    
    // Filtrar solo datos de hoy
    const todayData = salesHourly.filter(r => r.fecha === today);
    if (todayData.length === 0) return findings;
    
    // Agrupar por sucursal
    const byBranch = this.groupBy(todayData, "branch_id");
    
    for (const [branchId, records] of Object.entries(byBranch)) {
      // Detectar horas sin ventas durante horario operativo
      const hoursWithSales = new Set(records.map(r => parseInt(r.hora)));
      const currentHour = new Date().getHours();
      
      // Horario operativo típico: 8am a 10pm
      const operatingStart = this.thresholds.operating_hours_start || 8;
      const operatingEnd = this.thresholds.operating_hours_end || 22;
      
      // Buscar gaps de más de 2 horas consecutivas sin ventas
      let consecutiveGap = 0;
      let gapStart = null;
      
      for (let hour = operatingStart; hour <= Math.min(currentHour, operatingEnd); hour++) {
        if (!hoursWithSales.has(hour)) {
          if (consecutiveGap === 0) gapStart = hour;
          consecutiveGap++;
        } else {
          if (consecutiveGap >= 2) {
            findings.push({
              type: "threshold_breach",
              severity: "high",
              confidence: 0.9,
              title: `⏰ Gap de ventas en ${branchId}`,
              description: `Sin ventas registradas de ${gapStart}:00 a ${hour-1}:59. ` +
                          `${consecutiveGap} horas sin actividad durante horario operativo.`,
              branch_id: branchId,
              metric_id: "sales_gap_hours",
              metric_value: consecutiveGap,
              date_range: { date: today, hourStart: gapStart, hourEnd: hour - 1 },
              evidence: {
                gapHours: consecutiveGap,
                gapStart,
                gapEnd: hour - 1,
                hoursWithSales: Array.from(hoursWithSales).sort((a, b) => a - b),
              },
            });
          }
          consecutiveGap = 0;
          gapStart = null;
        }
      }
      
      // Check gap en curso
      if (consecutiveGap >= 2 && currentHour >= operatingStart) {
        findings.push({
          type: "threshold_breach",
          severity: consecutiveGap >= 3 ? "critical" : "high",
          confidence: 0.9,
          title: `🚨 Sin ventas actuales en ${branchId}`,
          description: `Sin ventas registradas desde ${gapStart}:00. ` +
                      `${consecutiveGap} horas sin actividad. ¿Problema operativo?`,
          branch_id: branchId,
          metric_id: "sales_gap_hours",
          metric_value: consecutiveGap,
          date_range: { date: today, hourStart: gapStart, hourEnd: currentHour },
          evidence: {
            gapHours: consecutiveGap,
            gapStart,
            currentHour,
            hoursWithSales: Array.from(hoursWithSales).sort((a, b) => a - b),
          },
        });
      }
    }
    
    return findings;
  }

  /**
   * Detecta tendencia en los últimos N días
   */
  detectTrend(records) {
    if (records.length < 2) {
      return { isNegative: false, consecutiveDays: 0, totalDrop: 0, values: [] };
    }
    
    let consecutiveDays = 0;
    let totalDrop = 0;
    const values = [];
    
    for (let i = 0; i < records.length - 1; i++) {
      const current = parseFloat(records[i].venta_total) || 0;
      const previous = parseFloat(records[i + 1].venta_total) || 0;
      
      values.push({
        date: records[i].fecha,
        value: current,
        change: previous > 0 ? ((current - previous) / previous * 100) : 0,
      });
      
      if (previous > 0 && current < previous) {
        consecutiveDays++;
        totalDrop += ((current - previous) / previous * 100);
      } else {
        break;
      }
    }
    
    return {
      isNegative: consecutiveDays >= 2,
      consecutiveDays,
      totalDrop,
      values,
    };
  }

  /**
   * Helper para agrupar array por propiedad
   */
  groupBy(array, key) {
    return array.reduce((result, item) => {
      const group = item[key];
      if (!result[group]) result[group] = [];
      result[group].push(item);
      return result;
    }, {});
  }
}

export default SalesAnomalyDetector;
