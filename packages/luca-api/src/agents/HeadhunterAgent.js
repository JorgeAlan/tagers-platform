/**
 * ═══════════════════════════════════════════════════════════════════════════
 * HEADHUNTER AGENT - Staffing Dinámico
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El Headhunter asegura que siempre haya personal suficiente:
 * 
 * 1. predictDemand()      → Forecast de personal necesario
 * 2. detectGaps()         → Encuentra huecos en programación
 * 3. findCandidates()     → Filtra eventuales disponibles
 * 4. draftConvocatoria()  → Prepara mensajes personalizados
 * 5. processResponses()   → Maneja aceptaciones/rechazos
 * 6. confirmAssignment()  → Confirma y actualiza BUK
 * 
 * Flujo: PREDICT → DETECT → SEARCH → DRAFT → SEND → PROCESS → CONFIRM
 */

import { logger, query } from "@tagers/shared";
import { bukClient } from "../integrations/buk/BukClient.js";
import { actionBus } from "../actions/ActionBus.js";
import { getBranchList, getBranchName } from "../config/lucaConfig.js";
import { memoryService, MemoryTypes } from "../memory/MemoryService.js";

/**
 * Configuración de staffing por tipo de día
 */
const STAFFING_REQUIREMENTS = {
  weekday: {
    morning: { min: 3, optimal: 4 },   // 7am - 3pm
    afternoon: { min: 3, optimal: 4 }, // 3pm - 10pm
  },
  weekend: {
    morning: { min: 4, optimal: 5 },
    afternoon: { min: 4, optimal: 6 },
  },
  holiday: {
    morning: { min: 5, optimal: 6 },
    afternoon: { min: 5, optimal: 7 },
  },
};

/**
 * Criterios para selección de eventuales
 */
const SELECTION_CRITERIA = {
  minRating: 3.5,
  maxDaysSinceLastShift: 60,
  preferredRating: 4.0,
  maxCandidatesToContact: 10,
  responseWaitHours: 4,
};

export class HeadhunterAgent {
  constructor() {
    this.pendingConvocatorias = new Map(); // actionId -> convocatoria
  }

  /**
   * Ejecuta el flujo completo del Headhunter
   */
  async run(context = {}) {
    const runId = `headhunter_${Date.now()}`;
    logger.info({ runId, context }, "HeadhunterAgent starting");

    const results = {
      runId,
      startedAt: new Date().toISOString(),
      phases: {},
      gaps_found: [],
      convocatorias_created: [],
    };

    try {
      // Determinar rango de fechas a analizar
      const today = new Date();
      const lookaheadDays = context.lookahead_days || 2;
      const endDate = new Date(today);
      endDate.setDate(endDate.getDate() + lookaheadDays);

      // Obtener sucursales a analizar
      const branches = context.branch_id 
        ? [{ id: context.branch_id }]
        : await getBranchList();

      // Fase 1: PREDICT - Calcular demanda esperada
      results.phases.predict = await this.predictDemand(branches, today, endDate);

      // Fase 2: DETECT - Encontrar gaps
      results.phases.detect = await this.detectGaps(
        branches, 
        today, 
        endDate, 
        results.phases.predict
      );

      if (results.phases.detect.gaps.length === 0) {
        results.status = "no_gaps";
        results.completedAt = new Date().toISOString();
        logger.info({ runId }, "No staffing gaps detected");
        return results;
      }

      results.gaps_found = results.phases.detect.gaps;

      // Fase 3-5 para cada gap
      for (const gap of results.phases.detect.gaps) {
        // Fase 3: SEARCH - Buscar candidatos
        const candidates = await this.findCandidates(gap);

        if (candidates.length === 0) {
          logger.warn({ gap }, "No candidates found for gap");
          continue;
        }

        // Fase 4: DRAFT - Preparar convocatoria
        const convocatoria = await this.draftConvocatoria(gap, candidates);

        // Fase 5: SEND - Enviar via ActionBus (requiere aprobación)
        const actionResult = await this.sendConvocatoria(convocatoria, context);

        results.convocatorias_created.push({
          gap,
          candidatesFound: candidates.length,
          convocatoriaId: convocatoria.id,
          actionId: actionResult.actionId,
          actionState: actionResult.state,
        });
      }

      results.status = "completed";
      results.completedAt = new Date().toISOString();

      logger.info({
        runId,
        gapsFound: results.gaps_found.length,
        convocatoriasCreated: results.convocatorias_created.length,
      }, "HeadhunterAgent completed");

      return results;

    } catch (err) {
      logger.error({ runId, err: err?.message }, "HeadhunterAgent failed");
      results.status = "error";
      results.error = err?.message;
      return results;
    }
  }

