/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BASE DETECTOR - Clase base para todos los detectores LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cada detector hereda de aquí para garantizar:
 * - Logging consistente
 * - Run tracking
 * - Finding generation
 * - Error handling
 * 
 * Para crear un nuevo detector:
 * 1. Extender BaseDetector
 * 2. Implementar analyze(data, scope)
 * 3. Registrar en registry_detectors
 */

import { logger, query } from "@tagers/shared";
import { updateDetectorStatus } from "../services/registryService.js";

export class BaseDetector {
  constructor(config) {
    this.detectorId = config.detector_id || config.detectorId;
    this.name = config.name;
    this.category = config.category;
    this.agentName = config.agent_name || config.agentName || "LUCA";
    this.inputDataProducts = config.input_data_products || config.inputDataProducts || [];
    this.outputType = config.output_type || config.outputType || "alert";
    this.thresholds = config.thresholds || {};
    this.config = config.config || {};
    this.cooldownHours = config.cooldown_hours || config.cooldownHours || 24;
    this.maxAlertsPerDay = config.max_alerts_per_day || config.maxAlertsPerDay || 10;
    
    this.runId = null;
    this.startTime = null;
    this.findings = [];
  }

  /**
   * Main entry point - llamado por el runner
   */
  async execute(scope = {}) {
    this.startTime = Date.now();
    
    try {
      // 1. Iniciar run
      this.runId = await this.startRun(scope);
      logger.info({ 
        detectorId: this.detectorId, 
        runId: this.runId,
        scope 
      }, `🔍 ${this.agentName} starting analysis`);
      
      // 2. Cargar datos
      const data = await this.loadData(scope);
      const inputRowCount = this.countRows(data);
      
      // 3. Analizar (implementado por subclase)
      this.findings = await this.analyze(data, scope);
      
      // 4. Guardar findings
      if (this.findings.length > 0) {
        await this.saveFindings();
      }
      
      // 5. Convertir a alertas/casos si aplica
      const { alertsCreated, casesCreated } = await this.processFindings();
      
      // 6. Completar run
      await this.completeRun({
        status: "completed",
        findingsCount: this.findings.length,
        alertsCreated,
        casesCreated,
        inputRowCount,
      });
      
      logger.info({
        detectorId: this.detectorId,
        runId: this.runId,
        findings: this.findings.length,
        alertsCreated,
        casesCreated,
        duration: Date.now() - this.startTime,
      }, `✅ ${this.agentName} completed`);
      
      return { 
        runId: this.runId, 
        findings: this.findings,
        alertsCreated,
        casesCreated,
      };
      
    } catch (error) {
      await this.failRun(error);
      throw error;
    }
  }

  /**
   * Implementar en subclase - la lógica de detección
   * @param {Object} data - Datos cargados desde los data products
   * @param {Object} scope - Alcance de la ejecución (branches, fechas, etc)
   * @returns {Array} Array de findings
   */
  async analyze(data, scope) {
    throw new Error("analyze() must be implemented by subclass");
  }

  /**
   * Cargar datos desde los data products configurados
   * Override en subclase para lógica específica
   */
  async loadData(scope) {
    // Por defecto, cargar datos de sync tables según scope
    const data = {};
    const branches = scope.branches || ["ALL"];
    const dateFrom = scope.dateFrom || this.getDefaultDateFrom();
    const dateTo = scope.dateTo || new Date().toISOString().split("T")[0];
    
    // Cargar sales_daily si es un input
    if (this.inputDataProducts.includes("dp_sales_daily")) {
      const result = await query(`
        SELECT * FROM sync_sales_daily 
        WHERE fecha BETWEEN $1 AND $2
        ${branches[0] !== "ALL" ? "AND branch_id = ANY($3)" : ""}
        ORDER BY fecha DESC, branch_id
      `, branches[0] !== "ALL" ? [dateFrom, dateTo, branches] : [dateFrom, dateTo]);
      data.salesDaily = result.rows;
    }
    
    // Cargar sales_hourly si es un input
    if (this.inputDataProducts.includes("dp_sales_hourly")) {
      const result = await query(`
        SELECT * FROM sync_sales_hourly 
        WHERE fecha BETWEEN $1 AND $2
        ${branches[0] !== "ALL" ? "AND branch_id = ANY($3)" : ""}
        ORDER BY fecha DESC, hora DESC, branch_id
      `, branches[0] !== "ALL" ? [dateFrom, dateTo, branches] : [dateFrom, dateTo]);
      data.salesHourly = result.rows;
    }
    
    // Cargar descuentos si es un input
    if (this.inputDataProducts.includes("dp_discounts")) {
      const result = await query(`
        SELECT * FROM sync_descuentos 
        WHERE fecha BETWEEN $1 AND $2
        ${branches[0] !== "ALL" ? "AND branch_id = ANY($3)" : ""}
        ORDER BY fecha DESC, branch_id, monto_total DESC
      `, branches[0] !== "ALL" ? [dateFrom, dateTo, branches] : [dateFrom, dateTo]);
      data.discounts = result.rows;
    }
    
    return data;
  }

