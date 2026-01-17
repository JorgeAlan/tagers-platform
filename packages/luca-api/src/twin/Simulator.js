/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SIMULATOR - Motor de Simulación "What If"
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Permite responder preguntas del tipo:
 * - "¿Qué pasa si aumentamos 20% las ventas?"
 * - "¿Qué pasa si quitamos 1 cocinero?"
 * - "¿Qué pasa si hay tormenta el sábado?"
 * - "¿Cuánto personal necesitamos para el Día de Reyes?"
 */

import { logger } from "@tagers/shared";
import { BranchTwin, BranchConfigs } from "./BranchTwin.js";
import { DemandForecaster } from "./DemandForecaster.js";
import { CapacityModel } from "./CapacityModel.js";

/**
 * Tipos de escenarios
 */
export const ScenarioTypes = {
  DEMAND_CHANGE: "demand_change",       // Cambio en demanda
  STAFF_CHANGE: "staff_change",         // Cambio en personal
  WEATHER_EVENT: "weather_event",       // Evento climático
  SPECIAL_DATE: "special_date",         // Fecha especial
  PRICE_CHANGE: "price_change",         // Cambio de precios
  NEW_PRODUCT: "new_product",           // Nuevo producto
  CUSTOM: "custom",                     // Personalizado
};

export class Simulator {
  constructor() {
    this.forecaster = new DemandForecaster();
  }

  /**
   * Simula un escenario completo
   */
  async simulate(branchId, scenario) {
    const twin = new BranchTwin(branchId);
    const capacityModel = new CapacityModel(branchId);
    const baseline = twin.getBaseline();

    logger.info({ branchId, scenario: scenario.type }, "Running simulation");

    const result = {
      branchId,
      branchName: twin.name,
      scenario,
      timestamp: new Date().toISOString(),
      baseline: {
        dailySales: baseline.dailySales,
        dailyTransactions: baseline.dailyTransactions,
        avgTicket: baseline.avgTicket,
      },
      simulated: {},
      impact: {},
      recommendations: [],
    };

    switch (scenario.type) {
      case ScenarioTypes.DEMAND_CHANGE:
        return this.simulateDemandChange(result, twin, capacityModel, scenario);
      
      case ScenarioTypes.STAFF_CHANGE:
        return this.simulateStaffChange(result, twin, capacityModel, scenario);
      
      case ScenarioTypes.WEATHER_EVENT:
        return this.simulateWeatherEvent(result, twin, capacityModel, scenario);
      
      case ScenarioTypes.SPECIAL_DATE:
        return this.simulateSpecialDate(result, twin, capacityModel, scenario);
      
      case ScenarioTypes.PRICE_CHANGE:
        return this.simulatePriceChange(result, twin, capacityModel, scenario);
      
      case ScenarioTypes.CUSTOM:
        return this.simulateCustom(result, twin, capacityModel, scenario);
      
      default:
        throw new Error(`Unknown scenario type: ${scenario.type}`);
    }
  }

  /**
   * Simula cambio en demanda
   * "¿Qué pasa si aumentamos 20% las ventas?"
   */
  simulateDemandChange(result, twin, capacityModel, scenario) {
    const { changePercent } = scenario.params;
    const factor = 1 + (changePercent / 100);
    
    const baseline = result.baseline;
    const currentStaff = twin.config.staffing.afternoon;

    // Calcular nueva demanda
    const newTransactions = Math.round(baseline.dailyTransactions * factor);
    const newSales = Math.round(baseline.dailySales * factor);
    const hourlyTransactions = newTransactions / twin.getOperatingHours();

    result.simulated = {
      dailySales: newSales,
      dailyTransactions: newTransactions,
      hourlyTransactions: Math.round(hourlyTransactions),
    };

    // Evaluar capacidad
    const utilization = capacityModel.calculateUtilization(currentStaff, hourlyTransactions);
    const bottleneck = capacityModel.identifyBottleneck(currentStaff, { transactions: hourlyTransactions });

    result.impact = {
      salesDiff: newSales - baseline.dailySales,
      salesDiffPercent: changePercent,
      currentUtilization: utilization.utilization,
      utilizationStatus: utilization.status,
      bottleneck: bottleneck.area,
      isOverCapacity: bottleneck.isOverCapacity,
    };

    // Recomendaciones
    if (bottleneck.isOverCapacity) {
      const recommended = capacityModel.recommendStaff(hourlyTransactions);
      result.recommendations.push({
        priority: "HIGH",
        action: "Aumentar personal",
        details: `Se necesitan +${recommended.staff.total - Object.values(currentStaff).reduce((a, b) => a + b, 0)} empleados para manejar el volumen`,
        suggestedStaff: recommended.staff,
      });
    }

    if (utilization.status === "warning") {
      result.recommendations.push({
        priority: "MEDIUM",
        action: "Monitorear horas pico",
        details: "Utilización alta, considerar staff adicional en horas pico",
      });
    }

    return result;
  }

