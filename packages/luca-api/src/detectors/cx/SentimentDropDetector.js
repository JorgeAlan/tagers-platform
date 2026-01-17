/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SENTIMENT DROP DETECTOR - Detecta Caídas de Sentimiento
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta caídas en el sentimiento de clientes a través de:
 * - Análisis de conversaciones (KISS/Chatwoot)
 * - Reviews en Google/TripAdvisor
 * - Encuestas de satisfacción
 * - Menciones en redes sociales
 */

import { logger } from "@tagers/shared";
import { BaseDetector } from "../BaseDetector.js";

/**
 * Configuración del detector
 */
const DETECTOR_CONFIG = {
  thresholds: {
    scoreDrop: 0.5,              // Alerta si score cae 0.5 puntos
    absoluteMin: 3.0,            // Alerta si score < 3.0
    criticalMin: 2.5,            // Crítico si score < 2.5
    minSamples: 5,               // Mínimo de muestras para alertar
  },
  sources: ["chatwoot", "google_reviews", "surveys", "social"],
  lookbackDays: 7,
  baselineDays: 30,
};

export class SentimentDropDetector extends BaseDetector {
  constructor() {
    super({
      name: "sentiment_drop_detector",
      description: "Detecta caídas en el sentimiento de clientes",
      category: "cx",
      schedule: "0 9 * * *", // Diario a las 9am
    });
    this.config = DETECTOR_CONFIG;
  }

  /**
   * Ejecuta la detección
   */
  async detect(context = {}) {
    logger.info({ context }, "SentimentDropDetector running");

    const findings = [];

    try {
      // Obtener sentimiento reciente
      const recentSentiment = await this.getRecentSentiment(context);
      
      // Obtener baseline
      const baseline = await this.getSentimentBaseline(context);

      // Analizar por sucursal
      const branchFindings = this.analyzeByBranch(recentSentiment, baseline);
      findings.push(...branchFindings);

      // Analizar por fuente
      const sourceFindings = this.analyzeBySource(recentSentiment, baseline);
      findings.push(...sourceFindings);

      // Analizar tendencia general
      const trendFinding = this.analyzeTrend(recentSentiment, baseline);
      if (trendFinding) {
        findings.push(trendFinding);
      }

      // Crear resumen
      const summary = this.createSummary(findings, recentSentiment, baseline);

      return {
        detector: this.name,
        timestamp: new Date().toISOString(),
        findings,
        summary,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "SentimentDropDetector failed");
      throw err;
    }
  }

