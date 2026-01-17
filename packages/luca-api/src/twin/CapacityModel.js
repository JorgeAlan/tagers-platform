/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CAPACITY MODEL - Modelo de Capacidad Operativa
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Todo viene del ConfigLoader (Google Sheets)
 * 
 * Modela la capacidad operativa de cada sucursal:
 * - Capacidad por área (cocina, barra, servicio)
 * - Cuellos de botella
 * - Utilización
 * - Puntos de quiebre
 */

import { logger } from "@tagers/shared";
import { BranchTwin } from "./BranchTwin.js";
import { configLoader } from "../config/ConfigLoader.js";

export class CapacityModel {
  constructor(branchId) {
    this.twin = new BranchTwin(branchId);
    this.branchId = branchId;
  }

  /**
   * Obtiene capacidad por rol desde config
   */
  getRoleCapacities() {
    return {
      barista: configLoader.getRoleCapacity("barista") || { drinksPerHour: 30, costPerHour: 85 },
      kitchen: configLoader.getRoleCapacity("kitchen") || { dishesPerHour: 12, costPerHour: 80 },
      floor: configLoader.getRoleCapacity("floor") || { customersPerHour: 20, costPerHour: 70 },
      cashier: configLoader.getRoleCapacity("cashier") || { transactionsPerHour: 45, costPerHour: 75 },
    };
  }

  /**
   * Obtiene umbrales de utilización desde config
   */
  getUtilizationThresholds() {
    return {
      optimal: {
        min: configLoader.getThresholdValue("capacity", "utilization_optimal_min", 0.6),
        max: configLoader.getThresholdValue("capacity", "utilization_optimal_max", 0.8),
      },
      warning: {
        min: configLoader.getThresholdValue("capacity", "utilization_warning_min", 0.8),
        max: configLoader.getThresholdValue("capacity", "utilization_warning_max", 0.95),
      },
      critical: {
        min: configLoader.getThresholdValue("capacity", "utilization_critical_min", 0.95),
        max: 1.0,
      },
    };
  }

  /**
   * Calcula capacidad máxima teórica por área
   */
  calculateMaxCapacity(staff) {
    const roles = this.getRoleCapacities();
    
    return {
      drinks: staff.baristas * (roles.barista.drinksPerHour || 30),
      dishes: staff.kitchen * (roles.kitchen.dishesPerHour || 12),
      bakery: staff.kitchen * (roles.kitchen.bakeryPerHour || 25) * 0.3,
      tables: staff.floor * (roles.floor.customersPerHour || 20) / 2.5,
      transactions: staff.cashier * (roles.cashier.transactionsPerHour || 45),
    };
  }

  /**
   * Identifica cuello de botella dado staff y demanda
   */
  identifyBottleneck(staff, expectedDemand) {
    const capacity = this.calculateMaxCapacity(staff);
    
    // Estimar distribución de demanda
    const estimatedDrinks = expectedDemand.transactions * 0.8;
    const estimatedDishes = expectedDemand.transactions * 0.6;

    const utilization = {
      drinks: {
        demand: estimatedDrinks,
        capacity: capacity.drinks,
        utilization: estimatedDrinks / capacity.drinks,
      },
      dishes: {
        demand: estimatedDishes,
        capacity: capacity.dishes,
        utilization: estimatedDishes / capacity.dishes,
      },
      transactions: {
        demand: expectedDemand.transactions,
        capacity: capacity.transactions,
        utilization: expectedDemand.transactions / capacity.transactions,
      },
    };

    const sorted = Object.entries(utilization)
      .sort((a, b) => b[1].utilization - a[1].utilization);

    const bottleneck = sorted[0];
    
    return {
      area: bottleneck[0],
      utilization: Math.round(bottleneck[1].utilization * 100) / 100,
      isOverCapacity: bottleneck[1].utilization > 1.0,
      allAreas: utilization,
    };
  }

  /**
   * Calcula utilización general de la sucursal
   */
  calculateUtilization(staff, expectedTransactions) {
    const capacity = this.calculateMaxCapacity(staff);
    const thresholds = this.getUtilizationThresholds();
    
    const effectiveCapacity = Math.min(
      capacity.drinks,
      capacity.dishes,
      capacity.transactions
    );

    const utilization = expectedTransactions / effectiveCapacity;

    let status = "optimal";
    let color = "green";
    
    if (utilization >= thresholds.critical.min) {
      status = "critical";
      color = "red";
    } else if (utilization >= thresholds.warning.min) {
      status = "warning";
      color = "yellow";
    } else if (utilization < thresholds.optimal.min) {
      status = "underutilized";
      color = "blue";
    }

    return {
      utilization: Math.round(utilization * 100) / 100,
      utilizationPercent: Math.round(utilization * 100),
      status,
      color,
      effectiveCapacity,
      maxCapacity: capacity,
    };
  }

