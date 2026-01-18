/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EXTERNAL ROUTES - API para Integraciones Externas
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { weatherService } from "../integrations/weather/WeatherService.js";
import { weatherImpact } from "../integrations/weather/WeatherImpact.js";
import { mexicoHolidays } from "../integrations/calendar/MexicoHolidays.js";
import { localEvents, EventTypes } from "../integrations/calendar/LocalEvents.js";
import { schoolCalendar } from "../integrations/calendar/SchoolCalendar.js";
import { externalContext } from "../integrations/external/ExternalContext.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// WEATHER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/external/weather/current/:branchId
 * Clima actual de una sucursal
 */
router.get("/weather/current/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const weather = await weatherService.getCurrentWeather(branchId);
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/weather/forecast/:branchId
 * Forecast de una sucursal
 */
router.get("/weather/forecast/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { days } = req.query;
    const forecast = await weatherService.getForecast(branchId, parseInt(days) || 5);
    res.json(forecast);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/weather/all
 * Clima de todas las sucursales
 */
router.get("/weather/all", async (req, res) => {
  try {
    const weather = await weatherService.getAllBranchesWeather();
    res.json(weather);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/weather/summary
 * Resumen de clima para briefing
 */
router.get("/weather/summary", async (req, res) => {
  try {
    const summary = await weatherService.getWeatherSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/weather/impact/:branchId
 * Impacto del clima en una sucursal
 */
router.get("/weather/impact/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const impact = await weatherImpact.calculateImpact(branchId);
    res.json(impact);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/weather/impact/summary
 * Resumen de impacto del clima
 */
router.get("/weather/impact/summary", async (req, res) => {
  try {
    const summary = await weatherImpact.getImpactSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/weather/locations
 * Lista ubicaciones de sucursales
 */
router.get("/weather/locations", (req, res) => {
  res.json(weatherService.getAllBranchLocations());
});

// ═══════════════════════════════════════════════════════════════════════════
// CALENDAR / HOLIDAYS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/external/calendar/today
 * Información del día actual
 */
router.get("/calendar/today", (req, res) => {
  res.json(mexicoHolidays.getToday());
});

/**
 * GET /api/luca/external/calendar/date/:date
 * Información de una fecha específica
 */
router.get("/calendar/date/:date", (req, res) => {
  const { date } = req.params;
  res.json(mexicoHolidays.getDateInfo(new Date(date)));
});

/**
 * GET /api/luca/external/calendar/upcoming
 * Próximos días especiales
 */
router.get("/calendar/upcoming", (req, res) => {
  const { days } = req.query;
  res.json(mexicoHolidays.getUpcoming(parseInt(days) || 30));
});

/**
 * GET /api/luca/external/calendar/month/:year/:month
 * Feriados de un mes
 */
router.get("/calendar/month/:year/:month", (req, res) => {
  const { year, month } = req.params;
  res.json(mexicoHolidays.getMonthHolidays(parseInt(year), parseInt(month)));
});

/**
 * GET /api/luca/external/calendar/year/:year
 * Feriados del año
 */
router.get("/calendar/year/:year", (req, res) => {
  const { year } = req.params;
  res.json(mexicoHolidays.getYearHolidays(parseInt(year)));
});

/**
 * GET /api/luca/external/calendar/seasons
 * Temporadas especiales activas
 */
router.get("/calendar/seasons", (req, res) => {
  res.json({
    isRoscaSeason: mexicoHolidays.isRoscaSeason(),
    isPanDeMuertoSeason: mexicoHolidays.isPanDeMuertoSeason(),
  });
});

/**
 * GET /api/luca/external/calendar/types
 * Tipos de feriados
 */
router.get("/calendar/types", (req, res) => {
  // Types of holidays in Mexico
  res.json({
    NATIONAL: "Feriado nacional",
    BANK: "Día bancario",
    RELIGIOUS: "Feriado religioso",
    CIVIC: "Fecha cívica",
    SEASONAL: "Temporada especial",
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LOCAL EVENTS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/external/events
 * Añade un evento
 */
router.post("/events", (req, res) => {
  try {
    const event = localEvents.addEvent(req.body);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/events/date/:date
 * Eventos de una fecha
 */
router.get("/events/date/:date", (req, res) => {
  const { date } = req.params;
  const { city, type } = req.query;
  res.json(localEvents.getEventsForDate(date, { city, type }));
});

/**
 * GET /api/luca/external/events/upcoming
 * Próximos eventos
 */
router.get("/events/upcoming", (req, res) => {
  const { days, city, type } = req.query;
  res.json(localEvents.getUpcomingEvents(parseInt(days) || 7, { city, type }));
});

/**
 * GET /api/luca/external/events/impact/:branchId
 * Impacto de eventos en una sucursal
 */
router.get("/events/impact/:branchId", (req, res) => {
  const { branchId } = req.params;
  const { date } = req.query;
  res.json(localEvents.calculateImpact(branchId, date ? new Date(date) : new Date()));
});

/**
 * GET /api/luca/external/events/types
 * Tipos de eventos
 */
router.get("/events/types", (req, res) => {
  res.json(EventTypes);
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHOOL CALENDAR
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/external/school/today
 * Estado escolar del día
 */
router.get("/school/today", (req, res) => {
  res.json(schoolCalendar.isSchoolDay());
});

/**
 * GET /api/luca/external/school/date/:date
 * Estado escolar de una fecha
 */
router.get("/school/date/:date", (req, res) => {
  const { date } = req.params;
  res.json(schoolCalendar.isSchoolDay(new Date(date)));
});

/**
 * GET /api/luca/external/school/traffic/:branchId
 * Impacto de tráfico escolar
 */
router.get("/school/traffic/:branchId", (req, res) => {
  const { branchId } = req.params;
  const { date, hour } = req.query;
  res.json(schoolCalendar.getTrafficImpact(
    branchId, 
    date ? new Date(date) : new Date(),
    hour ? parseInt(hour) : new Date().getHours()
  ));
});

/**
 * GET /api/luca/external/school/vacations
 * Próximas vacaciones
 */
router.get("/school/vacations", (req, res) => {
  const { days } = req.query;
  res.json(schoolCalendar.getUpcomingVacations(parseInt(days) || 60));
});

/**
 * GET /api/luca/external/school/summary
 * Resumen para briefing
 */
router.get("/school/summary", (req, res) => {
  res.json(schoolCalendar.getSummaryForBriefing());
});

// ═══════════════════════════════════════════════════════════════════════════
// UNIFIED CONTEXT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/external/context
 * Contexto externo completo
 */
router.get("/context", async (req, res) => {
  try {
    const { date, branch_id, city, force } = req.query;
    const context = await externalContext.getContext(
      date ? new Date(date) : new Date(),
      { branchId: branch_id, city, forceRefresh: force === "true" }
    );
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/context/briefing
 * Contexto resumido para briefing
 */
router.get("/context/briefing", async (req, res) => {
  try {
    const { branch_id, city } = req.query;
    const context = await externalContext.getBriefingContext({ 
      branchId: branch_id, 
      city 
    });
    res.json(context);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/external/context/demand/:branchId
 * Señales de demanda para una sucursal
 */
router.get("/context/demand/:branchId", async (req, res) => {
  try {
    const { branchId } = req.params;
    const { date } = req.query;
    const signals = await externalContext.getDemandSignals(
      branchId, 
      date ? new Date(date) : new Date()
    );
    res.json(signals);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/external/status
 * Estado del sistema de integraciones externas
 */
router.get("/status", (req, res) => {
  const branchLocations = weatherService.getAllBranchLocations();
  res.json({
    service: "external_integrations",
    status: "operational",
    integrations: {
      weather: {
        configured: !!process.env.OPENWEATHER_API_KEY,
        branches: Object.keys(branchLocations).length,
      },
      calendar: {
        holidaysLoaded: true,
        currentSeason: mexicoHolidays.isRoscaSeason() 
          ? "rosca" 
          : mexicoHolidays.isPanDeMuertoSeason() 
            ? "pan_de_muerto" 
            : "regular",
      },
      events: {
        eventsLoaded: true,
      },
      school: {
        isSchoolDay: schoolCalendar.isSchoolDay().isSchoolDay,
      },
    },
  });
});

export default router;