  /**
   * Fase 1: Predice demanda de personal por sucursal y fecha
   */
  async predictDemand(branches, startDate, endDate) {
    logger.info("Phase 1: PREDICT DEMAND");

    const predictions = [];

    for (const branch of branches) {
      const date = new Date(startDate);
      while (date <= endDate) {
        const dateStr = date.toISOString().split("T")[0];
        const dayOfWeek = date.getDay();
        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
        const isHoliday = await this.isHoliday(dateStr);

        const dayType = isHoliday ? "holiday" : (isWeekend ? "weekend" : "weekday");
        const requirements = STAFFING_REQUIREMENTS[dayType];

        // Ajustar por factores históricos y estacionalidad
        const adjustmentFactor = await this.getSeasonalAdjustment(branch.id, dateStr);

        predictions.push({
          branchId: branch.id,
          date: dateStr,
          dayType,
          shifts: {
            morning: {
              required: Math.ceil(requirements.morning.optimal * adjustmentFactor),
              minimum: requirements.morning.min,
            },
            afternoon: {
              required: Math.ceil(requirements.afternoon.optimal * adjustmentFactor),
              minimum: requirements.afternoon.min,
            },
          },
        });

        date.setDate(date.getDate() + 1);
      }
    }

    return { predictions };
  }

  /**
   * Fase 2: Detecta gaps entre demanda y programación actual
   */
  async detectGaps(branches, startDate, endDate, demandPrediction) {
    logger.info("Phase 2: DETECT GAPS");

    const gaps = [];

    for (const branch of branches) {
      // Obtener horarios programados desde BUK
      const schedules = await bukClient.getSchedules({
        branchId: branch.id,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      });

      // Obtener ausencias programadas
      const absences = await bukClient.getAbsences({
        branchId: branch.id,
        startDate: startDate.toISOString().split("T")[0],
        endDate: endDate.toISOString().split("T")[0],
      });

      // Analizar cada predicción
      for (const prediction of demandPrediction.predictions) {
        if (prediction.branchId !== branch.id) continue;

        // Contar personal programado por turno
        const scheduled = this.countScheduledStaff(schedules, prediction.date, absences);

        // Comparar con requerimientos
        for (const shift of ["morning", "afternoon"]) {
          const required = prediction.shifts[shift].required;
          const minimum = prediction.shifts[shift].minimum;
          const actual = scheduled[shift] || 0;

          if (actual < minimum) {
            gaps.push({
              gapId: `GAP-${branch.id}-${prediction.date}-${shift}`,
              branchId: branch.id,
              date: prediction.date,
              shift,
              required,
              minimum,
              scheduled: actual,
              deficit: minimum - actual,
              severity: actual === 0 ? "CRITICAL" : (actual < minimum ? "HIGH" : "MEDIUM"),
              dayType: prediction.dayType,
            });
          }
        }
      }
    }

    return { gaps };
  }

  /**
   * Fase 3: Encuentra candidatos eventuales para cubrir un gap
   */
  async findCandidates(gap) {
    logger.info({ gap: gap.gapId }, "Phase 3: FIND CANDIDATES");

    // Obtener todos los eventuales
    const eventuals = await bukClient.getEventualEmployees({
      minRating: SELECTION_CRITERIA.minRating,
    });

    // Verificar disponibilidad
    const candidates = [];

    for (const eventual of eventuals) {
      // Verificar días desde último turno
      if (eventual.lastShiftDate) {
        const daysSinceLastShift = Math.floor(
          (new Date() - new Date(eventual.lastShiftDate)) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceLastShift > SELECTION_CRITERIA.maxDaysSinceLastShift) {
          continue; // Muy inactivo
        }
      }

      // Verificar disponibilidad para la fecha
      const availability = await bukClient.getEmployeeAvailability(
        eventual.employeeId,
        [gap.date]
      );

      const dateAvailability = availability[0];
      if (!dateAvailability?.available) {
        continue;
      }

      // Verificar que el turno esté en su disponibilidad
      const shiftMatch = gap.shift === "morning" 
        ? dateAvailability.shifts?.includes("morning")
        : dateAvailability.shifts?.includes("afternoon") || dateAvailability.shifts?.includes("evening");

      if (!shiftMatch && dateAvailability.shifts?.length > 0) {
        continue;
      }

      candidates.push({
        ...eventual,
        score: this.calculateCandidateScore(eventual, gap),
      });
    }

    // Ordenar por score
    candidates.sort((a, b) => b.score - a.score);

    // Limitar cantidad
    return candidates.slice(0, SELECTION_CRITERIA.maxCandidatesToContact);
  }

