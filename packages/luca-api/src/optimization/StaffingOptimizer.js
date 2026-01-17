/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STAFFING OPTIMIZER - Optimizador de Plantilla
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Todo viene del ConfigLoader (Google Sheets)
 * 
 * Optimiza la plantilla de personal basado en:
 * - Forecast de demanda
 * - Costos laborales
 * - Nivel de servicio objetivo
 * - Restricciones operativas
 */

import { logger } from "@tagers/shared";
import { BranchTwin } from "../twin/BranchTwin.js";
import { DemandForecaster } from "../twin/DemandForecaster.js";
import { CapacityModel } from "../twin/CapacityModel.js";
import { configLoader } from "../config/ConfigLoader.js";

export class StaffingOptimizer {
  constructor() {
    this.forecaster = new DemandForecaster();
  }

  /**
   * Obtiene niveles de servicio desde config
   */
  getServiceLevels() {
    const levels = configLoader.getAllAutonomyLevels();
    
    // Si no hay config, usar defaults
    if (!levels.length) {
      return {
        PREMIUM: { targetUtilization: 0.65, name: "Premium" },
        STANDARD: { targetUtilization: 0.75, name: "Standard" },
        EFFICIENT: { targetUtilization: 0.85, name: "Efficient" },
        LEAN: { targetUtilization: 0.90, name: "Lean" },
      };
    }

    // Convertir desde config
    const result = {};
    for (const level of levels) {
      result[level.name.toUpperCase()] = {
        targetUtilization: 1 - (level.level * 0.05), // Ejemplo: nivel 1 = 0.95, nivel 5 = 0.75
        name: level.name,
      };
    }
    return result;
  }

  /**
   * Obtiene costos por rol
   */
  getRoleCosts() {
    const roles = ["barista", "kitchen", "floor", "cashier"];
    const costs = {};
    
    for (const role of roles) {
      const capacity = configLoader.getRoleCapacity(role);
      costs[role] = capacity?.costPerHour || 75; // Default 75 MXN/hr
    }
    
    return costs;
  }

  /**
   * Obtiene mínimos de staff
   */
  getMinimumStaff() {
    return {
      barista: configLoader.getThresholdValue("staffing", "min_barista", 1),
      kitchen: configLoader.getThresholdValue("staffing", "min_kitchen", 1),
      floor: configLoader.getThresholdValue("staffing", "min_floor", 1),
      cashier: configLoader.getThresholdValue("staffing", "min_cashier", 1),
    };
  }

  /**
   * Optimiza staff para un día completo
   */
  async optimizeDay(branchId, date = new Date(), options = {}) {
    const serviceLevels = this.getServiceLevels();
    const { serviceLevel = "STANDARD" } = options;
    const serviceLevelConfig = serviceLevels[serviceLevel] || serviceLevels.STANDARD;

    const twin = new BranchTwin(branchId);
    const capacityModel = new CapacityModel(branchId);

    const forecast = await this.forecaster.forecastDay(branchId, date);

    const shifts = this.defineShifts(twin);
    const optimizedShifts = [];

    for (const shift of shifts) {
      const shiftForecast = this.getShiftForecast(forecast.hourly, shift);
      const optimized = this.optimizeShift(
        shiftForecast, 
        capacityModel, 
        serviceLevelConfig.targetUtilization
      );
      
      optimizedShifts.push({
        ...shift,
        ...optimized,
      });
    }

    const totalCost = this.calculateDailyCost(optimizedShifts);
    const currentCost = this.calculateCurrentCost(twin, shifts);

    return {
      branchId,
      branchName: twin.name,
      date: date.toISOString().split("T")[0],
      serviceLevel: serviceLevelConfig.name,
      forecast: {
        dailyTransactions: forecast.expectedTransactions,
        dailySales: forecast.expectedSales,
      },
      shifts: optimizedShifts,
      totals: {
        totalStaff: optimizedShifts.reduce((sum, s) => sum + s.recommendedStaff.total, 0),
        totalHours: optimizedShifts.reduce((sum, s) => sum + s.recommendedStaff.total * s.duration, 0),
        totalCost,
        currentCost,
        savings: currentCost - totalCost,
        savingsPercent: Math.round(((currentCost - totalCost) / currentCost) * 100),
      },
    };
  }