  /**
   * Inicia un run y lo registra en la DB
   */
  async startRun(scope) {
    const runId = this.generateRunId();
    
    await query(`
      INSERT INTO detector_runs (
        run_id, detector_id, scope, data_products_used, config_snapshot
      ) VALUES ($1, $2, $3, $4, $5)
    `, [
      runId,
      this.detectorId,
      scope,
      this.inputDataProducts,
      { thresholds: this.thresholds, config: this.config },
    ]);
    
    return runId;
  }

  /**
   * Completa un run exitoso
   */
  async completeRun({ status, findingsCount, alertsCreated, casesCreated, inputRowCount }) {
    const duration = Date.now() - this.startTime;
    
    await query(`
      UPDATE detector_runs SET
        status = $2,
        completed_at = NOW(),
        duration_ms = $3,
        findings_count = $4,
        alerts_created = $5,
        cases_created = $6,
        input_row_count = $7
      WHERE run_id = $1
    `, [this.runId, status, duration, findingsCount, alertsCreated, casesCreated, inputRowCount]);
    
    await updateDetectorStatus(this.detectorId, status, this.runId);
  }

  /**
   * Marca un run como fallido
   */
  async failRun(error) {
    const duration = Date.now() - this.startTime;
    
    logger.error({
      detectorId: this.detectorId,
      runId: this.runId,
      error: error?.message,
      stack: error?.stack,
    }, `❌ ${this.agentName} failed`);
    
    if (this.runId) {
      await query(`
        UPDATE detector_runs SET
          status = 'failed',
          completed_at = NOW(),
          duration_ms = $2,
          error_message = $3,
          error_stack = $4
        WHERE run_id = $1
      `, [this.runId, duration, error?.message, error?.stack]);
      
      await updateDetectorStatus(this.detectorId, "failed", this.runId);
    }
  }

  /**
   * Guarda los findings en la DB
   */
  async saveFindings() {
    for (const finding of this.findings) {
      const findingId = this.generateFindingId();
      finding.finding_id = findingId;
      
      await query(`
        INSERT INTO detector_findings (
          finding_id, run_id, detector_id,
          finding_type, severity, confidence,
          title, description, evidence,
          branch_id, employee_id, product_id, date_range,
          metric_id, metric_value, baseline_value, deviation_pct
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      `, [
        findingId,
        this.runId,
        this.detectorId,
        finding.type || "anomaly",
        finding.severity || "medium",
        finding.confidence || 0.8,
        finding.title,
        finding.description,
        finding.evidence || {},
        finding.branch_id,
        finding.employee_id,
        finding.product_id,
        finding.date_range || {},
        finding.metric_id,
        finding.metric_value,
        finding.baseline_value,
        finding.deviation_pct,
      ]);
    }
  }

  /**
   * Procesa findings y crea alertas/casos según configuración
   * Usa el flow centralizado de findingToCaseFlow
   */
  async processFindings() {
    let alertsCreated = 0;
    let casesCreated = 0;
    
    // Importar dinámicamente para evitar dependencias circulares
    const { processFindings: processWithFlow } = await import("../flows/findingToCaseFlow.js");
    
    try {
      // Preparar findings con información completa
      const enrichedFindings = this.findings.map(f => ({
        ...f,
        run_id: this.runId,
        detector_id: this.detectorId,
        detected_at: new Date().toISOString(),
      }));
      
      // Procesar usando el flow centralizado
      const results = await processWithFlow(enrichedFindings, {
        detector_id: this.detectorId,
        output_type: this.outputType,
        category: this.category,
        agent_name: this.agentName,
        thresholds: this.thresholds,
      });
      
      alertsCreated = results.alerts.length;
      casesCreated = results.cases.length;
      
      // Actualizar status de findings procesados
      for (const finding of this.findings) {
        await query(
          "UPDATE detector_findings SET status = 'converted' WHERE finding_id = $1",
          [finding.finding_id]
        );
      }
      
      logger.info({
        detectorId: this.detectorId,
        alertsCreated,
        casesCreated,
        insights: results.insights.length,
        errors: results.errors.length,
      }, "Findings processed via flow");
      
    } catch (err) {
      logger.error({
        detectorId: this.detectorId,
        err: err?.message,
      }, "Failed to process findings via flow, falling back to legacy");
      
      // Fallback a método legacy si el flow falla
      return await this.processFindings_legacy();
    }
    
    return { alertsCreated, casesCreated };
  }

