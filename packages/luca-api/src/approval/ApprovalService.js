/**
 * ═══════════════════════════════════════════════════════════════════════════
 * APPROVAL SERVICE - Gestión de Aprobaciones
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja la cola de acciones pendientes de aprobación:
 * - Encolar para aprobación
 * - Notificar a aprobadores
 * - Manejar expiración
 * - Tracking de aprobaciones
 */

import { logger, query } from "@tagers/shared";
import { notificationRouter } from "../channels/notifications/NotificationRouter.js";
import { AutonomyLevel } from "../autonomy/AutonomyLevels.js";

/**
 * Tiempo de expiración por nivel
 */
const EXPIRATION_HOURS = {
  [AutonomyLevel.DRAFT]: 24,
  [AutonomyLevel.APPROVAL]: 48,
  [AutonomyLevel.CRITICAL]: 24,
};

/**
 * Aprobadores por nivel
 */
const APPROVERS = {
  [AutonomyLevel.DRAFT]: ["jorge", "andres", "tany"],
  [AutonomyLevel.APPROVAL]: ["jorge", "andres", "tany"],
  [AutonomyLevel.CRITICAL]: ["jorge"], // Solo Jorge para críticos
};

export class ApprovalService {
  /**
   * Encola acción para aprobación
   */
  async queueForApproval(actionRecord) {
    const { action_id, action_type, autonomy_level, payload, context, reason } = actionRecord;

    logger.info({
      actionId: action_id,
      actionType: action_type,
      level: autonomy_level,
    }, "Queueing for approval");

    // Determinar aprobadores
    const approvers = this.getApprovers(autonomy_level, action_type);

    // Notificar a aprobadores
    await this.notifyApprovers(actionRecord, approvers);

    return {
      queued: true,
      approvers,
      expiresIn: `${EXPIRATION_HOURS[autonomy_level] || 48} hours`,
    };
  }

  /**
   * Encola acción crítica (requiere 2FA)
   */
  async queueForCriticalApproval(actionRecord) {
    logger.info({
      actionId: actionRecord.action_id,
      actionType: actionRecord.action_type,
    }, "Queueing for critical approval (2FA required)");

    // Solo Jorge puede aprobar críticos
    const approvers = APPROVERS[AutonomyLevel.CRITICAL];

    // Notificar con urgencia
    await this.notifyApprovers(actionRecord, approvers, {
      urgency: "critical",
      requires2FA: true,
    });

    return {
      queued: true,
      approvers,
      requires2FA: true,
      expiresIn: "24 hours",
    };
  }

  /**
   * Notifica que hay un draft pendiente
   */
  async notifyDraftPending(actionRecord) {
    const approvers = this.getApprovers(AutonomyLevel.DRAFT, actionRecord.action_type);

    await this.notifyApprovers(actionRecord, approvers, {
      type: "draft",
      message: "Confirma para ejecutar",
    });
  }

  /**
   * Obtiene aprobadores según nivel y tipo de acción
   */
  getApprovers(autonomyLevel, actionType) {
    // Por defecto usar aprobadores del nivel
    let approvers = APPROVERS[autonomyLevel] || APPROVERS[AutonomyLevel.APPROVAL];

    // Personalizar según tipo de acción si es necesario
    switch (actionType) {
      case "BLOCK_POS_USER":
      case "SUSPEND_EMPLOYEE_ACCESS":
        // Solo Jorge para acciones de bloqueo
        approvers = ["jorge"];
        break;

      case "SUBMIT_PURCHASE_ORDER":
        // Todos los dueños para POs grandes
        approvers = ["jorge", "andres", "tany"];
        break;
    }

    return approvers;
  }

  /**
   * Notifica a los aprobadores
   */
  async notifyApprovers(actionRecord, approvers, options = {}) {
    const {
      type = "approval",
      urgency = "normal",
      requires2FA = false,
      message,
    } = options;

    for (const approverId of approvers) {
      try {
        await notificationRouter.route({
          type: "approval",
          severity: urgency === "critical" ? "CRITICAL" : "HIGH",
          topic: "approval",
          targetUsers: [approverId],
          data: {
            action_id: actionRecord.action_id,
            action_type: actionRecord.action_type,
            reason: actionRecord.reason,
            payload_preview: this.getPayloadPreview(actionRecord),
            requires_2fa: requires2FA,
            message: message || this.getApprovalMessage(actionRecord, type),
            approve_url: `/api/luca/actions/${actionRecord.action_id}/approve`,
            reject_url: `/api/luca/actions/${actionRecord.action_id}/reject`,
          },
        });
      } catch (err) {
        logger.warn({
          approverId,
          actionId: actionRecord.action_id,
          err: err?.message,
        }, "Failed to notify approver");
      }
    }
  }

