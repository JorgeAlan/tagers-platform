/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEMAND FORECASTER - Predictor de Demanda
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Todo viene del ConfigLoader (Google Sheets)
 * 
 * Predice demanda combinando:
 * - Datos históricos (baseline de sucursal)
 * - Patrones estacionales (día de semana, mes)
 * - Factores externos (clima, feriados, eventos)
 * - Tendencias recientes
 */

import { logger } from "@tagers/shared";
import { BranchTwin } from "./BranchTwin.js";
import { configLoader } from "../config/ConfigLoader.js";

export class DemandForecaster {
  constructor() {
    this.twins = {};
    this.cache = new Map();
  }

  /**
   * Obtiene o crea twin de sucursal
   */
  getTwin(branchId) {
    if (!this.twins[branchId]) {
      this.twins[branchId] = new BranchTwin(branchId);
    }
    return this.twins[branchId];
  }

  /**
   * Predice demanda para un día completo
   */
  async forecastDay(branchId, date = new Date()) {
    const twin = this.getTwin(branchId);
    const baseline = twin.getBaseline();
    
    // Obtener factores externos
    let externalFactors = { weather: 1.0, calendar: 1.0, events: 1.0 };
    try {
      // Importar dinámicamente para evitar dependencia circular
      const { externalContext } = await import("../integrations/external/ExternalContext.js");
      const context = await externalContext.getContext(date, { branchId });
      if (context.combinedImpact) {
        externalFactors = {
          weather: 1 + (context.weather?.impact?.overall || 0),
          calendar: context.calendar?.impact || 1.0,
          events: context.events?.branchImpact?.impact || 1.0,
        };
      }
    } catch (err) {
      logger.warn({ branchId, err: err?.message }, "Failed to get external context");
    }

    // Factores de calendario desde config
    const d = new Date(date);
    const dayOfWeek = d.getDay();
    const month = d.getMonth() + 1;
    
    const dayFactor = configLoader.getDayOfWeekFactor(dayOfWeek);
    const monthFactor = configLoader.getMonthFactor(month);

    // Verificar si es feriado
    const holiday = configLoader.getHoliday(date);
    const holidayFactor = holiday?.salesImpact || 1.0;

    // Calcular forecast diario
    const combinedFactor = dayFactor * monthFactor * holidayFactor *
      externalFactors.weather * externalFactors.calendar * externalFactors.events;

    const forecast = {
      branchId,
      branchName: twin.name,
      date: d.toISOString().split("T")[0],
      
      // Predicciones
      expectedSales: Math.round(baseline.dailySales * combinedFactor),
      expectedTransactions: Math.round(baseline.dailyTransactions * combinedFactor),
      expectedAvgTicket: baseline.avgTicket,
      
      // Factores aplicados
      factors: {
        dayOfWeek: { day: dayOfWeek, factor: dayFactor },
        month: { month, factor: monthFactor },
        holiday: holiday ? { name: holiday.name, factor: holidayFactor } : null,
        external: externalFactors,
        combined: Math.round(combinedFactor * 100) / 100,
      },
      
      // Comparación con baseline
      vsBaseline: {
        salesDiff: Math.round((combinedFactor - 1) * baseline.dailySales),
        salesDiffPercent: Math.round((combinedFactor - 1) * 100),
      },
      
      // Confianza
      confidence: this.calculateConfidence(externalFactors),
    };

    // Añadir forecast por hora
    forecast.hourly = this.forecastHours(twin, date, combinedFactor);

    return forecast;
  }

  /**
   * Predice demanda por hora
   */
  forecastHours(twin, date, dayFactor) {
    const baseline = twin.getBaseline();
    const openH = parseInt(twin.config.openHour.split(":")[0]);
    const closeH = parseInt(twin.config.closeHour.split(":")[0]);
    
    const hourly = [];
    let totalTransactions = 0;
    
    for (let hour = openH; hour < closeH; hour++) {
      const hourPattern = configLoader.getHourFactor(hour);
      const isPeak = twin.isPeakHour(hour);
      
      const baseHourlyTransactions = baseline.dailyTransactions / (closeH - openH);
      const expectedTransactions = Math.round(
        baseHourlyTransactions * hourPattern * dayFactor
      );
      
      totalTransactions += expectedTransactions;
      
      hourly.push({
        hour,
        hourFormatted: `${hour.toString().padStart(2, "0")}:00`,
        expectedTransactions,
        expectedSales: expectedTransactions * baseline.avgTicket,
        isPeak,
        pattern: hourPattern,
      });
    }

    // Normalizar para que sume al total diario
    const normalFactor = (baseline.dailyTransactions * dayFactor) / totalTransactions;
    for (const h of hourly) {
      h.expectedTransactions = Math.round(h.expectedTransactions * normalFactor);
      h.expectedSales = h.expectedTransactions * baseline.avgTicket;
    }

    return hourly;
  }

