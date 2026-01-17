/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BRANCH TWIN - Modelo Digital de Sucursal (v2 - Zero Hardcode)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * CAMBIO vs v1:
 * - v1: Configuración hardcodeada en BranchConfigs
 * - v2: Todo viene de Google Sheets via lucaConfigHub
 * 
 * Representa el "gemelo digital" de cada sucursal:
 * - Características físicas (capacidad, mesas, estaciones)
 * - Métricas históricas (ventas promedio, patrones)
 * - Estado actual (staff, inventario)
 * - Capacidades operativas
 */

import { logger } from "@tagers/shared";
import { lucaConfigHub } from "../config/LucaConfigHub.js";

/**
 * Clase que representa el gemelo digital de una sucursal
 */
export class BranchTwin {
  constructor(branchId) {
    // Obtener configuración desde ConfigHub (NO hardcodeada)
    const config = lucaConfigHub.getBranch(branchId);
    
    if (!config) {
      throw new Error(`Branch ${branchId} not found in config. Available: ${lucaConfigHub.getBranchIds().join(', ')}`);
    }
    
    this.config = config;
    this.id = branchId;
    this.name = config.name;
    this.city = config.city;
    
    // Estado actual (mutable)
    this.state = {
      currentStaff: this.getDefaultStaff('afternoon'),
      currentOccupancy: 0,
      kitchenLoad: 0,
      inventoryLevels: {},
    };
  }

  /**
   * Obtiene configuración completa
   */
  getConfig() {
    return this.config;
  }

  /**
   * Obtiene capacidad física
   * NOTA: Estas métricas también podrían venir del Sheet en futuro
   */
  getCapacity() {
    // Por ahora calculamos basado en tipo de sucursal
    const typeCapacities = {
      flagship: { tables: 25, seats: 80, maxOccupancy: 100, kitchenStations: 4, bakeryStations: 2, cashRegisters: 3 },
      standard: { tables: 18, seats: 55, maxOccupancy: 70, kitchenStations: 3, bakeryStations: 1, cashRegisters: 2 },
      premium: { tables: 30, seats: 100, maxOccupancy: 120, kitchenStations: 5, bakeryStations: 2, cashRegisters: 4 },
      trendy: { tables: 20, seats: 65, maxOccupancy: 80, kitchenStations: 3, bakeryStations: 2, cashRegisters: 2 },
      family: { tables: 28, seats: 90, maxOccupancy: 110, kitchenStations: 4, bakeryStations: 2, cashRegisters: 3 },
    };
    
    return typeCapacities[this.config.type] || typeCapacities.standard;
  }

  /**
   * Obtiene métricas baseline (DESDE CONFIG HUB)
   */
  getBaseline() {
    return {
      dailySales: this.config.daily_sales_baseline,
      avgTicket: this.config.avg_ticket,
      dailyTransactions: this.config.daily_transactions || Math.round(this.config.daily_sales_baseline / this.config.avg_ticket),
      peakHourFactor: this.config.peak_factor,
    };
  }

  /**
   * Obtiene horarios de operación (DESDE CONFIG HUB)
   */
  getHours() {
    return {
      open: this.config.open_hour,
      close: this.config.close_hour,
      peakHours: this.getPeakHoursFromPatterns(),
    };
  }

  /**
   * Obtiene horas pico desde patrones (si existen en config)
   */
  getPeakHoursFromPatterns() {
    // Intentar obtener de LUCA_DAY_PATTERNS
    const dayPatterns = lucaConfigHub.getRawSheet('day_patterns');
    if (dayPatterns?.rows) {
      const today = new Date().getDay();
      const todayPattern = dayPatterns.rows.find(p => p.day_of_week === today);
      if (todayPattern?.peak_hours) {
        return todayPattern.peak_hours.split(',');
      }
    }
    
    // Default basado en tipo
    const defaultPeaks = {
      flagship: ["08:00-10:00", "13:00-15:00", "19:00-21:00"],
      premium: ["08:00-10:00", "13:00-15:00", "19:00-22:00"],
      trendy: ["09:00-11:00", "13:00-15:00", "18:00-20:00"],
      family: ["08:00-10:00", "13:00-15:00", "17:00-19:00"],
      standard: ["08:00-10:00", "13:00-15:00"],
    };
    
    return defaultPeaks[this.config.type] || defaultPeaks.standard;
  }

