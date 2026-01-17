/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXTERNAL CONTEXT - Agregador de Contexto Externo
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Combina todas las fuentes externas en un solo contexto:
 * - Clima (WeatherService + WeatherImpact)
 * - Feriados (MexicoHolidays)
 * - Eventos locales (LocalEvents)
 * - Calendario escolar (SchoolCalendar)
 * 
 * Proporciona contexto unificado para:
 * - Morning Briefing
 * - Detectores
 * - Predicciones
 */

import { logger } from "@tagers/shared";
import { weatherService } from "./weather/WeatherService.js";
import { weatherImpact } from "./weather/WeatherImpact.js";
import { mexicoHolidays } from "./calendar/MexicoHolidays.js";
import { localEvents } from "./calendar/LocalEvents.js";
import { schoolCalendar } from "./calendar/SchoolCalendar.js";

/**
 * Cache de contexto
 */
const contextCache = new Map();
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutos

export class ExternalContext {
  constructor() {
    this.weather = weatherService;
    this.weatherImpact = weatherImpact;
    this.holidays = mexicoHolidays;
    this.events = localEvents;
    this.school = schoolCalendar;
  }

  /**
   * Obtiene contexto completo para una fecha
   */
  async getContext(date = new Date(), options = {}) {
    const { branchId, city, forceRefresh = false } = options;
    
    const dateStr = new Date(date).toISOString().split("T")[0];
    const cacheKey = `context_${dateStr}_${branchId || city || "all"}`;

    // Verificar cache
    if (!forceRefresh) {
      const cached = this.getFromCache(cacheKey);
      if (cached) return cached;
    }

    logger.info({ date: dateStr, branchId, city }, "Building external context");

    const context = {
      date: dateStr,
      timestamp: new Date().toISOString(),
      weather: {},
      calendar: {},
      events: {},
      school: {},
      combinedImpact: {},
      recommendations: [],
      alerts: [],
    };

    try {
      // 1. Clima
      if (branchId) {
        const currentWeather = await this.weather.getCurrentWeather(branchId);
        const forecast = await this.weather.getForecast(branchId, 3);
        const impact = this.weatherImpact.calculateImpactFromWeather(currentWeather);
        
        context.weather = {
          current: currentWeather,
          forecast: forecast.days,
          impact: impact.impacts,
        };

        // Añadir recomendaciones de clima
        for (const rec of impact.impacts.recommendations || []) {
          context.recommendations.push({
            source: "weather",
            ...rec,
          });
        }
      } else if (city) {
        const cityWeather = await this.weather.getWeatherByCity(city);
        context.weather.current = cityWeather;
      } else {
        const weatherSummary = await this.weather.getWeatherSummary();
        context.weather = weatherSummary;
      }
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get weather context");
      context.weather.error = err?.message;
    }

    // 2. Calendario de feriados
    const holidayInfo = this.holidays.getDateInfo(date);
    context.calendar = {
      ...holidayInfo,
      upcoming: this.holidays.getUpcoming(7),
      isRoscaSeason: this.holidays.isRoscaSeason(date),
      isPanDeMuertoSeason: this.holidays.isPanDeMuertoSeason(date),
    };

    if (holidayInfo.isSpecialDay) {
      context.alerts.push({
        source: "calendar",
        type: "SPECIAL_DAY",
        message: `Hoy es ${holidayInfo.holidays[0]?.name || holidayInfo.seasons[0]?.name}`,
        impact: holidayInfo.impactFormatted,
      });
    }

    // 3. Eventos locales
    const cityForEvents = city || (branchId ? this.getBranchCity(branchId) : null);
    const todayEvents = this.events.getEventsForDate(date, { city: cityForEvents });
    const upcomingEvents = this.events.getUpcomingEvents(7, { city: cityForEvents });

    context.events = {
      today: todayEvents,
      upcoming: upcomingEvents,
    };

    if (branchId) {
      const eventImpact = this.events.calculateImpact(branchId, date);
      context.events.branchImpact = eventImpact;
      
      if (eventImpact.events.length > 0) {
        context.alerts.push({
          source: "events",
          type: "LOCAL_EVENT",
          message: `${eventImpact.events.length} evento(s) cercano(s)`,
          events: eventImpact.events.map(e => e.name),
          impact: eventImpact.impactFormatted,
        });
      }
    }

    // 4. Calendario escolar
    const schoolStatus = this.school.isSchoolDay(date);
    context.school = {
      ...schoolStatus,
      upcomingVacations: this.school.getUpcomingVacations(30),
      isBackToSchool: this.school.isBackToSchool(date),
    };

    if (branchId) {
      const schoolTraffic = this.school.getTrafficImpact(branchId, date);
      context.school.trafficImpact = schoolTraffic;
    }

    if (!schoolStatus.isSchoolDay && schoolStatus.vacationName) {
      context.alerts.push({
        source: "school",
        type: "VACATION",
        message: `Vacaciones escolares: ${schoolStatus.vacationName}`,
        impact: `${Math.round((1 - schoolStatus.impact) * 100)}% menos tráfico escolar`,
      });
    }

    // 5. Calcular impacto combinado
    context.combinedImpact = this.calculateCombinedImpact(context);

    // Guardar en cache
    this.setCache(cacheKey, context);

    return context;
  }

