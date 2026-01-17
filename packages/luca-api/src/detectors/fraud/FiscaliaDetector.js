/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LA FISCALÍA - Detector de Fraude
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * "Nadie sospecha del cajero simpático hasta que LUCA revisa los números."
 * 
 * Este detector busca patrones de fraude en transacciones:
 * - Sweethearting (descuentos a conocidos)
 * - Cash Preference (preferencia por efectivo)
 * - Time Concentration (horarios sospechosos)
 * - Collusion (colusión cajero-mesero-cliente)
 * 
 * Hereda de BaseDetector para integración con el engine.
 */

import { BaseDetector } from "../../engine/BaseDetector.js";
import { logger, query } from "@tagers/shared";

// Import patterns
import sweetheartingPattern from "./patterns/sweetheartingPattern.js";
import cashPreferencePattern from "./patterns/cashPreferencePattern.js";
import timeConcentrationPattern from "./patterns/timeConcentrationPattern.js";
import collusionPattern from "./patterns/collusionPattern.js";

export class FiscaliaDetector extends BaseDetector {
  constructor(config = {}) {
    super({
      detector_id: config.detector_id || "fiscalia_fraud_v1",
      name: "La Fiscalía - Detector de Fraude",
      category: "fraud",
      agent_name: "La Fiscalía",
      input_data_products: ["dp_transactions", "dp_employees"],
      output_type: "case", // Siempre genera casos
      thresholds: {
        minConfidence: 0.6,
        ...config.thresholds,
      },
      cooldown_hours: 24,
      max_alerts_per_day: 5,
      ...config,
    });
    
    // Patterns a ejecutar
    this.patterns = [
      sweetheartingPattern,
      cashPreferencePattern,
      timeConcentrationPattern,
      collusionPattern,
    ];
  }

  /**
   * Carga datos necesarios para el análisis
   */
  async loadData(scope = {}) {
    const dateFrom = scope.dateFrom || this.getDefaultDateFrom();
    const dateTo = scope.dateTo || new Date().toISOString().split("T")[0];
    const branchId = scope.branch_id;
    
    logger.info({ dateFrom, dateTo, branchId }, "Loading data for fraud analysis");
    
    // Query transacciones (simulado - en producción vendría de Redshift)
    // Por ahora generamos datos de prueba
    const transactions = await this.loadTransactions(dateFrom, dateTo, branchId);
    const employees = await this.loadEmployees(branchId);
    
    return {
      transactions,
      employees,
      scope: { dateFrom, dateTo, branch_id: branchId },
    };
  }

  /**
   * Carga transacciones para análisis
   */
  async loadTransactions(dateFrom, dateTo, branchId) {
    try {
      // Intentar cargar de la tabla de transacciones si existe
      const result = await query(`
        SELECT 
          transaction_id,
          branch_id,
          employee_id,
          cashier_id,
          server_id,
          customer_id,
          customer_phone,
          customer_name,
          subtotal,
          discount_amount,
          discount_reason,
          discount_type,
          total,
          payment_method,
          created_at,
          DATE(created_at) as date
        FROM transactions
        WHERE DATE(created_at) BETWEEN $1 AND $2
          ${branchId ? "AND branch_id = $3" : ""}
        ORDER BY created_at DESC
        LIMIT 10000
      `, branchId ? [dateFrom, dateTo, branchId] : [dateFrom, dateTo]);
      
      return result.rows;
    } catch (err) {
      // Si no existe la tabla, generar datos de prueba
      logger.warn("Transactions table not found, generating test data");
      return this.generateTestTransactions(dateFrom, dateTo, branchId);
    }
  }