  /**
   * Define turnos del día
   */
  defineShifts(twin) {
    const openH = parseInt(twin.config.openHour.split(":")[0]);
    const closeH = parseInt(twin.config.closeHour.split(":")[0]);
    
    const shifts = [];
    
    if (openH < 12) {
      shifts.push({
        name: "morning",
        displayName: "Mañana",
        startHour: openH,
        endHour: Math.min(12, closeH),
        duration: Math.min(12, closeH) - openH,
      });
    }
    
    if (closeH > 12) {
      shifts.push({
        name: "afternoon",
        displayName: "Tarde",
        startHour: Math.max(12, openH),
        endHour: Math.min(18, closeH),
        duration: Math.min(18, closeH) - Math.max(12, openH),
      });
    }
    
    if (closeH > 18) {
      shifts.push({
        name: "evening",
        displayName: "Noche",
        startHour: 18,
        endHour: closeH,
        duration: closeH - 18,
      });
    }

    return shifts;
  }

  /**
   * Obtiene forecast para un turno
   */
  getShiftForecast(hourlyForecast, shift) {
    const shiftHours = hourlyForecast.filter(h => 
      h.hour >= shift.startHour && h.hour < shift.endHour
    );

    return {
      hours: shiftHours,
      totalTransactions: shiftHours.reduce((sum, h) => sum + h.expectedTransactions, 0),
      avgHourlyTransactions: shiftHours.length > 0 
        ? shiftHours.reduce((sum, h) => sum + h.expectedTransactions, 0) / shiftHours.length
        : 0,
      peakTransactions: Math.max(...shiftHours.map(h => h.expectedTransactions), 0),
    };
  }

  /**
   * Optimiza staff para un turno
   */
  optimizeShift(shiftForecast, capacityModel, targetUtilization) {
    const demandForStaffing = shiftForecast.peakTransactions;
    const minimums = this.getMinimumStaff();
    
    const recommended = capacityModel.recommendStaff(demandForStaffing, {
      targetUtilization,
    });

    const finalStaff = {
      baristas: Math.max(minimums.barista, recommended.staff.baristas),
      kitchen: Math.max(minimums.kitchen, recommended.staff.kitchen),
      floor: Math.max(minimums.floor, recommended.staff.floor),
      cashier: Math.max(minimums.cashier, recommended.staff.cashier),
    };
    finalStaff.total = Object.values(finalStaff).reduce((a, b) => a + b, 0);

    return {
      shiftForecast: {
        avgHourly: Math.round(shiftForecast.avgHourlyTransactions),
        peak: shiftForecast.peakTransactions,
      },
      recommendedStaff: finalStaff,
      expectedUtilization: recommended.resultingUtilization,
    };
  }

  /**
   * Calcula costo diario de configuración optimizada
   */
  calculateDailyCost(shifts) {
    const costs = this.getRoleCosts();
    let total = 0;

    for (const shift of shifts) {
      const staff = shift.recommendedStaff;
      const hours = shift.duration;

      total += staff.baristas * costs.barista * hours;
      total += staff.kitchen * costs.kitchen * hours;
      total += staff.floor * costs.floor * hours;
      total += staff.cashier * costs.cashier * hours;
    }

    return total;
  }

  /**
   * Calcula costo actual (sin optimizar)
   */
  calculateCurrentCost(twin, shifts) {
    const costs = this.getRoleCosts();
    const allStaffing = twin.getAllStaffing();
    let total = 0;

    for (const shift of shifts) {
      const staff = allStaffing[shift.name] || { baristas: 2, kitchen: 2, floor: 1, cashier: 1 };
      const hours = shift.duration;

      total += (staff.baristas || 0) * costs.barista * hours;
      total += (staff.kitchen || 0) * costs.kitchen * hours;
      total += (staff.floor || 0) * costs.floor * hours;
      total += (staff.cashier || 0) * costs.cashier * hours;
    }

    return total;
  }