  /**
   * Método legacy de procesamiento (backup si el flow falla)
   */
  async processFindings_legacy() {
    let alertsCreated = 0;
    let casesCreated = 0;
    
    for (const finding of this.findings) {
      if (this.outputType === "alert" || finding.severity === "high" || finding.severity === "critical") {
        if (await this.shouldCreateAlert(finding)) {
          await this.createAlert(finding);
          alertsCreated++;
          
          // Update finding status
          await query(
            "UPDATE detector_findings SET status = 'converted' WHERE finding_id = $1",
            [finding.finding_id]
          );
        }
      }
      
      if (this.outputType === "case" || finding.severity === "critical") {
        if (await this.shouldCreateCase(finding)) {
          await this.createCase(finding);
          casesCreated++;
          
          await query(
            "UPDATE detector_findings SET status = 'converted' WHERE finding_id = $1",
            [finding.finding_id]
          );
        }
      }
    }
    
    return { alertsCreated, casesCreated };
  }

  /**
   * Determina si se debe crear una alerta (cooldown, dedup, etc)
   */
  async shouldCreateAlert(finding) {
    // Check cooldown - no crear alerta si hay una similar reciente
    const result = await query(`
      SELECT COUNT(*) as count FROM luca_alerts
      WHERE detector_id = $1
        AND branch_id = $2
        AND created_at > NOW() - INTERVAL '${this.cooldownHours} hours'
        AND state != 'RESOLVED'
    `, [this.detectorId, finding.branch_id]);
    
    return parseInt(result.rows[0].count) === 0;
  }

  /**
   * Determina si se debe crear un caso
   */
  async shouldCreateCase(finding) {
    // Check if similar case exists
    const result = await query(`
      SELECT COUNT(*) as count FROM luca_cases
      WHERE detector_id = $1
        AND scope->>'branch_id' = $2
        AND state NOT IN ('CLOSED', 'RESOLVED')
        AND created_at > NOW() - INTERVAL '7 days'
    `, [this.detectorId, finding.branch_id]);
    
    return parseInt(result.rows[0].count) === 0;
  }

  /**
   * Crea una alerta desde un finding
   */
  async createAlert(finding) {
    const alertId = this.generateAlertId();
    
    await query(`
      INSERT INTO luca_alerts (
        alert_id, alert_type, severity, title, message,
        branch_id, fingerprint, source, detector_id, run_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      alertId,
      finding.type || this.category,
      finding.severity,
      finding.title,
      finding.description,
      finding.branch_id,
      `${this.detectorId}:${finding.branch_id}:${finding.metric_id}`,
      this.agentName,
      this.detectorId,
      this.runId,
    ]);
    
    logger.info({ alertId, finding: finding.title }, "Alert created");
    return alertId;
  }

  /**
   * Crea un caso desde un finding
   */
  async createCase(finding) {
    const caseId = this.generateCaseId();
    
    await query(`
      INSERT INTO luca_cases (
        case_id, case_type, severity, title, description,
        scope, evidence, source, detector_id, run_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    `, [
      caseId,
      this.category.toUpperCase(),
      finding.severity.toUpperCase(),
      finding.title,
      finding.description,
      { branch_id: finding.branch_id, employee_id: finding.employee_id },
      [finding.evidence],
      this.agentName,
      this.detectorId,
      this.runId,
    ]);
    
    logger.info({ caseId, finding: finding.title }, "Case created");
    return caseId;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  generateRunId() {
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `RUN-${date}-${random}`;
  }

  generateFindingId() {
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `FND-${date}-${random}`;
  }

  generateAlertId() {
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `ALT-${date}-${random}`;
  }

  generateCaseId() {
    const date = new Date().toISOString().split("T")[0].replace(/-/g, "");
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `CASE-${date}-${random}`;
  }

  getDefaultDateFrom() {
    const date = new Date();
    date.setDate(date.getDate() - 7); // Últimos 7 días por defecto
    return date.toISOString().split("T")[0];
  }

  countRows(data) {
    let count = 0;
    for (const key of Object.keys(data)) {
      if (Array.isArray(data[key])) {
        count += data[key].length;
      }
    }
    return count;
  }

  /**
   * Helper para calcular baseline (promedio de período anterior)
   */
  calculateBaseline(values) {
    if (!values || values.length === 0) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  /**
   * Helper para calcular desviación estándar
   */
  calculateStdDev(values, mean) {
    if (!values || values.length < 2) return 0;
    const squareDiffs = values.map(v => Math.pow(v - mean, 2));
    return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / values.length);
  }

  /**
   * Helper para detectar outliers usando z-score
   */
  isOutlier(value, mean, stdDev, threshold = 2) {
    if (stdDev === 0) return false;
    const zScore = Math.abs((value - mean) / stdDev);
    return zScore > threshold;
  }
}

export default BaseDetector;
