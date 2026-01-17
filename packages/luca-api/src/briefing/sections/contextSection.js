/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTEXT SECTION - Datos de Contexto para el Briefing
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Obtiene información contextual del día:
 * - Clima
 * - Eventos especiales
 * - Días festivos
 * - Notas relevantes
 */

import { logger } from "@tagers/shared";

/**
 * Días festivos de México (simplificado)
 */
const HOLIDAYS = {
  "01-01": "Año Nuevo",
  "02-05": "Día de la Constitución",
  "03-21": "Natalicio de Benito Juárez",
  "05-01": "Día del Trabajo",
  "05-10": "Día de las Madres",
  "09-16": "Día de la Independencia",
  "11-02": "Día de Muertos",
  "11-20": "Revolución Mexicana",
  "12-12": "Día de la Virgen",
  "12-25": "Navidad",
};

/**
 * Eventos especiales por temporada
 */
const SEASONAL_EVENTS = {
  "01": ["Temporada de Rosca de Reyes (hasta el 6)"],
  "02": ["San Valentín (14)"],
  "04": ["Semana Santa (variable)"],
  "05": ["Día de las Madres (10)"],
  "10": ["Halloween (31)"],
  "11": ["Día de Muertos (1-2)"],
  "12": ["Temporada Navideña", "Nochebuena (24)", "Fin de Año (31)"],
};

export const contextSection = {
  /**
   * Obtiene datos de contexto para una fecha
   */
  async getData(date) {
    const today = new Date();
    
    return {
      weather: await this.getWeather(),
      events: this.getEvents(today),
      holiday: this.getHoliday(today),
      notes: this.getContextNotes(today),
    };
  },

  /**
   * Obtiene el clima actual (CDMX)
   */
  async getWeather() {
    try {
      // En producción, usar API de clima como OpenWeatherMap
      // Por ahora, datos simulados basados en mes
      const month = new Date().getMonth();
      
      // Clima típico de CDMX por mes
      const weatherByMonth = [
        "Fresco, 14°C, soleado", // Enero
        "Templado, 16°C, seco",  // Febrero
        "Templado, 18°C, seco",  // Marzo
        "Cálido, 20°C, seco",    // Abril
        "Cálido, 22°C, posibles lluvias", // Mayo
        "Templado, 20°C, lluvias",  // Junio
        "Templado, 18°C, lluvias",  // Julio
        "Templado, 18°C, lluvias",  // Agosto
        "Templado, 17°C, lluvias",  // Septiembre
        "Templado, 16°C, lluvias ligeras", // Octubre
        "Fresco, 15°C, seco",    // Noviembre
        "Fresco, 14°C, seco",    // Diciembre
      ];
      
      return weatherByMonth[month];
      
      // TODO: Integrar con API real
      // const response = await fetch(`https://api.openweathermap.org/data/2.5/weather?q=Mexico City&appid=${API_KEY}&units=metric&lang=es`);
      // const data = await response.json();
      // return `${Math.round(data.main.temp)}°C, ${data.weather[0].description}`;
      
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get weather");
      return null;
    }
  },

  /**
   * Obtiene eventos del día
   */
  getEvents(date) {
    const events = [];
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = date.getDate();
    
    // Eventos de temporada
    const seasonal = SEASONAL_EVENTS[month];
    if (seasonal) {
      events.push(...seasonal);
    }
    
    // Día de la semana
    const dayOfWeek = date.getDay();
    
    // Lunes de inicio de mes
    if (dayOfWeek === 1 && day <= 7) {
      events.push("Inicio de mes - cierre previo");
    }
    
    // Quincena
    if (day === 15 || day === 30 || day === 31) {
      events.push("Día de quincena - mayor afluencia esperada");
    }
    
    // Viernes
    if (dayOfWeek === 5) {
      events.push("Viernes - mayor afluencia nocturna");
    }
    
    // Sábado
    if (dayOfWeek === 6) {
      events.push("Sábado - día de mayor venta");
    }
    
    return events;
  },

  /**
   * Verifica si es día festivo
   */
  getHoliday(date) {
    const key = `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return HOLIDAYS[key] || null;
  },

  /**
   * Genera notas de contexto relevantes
   */
  getContextNotes(date) {
    const notes = [];
    const month = date.getMonth();
    const day = date.getDate();
    
    // Enero - temporada de rosca
    if (month === 0 && day <= 6) {
      notes.push("Temporada alta de rosca - verificar inventario");
    }
    
    // Diciembre - temporada navideña
    if (month === 11) {
      notes.push("Temporada navideña - horarios extendidos posibles");
    }
    
    // Fin de mes
    if (day >= 28) {
      notes.push("Fin de mes - revisar inventarios para cierre");
    }
    
    return notes;
  },
};

export default contextSection;
