/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MEXICO HOLIDAYS - Calendario de Feriados
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Feriados desde ConfigLoader (Google Sheets)
 * 
 * Maneja:
 * - Feriados nacionales
 * - Días comerciales importantes
 * - Temporadas especiales
 * - Detección de puentes
 */

import { logger } from "@tagers/shared";
import { configLoader } from "../../config/ConfigLoader.js";

export class MexicoHolidays {
  /**
   * Obtiene información de una fecha
   */
  getDateInfo(date = new Date()) {
    const d = new Date(date);
    const mmdd = this.formatMMDD(d);
    
    // Buscar feriado
    const holiday = configLoader.getHoliday(d);
    
    // Buscar temporada
    const season = configLoader.getSeason(d);
    
    // Calcular Semana Santa (móvil)
    const semanaSanta = this.calculateSemanaSanta(d.getFullYear());
    const isSemanaSanta = this.isInSemanaSanta(d, semanaSanta);
    
    // Detectar puente
    const isPuente = this.isPuenteDay(d);

    return {
      date: d.toISOString().split("T")[0],
      dayOfWeek: d.getDay(),
      dayName: this.getDayName(d.getDay()),
      
      holiday: holiday ? {
        name: holiday.name,
        type: holiday.type,
        impact: holiday.salesImpact,
        isClosed: holiday.isClosedDay,
      } : null,
      
      season: season ? {
        name: season.name,
        impact: season.salesImpact,
        products: season.affectedProducts,
      } : null,
      
      semanaSanta: isSemanaSanta ? {
        inSemanaSanta: true,
        dates: semanaSanta,
      } : null,
      
      isPuente,
      
      // Flags de conveniencia
      isSpecialDay: !!holiday || !!season || isSemanaSanta || isPuente,
      isRoscaSeason: this.isRoscaSeason(d),
      isPanDeMuertoSeason: this.isPanDeMuertoSeason(d),
      
      // Impacto combinado
      combinedImpact: this.calculateCombinedImpact(holiday, season, isSemanaSanta),
    };
  }

  /**
   * Obtiene información de hoy
   */
  getToday() {
    return this.getDateInfo(new Date());
  }

  /**
   * Obtiene próximos feriados
   */
  getUpcoming(days = 30) {
    const upcoming = [];
    const d = new Date();
    
    for (let i = 0; i < days; i++) {
      const info = this.getDateInfo(d);
      if (info.isSpecialDay) {
        upcoming.push(info);
      }
      d.setDate(d.getDate() + 1);
    }
    
    return upcoming;
  }

  /**
   * Obtiene feriados de un mes
   */
  getMonthHolidays(year, month) {
    const holidays = [];
    const d = new Date(year, month - 1, 1);
    
    while (d.getMonth() === month - 1) {
      const info = this.getDateInfo(d);
      if (info.holiday) {
        holidays.push(info);
      }
      d.setDate(d.getDate() + 1);
    }
    
    return holidays;
  }

  /**
   * Calcula fecha de Semana Santa (móvil)
   */
  calculateSemanaSanta(year) {
    // Algoritmo de Computus para calcular Pascua
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    
    const easter = new Date(year, month - 1, day);
    
    // Semana Santa: Domingo de Ramos a Domingo de Pascua
    const palmSunday = new Date(easter);
    palmSunday.setDate(easter.getDate() - 7);
    
    return {
      palmSunday: palmSunday.toISOString().split("T")[0],
      easter: easter.toISOString().split("T")[0],
      year,
    };
  }

  /**
   * Verifica si una fecha está en Semana Santa
   */
  isInSemanaSanta(date, semanaSanta) {
    const dateStr = date.toISOString().split("T")[0];
    return dateStr >= semanaSanta.palmSunday && dateStr <= semanaSanta.easter;
  }

  /**
   * Detecta si es día de puente
   */
  isPuenteDay(date) {
    const d = new Date(date);
    const dayOfWeek = d.getDay();
    
    // Si es lunes o viernes, verificar si hay feriado cercano
    if (dayOfWeek === 1) { // Lunes
      const sunday = new Date(d);
      sunday.setDate(d.getDate() - 1);
      const tuesday = new Date(d);
      tuesday.setDate(d.getDate() + 1);
      
      const sundayHoliday = configLoader.getHoliday(sunday);
      const tuesdayHoliday = configLoader.getHoliday(tuesday);
      
      if (sundayHoliday || tuesdayHoliday) {
        return true;
      }
    }
    
    if (dayOfWeek === 5) { // Viernes
      const thursday = new Date(d);
      thursday.setDate(d.getDate() - 1);
      const saturday = new Date(d);
      saturday.setDate(d.getDate() + 1);
      
      const thursdayHoliday = configLoader.getHoliday(thursday);
      const saturdayHoliday = configLoader.getHoliday(saturday);
      
      if (thursdayHoliday || saturdayHoliday) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * Verifica si es temporada de rosca
   */
  isRoscaSeason(date) {
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    
    // Temporada de rosca: 1-6 de enero
    if (month === 1 && day >= 1 && day <= 6) {
      return true;
    }
    
    // También verificar en config
    const season = configLoader.getSeason(d);
    return season?.seasonId === "rosca_season";
  }

  /**
   * Verifica si es temporada de pan de muerto
   */
  isPanDeMuertoSeason(date) {
    const d = new Date(date);
    const month = d.getMonth() + 1;
    const day = d.getDate();
    
    // Pan de muerto: 15 oct - 2 nov
    if ((month === 10 && day >= 15) || (month === 11 && day <= 2)) {
      return true;
    }
    
    const season = configLoader.getSeason(d);
    return season?.seasonId === "pan_de_muerto";
  }

  /**
   * Calcula impacto combinado
   */
  calculateCombinedImpact(holiday, season, isSemanaSanta) {
    let impact = 1.0;
    
    if (holiday) {
      impact *= holiday.salesImpact;
    }
    
    if (season) {
      impact *= season.salesImpact;
    }
    
    if (isSemanaSanta) {
      // Semana Santa típicamente tiene impacto de 0.75
      const ssImpact = configLoader.getThresholdValue("calendar", "semana_santa_impact", 0.75);
      impact *= ssImpact;
    }
    
    return Math.round(impact * 100) / 100;
  }

  /**
   * Obtiene resumen para briefing
   */
  getSummaryForBriefing(date = new Date()) {
    const today = this.getDateInfo(date);
    const upcoming = this.getUpcoming(7);
    
    const summary = {
      date: today.date,
      today: {
        isSpecial: today.isSpecialDay,
        holiday: today.holiday?.name,
        season: today.season?.name,
        impact: today.combinedImpact,
      },
      upcoming: upcoming.slice(0, 5).map(d => ({
        date: d.date,
        name: d.holiday?.name || d.season?.name || "Día especial",
        impact: d.combinedImpact,
      })),
      flags: {
        isRoscaSeason: today.isRoscaSeason,
        isPanDeMuertoSeason: today.isPanDeMuertoSeason,
      },
    };
    
    return summary;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  formatMMDD(date) {
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${m}-${d}`;
  }

  getDayName(dayOfWeek) {
    const names = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    return names[dayOfWeek];
  }
}

export const mexicoHolidays = new MexicoHolidays();

export default MexicoHolidays;