  /**
   * Analiza sentimiento por sucursal
   */
  analyzeByBranch(recentSentiment, baseline) {
    const findings = [];
    
    // Agrupar por sucursal
    const recentByBranch = this.groupBy(recentSentiment, "branchId");
    const baselineByBranch = this.groupByAverage(baseline.samples || [], "branchId");

    for (const [branchId, samples] of Object.entries(recentByBranch)) {
      if (samples.length < this.config.thresholds.minSamples) continue;

      const recentAvg = this.average(samples.map(s => s.score));
      const baselineAvg = baselineByBranch[branchId] || baseline.overallAvg || 4.0;
      
      const drop = baselineAvg - recentAvg;
      
      // Verificar umbral de caída
      if (drop >= this.config.thresholds.scoreDrop || 
          recentAvg < this.config.thresholds.absoluteMin) {
        
        const severity = recentAvg < this.config.thresholds.criticalMin 
          ? "CRITICAL" 
          : (drop >= 1.0 ? "HIGH" : "MEDIUM");

        findings.push({
          findingId: `SENTIMENT-DROP-${branchId}-${Date.now()}`,
          type: "SENTIMENT_DROP",
          dimension: "branch",
          dimensionValue: branchId,
          severity,
          
          metrics: {
            currentScore: Math.round(recentAvg * 100) / 100,
            baselineScore: Math.round(baselineAvg * 100) / 100,
            drop: Math.round(drop * 100) / 100,
            sampleCount: samples.length,
          },

          breakdown: this.getSourceBreakdown(samples),
          
          worstFeedback: samples
            .filter(s => s.score <= 2)
            .slice(0, 3)
            .map(s => ({
              source: s.source,
              score: s.score,
              comment: s.comment?.substring(0, 100),
            })),

          detectedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Analiza sentimiento por fuente
   */
  analyzeBySource(recentSentiment, baseline) {
    const findings = [];
    
    const recentBySource = this.groupBy(recentSentiment, "source");
    const baselineBySource = this.groupByAverage(baseline.samples || [], "source");

    for (const [source, samples] of Object.entries(recentBySource)) {
      if (samples.length < this.config.thresholds.minSamples) continue;

      const recentAvg = this.average(samples.map(s => s.score));
      const baselineAvg = baselineBySource[source] || baseline.overallAvg || 4.0;
      
      const drop = baselineAvg - recentAvg;
      
      if (drop >= this.config.thresholds.scoreDrop * 1.2) { // Umbral más alto para fuentes
        findings.push({
          findingId: `SENTIMENT-DROP-SRC-${source}-${Date.now()}`,
          type: "SENTIMENT_DROP",
          dimension: "source",
          dimensionValue: source,
          severity: drop >= 1.0 ? "HIGH" : "MEDIUM",
          
          metrics: {
            currentScore: Math.round(recentAvg * 100) / 100,
            baselineScore: Math.round(baselineAvg * 100) / 100,
            drop: Math.round(drop * 100) / 100,
            sampleCount: samples.length,
          },

          affectedBranches: [...new Set(samples.map(s => s.branchId))],
          
          detectedAt: new Date().toISOString(),
        });
      }
    }

    return findings;
  }

  /**
   * Analiza tendencia general
   */
  analyzeTrend(recentSentiment, baseline) {
    if (recentSentiment.length < this.config.thresholds.minSamples) {
      return null;
    }

    const recentAvg = this.average(recentSentiment.map(s => s.score));
    const baselineAvg = baseline.overallAvg || 4.0;
    
    const drop = baselineAvg - recentAvg;

    if (drop >= this.config.thresholds.scoreDrop) {
      return {
        findingId: `SENTIMENT-DROP-GLOBAL-${Date.now()}`,
        type: "SENTIMENT_DROP",
        dimension: "global",
        dimensionValue: "all",
        severity: recentAvg < this.config.thresholds.criticalMin ? "CRITICAL" : "HIGH",
        
        metrics: {
          currentScore: Math.round(recentAvg * 100) / 100,
          baselineScore: Math.round(baselineAvg * 100) / 100,
          drop: Math.round(drop * 100) / 100,
          sampleCount: recentSentiment.length,
        },

        trend: this.calculateTrend(recentSentiment),
        
        detectedAt: new Date().toISOString(),
      };
    }

    return null;
  }

  /**
   * Calcula tendencia (últimos días)
   */
  calculateTrend(samples) {
    // Agrupar por día
    const byDay = {};
    for (const sample of samples) {
      const day = sample.date?.split("T")[0] || "unknown";
      if (!byDay[day]) byDay[day] = [];
      byDay[day].push(sample.score);
    }

    const dailyAvgs = Object.entries(byDay)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, scores]) => ({
        day,
        avg: this.average(scores),
      }));

    if (dailyAvgs.length < 2) return "stable";

    const firstHalf = this.average(dailyAvgs.slice(0, Math.floor(dailyAvgs.length / 2)).map(d => d.avg));
    const secondHalf = this.average(dailyAvgs.slice(Math.floor(dailyAvgs.length / 2)).map(d => d.avg));

    if (secondHalf < firstHalf - 0.2) return "declining";
    if (secondHalf > firstHalf + 0.2) return "improving";
    return "stable";
  }

  /**
   * Obtiene breakdown por fuente
   */
  getSourceBreakdown(samples) {
    const bySource = this.groupBy(samples, "source");
    const breakdown = {};

    for (const [source, sourceSamples] of Object.entries(bySource)) {
      breakdown[source] = {
        count: sourceSamples.length,
        avg: Math.round(this.average(sourceSamples.map(s => s.score)) * 100) / 100,
      };
    }

    return breakdown;
  }

  /**
   * Agrupa y calcula promedio
   */
  groupByAverage(array, key) {
    const groups = this.groupBy(array, key);
    const averages = {};

    for (const [k, samples] of Object.entries(groups)) {
      averages[k] = this.average(samples.map(s => s.score));
    }

    return averages;
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
   * Calcula promedio
   */
  average(numbers) {
    if (numbers.length === 0) return 0;
    return numbers.reduce((sum, n) => sum + n, 0) / numbers.length;
  }

  /**
   * Crea resumen de detección
   */
  createSummary(findings, recentSentiment, baseline) {
    return {
      totalSamples: recentSentiment.length,
      currentAvg: Math.round(this.average(recentSentiment.map(s => s.score)) * 100) / 100,
      baselineAvg: Math.round((baseline.overallAvg || 4.0) * 100) / 100,
      dropsDetected: findings.length,
      bySeverity: {
        CRITICAL: findings.filter(f => f.severity === "CRITICAL").length,
        HIGH: findings.filter(f => f.severity === "HIGH").length,
        MEDIUM: findings.filter(f => f.severity === "MEDIUM").length,
      },
      byDimension: {
        global: findings.filter(f => f.dimension === "global").length,
        branch: findings.filter(f => f.dimension === "branch").length,
        source: findings.filter(f => f.dimension === "source").length,
      },
    };
  }

  /**
   * Obtiene sentimiento reciente (mock)
   */
  async getRecentSentiment(context) {
    // TODO: Obtener de Chatwoot, Google Reviews, encuestas
    return [
      { branchId: "SUC01", source: "chatwoot", score: 3.0, date: "2026-01-17", comment: "Servicio lento" },
      { branchId: "SUC01", source: "chatwoot", score: 2.5, date: "2026-01-16", comment: "Mala experiencia" },
      { branchId: "SUC01", source: "google_reviews", score: 3.0, date: "2026-01-15", comment: "Ha bajado la calidad" },
      { branchId: "SUC01", source: "surveys", score: 3.5, date: "2026-01-15", comment: "" },
      { branchId: "SUC01", source: "chatwoot", score: 2.0, date: "2026-01-14", comment: "No volvería" },
      { branchId: "SUC02", source: "chatwoot", score: 4.0, date: "2026-01-17", comment: "Buen servicio" },
      { branchId: "SUC02", source: "google_reviews", score: 4.5, date: "2026-01-16", comment: "Excelente" },
    ];
  }

  /**
   * Obtiene baseline de sentimiento (mock)
   */
  async getSentimentBaseline(context) {
    return {
      overallAvg: 4.2,
      samples: [
        { branchId: "SUC01", source: "chatwoot", score: 4.0 },
        { branchId: "SUC01", source: "google_reviews", score: 4.5 },
        { branchId: "SUC02", source: "chatwoot", score: 4.3 },
      ],
    };
  }
}

export const sentimentDropDetector = new SentimentDropDetector();

export default SentimentDropDetector;