  /**
   * Obtiene staff por defecto para un turno (DESDE CONFIG HUB)
   */
  getDefaultStaff(shift) {
    const staffing = lucaConfigHub.getStaffing(this.id, shift);
    
    if (staffing) {
      return {
        baristas: staffing.baristas,
        kitchen: staffing.kitchen,
        floor: staffing.floor,
        cashier: staffing.cashier,
      };
    }
    
    // Fallback basado en tipo
    const defaults = {
      flagship: { baristas: 3, kitchen: 4, floor: 2, cashier: 2 },
      premium: { baristas: 4, kitchen: 5, floor: 3, cashier: 2 },
      trendy: { baristas: 3, kitchen: 3, floor: 2, cashier: 1 },
      family: { baristas: 3, kitchen: 4, floor: 2, cashier: 2 },
      standard: { baristas: 2, kitchen: 3, floor: 1, cashier: 1 },
    };
    
    return defaults[this.config.type] || defaults.standard;
  }

  /**
   * Calcula capacidad operativa actual
   */
  getCurrentCapacity() {
    const staff = this.state.currentStaff;
    const capacity = this.getCapacity();
    
    // Obtener capacidades por rol desde ConfigHub
    const baristaCapacity = lucaConfigHub.getRoleCapacity('barista');
    const kitchenCapacity = lucaConfigHub.getRoleCapacity('kitchen');
    const floorCapacity = lucaConfigHub.getRoleCapacity('floor');
    const cashierCapacity = lucaConfigHub.getRoleCapacity('cashier');
    
    // Capacidad de producción por área
    const baristaMax = staff.baristas * (baristaCapacity?.drinks_per_hour || 30);
    const kitchenMax = staff.kitchen * (kitchenCapacity?.dishes_per_hour || 12);
    const serviceMax = staff.floor * (floorCapacity?.customers_per_hour || 20);
    const checkoutMax = staff.cashier * (cashierCapacity?.transactions_per_hour || 45);
    
    // Bottleneck (cuello de botella)
    const maxTransactionsPerHour = Math.min(
      baristaMax,
      kitchenMax,
      serviceMax,
      checkoutMax,
      capacity.maxOccupancy * 2
    );

    return {
      baristaCapacity: baristaMax,
      kitchenCapacity: kitchenMax,
      serviceCapacity: serviceMax,
      checkoutCapacity: checkoutMax,
      maxTransactionsPerHour,
      bottleneck: this.identifyBottleneck(baristaMax, kitchenMax, serviceMax, checkoutMax),
      utilizationRate: this.state.currentOccupancy / capacity.maxOccupancy,
    };
  }

  /**
   * Identifica el cuello de botella
   */
  identifyBottleneck(barista, kitchen, service, checkout) {
    const min = Math.min(barista, kitchen, service, checkout);
    if (min === barista) return "baristas";
    if (min === kitchen) return "kitchen";
    if (min === service) return "floor_service";
    return "checkout";
  }

  /**
   * Simula demanda para una hora específica
   */
  simulateHour(hour, factors = {}) {
    const baseline = this.getBaseline();
    const avgHourlyTransactions = baseline.dailyTransactions / this.getOperatingHours();
    
    // Obtener factor de hora desde ConfigHub
    let hourFactor = this.getHourFactor(hour);
    
    // Aplicar factor de hora pico
    if (this.isPeakHour(hour)) {
      hourFactor = Math.max(hourFactor, baseline.peakHourFactor);
    }
    
    // Aplicar factores externos
    const externalFactor = factors.weather || 1.0;
    const calendarFactor = factors.calendar || 1.0;
    const eventFactor = factors.events || 1.0;
    
    const expectedTransactions = Math.round(
      avgHourlyTransactions * hourFactor * externalFactor * calendarFactor * eventFactor
    );
    
    const expectedSales = expectedTransactions * baseline.avgTicket;
    
    return {
      hour,
      expectedTransactions,
      expectedSales,
      factors: {
        hourFactor,
        externalFactor,
        calendarFactor,
        eventFactor,
        combined: hourFactor * externalFactor * calendarFactor * eventFactor,
      },
    };
  }