  /**
   * Calcula score de un candidato
   */
  calculateCandidateScore(candidate, gap) {
    let score = 0;

    // Rating (40% del score)
    score += (candidate.rating / 5) * 40;

    // Recencia (30% del score)
    if (candidate.lastShiftDate) {
      const daysSince = Math.floor(
        (new Date() - new Date(candidate.lastShiftDate)) / (1000 * 60 * 60 * 24)
      );
      if (daysSince <= 7) score += 30;
      else if (daysSince <= 14) score += 25;
      else if (daysSince <= 30) score += 15;
      else score += 5;
    }

    // Skills relevantes (20% del score)
    const requiredSkills = ["barista", "caja"];
    const matchingSkills = requiredSkills.filter(s => 
      candidate.skills?.includes(s)
    ).length;
    score += (matchingSkills / requiredSkills.length) * 20;

    // Bonus si ya trabajó en esa sucursal (10%)
    if (candidate.branchId === gap.branchId) {
      score += 10;
    }

    return Math.round(score);
  }

  /**
   * Fase 4: Prepara convocatoria para candidatos
   */
  async draftConvocatoria(gap, candidates) {
    logger.info({ gap: gap.gapId, candidates: candidates.length }, "Phase 4: DRAFT CONVOCATORIA");

    const branchName = await getBranchName(gap.branchId);
    const shiftTimes = gap.shift === "morning" 
      ? "7:00 AM - 3:00 PM" 
      : "3:00 PM - 10:00 PM";

    const convocatoria = {
      id: `CONV-${Date.now()}-${gap.branchId}`,
      gap,
      candidates: candidates.map(c => ({
        employeeId: c.employeeId,
        name: c.name,
        phone: c.phone,
        score: c.score,
        status: "pending",
      })),
      message: this.generateConvocatoriaMessage({
        branchName,
        date: gap.date,
        shift: shiftTimes,
        dayType: gap.dayType,
      }),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + SELECTION_CRITERIA.responseWaitHours * 60 * 60 * 1000).toISOString(),
    };

