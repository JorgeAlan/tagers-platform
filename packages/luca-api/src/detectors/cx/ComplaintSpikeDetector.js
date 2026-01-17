/**
 * ═══════════════════════════════════════════════════════════════════════════
 * COMPLAINT SPIKE DETECTOR - Detecta Picos de Quejas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta aumentos anómalos en quejas:
 * - Por sucursal
 * - Por categoría (producto, servicio, tiempo de espera)
 * - Por canal (WhatsApp, Instagram, Facebook)
 * - Por empleado
 */

import { logger } from "@tagers/shared";
import { BaseDetector } from "../BaseDetector.js";

/**
 * Configuración del detector
 */
const DETECTOR_CONFIG = {
  thresholds: {
    spikePercent: 50,           // Alerta si quejas suben >50% vs baseline
    absoluteMin: 3,              // Mínimo de quejas para considerar spike
    criticalSpikePercent: 100,   // Crítico si suben >100%
  },
  categories: [
    "producto_calidad",
    "producto_faltante",
    "servicio_lento",
    "servicio_atencion",
    "precio",
    "limpieza",
    "pedido_incorrecto",
    "otro",
  ],
  lookbackDays: 7,
  baselineDays: 30,
};

export class ComplaintSpikeDetector extends BaseDetector {
  constructor() {
    super({
      name: "complaint_spike_detector",
      description: "Detecta picos anómalos de quejas",
      category: "cx",
      schedule: "0 */4 * * *", // Cada 4 horas
    });
    this.config = DETECTOR_CONFIG;
  }

  /**
   * Ejecuta la detección
   */
  async detect(context = {}) {
    logger.info({ context }, "ComplaintSpikeDetector running");

    const findings = [];

    try {
      // Obtener quejas recientes
      const recentComplaints = await this.getRecentComplaints(context);
      
      // Obtener baseline
      const baseline = await this.getComplaintBaseline(context);

      // Analizar por sucursal
      const branchFindings = this.analyzeByBranch(recentComplaints, baseline);
      findings.push(...branchFindings);

      // Analizar por categoría
      const categoryFindings = this.analyzeByCategory(recentComplaints, baseline);
      findings.push(...categoryFindings);

      // Analizar por canal
      const channelFindings = this.analyzeByChannel(recentComplaints, baseline);
      findings.push(...channelFindings);

      // Crear resumen
      const summary = this.createSummary(findings, recentComplaints);

      return {
        detector: this.name,
        timestamp: new Date().toISOString(),
        findings,
        summary,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "ComplaintSpikeDetector failed");
      throw err;
    }
  }