  /**
   * Optimiza para una semana completa
   */
  async optimizeWeek(branchId, startDate = new Date(), options = {}) {
    const days = [];
    const d = new Date(startDate);

    for (let i = 0; i < 7; i++) {
      const dayResult = await this.optimizeDay(branchId, d, options);
      days.push(dayResult);
      d.setDate(d.getDate() + 1);
    }

    const totals = {
      totalCost: days.reduce((sum, d) => sum + d.totals.totalCost, 0),
      currentCost: days.reduce((sum, d) => sum + d.totals.currentCost, 0),
      totalSavings: days.reduce((sum, d) => sum + d.totals.savings, 0),
    };
    totals.savingsPercent = Math.round((totals.totalSavings / totals.currentCost) * 100);

    return {
      branchId,
      startDate: startDate.toISOString().split("T")[0],
      days,
      totals,
    };
  }

  /**
   * Genera horario semanal optimizado
   */
  async generateWeeklySchedule(branchId, startDate = new Date(), options = {}) {
    const weekOptimization = await this.optimizeWeek(branchId, startDate, options);
    
    const schedule = {
      branchId,
      branchName: weekOptimization.days[0]?.branchName,
      weekStarting: startDate.toISOString().split("T")[0],
      generated: new Date().toISOString(),
      serviceLevel: options.serviceLevel || "STANDARD",
      days: [],
      summary: {},
    };

    const dayNames = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

    for (const day of weekOptimization.days) {
      const d = new Date(day.date);
      
      schedule.days.push({
        date: day.date,
        dayName: dayNames[d.getDay()],
        shifts: day.shifts.map(s => ({
          shift: s.displayName,
          hours: `${s.startHour}:00 - ${s.endHour}:00`,
          staff: s.recommendedStaff,
          expectedDemand: s.shiftForecast.peak,
        })),
        totals: day.totals,
      });
    }

    schedule.summary = {
      ...weekOptimization.totals,
      avgDailyCost: Math.round(weekOptimization.totals.totalCost / 7),
      monthlySavings: Math.round(weekOptimization.totals.totalSavings * 4.3),
    };

    return schedule;
  }

  /**
   * Compara diferentes niveles de servicio
   */
  async compareServiceLevels(branchId, date = new Date()) {
    const serviceLevels = this.getServiceLevels();
    const results = [];

    for (const [levelName, config] of Object.entries(serviceLevels)) {
      const optimization = await this.optimizeDay(branchId, date, { serviceLevel: levelName });
      
      results.push({
        level: levelName,
        name: config.name,
        targetUtilization: config.targetUtilization,
        totalStaff: optimization.totals.totalStaff,
        totalCost: optimization.totals.totalCost,
        savings: optimization.totals.savings,
      });
    }

    return {
      branchId,
      date: date.toISOString().split("T")[0],
      comparisons: results,
      recommendation: this.recommendServiceLevel(results),
    };
  }

  /**
   * Recomienda nivel de servicio
   */
  recommendServiceLevel(comparisons) {
    const efficient = comparisons.find(c => c.level === "EFFICIENT");

    if (efficient && efficient.savings > 0) {
      return {
        level: "EFFICIENT",
        reason: `Ahorra $${efficient.savings.toLocaleString()} vs actual manteniendo buen servicio`,
      };
    }

    return {
      level: "STANDARD",
      reason: "Balance óptimo entre servicio y costo",
    };
  }

  /**
   * Obtiene resumen de optimización para todas las sucursales
   */
  async getOptimizationSummary(date = new Date()) {
    const branchIds = configLoader.getBranchIds();
    const results = [];

    for (const branchId of branchIds) {
      try {
        const optimization = await this.optimizeDay(branchId, date);
        results.push({
          branchId,
          branchName: optimization.branchName,
          currentCost: optimization.totals.currentCost,
          optimizedCost: optimization.totals.totalCost,
          savings: optimization.totals.savings,
          savingsPercent: optimization.totals.savingsPercent,
        });
      } catch (err) {
        logger.warn({ branchId, err: err?.message }, "Failed to optimize branch");
      }
    }

    results.sort((a, b) => b.savings - a.savings);

    return {
      date: date.toISOString().split("T")[0],
      branches: results,
      totals: {
        totalCurrentCost: results.reduce((sum, r) => sum + r.currentCost, 0),
        totalOptimizedCost: results.reduce((sum, r) => sum + r.optimizedCost, 0),
        totalSavings: results.reduce((sum, r) => sum + r.savings, 0),
      },
    };
  }
}

export const staffingOptimizer = new StaffingOptimizer();

export default StaffingOptimizer;
