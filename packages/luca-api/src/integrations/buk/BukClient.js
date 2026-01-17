/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BUK CLIENT - Cliente para API de BUK (Sistema de RRHH)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Integración con BUK para:
 * - Leer horarios programados
 * - Obtener lista de empleados eventuales
 * - Verificar disponibilidad
 * - Registrar asignaciones de turnos
 */

import { logger } from "@tagers/shared";

const BUK_API_URL = process.env.BUK_API_URL || "https://api.buk.cl/v1";
const BUK_API_KEY = process.env.BUK_API_KEY;
const BUK_COMPANY_ID = process.env.BUK_COMPANY_ID;

/**
 * Tipos de empleado
 */
export const EmployeeType = {
  PERMANENT: "permanent",
  EVENTUAL: "eventual",
  TEMP: "temp",
};

/**
 * Estados de turno
 */
export const ShiftStatus = {
  SCHEDULED: "scheduled",
  CONFIRMED: "confirmed",
  PENDING: "pending",
  CANCELLED: "cancelled",
  NO_SHOW: "no_show",
};

export class BukClient {
  constructor() {
    this.baseUrl = BUK_API_URL;
    this.apiKey = BUK_API_KEY;
    this.companyId = BUK_COMPANY_ID;
  }

  /**
   * Verifica si el cliente está configurado
   */
  isConfigured() {
    return !!(this.apiKey && this.companyId);
  }

