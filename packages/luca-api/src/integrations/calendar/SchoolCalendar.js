/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SCHOOL CALENDAR - Calendario Escolar SEP
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Calendario escolar oficial de la SEP:
 * - Períodos de vacaciones
 * - Días de asueto
 * - Inicio/fin de ciclo escolar
 * 
 * Impacta tráfico en zonas cercanas a escuelas.
 */

import { logger } from "@tagers/shared";

/**
 * Ciclo escolar 2025-2026 (ejemplo)
 * En producción, actualizar cada año
 */
const SchoolYear = {
  year: "2025-2026",
  start: "2025-08-25",
  end: "2026-07-17",
};

/**
 * Períodos de vacaciones
 */
const VacationPeriods = [
  {
    name: "Vacaciones de Verano 2025",
    start: "2025-07-01",
    end: "2025-08-24",
    impact: 0.85, // -15% tráfico
  },
  {
    name: "Día de Muertos",
    start: "2025-11-01",
    end: "2025-11-02",
    impact: 0.9,
  },
  {
    name: "Vacaciones de Invierno",
    start: "2025-12-19",
    end: "2026-01-06",
    impact: 0.8, // -20% tráfico
  },
  {
    name: "Día de la Constitución",
    start: "2026-02-02",
    end: "2026-02-02",
    impact: 0.95,
  },
  {
    name: "Natalicio de Benito Juárez",
    start: "2026-03-16",
    end: "2026-03-16",
    impact: 0.95,
  },
  {
    name: "Vacaciones de Semana Santa",
    start: "2026-03-30",
    end: "2026-04-10",
    impact: 0.75, // -25%
  },
  {
    name: "Día del Trabajo",
    start: "2026-05-01",
    end: "2026-05-01",
    impact: 0.95,
  },
  {
    name: "Día del Maestro",
    start: "2026-05-15",
    end: "2026-05-15",
    impact: 0.9,
  },
  {
    name: "Vacaciones de Verano 2026",
    start: "2026-07-18",
    end: "2026-08-23",
    impact: 0.85,
  },
];

/**
 * Horarios escolares típicos
 */
const SchoolSchedules = {
  morning: {
    entry: "07:30",
    exit: "13:00",
    peakTraffic: ["07:00-08:00", "12:30-13:30"],
  },
  afternoon: {
    entry: "13:30",
    exit: "18:30",
    peakTraffic: ["13:00-14:00", "18:00-19:00"],
  },
};

/**
 * Zonas con alta densidad escolar
 */
const SchoolZones = {
  CDMX: [
    { name: "Coyoacán Centro", branches: ["SUC-COY"], density: "high" },
    { name: "Condesa-Roma", branches: ["SUC-CON", "SUC-ROM"], density: "medium" },
    { name: "Polanco", branches: ["SUC-POL"], density: "medium" },
  ],
  Puebla: [
    { name: "Angelópolis", branches: ["SUC-ANG"], density: "high" },
    { name: "Zavaleta", branches: ["SUC-ZAV"], density: "medium" },
  ],
};

export class SchoolCalendar {
  constructor() {
    this.schoolYear = SchoolYear;
    this.vacations = VacationPeriods;
    this.schedules = SchoolSchedules;
    this.zones = SchoolZones;
  }

  /**
   * Verifica si es día de clases
   */
  isSchoolDay(date = new Date()) {
    const d = new Date(date);
    const dateStr = d.toISOString().split("T")[0];
    const dayOfWeek = d.getDay();

    // Fin de semana = no hay clases
    if (dayOfWeek === 0 || dayOfWeek === 6) {
      return { isSchoolDay: false, reason: "weekend" };
    }

    // Verificar si está en período de vacaciones
    for (const vacation of this.vacations) {
      if (dateStr >= vacation.start && dateStr <= vacation.end) {
        return {
          isSchoolDay: false,
          reason: "vacation",
          vacationName: vacation.name,
          impact: vacation.impact,
        };
      }
    }

    // Verificar si está dentro del ciclo escolar
    if (dateStr < this.schoolYear.start || dateStr > this.schoolYear.end) {
      return {
        isSchoolDay: false,
        reason: "outside_school_year",
        impact: 0.85,
      };
    }

    return {
      isSchoolDay: true,
      schedules: this.schedules,
      impact: 1.0, // Sin ajuste
    };
  }