  /**
   * Genera preview del payload para notificación
   */
  getPayloadPreview(actionRecord) {
    const { action_type, payload } = actionRecord;

    switch (action_type) {
      case "NOTIFY_SOCIO":
        return `Mensaje: "${(payload.message || "").substring(0, 50)}..."`;

      case "CONTACT_EVENTUAL_STAFF":
        return `Contactar ${payload.candidates?.length || 0} candidatos para turno ${payload.shift_date}`;

      case "SUBMIT_PURCHASE_ORDER":
        return `PO ${payload.po_id} - $${payload.total?.toLocaleString() || "N/A"}`;

      case "FLAG_EMPLOYEE":
        return `Marcar ${payload.employee_id} - ${payload.reason?.substring(0, 50)}`;

      case "BLOCK_POS_USER":
        return `Bloquear usuario ${payload.user_id} en POS`;

      case "SUSPEND_EMPLOYEE_ACCESS":
        return `Suspender acceso de ${payload.employee_id}`;

      default:
        return `${action_type}: ${JSON.stringify(payload).substring(0, 100)}`;
    }
  }

  /**
   * Genera mensaje de aprobación
   */
  getApprovalMessage(actionRecord, type) {
    const { action_type, reason } = actionRecord;

    if (type === "draft") {
      return `LUCA preparó: ${this.getActionDescription(action_type)}\n\nRazón: ${reason || "N/A"}\n\n¿Confirmas?`;
    }

    return `LUCA solicita aprobación para: ${this.getActionDescription(action_type)}\n\nRazón: ${reason || "N/A"}`;
  }

  /**
   * Obtiene descripción legible de la acción
   */
  getActionDescription(actionType) {
    const descriptions = {
      NOTIFY_GERENTE: "Enviar mensaje a gerente",
      NOTIFY_SOCIO: "Enviar mensaje a socio",
      CONTACT_EVENTUAL_STAFF: "Contactar staff eventual",
      SUGGEST_SCHEDULE_CHANGE: "Sugerir cambio de horario",
      DRAFT_PURCHASE_ORDER: "Crear orden de compra",
      SUBMIT_PURCHASE_ORDER: "Enviar orden de compra",
      FLAG_EMPLOYEE: "Marcar empleado para auditoría",
      SUSPEND_EMPLOYEE_ACCESS: "Suspender acceso de empleado",
      BLOCK_POS_USER: "Bloquear usuario en POS",
      CREATE_CASE: "Crear caso de investigación",
      ESCALATE_CASE: "Escalar caso",
      INITIATE_INVESTIGATION: "Iniciar investigación",
    };

    return descriptions[actionType] || actionType;
  }

  /**
   * Obtiene acciones pendientes de aprobación
   */
  async getPendingApprovals(options = {}) {
    const { level, limit = 20, approverId } = options;

    try {
      let sql = `
        SELECT * FROM luca_action_bus 
        WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA')
      `;
      const params = [];

      if (level) {
        sql += ` AND autonomy_level = $${params.length + 1}`;
        params.push(level);
      }

      sql += ` ORDER BY 
        CASE 
          WHEN state = 'PENDING_2FA' THEN 1
          WHEN autonomy_level = 'CRITICAL' THEN 2
          WHEN autonomy_level = 'APPROVAL' THEN 3
          ELSE 4
        END,
        created_at ASC
      `;

      sql += ` LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await query(sql, params);
      return result.rows;
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get pending approvals");
      return [];
    }
  }

  /**
   * Obtiene estadísticas de aprobaciones
   */
  async getApprovalStats() {
    try {
      const result = await query(`
        SELECT 
          state,
          autonomy_level,
          COUNT(*) as count
        FROM luca_action_bus
        WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA', 'APPROVED', 'REJECTED', 'EXPIRED')
          AND created_at >= NOW() - INTERVAL '7 days'
        GROUP BY state, autonomy_level
      `);

      const stats = {
        pending: 0,
        approved: 0,
        rejected: 0,
        expired: 0,
        byLevel: {},
      };

      for (const row of result.rows) {
        if (['DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA'].includes(row.state)) {
          stats.pending += parseInt(row.count);
        } else if (row.state === 'APPROVED') {
          stats.approved += parseInt(row.count);
        } else if (row.state === 'REJECTED') {
          stats.rejected += parseInt(row.count);
        } else if (row.state === 'EXPIRED') {
          stats.expired += parseInt(row.count);
        }

        if (!stats.byLevel[row.autonomy_level]) {
          stats.byLevel[row.autonomy_level] = { pending: 0, completed: 0 };
        }

        if (['DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA'].includes(row.state)) {
          stats.byLevel[row.autonomy_level].pending += parseInt(row.count);
        } else {
          stats.byLevel[row.autonomy_level].completed += parseInt(row.count);
        }
      }

      return stats;
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get approval stats");
      return { pending: 0, approved: 0, rejected: 0, expired: 0, byLevel: {} };
    }
  }

  /**
   * Procesa acciones expiradas
   */
  async processExpiredActions() {
    try {
      const result = await query(`
        UPDATE luca_action_bus 
        SET state = 'EXPIRED', 
            metadata = metadata || '{"expired_at": "${new Date().toISOString()}"}'::jsonb
        WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA')
          AND (metadata->>'expires_at')::timestamptz < NOW()
        RETURNING action_id
      `);

      if (result.rows.length > 0) {
        logger.info({
          expiredCount: result.rows.length,
          actionIds: result.rows.map(r => r.action_id),
        }, "Processed expired actions");
      }

      return result.rows.length;
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to process expired actions");
      return 0;
    }
  }
}

// Export singleton
export const approvalService = new ApprovalService();

export default ApprovalService;