    return convocatoria;
  }

  /**
   * Genera mensaje de convocatoria
   */
  generateConvocatoriaMessage(params) {
    const { branchName, date, shift, dayType } = params;
    
    const dateFormatted = new Date(date).toLocaleDateString("es-MX", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

    let urgencyPrefix = "";
    if (dayType === "weekend") urgencyPrefix = "🔥 ";
    if (dayType === "holiday") urgencyPrefix = "🚨 URGENTE: ";

    return `${urgencyPrefix}¡Hola {name}! 👋

Tenemos un turno disponible en *${branchName}*:

📅 *${dateFormatted}*
⏰ *${shift}*

¿Te gustaría cubrirlo?

_Responde SI para confirmar o NO si no puedes._

— Recursos Humanos (LUCA) 🦑`;
  }

  /**
   * Fase 5: Envía convocatoria via ActionBus
   */
  async sendConvocatoria(convocatoria, context) {
    logger.info({ convocatoriaId: convocatoria.id }, "Phase 5: SEND CONVOCATORIA");

    // Guardar convocatoria para tracking
    this.pendingConvocatorias.set(convocatoria.id, convocatoria);

    // Proponer acción via ActionBus (requiere APPROVAL)
    const result = await actionBus.propose({
      type: "CONTACT_EVENTUAL_STAFF",
      payload: {
        candidates: convocatoria.candidates.map(c => ({
          phone: c.phone,
          name: c.name,
        })),
        shift_date: convocatoria.gap.date,
        shift_time: convocatoria.gap.shift === "morning" ? "7:00 - 15:00" : "15:00 - 22:00",
        branch_id: convocatoria.gap.branchId,
        message_template: convocatoria.message,
        convocatoria_id: convocatoria.id,
      },
      context: {
        gap_id: convocatoria.gap.gapId,
        deficit: convocatoria.gap.deficit,
        convocatoria_id: convocatoria.id,
      },
      reason: `Cubrir ${convocatoria.gap.deficit} posición(es) el ${convocatoria.gap.date} turno ${convocatoria.gap.shift}`,
      requestedBy: "headhunter_agent",
    });

    return result;
  }

  /**
   * Procesa respuesta de un candidato
   */
  async processResponse(convocatoriaId, employeePhone, response) {
    logger.info({ convocatoriaId, employeePhone, response }, "Processing candidate response");

    const convocatoria = this.pendingConvocatorias.get(convocatoriaId);
    
    if (!convocatoria) {
      logger.warn({ convocatoriaId }, "Convocatoria not found");
      return { success: false, error: "Convocatoria not found" };
    }

    const candidate = convocatoria.candidates.find(c => c.phone === employeePhone);
    
    if (!candidate) {
      logger.warn({ employeePhone }, "Candidate not found in convocatoria");
      return { success: false, error: "Candidate not found" };
    }

    const isAccept = this.parseResponse(response);

    if (isAccept) {
      // Candidato aceptó
      candidate.status = "accepted";
      candidate.acceptedAt = new Date().toISOString();

      // Asignar turno en BUK
      const assignment = await this.assignShift(convocatoria.gap, candidate);

      // Notificar confirmación
      await this.notifyConfirmation(convocatoria, candidate);

      return {
        success: true,
        action: "accepted",
        assignment,
      };

    } else {
      // Candidato rechazó
      candidate.status = "declined";
      candidate.declinedAt = new Date().toISOString();

      // Contactar siguiente candidato si hay déficit pendiente
      const accepted = convocatoria.candidates.filter(c => c.status === "accepted").length;
      const pending = convocatoria.candidates.filter(c => c.status === "pending");

      if (accepted < convocatoria.gap.deficit && pending.length > 0) {
        // TODO: Contactar siguiente candidato
        logger.info({ nextCandidate: pending[0].name }, "Would contact next candidate");
      }

      return {
        success: true,
        action: "declined",
        remainingDeficit: convocatoria.gap.deficit - accepted,
      };
    }
  }

  /**
   * Parsea respuesta del candidato
   */
  parseResponse(response) {
    const text = response.toLowerCase().trim();
    const acceptPhrases = ["si", "sí", "yes", "acepto", "confirmo", "ok", "va", "dale"];
    return acceptPhrases.some(phrase => text.includes(phrase));
  }

  /**
   * Asigna turno en BUK
   */
  async assignShift(gap, candidate) {
    const shiftTimes = gap.shift === "morning" 
      ? { start: "07:00", end: "15:00" }
      : { start: "15:00", end: "22:00" };

    const assignment = await bukClient.assignShift({
      employeeId: candidate.employeeId,
      branchId: gap.branchId,
      date: gap.date,
      startTime: shiftTimes.start,
      endTime: shiftTimes.end,
      role: "barista",
    });

    logger.info({ assignment }, "Shift assigned in BUK");

    return assignment;
  }

  /**
   * Notifica confirmación de turno
   */
  async notifyConfirmation(convocatoria, candidate) {
    const branchName = await getBranchName(convocatoria.gap.branchId);
    
    // Notificar al candidato
    await actionBus.propose({
      type: "NOTIFY_GERENTE", // Usar AUTO para confirmación
      payload: {
        branch_id: convocatoria.gap.branchId,
        message: `✅ ${candidate.name} confirmado para ${convocatoria.gap.date} turno ${convocatoria.gap.shift}`,
      },
      reason: "Confirmar asignación de turno eventual",
      requestedBy: "headhunter_agent",
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Cuenta personal programado por turno
   */
  countScheduledStaff(schedules, date, absences) {
    const counts = { morning: 0, afternoon: 0 };

    for (const schedule of schedules) {
      if (schedule.date !== date) continue;
      if (schedule.status === "cancelled") continue;

      // Verificar si hay ausencia
      const hasAbsence = absences.some(a => 
        a.employeeId === schedule.employeeId && a.date === date
      );
      if (hasAbsence) continue;

      // Determinar turno
      const startHour = parseInt(schedule.startTime.split(":")[0]);
      if (startHour < 12) {
        counts.morning++;
      } else {
        counts.afternoon++;
      }
    }

    return counts;
  }

  /**
   * Verifica si una fecha es feriado
   */
  async isHoliday(dateStr) {
    // TODO: Integrar con calendario de feriados
    const holidays = [
      "2026-01-01", // Año Nuevo
      "2026-02-03", // Constitución
      "2026-03-16", // Benito Juárez
      "2026-05-01", // Día del Trabajo
      "2026-09-16", // Independencia
      "2026-11-16", // Revolución
      "2026-12-25", // Navidad
    ];
    return holidays.includes(dateStr);
  }

  /**
   * Obtiene ajuste estacional para demanda
   */
  async getSeasonalAdjustment(branchId, dateStr) {
    // Buscar en memoria contexto estacional
    try {
      const context = await memoryService.getRelevantKnowledge(
        `estacionalidad ${new Date(dateStr).toLocaleDateString("es-MX", { month: "long" })} ${branchId}`,
        { limit: 1 }
      );

      if (context.length > 0 && context[0].metadata?.impact) {
        return 1 + parseFloat(context[0].metadata.impact);
      }
    } catch (err) {
      // Ignorar errores de memoria
    }

    // Default: sin ajuste
    return 1.0;
  }
}

export const headhunterAgent = new HeadhunterAgent();

export default HeadhunterAgent;
