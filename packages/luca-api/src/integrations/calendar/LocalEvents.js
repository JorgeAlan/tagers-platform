/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LOCAL EVENTS - Eventos Locales que Afectan Ventas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Eventos locales por ciudad/zona:
 * - Conciertos y festivales
 * - Partidos de fútbol
 * - Maratones y eventos deportivos
 * - Ferias y exposiciones
 */

import { logger } from "@tagers/shared";

/**
 * Tipos de eventos
 */
export const EventTypes = {
  CONCERT: "concert",
  SPORTS: "sports",
  FESTIVAL: "festival",
  CONVENTION: "convention",
  MARATHON: "marathon",
  PARADE: "parade",
  FAIR: "fair",
  OTHER: "other",
};

/**
 * Impacto por tipo de evento
 */
export const EventImpact = {
  [EventTypes.CONCERT]: {
    nearby: 1.3,        // +30% en sucursales cercanas
    delivery: 0.9,      // -10% delivery (tráfico)
    duration: "evening",
  },
  [EventTypes.SPORTS]: {
    nearby: 1.25,
    bebidas: 1.4,
    duration: "3h",
  },
  [EventTypes.FESTIVAL]: {
    nearby: 1.4,
    duration: "all_day",
  },
  [EventTypes.MARATHON]: {
    nearby: 0.7,        // Calles cerradas
    delivery: 0.5,
    duration: "morning",
  },
  [EventTypes.PARADE]: {
    nearby: 0.8,
    delivery: 0.6,
    duration: "morning",
  },
  [EventTypes.CONVENTION]: {
    nearby: 1.2,
    duration: "all_day",
  },
};

/**
 * Venues conocidos por ciudad
 */
export const KnownVenues = {
  CDMX: [
    { id: "foro_sol", name: "Foro Sol", lat: 19.4039, lon: -99.0924, capacity: 65000 },
    { id: "azteca", name: "Estadio Azteca", lat: 19.3028, lon: -99.1505, capacity: 87000 },
    { id: "palacio_deportes", name: "Palacio de los Deportes", lat: 19.4042, lon: -99.0997, capacity: 22000 },
    { id: "auditorio", name: "Auditorio Nacional", lat: 19.4257, lon: -99.1919, capacity: 10000 },
    { id: "arena_cdmx", name: "Arena CDMX", lat: 19.4041, lon: -99.0953, capacity: 22300 },
    { id: "zocalo", name: "Zócalo", lat: 19.4326, lon: -99.1332, capacity: 100000 },
  ],
  Puebla: [
    { id: "cuauhtemoc", name: "Estadio Cuauhtémoc", lat: 19.0279, lon: -98.2070, capacity: 51726 },
    { id: "centro_convenciones", name: "Centro de Convenciones", lat: 19.0447, lon: -98.1983, capacity: 5000 },
  ],
};

/**
 * Store de eventos (en producción, esto vendría de una API o DB)
 */
const eventsStore = [];

export class LocalEvents {
  constructor() {
    this.venues = KnownVenues;
    this.events = eventsStore;
  }