  /**
   * Obtiene horarios programados para un rango de fechas
   */
  async getSchedules(options = {}) {
    const { branchId, startDate, endDate, employeeId } = options;

    if (!this.isConfigured()) {
      logger.warn("BUK not configured, returning mock schedules");
      return this.getMockSchedules(options);
    }

    try {
      const params = new URLSearchParams();
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);
      if (branchId) params.append("location_id", branchId);
      if (employeeId) params.append("employee_id", employeeId);

      const response = await this.request(`/schedules?${params.toString()}`);
      return this.normalizeSchedules(response.data);
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to get schedules from BUK");
      return this.getMockSchedules(options);
    }
  }

  /**
   * Obtiene lista de empleados eventuales disponibles
   */
  async getEventualEmployees(options = {}) {
    const { branchId, skills, minRating } = options;

    if (!this.isConfigured()) {
      logger.warn("BUK not configured, returning mock eventuals");
      return this.getMockEventuals(options);
    }

    try {
      const params = new URLSearchParams();
      params.append("type", EmployeeType.EVENTUAL);
      params.append("status", "active");
      if (branchId) params.append("location_id", branchId);

      const response = await this.request(`/employees?${params.toString()}`);
      
      let employees = this.normalizeEmployees(response.data);

      // Filtrar por rating si se especifica
      if (minRating) {
        employees = employees.filter(e => (e.rating || 5) >= minRating);
      }

      // Filtrar por skills si se especifica
      if (skills && skills.length > 0) {
        employees = employees.filter(e => 
          skills.some(skill => e.skills?.includes(skill))
        );
      }

      return employees;
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to get eventuals from BUK");
      return this.getMockEventuals(options);
    }
  }

  /**
   * Obtiene disponibilidad de un empleado para fechas específicas
   */
  async getEmployeeAvailability(employeeId, dates) {
    if (!this.isConfigured()) {
      return this.getMockAvailability(employeeId, dates);
    }

    try {
      const response = await this.request(
        `/employees/${employeeId}/availability`,
        "POST",
        { dates }
      );
      return response.data;
    } catch (err) {
      logger.error({ employeeId, err: err?.message }, "Failed to get availability");
      return this.getMockAvailability(employeeId, dates);
    }
  }

  /**
   * Obtiene información de un empleado
   */
  async getEmployee(employeeId) {
    if (!this.isConfigured()) {
      return this.getMockEmployee(employeeId);
    }

    try {
      const response = await this.request(`/employees/${employeeId}`);
      return this.normalizeEmployee(response.data);
    } catch (err) {
      logger.error({ employeeId, err: err?.message }, "Failed to get employee");
      return null;
    }
  }

  /**
   * Asigna un turno a un empleado
   */
  async assignShift(assignment) {
    const { employeeId, branchId, date, startTime, endTime, role } = assignment;

    if (!this.isConfigured()) {
      logger.warn("BUK not configured, mock assignment");
      return {
        success: true,
        mock: true,
        shiftId: `SHIFT-MOCK-${Date.now()}`,
        ...assignment,
      };
    }

    try {
      const response = await this.request("/shifts", "POST", {
        employee_id: employeeId,
        location_id: branchId,
        date,
        start_time: startTime,
        end_time: endTime,
        role,
        status: ShiftStatus.PENDING,
      });

      return {
        success: true,
        shiftId: response.data.id,
        ...assignment,
      };
    } catch (err) {
      logger.error({ assignment, err: err?.message }, "Failed to assign shift");
      throw err;
    }
  }

  /**
   * Confirma un turno asignado
   */
  async confirmShift(shiftId) {
    if (!this.isConfigured()) {
      return { success: true, mock: true, shiftId };
    }

    try {
      const response = await this.request(
        `/shifts/${shiftId}/confirm`,
        "POST"
      );
      return { success: true, shiftId };
    } catch (err) {
      logger.error({ shiftId, err: err?.message }, "Failed to confirm shift");
      throw err;
    }
  }

  /**
   * Cancela un turno
   */
  async cancelShift(shiftId, reason) {
    if (!this.isConfigured()) {
      return { success: true, mock: true, shiftId };
    }

    try {
      await this.request(`/shifts/${shiftId}/cancel`, "POST", { reason });
      return { success: true, shiftId };
    } catch (err) {
      logger.error({ shiftId, err: err?.message }, "Failed to cancel shift");
      throw err;
    }
  }

  /**
   * Obtiene ausencias/faltas programadas
   */
  async getAbsences(options = {}) {
    const { branchId, startDate, endDate } = options;

    if (!this.isConfigured()) {
      return this.getMockAbsences(options);
    }

    try {
      const params = new URLSearchParams();
      if (startDate) params.append("start_date", startDate);
      if (endDate) params.append("end_date", endDate);
      if (branchId) params.append("location_id", branchId);

      const response = await this.request(`/absences?${params.toString()}`);
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to get absences");
      return [];
    }
  }

  /**
   * Hace request a la API de BUK
   */
  async request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        "X-Company-Id": this.companyId,
      },
    };

    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `BUK API error: ${response.status}`);
    }

    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // NORMALIZADORES
  // ═══════════════════════════════════════════════════════════════════════════

  normalizeSchedules(data) {
    if (!Array.isArray(data)) return [];
    return data.map(s => ({
      shiftId: s.id,
      employeeId: s.employee_id,
      employeeName: s.employee_name,
      branchId: s.location_id,
      date: s.date,
      startTime: s.start_time,
      endTime: s.end_time,
      role: s.role,
      status: s.status,
    }));
  }

  normalizeEmployees(data) {
    if (!Array.isArray(data)) return [];
    return data.map(e => this.normalizeEmployee(e));
  }

  normalizeEmployee(e) {
    return {
      employeeId: e.id,
      name: e.full_name || `${e.first_name} ${e.last_name}`,
      phone: e.phone || e.mobile,
      email: e.email,
      type: e.employment_type || EmployeeType.EVENTUAL,
      branchId: e.location_id,
      skills: e.skills || [],
      rating: e.performance_rating || 4.0,
      lastShiftDate: e.last_shift_date,
      hireDate: e.hire_date,
      status: e.status,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATOS MOCK PARA DESARROLLO
  // ═══════════════════════════════════════════════════════════════════════════

  getMockSchedules(options) {
    const { branchId = "SUC01", startDate } = options;
    const baseDate = startDate ? new Date(startDate) : new Date();
    
    const schedules = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(baseDate);
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split("T")[0];

      // Turno matutino
      schedules.push({
        shiftId: `SHIFT-${dateStr}-AM-${branchId}`,
        employeeId: `EMP00${(i % 5) + 1}`,
        employeeName: ["María García", "Juan López", "Ana Martínez", "Carlos Ruiz", "Laura Sánchez"][i % 5],
        branchId,
        date: dateStr,
        startTime: "07:00",
        endTime: "15:00",
        role: "barista",
        status: ShiftStatus.SCHEDULED,
      });

      // Turno vespertino
      schedules.push({
        shiftId: `SHIFT-${dateStr}-PM-${branchId}`,
        employeeId: `EMP00${((i + 2) % 5) + 1}`,
        employeeName: ["María García", "Juan López", "Ana Martínez", "Carlos Ruiz", "Laura Sánchez"][(i + 2) % 5],
        branchId,
        date: dateStr,
        startTime: "15:00",
        endTime: "22:00",
        role: "barista",
        status: ShiftStatus.SCHEDULED,
      });
    }

    return schedules;
  }

  getMockEventuals(options) {
    return [
      {
        employeeId: "EVT001",
        name: "Roberto Hernández",
        phone: "5255123456781",
        email: "roberto@email.com",
        type: EmployeeType.EVENTUAL,
        branchId: null,
        skills: ["barista", "caja", "limpieza"],
        rating: 4.8,
        lastShiftDate: "2026-01-10",
        status: "active",
      },
      {
        employeeId: "EVT002",
        name: "Sandra Torres",
        phone: "5255123456782",
        email: "sandra@email.com",
        type: EmployeeType.EVENTUAL,
        branchId: null,
        skills: ["barista", "pasteleria"],
        rating: 4.5,
        lastShiftDate: "2026-01-05",
        status: "active",
      },
      {
        employeeId: "EVT003",
        name: "Miguel Flores",
        phone: "5255123456783",
        email: "miguel@email.com",
        type: EmployeeType.EVENTUAL,
        branchId: null,
        skills: ["caja", "limpieza"],
        rating: 4.2,
        lastShiftDate: "2025-12-20",
        status: "active",
      },
      {
        employeeId: "EVT004",
        name: "Patricia Vega",
        phone: "5255123456784",
        email: "patricia@email.com",
        type: EmployeeType.EVENTUAL,
        branchId: null,
        skills: ["barista", "caja", "pasteleria"],
        rating: 4.9,
        lastShiftDate: "2026-01-12",
        status: "active",
      },
      {
        employeeId: "EVT005",
        name: "Fernando Díaz",
        phone: "5255123456785",
        email: "fernando@email.com",
        type: EmployeeType.EVENTUAL,
        branchId: null,
        skills: ["barista"],
        rating: 3.8,
        lastShiftDate: "2025-11-15",
        status: "active",
      },
    ];
  }

  getMockAvailability(employeeId, dates) {
    return dates.map(date => ({
      date,
      available: Math.random() > 0.3, // 70% disponible
      shifts: ["morning", "afternoon", "evening"].filter(() => Math.random() > 0.5),
    }));
  }

  getMockEmployee(employeeId) {
    const eventuals = this.getMockEventuals({});
    return eventuals.find(e => e.employeeId === employeeId) || {
      employeeId,
      name: "Empleado Mock",
      phone: "5255000000000",
      type: EmployeeType.EVENTUAL,
      rating: 4.0,
      status: "active",
    };
  }

  getMockAbsences(options) {
    return [
      {
        employeeId: "EMP001",
        date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        type: "vacation",
        reason: "Vacaciones programadas",
      },
    ];
  }
}

// Export singleton
export const bukClient = new BukClient();

export default BukClient;