  /**
   * Analiza quejas por sucursal
   */
  analyzeByBranch(recentComplaints, baseline) {
    const findings = [];
    
    // Agrupar por sucursal
    const byBranch = this.groupBy(recentComplaints, "branchId");
    const baselineByBranch = this.groupBy(baseline.complaints || [], "branchId");

    for (const [branchId, complaints] of Object.entries(byBranch)) {
      const recentCount = complaints.length;
      const baselineCount = (baselineByBranch[branchId]?.length || 0) / (baseline.days / this.config.lookbackDays);
      
      if (recentCount < this.config.thresholds.absoluteMin) continue;

      const percentChange = baselineCount > 0 
        ? ((recentCount - baselineCount) / baselineCount) * 100 
        : 100;

      if (percentChange >= this.config.thresholds.spikePercent) {
        findings.push({
          findingId: `COMPLAINT-SPIKE-${branchId}-${Date.now()}`,
          type: "COMPLAINT_SPIKE",
          dimension: "branch",
          dimensionValue: branchId,
          severity: percentChange >= this.config.thresholds.criticalSpikePercent ? "HIGH" : "MEDIUM",
          
          metrics: {
            recentCount,
            baselineAvg: Math.round(baselineCount * 10) / 10,
            percentChange: Math.round(percentChange),
          },

          complaints: complaints.slice(0, 5).map(c => ({
            id: c.complaintId,
            category: c.category,
            summary: c.summary,
            sentiment: c.sentiment,
          })),

          topCategories: this.getTopCategories(complaints),
          
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Analiza quejas por categoría
   */
  analyzeByCategory(recentComplaints, baseline) {
    const findings = [];
    
    const byCategory = this.groupBy(recentComplaints, "category");
    const baselineByCategory = this.groupBy(baseline.complaints || [], "category");

    for (const [category, complaints] of Object.entries(byCategory)) {
      const recentCount = complaints.length;
      const baselineCount = (baselineByCategory[category]?.length || 0) / (baseline.days / this.config.lookbackDays);
      
      if (recentCount < this.config.thresholds.absoluteMin) continue;

      const percentChange = baselineCount > 0 
        ? ((recentCount - baselineCount) / baselineCount) * 100 
        : 100;

      if (percentChange >= this.config.thresholds.spikePercent) {
        findings.push({
          findingId: `COMPLAINT-SPIKE-CAT-${category}-${Date.now()}`,
          type: "COMPLAINT_SPIKE",
          dimension: "category",
          dimensionValue: category,
          severity: percentChange >= this.config.thresholds.criticalSpikePercent ? "HIGH" : "MEDIUM",
          
          metrics: {
            recentCount,
            baselineAvg: Math.round(baselineCount * 10) / 10,
            percentChange: Math.round(percentChange),
          },

          affectedBranches: [...new Set(complaints.map(c => c.branchId))],
          
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Analiza quejas por canal
   */
  analyzeByChannel(recentComplaints, baseline) {
    const findings = [];
    
    const byChannel = this.groupBy(recentComplaints, "channel");
    const baselineByChannel = this.groupBy(baseline.complaints || [], "channel");

    for (const [channel, complaints] of Object.entries(byChannel)) {
      const recentCount = complaints.length;
      const baselineCount = (baselineByChannel[channel]?.length || 0) / (baseline.days / this.config.lookbackDays);
      
      if (recentCount < this.config.thresholds.absoluteMin) continue;

      const percentChange = baselineCount > 0 
        ? ((recentCount - baselineCount) / baselineCount) * 100 
        : 100;

      if (percentChange >= this.config.thresholds.criticalSpikePercent) { // Solo críticos para canales
        findings.push({
          findingId: `COMPLAINT-SPIKE-CH-${channel}-${Date.now()}`,
          type: "COMPLAINT_SPIKE",
          dimension: "channel",
          dimensionValue: channel,
          severity: "HIGH",
          
          metrics: {
            recentCount,
            baselineAvg: Math.round(baselineCount * 10) / 10,
            percentChange: Math.round(percentChange),
          },

          topCategories: this.getTopCategories(complaints),
          
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Obtiene top categorías de quejas
   */
  getTopCategories(complaints) {
    const counts = {};
    for (const c of complaints) {
      counts[c.category] = (counts[c.category] || 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category, count]) => ({ category, count }));
  }

  /**
   * Agrupa array por propiedad
   */
  groupBy(array, key) {
    return array.reduce((groups, item) => {
      const value = item[key] || "unknown";
      groups[value] = groups[value] || [];
      groups[value].push(item);
      return groups;
    }, {});
  }

  /**
   * Crea resumen de detección
   */
  createSummary(findings, recentComplaints) {
    return {
      totalComplaints: recentComplaints.length,
      spikesDetected: findings.length,
      bySeverity: {
        HIGH: findings.filter(f => f.severity === "HIGH").length,
        MEDIUM: findings.filter(f => f.severity === "MEDIUM").length,
      },
      byDimension: {
        branch: findings.filter(f => f.dimension === "branch").length,
        category: findings.filter(f => f.dimension === "category").length,
        channel: findings.filter(f => f.dimension === "channel").length,
      },
      topIssues: this.getTopCategories(recentComplaints),
    };
  }

  /**
   * Obtiene quejas recientes (mock)
   */
  async getRecentComplaints(context) {
    // TODO: Obtener de Chatwoot/KISS
    return [
      { complaintId: "CMP001", branchId: "SUC01", category: "servicio_lento", channel: "whatsapp", sentiment: 2, summary: "Esperé 20 minutos" },
      { complaintId: "CMP002", branchId: "SUC01", category: "servicio_lento", channel: "whatsapp", sentiment: 1, summary: "Muy tardado" },
      { complaintId: "CMP003", branchId: "SUC01", category: "producto_calidad", channel: "instagram", sentiment: 2, summary: "Pan duro" },
      { complaintId: "CMP004", branchId: "SUC03", category: "servicio_atencion", channel: "whatsapp", sentiment: 2, summary: "Mal servicio" },
      { complaintId: "CMP005", branchId: "SUC01", category: "servicio_lento", channel: "facebook", sentiment: 3, summary: "Un poco lento" },
    ];
  }

  /**
   * Obtiene baseline de quejas (mock)
   */
  async getComplaintBaseline(context) {
    return {
      days: 30,
      complaints: [
        { branchId: "SUC01", category: "servicio_lento", channel: "whatsapp" },
        { branchId: "SUC02", category: "producto_calidad", channel: "whatsapp" },
      ],
    };
  }
}

export const complaintSpikeDetector = new ComplaintSpikeDetector();

export default ComplaintSpikeDetector;