  /**
   * Añade un evento
   */
  addEvent(event) {
    const newEvent = {
      id: `EVT-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      ...event,
      createdAt: new Date().toISOString(),
    };
    
    this.events.push(newEvent);
    return newEvent;
  }

  /**
   * Obtiene eventos para una fecha
   */
  getEventsForDate(date, options = {}) {
    const { city, type } = options;
    const targetDate = new Date(date).toISOString().split("T")[0];

    let filtered = this.events.filter(e => 
      e.date === targetDate || 
      (e.startDate && e.endDate && 
       targetDate >= e.startDate && targetDate <= e.endDate)
    );

    if (city) {
      filtered = filtered.filter(e => e.city === city);
    }

    if (type) {
      filtered = filtered.filter(e => e.type === type);
    }

    return filtered;
  }

  /**
   * Obtiene eventos próximos
   */
  getUpcomingEvents(days = 7, options = {}) {
    const { city, type } = options;
    const today = new Date();
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);

    const results = [];

    for (let d = new Date(today); d <= endDate; d.setDate(d.getDate() + 1)) {
      const events = this.getEventsForDate(d, { city, type });
      for (const event of events) {
        if (!results.find(e => e.id === event.id)) {
          results.push(event);
        }
      }
    }

    return results.sort((a, b) => new Date(a.date || a.startDate) - new Date(b.date || b.startDate));
  }

  /**
   * Calcula impacto de eventos en una sucursal
   */
  calculateImpact(branchId, date) {
    // Obtener ubicación de la sucursal
    const branchLocation = this.getBranchLocation(branchId);
    if (!branchLocation) return { impact: 1.0, events: [] };

    const events = this.getEventsForDate(date, { city: branchLocation.city });
    
    if (events.length === 0) {
      return { impact: 1.0, events: [] };
    }

    let totalImpact = 1.0;
    const relevantEvents = [];

    for (const event of events) {
      const distance = this.calculateDistance(branchLocation, event);
      
      // Solo considerar eventos dentro de 5km
      if (distance <= 5) {
        const eventImpact = EventImpact[event.type] || { nearby: 1.0 };
        
        // Ajustar por distancia (más cerca = más impacto)
        const distanceFactor = 1 - (distance / 5) * 0.5; // 0.5 a 1.0
        const adjustedImpact = 1 + (eventImpact.nearby - 1) * distanceFactor;

        totalImpact *= adjustedImpact;
        
        relevantEvents.push({
          ...event,
          distance: Math.round(distance * 10) / 10,
          impactFactor: adjustedImpact,
        });
      }
    }

    return {
      impact: Math.round(totalImpact * 100) / 100,
      impactFormatted: `${totalImpact >= 1 ? "+" : ""}${Math.round((totalImpact - 1) * 100)}%`,
      events: relevantEvents,
    };
  }

  /**
   * Calcula distancia entre dos puntos (km)
   */
  calculateDistance(point1, point2) {
    if (!point1.lat || !point1.lon || !point2.lat || !point2.lon) {
      return Infinity;
    }

    const R = 6371; // Radio de la Tierra en km
    const dLat = this.toRad(point2.lat - point1.lat);
    const dLon = this.toRad(point2.lon - point1.lon);
    const lat1 = this.toRad(point1.lat);
    const lat2 = this.toRad(point2.lat);

    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
    return R * c;
  }

  toRad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Obtiene ubicación de sucursal
   */
  getBranchLocation(branchId) {
    // Importar de WeatherService o tener copia local
    const locations = {
      "SUC-ANG": { name: "Angelópolis", lat: 19.0270, lon: -98.2263, city: "Puebla" },
      "SUC-ZAV": { name: "Zavaleta", lat: 19.0117, lon: -98.2149, city: "Puebla" },
      "SUC-POL": { name: "Polanco", lat: 19.4326, lon: -99.1971, city: "CDMX" },
      "SUC-CON": { name: "Condesa", lat: 19.4111, lon: -99.1744, city: "CDMX" },
      "SUC-ROM": { name: "Roma", lat: 19.4195, lon: -99.1618, city: "CDMX" },
      "SUC-COY": { name: "Coyoacán", lat: 19.3467, lon: -99.1617, city: "CDMX" },
    };
    return locations[branchId];
  }

  /**
   * Añade eventos recurrentes conocidos
   */
  addRecurringEvents() {
    // Partidos de Liga MX (ejemplo)
    // En producción, esto vendría de una API de deportes
    const ligaMXWeekends = this.getNextWeekends(4);
    
    for (const weekend of ligaMXWeekends) {
      // Partido genérico en Azteca
      this.addEvent({
        name: "Partido Liga MX - Estadio Azteca",
        type: EventTypes.SPORTS,
        date: weekend.toISOString().split("T")[0],
        city: "CDMX",
        venue: "azteca",
        lat: 19.3028,
        lon: -99.1505,
        expectedAttendance: 60000,
      });
    }
  }

  /**
   * Obtiene próximos fines de semana
   */
  getNextWeekends(count) {
    const weekends = [];
    const today = new Date();
    
    let d = new Date(today);
    while (weekends.length < count) {
      if (d.getDay() === 0) { // Domingo
        weekends.push(new Date(d));
      }
      d.setDate(d.getDate() + 1);
    }
    
    return weekends;
  }

  /**
   * Genera resumen para el briefing
   */
  getSummaryForBriefing(date = new Date()) {
    const events = this.getEventsForDate(date);
    const upcoming = this.getUpcomingEvents(7);

    return {
      today: {
        count: events.length,
        events: events.slice(0, 3),
      },
      upcoming: {
        count: upcoming.length,
        events: upcoming.slice(0, 5),
      },
    };
  }
}

export const localEvents = new LocalEvents();

export default LocalEvents;