  /**
   * Predice demanda para múltiples días
   */
  async forecastRange(branchId, startDate, days = 7) {
    const forecasts = [];
    const d = new Date(startDate);

    for (let i = 0; i < days; i++) {
      const forecast = await this.forecastDay(branchId, d);
      forecasts.push(forecast);
      d.setDate(d.getDate() + 1);
    }

    const totals = {
      totalSales: forecasts.reduce((sum, f) => sum + f.expectedSales, 0),
      totalTransactions: forecasts.reduce((sum, f) => sum + f.expectedTransactions, 0),
      avgDailySales: Math.round(forecasts.reduce((sum, f) => sum + f.expectedSales, 0) / days),
    };

    return {
      branchId,
      startDate: new Date(startDate).toISOString().split("T")[0],
      days,
      forecasts,
      totals,
    };
  }

  /**
   * Predice demanda para todas las sucursales
   */
  async forecastAllBranches(date = new Date()) {
    const results = {};
    const branchIds = configLoader.getBranchIds();
    
    for (const branchId of branchIds) {
      try {
        results[branchId] = await this.forecastDay(branchId, date);
      } catch (err) {
        logger.warn({ branchId, err: err?.message }, "Failed to forecast branch");
      }
    }

    const branches = Object.values(results);
    const totals = {
      totalExpectedSales: branches.reduce((sum, b) => sum + (b.expectedSales || 0), 0),
      totalExpectedTransactions: branches.reduce((sum, b) => sum + (b.expectedTransactions || 0), 0),
    };

    return {
      date: new Date(date).toISOString().split("T")[0],
      branches: results,
      totals,
    };
  }

  /**
   * Calcula confianza de la predicción
   */
  calculateConfidence(externalFactors) {
    let confidence = 0.85;
    
    const factors = [externalFactors.weather, externalFactors.calendar, externalFactors.events];
    for (const f of factors) {
      if (f < 0.7 || f > 1.5) {
        confidence -= 0.1;
      } else if (f < 0.85 || f > 1.2) {
        confidence -= 0.05;
      }
    }

    return Math.max(0.5, Math.min(0.95, confidence));
  }

  /**
   * Compara forecast con datos reales (para aprendizaje)
   */
  async compareWithActual(branchId, date, actualSales, actualTransactions) {
    const forecast = await this.forecastDay(branchId, date);
    
    const salesError = (actualSales - forecast.expectedSales) / forecast.expectedSales;
    const transactionsError = (actualTransactions - forecast.expectedTransactions) / forecast.expectedTransactions;

    return {
      branchId,
      date: date.toISOString().split("T")[0],
      forecast,
      actual: { sales: actualSales, transactions: actualTransactions },
      errors: {
        salesError: Math.round(salesError * 100) / 100,
        salesErrorPercent: Math.round(salesError * 100),
        transactionsError: Math.round(transactionsError * 100) / 100,
        transactionsErrorPercent: Math.round(transactionsError * 100),
      },
      accuracy: 1 - Math.abs(salesError),
    };
  }

  /**
   * Obtiene resumen de forecast para briefing
   */
  async getForecastSummary(date = new Date()) {
    const allBranches = await this.forecastAllBranches(date);
    
    const ranked = Object.entries(allBranches.branches)
      .map(([id, data]) => ({ branchId: id, ...data }))
      .sort((a, b) => b.expectedSales - a.expectedSales);

    return {
      date: allBranches.date,
      totalExpected: allBranches.totals.totalExpectedSales,
      topBranch: ranked[0],
      bottomBranch: ranked[ranked.length - 1],
      summary: ranked.map(b => ({
        branch: b.branchName,
        expectedSales: b.expectedSales,
        vsBaseline: b.vsBaseline.salesDiffPercent,
      })),
    };
  }
}

export const demandForecaster = new DemandForecaster();

export default DemandForecaster;
