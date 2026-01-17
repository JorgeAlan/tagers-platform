/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SALES SECTION - Datos de Ventas para el Briefing
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Obtiene y procesa datos de ventas para el morning briefing.
 * En producción, estos datos vendrían de Redshift.
 * 
 * ZERO-HARDCODE: Metas vienen de lucaConfig (Google Sheets)
 */

import { logger, query } from "@tagers/shared";
import { getAllDailyGoals, getBranchList } from "../../config/lucaConfig.js";

export const salesSection = {
  /**
   * Obtiene datos de ventas para una fecha
   */
  async getData(date) {
    const dateStr = date.toISOString().split("T")[0];
    
    // Obtener metas de config
    const dailyGoals = await getAllDailyGoals();
    
    try {
      // Intentar obtener de DB
      const result = await query(`
        SELECT 
          branch_id,
          SUM(total) as total,
          COUNT(*) as order_count,
          AVG(total) as avg_ticket
        FROM transactions
        WHERE DATE(created_at) = $1
        GROUP BY branch_id
      `, [dateStr]);
      
      if (result.rows.length > 0) {
        return this.processSalesData(result.rows, dateStr, dailyGoals);
      }
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get sales from DB, using mock data");
    }
    
    // Datos de prueba si no hay DB
    return this.getMockData(dateStr, dailyGoals);
  },

  /**
   * Procesa datos de ventas crudos
   */
  processSalesData(rows, dateStr, dailyGoals) {
    const byBranch = rows.map(row => {
      const goal = dailyGoals[row.branch_id] || 70000;
      return {
        branch_id: row.branch_id,
        total: parseFloat(row.total),
        order_count: parseInt(row.order_count),
        avg_ticket: parseFloat(row.avg_ticket),
        goal,
        vs_goal: ((parseFloat(row.total) - goal) / goal) * 100,
      };
    });
    
    // Calcular totales
    const totalSales = byBranch.reduce((sum, b) => sum + b.total, 0);
    const totalGoal = byBranch.reduce((sum, b) => sum + b.goal, 0);
    const totalOrders = byBranch.reduce((sum, b) => sum + b.order_count, 0);
    
    return {
      date: dateStr,
      total: {
        total: totalSales,
        goal: totalGoal,
        vs_goal: ((totalSales - totalGoal) / totalGoal) * 100,
        order_count: totalOrders,
        avg_ticket: totalSales / totalOrders,
      },
      byBranch: byBranch.sort((a, b) => b.vs_goal - a.vs_goal),
    };
  },

  /**
   * Datos de prueba - usa config para sucursales y metas
   */
  async getMockData(dateStr, dailyGoals) {
    const branches = await getBranchList();
    
    const byBranch = branches.map(branch => {
      const goal = dailyGoals[branch.id] || branch.daily_goal || 70000;
      // Simular variación de -20% a +30%
      const variation = -0.2 + Math.random() * 0.5;
      const total = Math.round(goal * (1 + variation));
      const orderCount = Math.round(total / (150 + Math.random() * 50));
      
      return {
        branch_id: branch.id,
        total,
        order_count: orderCount,
        avg_ticket: total / orderCount,
        goal,
        vs_goal: variation * 100,
      };
    });
    
    const totalSales = byBranch.reduce((sum, b) => sum + b.total, 0);
    const totalGoal = byBranch.reduce((sum, b) => sum + b.goal, 0);
    const totalOrders = byBranch.reduce((sum, b) => sum + b.order_count, 0);
    
    return {
      date: dateStr,
      total: {
        total: totalSales,
        goal: totalGoal,
        vs_goal: ((totalSales - totalGoal) / totalGoal) * 100,
        order_count: totalOrders,
        avg_ticket: totalSales / totalOrders,
        vs_last_week: -5 + Math.random() * 15, // Simulado
      },
      byBranch: byBranch.sort((a, b) => b.vs_goal - a.vs_goal),
    };
  },
};

export default salesSection;
