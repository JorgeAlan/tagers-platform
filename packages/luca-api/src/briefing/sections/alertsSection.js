/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ALERTS SECTION - Datos de Alertas para el Briefing
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { logger, query } from "@tagers/shared";

export const alertsSection = {
  /**
   * Obtiene alertas activas categorizadas
   */
  async getData() {
    try {
      const result = await query(`
        SELECT *
        FROM luca_alerts
        WHERE state IN ('ACTIVE', 'ACKNOWLEDGED')
        ORDER BY 
          CASE severity
            WHEN 'CRITICAL' THEN 1
            WHEN 'HIGH' THEN 2
            WHEN 'MEDIUM' THEN 3
            ELSE 4
          END,
          created_at DESC
        LIMIT 20
      `);
      
      const alerts = result.rows;
      
      return {
        all: alerts,
        critical: alerts.filter(a => a.severity === "CRITICAL"),
        high: alerts.filter(a => a.severity === "HIGH"),
        operational: alerts.filter(a => 
          ["inventory", "staff", "equipment"].includes(a.alert_type?.toLowerCase())
        ),
        count: alerts.length,
      };
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get alerts, using mock data");
      return this.getMockData();
    }
  },

  /**
   * Datos de prueba
   */
  getMockData() {
    const mockAlerts = [
      {
        alert_id: "ALT-001",
        title: "Inventario bajo en pan dulce",
        severity: "HIGH",
        alert_type: "inventory",
        branch_id: "SUC01",
        state: "ACTIVE",
        created_at: new Date().toISOString(),
      },
      {
        alert_id: "ALT-002",
        title: "Caída de ventas 15% vs ayer",
        severity: "MEDIUM",
        alert_type: "sales",
        branch_id: "SUC03",
        state: "ACTIVE",
        created_at: new Date().toISOString(),
      },
    ];
    
    return {
      all: mockAlerts,
      critical: [],
      high: mockAlerts.filter(a => a.severity === "HIGH"),
      operational: mockAlerts.filter(a => a.alert_type === "inventory"),
      count: mockAlerts.length,
    };
  },
};

export default alertsSection;
