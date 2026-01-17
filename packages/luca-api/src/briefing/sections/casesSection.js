/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASES SECTION - Datos de Casos para el Briefing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { logger, query } from "@tagers/shared";

export const casesSection = {
  /**
   * Obtiene casos relevantes para un usuario
   */
  async getData(userId) {
    try {
      // Casos abiertos
      const openResult = await query(`
        SELECT *
        FROM luca_cases
        WHERE state NOT IN ('CLOSED', 'ARCHIVED')
        ORDER BY 
          CASE severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          created_at DESC
        LIMIT 10
      `);
      
      const openCases = openResult.rows;
      
      // Casos de auditoría/fraude (para Andrés)
      const auditResult = await query(`
        SELECT *
        FROM luca_cases
        WHERE case_type IN ('FRAUD', 'AUDIT')
          AND state NOT IN ('CLOSED', 'ARCHIVED')
        ORDER BY created_at DESC
        LIMIT 5
      `);
      
      return {
        open: openCases,
        critical: openCases.filter(c => c.severity === "CRITICAL"),
        high: openCases.filter(c => c.severity === "HIGH"),
        audit: auditResult.rows,
        count: openCases.length,
      };
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get cases, using mock data");
      return this.getMockData();
    }
  },

  /**
   * Datos de prueba
   */
  getMockData() {
    const mockCases = [
      {
        case_id: "CASE-001",
        title: "Posible fraude en San Ángel",
        case_type: "FRAUD",
        severity: "HIGH",
        state: "INVESTIGATING",
        branch_id: "SUC01",
        created_at: new Date().toISOString(),
      },
    ];
    
    return {
      open: mockCases,
      critical: [],
      high: mockCases,
      audit: mockCases,
      count: mockCases.length,
    };
  },
};

export default casesSection;
