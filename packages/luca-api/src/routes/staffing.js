/**
 * ═══════════════════════════════════════════════════════════════════════════
 * STAFFING ROUTES - API para El Headhunter
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { headhunterAgent } from "../agents/HeadhunterAgent.js";
import { bukClient } from "../integrations/buk/BukClient.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// HEADHUNTER AGENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/staffing/run
 * Ejecutar el flujo completo del Headhunter
 */
router.post("/run", async (req, res) => {
  try {
    const { branch_id, lookahead_days } = req.body;
    
    const result = await headhunterAgent.run({
      branch_id,
      lookahead_days: lookahead_days || 2,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Headhunter run failed");
    res.status(500).json({ error: err?.message || "Run failed" });
  }
});

/**
 * GET /api/luca/staffing/gaps
 * Detectar gaps de personal sin ejecutar convocatorias
 */
router.get("/gaps", async (req, res) => {
  try {
    const { branch_id, days } = req.query;
    
    const result = await headhunterAgent.run({
      branch_id,
      lookahead_days: days ? parseInt(days) : 2,
      detectOnly: true,
    });
    
    res.json({
      gaps: result.gaps_found || [],
      summary: {
        total: result.gaps_found?.length || 0,
        critical: result.gaps_found?.filter(g => g.severity === "CRITICAL").length || 0,
        high: result.gaps_found?.filter(g => g.severity === "HIGH").length || 0,
      },
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Gap detection failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/staffing/response
 * Procesar respuesta de un candidato a convocatoria
 */
router.post("/response", async (req, res) => {
  try {
    const { convocatoria_id, phone, response } = req.body;
    
    if (!convocatoria_id || !phone || !response) {
      return res.status(400).json({ 
        error: "convocatoria_id, phone, and response required" 
      });
    }
    
    const result = await headhunterAgent.processResponse(
      convocatoria_id,
      phone,
      response
    );
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Response processing failed");
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BUK INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/staffing/schedules
 * Obtener horarios programados
 */
router.get("/schedules", async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    
    const schedules = await bukClient.getSchedules({
      branchId: branch_id,
      startDate: start_date,
      endDate: end_date,
    });
    
    res.json({ schedules });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/staffing/eventuals
 * Obtener lista de empleados eventuales
 */
router.get("/eventuals", async (req, res) => {
  try {
    const { branch_id, min_rating, skills } = req.query;
    
    const eventuals = await bukClient.getEventualEmployees({
      branchId: branch_id,
      minRating: min_rating ? parseFloat(min_rating) : undefined,
      skills: skills ? skills.split(",") : undefined,
    });
    
    res.json({ eventuals, count: eventuals.length });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/staffing/employee/:employeeId
 * Obtener información de un empleado
 */
router.get("/employee/:employeeId", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const employee = await bukClient.getEmployee(employeeId);
    
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }
    
    res.json(employee);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/staffing/employee/:employeeId/availability
 * Obtener disponibilidad de un empleado
 */
router.get("/employee/:employeeId/availability", async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { dates } = req.query;
    
    if (!dates) {
      return res.status(400).json({ error: "dates query param required" });
    }
    
    const availability = await bukClient.getEmployeeAvailability(
      employeeId,
      dates.split(",")
    );
    
    res.json({ availability });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/staffing/absences
 * Obtener ausencias programadas
 */
router.get("/absences", async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    
    const absences = await bukClient.getAbsences({
      branchId: branch_id,
      startDate: start_date,
      endDate: end_date,
    });
    
    res.json({ absences });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/staffing/assign
 * Asignar turno a un empleado
 */
router.post("/assign", async (req, res) => {
  try {
    const { employee_id, branch_id, date, start_time, end_time, role } = req.body;
    
    if (!employee_id || !branch_id || !date) {
      return res.status(400).json({ 
        error: "employee_id, branch_id, and date required" 
      });
    }
    
    const result = await bukClient.assignShift({
      employeeId: employee_id,
      branchId: branch_id,
      date,
      startTime: start_time || "07:00",
      endTime: end_time || "15:00",
      role: role || "barista",
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/staffing/shifts/:shiftId/confirm
 * Confirmar un turno
 */
router.post("/shifts/:shiftId/confirm", async (req, res) => {
  try {
    const { shiftId } = req.params;
    const result = await bukClient.confirmShift(shiftId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/staffing/shifts/:shiftId/cancel
 * Cancelar un turno
 */
router.post("/shifts/:shiftId/cancel", async (req, res) => {
  try {
    const { shiftId } = req.params;
    const { reason } = req.body;
    
    const result = await bukClient.cancelShift(shiftId, reason);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/staffing/status
 * Estado del sistema de staffing
 */
router.get("/status", async (req, res) => {
  res.json({
    agent: "headhunter",
    status: "operational",
    bukConfigured: bukClient.isConfigured(),
    pendingConvocatorias: headhunterAgent.pendingConvocatorias?.size || 0,
  });
});

export default router;