  /**
   * Simula cambio en staff
   * "¿Qué pasa si quitamos 1 cocinero?"
   */
  simulateStaffChange(result, twin, capacityModel, scenario) {
    const { staffChanges } = scenario.params;
    const baseline = result.baseline;
    
    // Calcular nuevo staff
    const currentStaff = { ...twin.config.staffing.afternoon };
    const newStaff = { ...currentStaff };
    
    for (const [role, change] of Object.entries(staffChanges)) {
      newStaff[role] = Math.max(0, currentStaff[role] + change);
    }

    const hourlyTransactions = baseline.dailyTransactions / twin.getOperatingHours();

    result.simulated = {
      currentStaff,
      newStaff,
      staffChange: staffChanges,
      totalChange: Object.values(staffChanges).reduce((a, b) => a + b, 0),
    };

    // Evaluar impacto
    const currentUtil = capacityModel.calculateUtilization(currentStaff, hourlyTransactions);
    const newUtil = capacityModel.calculateUtilization(newStaff, hourlyTransactions);
    const newBottleneck = capacityModel.identifyBottleneck(newStaff, { transactions: hourlyTransactions });

    result.impact = {
      currentUtilization: currentUtil.utilization,
      newUtilization: newUtil.utilization,
      utilizationChange: newUtil.utilization - currentUtil.utilization,
      currentStatus: currentUtil.status,
      newStatus: newUtil.status,
      bottleneck: newBottleneck.area,
      isOverCapacity: newBottleneck.isOverCapacity,
    };

    // Recomendaciones
    if (newBottleneck.isOverCapacity) {
      result.recommendations.push({
        priority: "CRITICAL",
        action: "NO reducir personal",
        details: `El cambio propuesto saturará ${newBottleneck.area}`,
      });
    } else if (newUtil.status === "warning") {
      result.recommendations.push({
        priority: "MEDIUM",
        action: "Reducción riesgosa",
        details: "Utilización resultante en zona de advertencia",
      });
    } else if (newUtil.status === "underutilized" && currentUtil.status !== "underutilized") {
      result.recommendations.push({
        priority: "LOW",
        action: "Reducción posible",
        details: "El cambio mantiene operación dentro de parámetros",
      });
    }

    // Calcular ahorro/costo
    const hourlyCost = 150; // MXN por hora por empleado
    const hoursPerDay = twin.getOperatingHours();
    const dailyCostChange = Object.values(staffChanges).reduce((a, b) => a + b, 0) * hourlyCost * hoursPerDay;

    result.impact.dailyCostChange = dailyCostChange;
    result.impact.monthlyCostChange = dailyCostChange * 30;

    return result;
  }