  /**
   * Genera transacciones de prueba para desarrollo
   */
  generateTestTransactions(dateFrom, dateTo, branchId) {
    const transactions = [];
    const branches = branchId ? [branchId] : ["SUC01", "SUC02", "SUC03"];
    const employees = ["EMP001", "EMP002", "EMP003", "EMP004", "EMP005"];
    const servers = ["SRV001", "SRV002", "SRV003"];
    const paymentMethods = ["cash", "card", "card", "card"]; // 25% efectivo
    const discountReasons = ["cortesía", "promoción", "empleado", "cumpleaños", null, null, null];
    
    // Crear empleado sospechoso
    const suspiciousEmployee = "EMP003";
    const suspiciousCustomer = "CUST_FRIEND_001";
    
    const startDate = new Date(dateFrom);
    const endDate = new Date(dateTo);
    const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    
    for (let d = 0; d < daysDiff; d++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + d);
      const dateStr = date.toISOString().split("T")[0];
      
      // Generar ~50-100 transacciones por día
      const txCount = 50 + Math.floor(Math.random() * 50);
      
      for (let i = 0; i < txCount; i++) {
        const branch = branches[Math.floor(Math.random() * branches.length)];
        const employee = employees[Math.floor(Math.random() * employees.length)];
        const server = servers[Math.floor(Math.random() * servers.length)];
        const hour = 8 + Math.floor(Math.random() * 14); // 8am - 10pm
        
        const subtotal = 100 + Math.floor(Math.random() * 400);
        let discountAmount = 0;
        let discountReason = null;
        let paymentMethod = paymentMethods[Math.floor(Math.random() * paymentMethods.length)];
        let customerId = Math.random() > 0.7 ? `CUST${Math.floor(Math.random() * 100)}` : null;
        
        // Simular comportamiento sospechoso del empleado
        if (employee === suspiciousEmployee) {
          // 40% de probabilidad de descuento (vs 10% normal)
          if (Math.random() < 0.4) {
            discountAmount = subtotal * (0.1 + Math.random() * 0.2); // 10-30%
            discountReason = discountReasons[Math.floor(Math.random() * 3)]; // Solo cortesía/promoción/empleado
            paymentMethod = Math.random() < 0.8 ? "cash" : "card"; // 80% efectivo
            
            // A veces es el mismo "amigo"
            if (Math.random() < 0.3) {
              customerId = suspiciousCustomer;
            }
          }
        } else {
          // Comportamiento normal
          if (Math.random() < 0.1) {
            discountAmount = subtotal * (0.05 + Math.random() * 0.1);
            discountReason = discountReasons[Math.floor(Math.random() * discountReasons.length)];
          }
        }
        
        transactions.push({
          transaction_id: `TXN-${dateStr}-${String(i).padStart(4, "0")}`,
          branch_id: branch,
          employee_id: employee,
          cashier_id: employee,
          server_id: server,
          customer_id: customerId,
          customer_phone: customerId ? `555${Math.floor(Math.random() * 10000000)}` : null,
          subtotal,
          discount_amount: Math.round(discountAmount * 100) / 100,
          discount_reason: discountReason,
          discount_type: discountReason ? "manual" : null,
          total: Math.round((subtotal - discountAmount) * 100) / 100,
          payment_method: paymentMethod,
          created_at: `${dateStr}T${String(hour).padStart(2, "0")}:${String(Math.floor(Math.random() * 60)).padStart(2, "0")}:00`,
          date: dateStr,
        });
      }
    }
    
    logger.info({ 
      transactionCount: transactions.length,
      dateRange: `${dateFrom} to ${dateTo}`,
    }, "Generated test transactions");
    
    return transactions;
  }

  /**
   * Carga empleados
   */
  async loadEmployees(branchId) {
    try {
      const result = await query(`
        SELECT employee_id, name, branch_id, role, hire_date
        FROM employees
        ${branchId ? "WHERE branch_id = $1" : ""}
      `, branchId ? [branchId] : []);
      
      return result.rows;
    } catch (err) {
      // Retornar lista vacía si no existe la tabla
      return [];
    }
  }

  /**
   * Ejecuta análisis de todos los patterns
   */
  async analyze(data, scope = {}) {
    const allFindings = [];
    
    logger.info({
      transactionCount: data.transactions?.length,
      patternCount: this.patterns.length,
    }, "Starting fraud pattern analysis");
    
    // Ejecutar cada pattern
    for (const pattern of this.patterns) {
      try {
        const findings = await pattern.analyze(data, {
          ...scope,
          ...data.scope,
        });
        
        logger.info({
          pattern: pattern.PATTERN_ID,
          findingsCount: findings.length,
        }, "Pattern analysis complete");
        
        allFindings.push(...findings);
      } catch (err) {
        logger.error({
          pattern: pattern.PATTERN_ID,
          error: err?.message,
        }, "Pattern analysis failed");
      }
    }
    
    // Consolidar findings por empleado (evitar duplicados)
    const consolidated = this.consolidateFindings(allFindings);
    
    // Filtrar por confianza mínima
    const filtered = consolidated.filter(f => 
      f.confidence >= this.thresholds.minConfidence
    );
    
    logger.info({
      totalFindings: allFindings.length,
      consolidatedFindings: consolidated.length,
      filteredFindings: filtered.length,
    }, "Fraud analysis complete");
    
    return filtered;
  }

  /**
   * Consolida findings del mismo empleado
   */
  consolidateFindings(findings) {
    const byEmployee = {};
    
    for (const finding of findings) {
      const key = `${finding.employee_id}-${finding.branch_id}`;
      
      if (!byEmployee[key]) {
        byEmployee[key] = {
          ...finding,
          patterns_detected: [finding.type],
          all_evidence: { [finding.type]: finding.evidence },
          all_signals: finding.signals || [],
        };
      } else {
        // Combinar findings del mismo empleado
        const existing = byEmployee[key];
        existing.patterns_detected.push(finding.type);
        existing.all_evidence[finding.type] = finding.evidence;
        existing.all_signals.push(...(finding.signals || []));
        
        // Tomar la confianza más alta
        if (finding.confidence > existing.confidence) {
          existing.confidence = finding.confidence;
          existing.severity = finding.severity;
        }
        
        // Actualizar descripción
        existing.description = `Múltiples patrones de fraude detectados: ${existing.patterns_detected.join(", ")}`;
        existing.title = `⚠️ Alerta de fraude - Empleado ${finding.employee_id} (${existing.patterns_detected.length} patrones)`;
      }
    }
    
    return Object.values(byEmployee);
  }
}

// Singleton para registro
export const fiscaliaDetector = new FiscaliaDetector();

export default FiscaliaDetector;