  /**
   * Obtiene factor de hora desde ConfigHub
   */
  getHourFactor(hour) {
    const hourPatterns = lucaConfigHub.getRawSheet('hour_patterns');
    if (hourPatterns?.rows) {
      const pattern = hourPatterns.rows.find(p => p.hour === hour);
      if (pattern?.pattern_factor) {
        return pattern.pattern_factor;
      }
    }
    
    // Fallback a valores default
    const defaultPatterns = {
      7: 0.6, 8: 1.2, 9: 1.4, 10: 1.0, 11: 0.8, 12: 1.0,
      13: 1.5, 14: 1.4, 15: 0.7, 16: 0.5, 17: 0.6, 18: 0.9,
      19: 1.2, 20: 1.1, 21: 0.8, 22: 0.5,
    };
    
    return defaultPatterns[hour] || 0.7;
  }

  /**
   * Verifica si es hora pico
   */
  isPeakHour(hour) {
    const hourStr = `${hour.toString().padStart(2, "0")}:00`;
    for (const peak of this.getHours().peakHours) {
      const [start, end] = peak.split("-");
      if (hourStr >= start && hourStr < end) {
        return true;
      }
    }
    return false;
  }

  /**
   * Verifica si es hora baja
   */
  isLowHour(hour) {
    return hour >= 15 && hour < 18;
  }

  /**
   * Obtiene horas de operación
   */
  getOperatingHours() {
    const hours = this.getHours();
    const [openH] = hours.open.split(":").map(Number);
    const [closeH] = hours.close.split(":").map(Number);
    return closeH - openH;
  }

  /**
   * Actualiza estado actual
   */
  updateState(updates) {
    Object.assign(this.state, updates);
  }

  /**
   * Calcula staff recomendado para demanda esperada
   */
  calculateRecommendedStaff(expectedTransactions) {
    // Obtener capacidades desde ConfigHub
    const baristaCapacity = lucaConfigHub.getRoleCapacity('barista')?.drinks_per_hour || 30;
    const kitchenCapacity = lucaConfigHub.getRoleCapacity('kitchen')?.dishes_per_hour || 12;
    const floorCapacity = lucaConfigHub.getRoleCapacity('floor')?.customers_per_hour || 20;
    const cashierCapacity = lucaConfigHub.getRoleCapacity('cashier')?.transactions_per_hour || 45;
    
    const capacity = this.getCapacity();
    
    // Calcular basado en capacidades
    const baristas = Math.ceil(expectedTransactions / baristaCapacity);
    const kitchen = Math.ceil(expectedTransactions / kitchenCapacity);
    const floor = Math.ceil(expectedTransactions / floorCapacity);
    const cashier = Math.ceil(expectedTransactions / cashierCapacity);
    
    return {
      baristas: Math.max(1, Math.min(baristas, capacity.cashRegisters + 2)),
      kitchen: Math.max(1, Math.min(kitchen, capacity.kitchenStations + 1)),
      floor: Math.max(1, floor),
      cashier: Math.max(1, Math.min(cashier, capacity.cashRegisters)),
      total: baristas + kitchen + floor + cashier,
    };
  }

  /**
   * Genera resumen del gemelo
   */
  getSummary() {
    const capacity = this.getCurrentCapacity();
    const hours = this.getHours();
    
    return {
      id: this.id,
      name: this.name,
      city: this.city,
      type: this.config.type,
      baseline: this.getBaseline(),
      currentCapacity: capacity,
      operatingHours: `${hours.open} - ${hours.close}`,
      peakHours: hours.peakHours,
      coordinates: {
        lat: this.config.lat,
        lon: this.config.lon,
      },
    };
  }
}

/**
 * Factory para crear twins
 */
export function createBranchTwin(branchId) {
  return new BranchTwin(branchId);
}

/**
 * Obtiene todos los twins (DESDE CONFIG HUB)
 */
export function getAllBranchTwins() {
  const branchIds = lucaConfigHub.getBranchIds();
  return branchIds.map(id => new BranchTwin(id));
}

/**
 * Obtiene IDs de todas las sucursales
 */
export function getBranchIds() {
  return lucaConfigHub.getBranchIds();
}

/**
 * Legacy: BranchConfigs ahora es dinámico
 * @deprecated Usar lucaConfigHub.getAllBranches() directamente
 */
export function getBranchConfigs() {
  const branches = lucaConfigHub.getAllBranches();
  const configs = {};
  for (const branch of branches) {
    configs[branch.branch_id] = branch;
  }
  return configs;
}

export default BranchTwin;