  /**
   * Calcula impacto combinado de todos los factores
   */
  calculateCombinedImpact(context) {
    let overall = 1.0;
    const factors = [];

    // Factor clima
    if (context.weather.impact?.overall) {
      const weatherFactor = 1 + context.weather.impact.overall;
      overall *= weatherFactor;
      factors.push({
        source: "weather",
        factor: weatherFactor,
        description: context.weather.current?.description || "clima",
      });
    }

    // Factor calendario
    if (context.calendar.impact && context.calendar.impact !== 1.0) {
      overall *= context.calendar.impact;
      factors.push({
        source: "calendar",
        factor: context.calendar.impact,
        description: context.calendar.holidays[0]?.name || context.calendar.seasons[0]?.name,
      });
    }

    // Factor eventos
    if (context.events.branchImpact?.impact && context.events.branchImpact.impact !== 1.0) {
      overall *= context.events.branchImpact.impact;
      factors.push({
        source: "events",
        factor: context.events.branchImpact.impact,
        description: `${context.events.branchImpact.events.length} evento(s) local(es)`,
      });
    }

    // Factor escolar
    if (context.school.impact && context.school.impact !== 1.0) {
      overall *= context.school.impact;
      factors.push({
        source: "school",
        factor: context.school.impact,
        description: context.school.vacationName || "calendario escolar",
      });
    }

    return {
      overall: Math.round(overall * 100) / 100,
      overallFormatted: `${overall >= 1 ? "+" : ""}${Math.round((overall - 1) * 100)}%`,
      factors,
      confidence: this.calculateConfidence(factors),
    };
  }

  /**
   * Calcula confianza de la predicción
   */
  calculateConfidence(factors) {
    // Más factores significativos = menos confianza
    const significantFactors = factors.filter(f => Math.abs(f.factor - 1) > 0.1);
    
    if (significantFactors.length === 0) return 0.9;
    if (significantFactors.length === 1) return 0.85;
    if (significantFactors.length === 2) return 0.75;
    return 0.65;
  }

  /**
   * Obtiene contexto resumido para el briefing
   */
  async getBriefingContext(options = {}) {
    const context = await this.getContext(new Date(), options);

    return {
      date: context.date,
      
      // Clima resumido
      weather: context.weather.current ? {
        description: context.weather.current.description,
        temperature: context.weather.current.temperature,
        isRainy: context.weather.current.isRainy,
        isHot: context.weather.current.isHot,
      } : null,
      
      // Día especial
      specialDay: context.calendar.isSpecialDay ? {
        name: context.calendar.holidays[0]?.name || context.calendar.seasons[0]?.name,
        impact: context.calendar.impactFormatted,
      } : null,
      
      // Eventos
      events: context.events.today?.length > 0 ? {
        count: context.events.today.length,
        names: context.events.today.map(e => e.name),
      } : null,
      
      // Escolar
      school: !context.school.isSchoolDay ? {
        reason: context.school.vacationName || "no hay clases",
      } : null,
      
      // Impacto esperado
      expectedImpact: context.combinedImpact,
      
      // Top recomendaciones
      topRecommendations: context.recommendations.slice(0, 3),
      
      // Alertas importantes
      alerts: context.alerts.filter(a => 
        a.type === "SPECIAL_DAY" || a.type === "LOCAL_EVENT"
      ),
    };
  }

  /**
   * Obtiene señales de demanda
   */
  async getDemandSignals(branchId, date = new Date()) {
    const context = await this.getContext(date, { branchId });

    return {
      branchId,
      date: context.date,
      expectedDemandFactor: context.combinedImpact.overall,
      
      signals: {
        weather: {
          condition: context.weather.current?.condition,
          impact: context.weather.impact?.overall || 0,
        },
        calendar: {
          isSpecialDay: context.calendar.isSpecialDay,
          impact: (context.calendar.impact || 1) - 1,
        },
        events: {
          hasEvents: (context.events.today?.length || 0) > 0,
          impact: (context.events.branchImpact?.impact || 1) - 1,
        },
        school: {
          isSchoolDay: context.school.isSchoolDay,
          impact: (context.school.impact || 1) - 1,
        },
      },
      
      recommendations: context.recommendations,
    };
  }

  /**
   * Obtiene ciudad de una sucursal
   */
  getBranchCity(branchId) {
    const cities = {
      "SUC-ANG": "Puebla",
      "SUC-ZAV": "Puebla",
      "SUC-POL": "CDMX",
      "SUC-CON": "CDMX",
      "SUC-ROM": "CDMX",
      "SUC-COY": "CDMX",
    };
    return cities[branchId];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // CACHE
  // ═══════════════════════════════════════════════════════════════════════════

  getFromCache(key) {
    const cached = contextCache.get(key);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      return cached.data;
    }
    return null;
  }

  setCache(key, data) {
    contextCache.set(key, { data, timestamp: Date.now() });
  }

  clearCache() {
    contextCache.clear();
  }
}

export const externalContext = new ExternalContext();

export default ExternalContext;