  /**
   * Simula evento climático
   * "¿Qué pasa si hay tormenta el sábado?"
   */
  simulateWeatherEvent(result, twin, capacityModel, scenario) {
    const { weatherType, intensity = "moderate" } = scenario.params;
    const baseline = result.baseline;

    // Impacto por tipo de clima
    const weatherImpacts = {
      rain: { light: 0.9, moderate: 0.8, heavy: 0.65 },
      storm: { light: 0.7, moderate: 0.6, heavy: 0.5 },
      extreme_heat: { light: 0.95, moderate: 0.9, heavy: 0.85 },
      cold: { light: 1.05, moderate: 1.0, heavy: 0.95 },
    };

    const impactFactor = weatherImpacts[weatherType]?.[intensity] || 1.0;
    const deliveryBoost = weatherType === "rain" || weatherType === "storm" ? 1.2 : 1.0;

    // Calcular impacto
    const newTransactions = Math.round(baseline.dailyTransactions * impactFactor);
    const newSales = Math.round(baseline.dailySales * impactFactor);

    result.simulated = {
      weatherType,
      intensity,
      impactFactor,
      dailySales: newSales,
      dailyTransactions: newTransactions,
      deliveryImpact: deliveryBoost,
    };

    result.impact = {
      salesDiff: newSales - baseline.dailySales,
      salesDiffPercent: Math.round((impactFactor - 1) * 100),
      transactionsDiff: newTransactions - baseline.dailyTransactions,
    };

    // Recomendaciones
    if (impactFactor < 0.8) {
      result.recommendations.push({
        priority: "HIGH",
        action: "Reducir personal de piso",
        details: `Esperar ${Math.round((1 - impactFactor) * 100)}% menos tráfico en sucursal`,
      });
    }

    if (deliveryBoost > 1.0) {
      result.recommendations.push({
        priority: "HIGH",
        action: "Reforzar delivery",
        details: `Esperar +${Math.round((deliveryBoost - 1) * 100)}% en delivery`,
      });
    }

    if (weatherType === "extreme_heat") {
      result.recommendations.push({
        priority: "MEDIUM",
        action: "Push bebidas frías",
        details: "Aumentar promoción de bebidas frías y helados",
      });
    }

    return result;
  }

  /**
   * Simula fecha especial
   * "¿Cuánto personal necesitamos para el Día de Reyes?"
   */
  simulateSpecialDate(result, twin, capacityModel, scenario) {
    const { dateName, expectedIncrease } = scenario.params;
    const baseline = result.baseline;
    
    // Factores por fecha especial
    const dateFactors = {
      "dia_de_reyes": 2.0,      // +100%
      "dia_de_las_madres": 1.8, // +80%
      "san_valentin": 1.5,      // +50%
      "dia_de_muertos": 1.4,    // +40%
      "navidad_vispera": 1.3,   // +30%
      "fin_de_semana_largo": 1.25,
    };

    const factor = expectedIncrease ? (1 + expectedIncrease / 100) : (dateFactors[dateName] || 1.2);
    
    // Calcular demanda esperada
    const newTransactions = Math.round(baseline.dailyTransactions * factor);
    const newSales = Math.round(baseline.dailySales * factor);
    const peakHourlyTransactions = Math.round((newTransactions / twin.getOperatingHours()) * baseline.peakHourFactor);

    result.simulated = {
      dateName,
      factor,
      dailySales: newSales,
      dailyTransactions: newTransactions,
      peakHourlyTransactions,
    };

    // Calcular staff necesario
    const recommendedStaff = capacityModel.recommendStaff(peakHourlyTransactions);
    const currentStaff = twin.config.staffing.afternoon;
    const currentTotal = Object.values(currentStaff).reduce((a, b) => a + b, 0);

    result.impact = {
      salesIncrease: newSales - baseline.dailySales,
      salesIncreasePercent: Math.round((factor - 1) * 100),
      additionalStaffNeeded: recommendedStaff.staff.total - currentTotal,
      peakUtilization: recommendedStaff.resultingUtilization,
    };

    result.recommendations.push({
      priority: "HIGH",
      action: `Preparar para ${dateName.replace(/_/g, " ")}`,
      details: `Necesitas ${recommendedStaff.staff.total} empleados (+${result.impact.additionalStaffNeeded} vs normal)`,
      suggestedStaff: recommendedStaff.staff,
    });

    // Si es Rosca
    if (dateName === "dia_de_reyes") {
      result.recommendations.push({
        priority: "CRITICAL",
        action: "Maximizar producción de rosca",
        details: "Asegurar inventario suficiente de rosca",
      });
    }

    return result;
  }