  /**
   * Obtiene impacto de tráfico escolar para una sucursal
   */
  getTrafficImpact(branchId, date = new Date(), hour = new Date().getHours()) {
    const schoolStatus = this.isSchoolDay(date);
    const zone = this.getBranchSchoolZone(branchId);

    const result = {
      date: new Date(date).toISOString().split("T")[0],
      branchId,
      isSchoolDay: schoolStatus.isSchoolDay,
      impact: 1.0,
      peakHour: false,
      notes: [],
    };

    if (!schoolStatus.isSchoolDay) {
      result.impact = schoolStatus.impact || 0.9;
      result.notes.push(`No hay clases: ${schoolStatus.vacationName || schoolStatus.reason}`);
      return result;
    }

    // Verificar si es hora pico
    const hourStr = `${hour.toString().padStart(2, "0")}:00`;
    const isPeakMorning = this.isInTimeRange(hourStr, "07:00", "08:30");
    const isPeakAfternoon = this.isInTimeRange(hourStr, "12:30", "14:00");
    const isPeakEvening = this.isInTimeRange(hourStr, "18:00", "19:00");

    if (isPeakMorning || isPeakAfternoon || isPeakEvening) {
      result.peakHour = true;
      
      // Ajustar impacto según densidad de zona escolar
      if (zone?.density === "high") {
        result.impact = 1.2; // +20% en zonas de alta densidad escolar
        result.notes.push("Hora pico escolar en zona de alta densidad");
      } else if (zone?.density === "medium") {
        result.impact = 1.1;
        result.notes.push("Hora pico escolar");
      }
    }

    return result;
  }

  /**
   * Obtiene zona escolar de una sucursal
   */
  getBranchSchoolZone(branchId) {
    for (const city of Object.values(this.zones)) {
      for (const zone of city) {
        if (zone.branches.includes(branchId)) {
          return zone;
        }
      }
    }
    return null;
  }

  /**
   * Verifica si una hora está en un rango
   */
  isInTimeRange(time, start, end) {
    return time >= start && time <= end;
  }

  /**
   * Obtiene próximas vacaciones
   */
  getUpcomingVacations(days = 60) {
    const today = new Date().toISOString().split("T")[0];
    const endDate = new Date();
    endDate.setDate(endDate.getDate() + days);
    const endStr = endDate.toISOString().split("T")[0];

    return this.vacations.filter(v => 
      (v.start >= today && v.start <= endStr) ||
      (v.end >= today && v.end <= endStr)
    );
  }

  /**
   * Obtiene días de clases restantes en el ciclo
   */
  getRemainingSchoolDays() {
    const today = new Date();
    const endDate = new Date(this.schoolYear.end);
    
    if (today > endDate) return 0;

    let count = 0;
    let d = new Date(today);
    
    while (d <= endDate) {
      const status = this.isSchoolDay(d);
      if (status.isSchoolDay) count++;
      d.setDate(d.getDate() + 1);
    }

    return count;
  }

  /**
   * Verifica si está en período de inscripciones
   */
  isEnrollmentPeriod(date = new Date()) {
    const month = new Date(date).getMonth() + 1;
    // Inscripciones típicamente en febrero y julio
    return month === 2 || month === 7;
  }

  /**
   * Verifica si es regreso a clases
   */
  isBackToSchool(date = new Date()) {
    const dateStr = new Date(date).toISOString().split("T")[0];
    const schoolStart = new Date(this.schoolYear.start);
    const weekBefore = new Date(schoolStart);
    weekBefore.setDate(weekBefore.getDate() - 7);
    const weekAfter = new Date(schoolStart);
    weekAfter.setDate(weekAfter.getDate() + 7);

    return dateStr >= weekBefore.toISOString().split("T")[0] && 
           dateStr <= weekAfter.toISOString().split("T")[0];
  }

  /**
   * Genera resumen para el briefing
   */
  getSummaryForBriefing(date = new Date()) {
    const schoolStatus = this.isSchoolDay(date);
    const upcomingVacations = this.getUpcomingVacations(30);
    
    return {
      today: {
        isSchoolDay: schoolStatus.isSchoolDay,
        reason: schoolStatus.reason || "normal_school_day",
        vacationName: schoolStatus.vacationName,
      },
      upcomingVacations: upcomingVacations.slice(0, 2),
      isBackToSchool: this.isBackToSchool(date),
      isEnrollmentPeriod: this.isEnrollmentPeriod(date),
      schoolYear: this.schoolYear,
    };
  }

  /**
   * Obtiene configuración de horario para una fecha
   */
  getScheduleConfig(date = new Date()) {
    if (!this.isSchoolDay(date).isSchoolDay) {
      return null;
    }

    return {
      morningPeaks: ["07:00-08:30", "12:30-14:00"],
      eveningPeaks: ["18:00-19:00"],
      lowTraffic: ["10:00-12:00", "15:00-17:00"],
    };
  }
}

export const schoolCalendar = new SchoolCalendar();

export default SchoolCalendar;