  /**
   * Calcula punto de quiebre (cuando se satura)
   */
  calculateBreakpoint(staff) {
    const capacity = this.calculateMaxCapacity(staff);
    
    const effectiveCapacity = Math.min(
      capacity.drinks,
      capacity.dishes,
      capacity.transactions
    );

    const breakpoint = Math.floor(effectiveCapacity * 0.95);

    return {
      breakpointTransactions: breakpoint,
      breakpointSales: breakpoint * this.twin.getBaseline().avgTicket,
      limitingFactor: Object.entries(capacity)
        .sort((a, b) => a[1] - b[1])[0][0],
    };
  }

  /**
   * Recomienda staff óptimo para demanda esperada
   */
  recommendStaff(expectedTransactions, options = {}) {
    const { targetUtilization = 0.75, minStaff = true } = options;
    const roles = this.getRoleCapacities();
    
    const estimatedDrinks = expectedTransactions * 0.8;
    const estimatedDishes = expectedTransactions * 0.6;

    const recommended = {
      baristas: Math.ceil(estimatedDrinks / ((roles.barista.drinksPerHour || 30) * targetUtilization)),
      kitchen: Math.ceil(estimatedDishes / ((roles.kitchen.dishesPerHour || 12) * targetUtilization)),
      floor: Math.ceil(expectedTransactions / ((roles.floor.customersPerHour || 20) * targetUtilization * 2)),
      cashier: Math.ceil(expectedTransactions / ((roles.cashier.transactionsPerHour || 45) * targetUtilization)),
    };

    if (minStaff) {
      recommended.baristas = Math.max(1, recommended.baristas);
      recommended.kitchen = Math.max(1, recommended.kitchen);
      recommended.floor = Math.max(1, recommended.floor);
      recommended.cashier = Math.max(1, recommended.cashier);
    }

    const physical = this.twin.getCapacity();
    recommended.baristas = Math.min(recommended.baristas, (physical.cashRegisters || 3) + 2);
    recommended.kitchen = Math.min(recommended.kitchen, (physical.kitchenStations || 3) + 1);
    recommended.cashier = Math.min(recommended.cashier, physical.cashRegisters || 3);

    recommended.total = recommended.baristas + recommended.kitchen + recommended.floor + recommended.cashier;

    const resultingUtilization = this.calculateUtilization(recommended, expectedTransactions);

    return {
      staff: recommended,
      targetUtilization,
      resultingUtilization: resultingUtilization.utilization,
      resultingStatus: resultingUtilization.status,
    };
  }

  /**
   * Simula escenarios de staff vs demanda
   */
  simulateScenarios(expectedTransactions, staffVariants) {
    return staffVariants.map(staff => {
      const utilization = this.calculateUtilization(staff, expectedTransactions);
      const bottleneck = this.identifyBottleneck(staff, { transactions: expectedTransactions });
      const breakpoint = this.calculateBreakpoint(staff);

      return {
        staff,
        totalStaff: Object.values(staff).reduce((a, b) => a + b, 0),
        utilization: utilization.utilization,
        status: utilization.status,
        bottleneck: bottleneck.area,
        canHandleDemand: !bottleneck.isOverCapacity,
        headroom: Math.max(0, breakpoint.breakpointTransactions - expectedTransactions),
      };
    });
  }

  /**
   * Obtiene resumen de capacidad actual
   */
  getCurrentCapacitySummary() {
    const currentStaff = this.twin.state.currentStaff;
    const baseline = this.twin.getBaseline();
    const avgHourlyTransactions = baseline.dailyTransactions / this.twin.getOperatingHours();

    const capacity = this.calculateMaxCapacity(currentStaff);
    const utilization = this.calculateUtilization(currentStaff, avgHourlyTransactions);
    const breakpoint = this.calculateBreakpoint(currentStaff);

    return {
      branchId: this.branchId,
      branchName: this.twin.name,
      currentStaff,
      maxCapacity: capacity,
      avgHourlyDemand: avgHourlyTransactions,
      utilization: utilization.utilization,
      status: utilization.status,
      breakpoint: breakpoint.breakpointTransactions,
      headroom: breakpoint.breakpointTransactions - avgHourlyTransactions,
    };
  }
}

/**
 * Factory para crear modelos de capacidad
 */
export function createCapacityModel(branchId) {
  return new CapacityModel(branchId);
}

/**
 * Obtiene capacidad de todas las sucursales
 */
export function getAllCapacitySummaries() {
  const branchIds = configLoader.getBranchIds();
  return branchIds.map(id => {
    const model = new CapacityModel(id);
    return model.getCurrentCapacitySummary();
  });
}

export default CapacityModel;
