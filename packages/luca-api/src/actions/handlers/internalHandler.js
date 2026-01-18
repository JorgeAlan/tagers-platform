/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTERNAL HANDLER - Ejecuta acciones internas de LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Acciones que afectan solo al sistema LUCA:
 * - Crear/cerrar/escalar casos
 * - Marcar empleados para auditoría
 * - Enviar alertas del sistema
 * - Iniciar investigaciones
 */

import { logger, query } from "@tagers/shared";
import caseService from "../../services/caseService.js";
import alertService from "../../services/alertService.js";
import { notificationRouter } from "../../channels/notifications/NotificationRouter.js";

export const internalHandler = {
  /**
   * Ejecuta una acción interna
   */
  async execute(actionType, payload, context) {
    logger.info({ actionType, payload }, "Internal handler executing");

    switch (actionType) {
      case "CREATE_CASE":
        return this.createCase(payload, context);

      case "CLOSE_CASE":
        return this.closeCase(payload, context);

      case "ESCALATE_CASE":
        return this.escalateCase(payload, context);

      case "FLAG_EMPLOYEE":
        return this.flagEmployee(payload, context);

      case "INITIATE_INVESTIGATION":
        return this.initiateInvestigation(payload, context);

      case "SEND_ALERT":
        return this.sendAlert(payload, context);

      case "UPDATE_CASE_STATUS":
        return this.updateCaseStatus(payload, context);

      case "ADD_CASE_NOTE":
        return this.addCaseNote(payload, context);

      default:
        throw new Error(`Unknown internal action: ${actionType}`);
    }
  },

  /**
   * Crea un caso de investigación
   */
  async createCase(payload, context) {
    const {
      title,
      description,
      case_type,
      severity,
      scope,
      source,
    } = payload;

    if (!title || !case_type) {
      throw new Error("title and case_type required");
    }

    const caso = await caseService.createCase({
      title,
      description,
      case_type,
      severity: severity || "MEDIUM",
      scope: scope || {},
      source: {
        ...source,
        action_id: context.action_id,
        created_by: "LUCA",
      },
    });

    return {
      success: true,
      case_id: caso.case_id,
      state: caso.state,
    };
  },

  /**
   * Cierra un caso
   */
  async closeCase(payload, context) {
    const { case_id, resolution, resolution_notes } = payload;

    if (!case_id) {
      throw new Error("case_id required");
    }

    await caseService.closeCase(case_id, {
      resolution: resolution || "COMPLETED",
      resolution_notes,
      closed_by: context.approved_by || "LUCA",
    });

    return {
      success: true,
      case_id,
      resolution,
    };
  },

  /**
   * Escala un caso a nivel superior
   */
  async escalateCase(payload, context) {
    const { case_id, new_severity, reason, escalate_to } = payload;

    if (!case_id) {
      throw new Error("case_id required");
    }

    // Actualizar severidad si se proporciona
    if (new_severity) {
      await caseService.updateCase(case_id, {
        severity: new_severity,
      });
    }

    // Agregar nota de escalamiento
    await caseService.addEvidence(case_id, {
      type: "ESCALATION",
      content: JSON.stringify({
        reason,
        escalated_to: escalate_to,
        escalated_at: new Date().toISOString(),
        action_id: context.action_id,
      }),
      source: "internal_handler",
    });

    // Notificar al destinatario del escalamiento
    if (escalate_to) {
      await notificationRouter.route({
        type: "case",
        severity: new_severity || "HIGH",
        topic: "escalation",
        targetUsers: [escalate_to],
        data: {
          case_id,
          reason,
          title: `Caso escalado: ${case_id}`,
        },
      });
    }

    return {
      success: true,
      case_id,
      escalated_to: escalate_to,
      new_severity,
    };
  },

  /**
   * Marca un empleado para auditoría
   */
  async flagEmployee(payload, context) {
    const {
      employee_id,
      branch_id,
      reason,
      flag_type,       // AUDIT, WATCH, INVESTIGATION
      related_case_id,
    } = payload;

    if (!employee_id || !reason) {
      throw new Error("employee_id and reason required");
    }

    // Crear registro de flag
    const flagId = `FLG-${Date.now()}-${employee_id}`;

    try {
      await query(`
        INSERT INTO luca_employee_flags (
          flag_id, employee_id, branch_id, flag_type, reason,
          related_case_id, status, created_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [
        flagId,
        employee_id,
        branch_id,
        flag_type || "AUDIT",
        reason,
        related_case_id,
        "ACTIVE",
        "LUCA",
        new Date().toISOString(),
      ]);
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to persist flag, table may not exist");
    }

    // Si hay caso relacionado, agregar evidencia
    if (related_case_id) {
      await caseService.addEvidence(related_case_id, {
        type: "EMPLOYEE_FLAG",
        content: JSON.stringify({
          flag_id: flagId,
          employee_id,
          flag_type: flag_type || "AUDIT",
          reason,
        }),
        source: "internal_handler",
      });
    }

    return {
      success: true,
      flag_id: flagId,
      employee_id,
      flag_type: flag_type || "AUDIT",
    };
  },

  /**
   * Inicia una investigación formal
   */
  async initiateInvestigation(payload, context) {
    const {
      case_id,
      investigation_type,
      assigned_to,
      priority,
      deadline,
      scope,
    } = payload;

    if (!case_id || !investigation_type) {
      throw new Error("case_id and investigation_type required");
    }

    // Actualizar caso
    await caseService.updateCase(case_id, {
      state: "INVESTIGATING",
      assigned_to,
    });

    // Agregar registro de investigación
    const investigationId = `INV-${Date.now()}`;

    await caseService.addEvidence(case_id, {
      type: "INVESTIGATION_INITIATED",
      content: JSON.stringify({
        investigation_id: investigationId,
        investigation_type,
        assigned_to,
        priority,
        deadline,
        scope,
        initiated_at: new Date().toISOString(),
        action_id: context.action_id,
      }),
      source: "internal_handler",
    });

    // Notificar al asignado
    if (assigned_to) {
      await notificationRouter.route({
        type: "case",
        severity: priority === "urgent" ? "HIGH" : "MEDIUM",
        topic: "investigation",
        targetUsers: [assigned_to],
        data: {
          case_id,
          investigation_id: investigationId,
          title: `Nueva investigación asignada`,
          investigation_type,
        },
      });
    }

    return {
      success: true,
      investigation_id: investigationId,
      case_id,
      assigned_to,
    };
  },

  /**
   * Envía alerta del sistema
   */
  async sendAlert(payload, context) {
    const {
      alert_type,
      title,
      message,
      severity,
      branch_id,
      target_users,
      data,
    } = payload;

    if (!title || !message) {
      throw new Error("title and message required");
    }

    // Crear alerta en el sistema
    const alert = await alertService.createAlert({
      alert_type: alert_type || "SYSTEM",
      title,
      message,
      severity: severity || "MEDIUM",
      branch_id,
      metadata: {
        ...data,
        action_id: context.action_id,
      },
    });

    // Enrutar notificaciones
    await notificationRouter.route({
      type: "alert",
      severity: severity || "MEDIUM",
      topic: alert_type?.toLowerCase(),
      targetUsers: target_users,
      branchId: branch_id,
      data: {
        alert_id: alert.alert_id,
        title,
        message,
      },
    });

    return {
      success: true,
      alert_id: alert.alert_id,
    };
  },

  /**
   * Actualiza estado de un caso
   */
  async updateCaseStatus(payload, context) {
    const { case_id, new_state, reason } = payload;

    if (!case_id || !new_state) {
      throw new Error("case_id and new_state required");
    }

    await caseService.updateCase(case_id, {
      state: new_state,
    });

    // Agregar nota de cambio de estado
    if (reason) {
      await caseService.addEvidence(case_id, {
        type: "STATUS_CHANGE",
        content: JSON.stringify({
          new_state,
          reason,
          changed_by: context.approved_by || "LUCA",
          changed_at: new Date().toISOString(),
        }),
        source: "internal_handler",
      });
    }

    return {
      success: true,
      case_id,
      new_state,
    };
  },

  /**
   * Agrega nota a un caso
   */
  async addCaseNote(payload, context) {
    const { case_id, note, note_type } = payload;

    if (!case_id || !note) {
      throw new Error("case_id and note required");
    }

    await caseService.addEvidence(case_id, {
      type: note_type || "NOTE",
      content: note,
      source: context.approved_by || "LUCA",
    });

    return {
      success: true,
      case_id,
    };
  },

  /**
   * Valida payload sin ejecutar
   */
  async validate(actionType, payload, context) {
    const errors = [];

    switch (actionType) {
      case "CREATE_CASE":
        if (!payload.title) errors.push("title required");
        if (!payload.case_type) errors.push("case_type required");
        break;

      case "CLOSE_CASE":
      case "ESCALATE_CASE":
      case "UPDATE_CASE_STATUS":
      case "ADD_CASE_NOTE":
        if (!payload.case_id) errors.push("case_id required");
        break;

      case "FLAG_EMPLOYEE":
        if (!payload.employee_id) errors.push("employee_id required");
        if (!payload.reason) errors.push("reason required");
        break;

      case "INITIATE_INVESTIGATION":
        if (!payload.case_id) errors.push("case_id required");
        if (!payload.investigation_type) errors.push("investigation_type required");
        break;

      case "SEND_ALERT":
        if (!payload.title) errors.push("title required");
        if (!payload.message) errors.push("message required");
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: errors.length === 0 
        ? `Would execute internal action: ${actionType}` 
        : null,
    };
  },

  /**
   * Rollback de acciones internas
   */
  async rollback(actionType, payload, context, executionResult) {
    switch (actionType) {
      case "FLAG_EMPLOYEE":
        // Desactivar flag
        try {
          await query(`
            UPDATE luca_employee_flags 
            SET status = 'CANCELLED', cancelled_at = NOW()
            WHERE flag_id = $1
          `, [executionResult?.flag_id]);
        } catch (err) {
          logger.warn({ err: err?.message }, "Failed to rollback flag");
        }
        return { success: true, rolledBack: true };

      case "ESCALATE_CASE":
        // Agregar nota de des-escalamiento
        await caseService.addEvidence(payload.case_id, {
          type: "ROLLBACK",
          content: "Escalamiento revertido",
          source: "internal_handler",
        });
        return { success: true, rolledBack: true };

      default:
        throw new Error(`Rollback not supported for ${actionType}`);
    }
  },
};

export default internalHandler;