  /**
   * Simula cambio de precios
   */
  simulatePriceChange(result, twin, capacityModel, scenario) {
    const { priceChangePercent, elasticity = -0.5 } = scenario.params;
    const baseline = result.baseline;

    // Elasticidad: si subes precio X%, demanda baja X% * elasticity
    const demandChangeFactor = 1 + (priceChangePercent * elasticity / 100);
    const newAvgTicket = Math.round(baseline.avgTicket * (1 + priceChangePercent / 100));
    const newTransactions = Math.round(baseline.dailyTransactions * demandChangeFactor);
    const newSales = newTransactions * newAvgTicket;

    result.simulated = {
      priceChangePercent,
      elasticity,
      newAvgTicket,
      dailyTransactions: newTransactions,
      dailySales: newSales,
    };

    result.impact = {
      ticketChange: newAvgTicket - baseline.avgTicket,
      transactionsChange: newTransactions - baseline.dailyTransactions,
      transactionsChangePercent: Math.round((demandChangeFactor - 1) * 100),
      salesChange: newSales - baseline.dailySales,
      salesChangePercent: Math.round(((newSales / baseline.dailySales) - 1) * 100),
    };

    if (result.impact.salesChange > 0) {
      result.recommendations.push({
        priority: "LOW",
        action: "Cambio de precio viable",
        details: `Ventas netas aumentan $${result.impact.salesChange.toLocaleString()}`,
      });
    } else {
      result.recommendations.push({
        priority: "MEDIUM",
        action: "Reconsiderar cambio de precio",
        details: `Ventas netas disminuyen $${Math.abs(result.impact.salesChange).toLocaleString()}`,
      });
    }

    return result;
  }

  /**
   * Simula escenario personalizado
   */
  simulateCustom(result, twin, capacityModel, scenario) {
    const { factors } = scenario.params;
    const baseline = result.baseline;

    // Aplicar todos los factores
    let combinedFactor = 1.0;
    const appliedFactors = [];

    for (const [name, value] of Object.entries(factors)) {
      combinedFactor *= value;
      appliedFactors.push({ name, value });
    }

    const newTransactions = Math.round(baseline.dailyTransactions * combinedFactor);
    const newSales = Math.round(baseline.dailySales * combinedFactor);
    const hourlyTransactions = newTransactions / twin.getOperatingHours();

    result.simulated = {
      factors: appliedFactors,
      combinedFactor: Math.round(combinedFactor * 100) / 100,
      dailyTransactions: newTransactions,
      dailySales: newSales,
    };

    const utilization = capacityModel.calculateUtilization(
      twin.config.staffing.afternoon,
      hourlyTransactions
    );

    result.impact = {
      salesDiff: newSales - baseline.dailySales,
      salesDiffPercent: Math.round((combinedFactor - 1) * 100),
      utilization: utilization.utilization,
      status: utilization.status,
    };

    if (combinedFactor > 1.2) {
      const recommended = capacityModel.recommendStaff(hourlyTransactions);
      result.recommendations.push({
        priority: "HIGH",
        action: "Planificar staff adicional",
        details: `Demanda esperada ${Math.round((combinedFactor - 1) * 100)}% arriba del baseline`,
        suggestedStaff: recommended.staff,
      });
    }

    return result;
  }

  /**
   * Compara múltiples escenarios
   */
  async compareScenarios(branchId, scenarios) {
    const results = [];

    for (const scenario of scenarios) {
      const result = await this.simulate(branchId, scenario);
      results.push({
        scenarioName: scenario.name || scenario.type,
        ...result,
      });
    }

    // Ordenar por impacto en ventas
    results.sort((a, b) => (b.impact.salesDiff || 0) - (a.impact.salesDiff || 0));

    return {
      branchId,
      scenarios: results,
      best: results[0],
      worst: results[results.length - 1],
    };
  }
}

export const simulator = new Simulator();

export default Simulator;
