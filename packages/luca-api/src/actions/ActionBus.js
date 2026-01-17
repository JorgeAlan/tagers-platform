/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACTION BUS - Router Central de Acciones
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Punto central para todas las acciones que LUCA quiere ejecutar.
 * 
 * Flujo:
 * 1. Agente/Detector propone acción → ActionBus.propose()
 * 2. ActionBus determina nivel de autonomía
 * 3. Si AUTO → ejecuta inmediatamente
 * 4. Si DRAFT → crea draft, notifica para confirmación
 * 5. Si APPROVAL → encola para aprobación
 * 6. Si CRITICAL → requiere 2FA
 * 
 * Todas las acciones quedan registradas para auditoría.
 */

import { logger, query } from "@tagers/shared";
import { v4 as uuidv4 } from "uuid";
import { 
  getAutonomyLevel, 
  canAutoExecute, 
  requires2FA,
  checkLimits,
  getHandler,
  AutonomyLevel 
} from "../autonomy/AutonomyLevels.js";
import { actionExecutor } from "./ActionExecutor.js";
import { approvalService } from "../approval/ApprovalService.js";

/**
 * Estados de una acción
 */
export const ActionState = {
  PROPOSED: "PROPOSED",       // Acción propuesta
  DRAFT: "DRAFT",             // Draft creado, esperando confirmación
  PENDING_APPROVAL: "PENDING_APPROVAL",  // Esperando aprobación
  PENDING_2FA: "PENDING_2FA", // Esperando 2FA
  APPROVED: "APPROVED",       // Aprobada, lista para ejecutar
  EXECUTING: "EXECUTING",     // En ejecución
  EXECUTED: "EXECUTED",       // Ejecutada exitosamente
  FAILED: "FAILED",           // Falló la ejecución
  REJECTED: "REJECTED",       // Rechazada por humano
  CANCELLED: "CANCELLED",     // Cancelada
  EXPIRED: "EXPIRED",         // Expiró sin respuesta
};

export class ActionBus {
  constructor() {
    this.handlers = new Map();
  }

  /**
   * Propone una acción para ejecución
   * 
   * @param {Object} action - Acción a proponer
   * @param {string} action.type - Tipo de acción (ej: NOTIFY_GERENTE)
   * @param {Object} action.payload - Datos de la acción
   * @param {Object} action.context - Contexto (case_id, alert_id, etc.)
   * @param {string} action.requestedBy - Quién solicita (agente, detector, etc.)
   * @param {string} action.reason - Razón de la acción
   */
  async propose(action) {
    const actionId = `ACT-${Date.now()}-${uuidv4().slice(0, 8)}`;
    
    logger.info({
      actionId,
      type: action.type,
      requestedBy: action.requestedBy,
    }, "Action proposed");

    try {
      // 1. Determinar nivel de autonomía
      const autonomyLevel = getAutonomyLevel(action.type);
      const handler = getHandler(action.type);

      // 2. Verificar límites
      const limitsCheck = await checkLimits(action.type, action.context);
      if (!limitsCheck.allowed) {
        return this.rejectAction(actionId, action, "LIMITS_EXCEEDED", limitsCheck.reason);
      }

      // 3. Crear registro de acción
      const actionRecord = {
        action_id: actionId,
        action_type: action.type,
        payload: action.payload,
        context: action.context || {},
        requested_by: action.requestedBy || "unknown",
        reason: action.reason,
        autonomy_level: autonomyLevel,
        handler,
        state: ActionState.PROPOSED,
        created_at: new Date().toISOString(),
      };

      // 4. Persistir
      await this.persistAction(actionRecord);

      // 5. Procesar según nivel de autonomía
      switch (autonomyLevel) {
        case AutonomyLevel.AUTO:
          return this.executeAuto(actionRecord);

        case AutonomyLevel.DRAFT:
          return this.createDraft(actionRecord);

        case AutonomyLevel.APPROVAL:
          return this.queueForApproval(actionRecord);

        case AutonomyLevel.CRITICAL:
          return this.queueForCriticalApproval(actionRecord);

        default:
          return this.queueForApproval(actionRecord);
      }

    } catch (err) {
      logger.error({ actionId, err: err?.message }, "Failed to process action");
      throw err;
    }
  }

  /**
   * Ejecuta acción automáticamente (nivel AUTO)
   */
  async executeAuto(actionRecord) {
    logger.info({ actionId: actionRecord.action_id }, "Auto-executing action");

    await this.updateState(actionRecord.action_id, ActionState.APPROVED, {
      approved_at: new Date().toISOString(),
      approved_by: "AUTO",
    });

    return this.execute(actionRecord.action_id);
  }

  /**
   * Crea draft para confirmación (nivel DRAFT)
   */
  async createDraft(actionRecord) {
    logger.info({ actionId: actionRecord.action_id }, "Creating draft for confirmation");

    await this.updateState(actionRecord.action_id, ActionState.DRAFT, {
      draft_created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
    });

    // Notificar que hay un draft pendiente
    await approvalService.notifyDraftPending(actionRecord);

    return {
      actionId: actionRecord.action_id,
      state: ActionState.DRAFT,
      message: "Draft creado, esperando confirmación",
      expiresAt: actionRecord.expires_at,
    };
  }

  /**
   * Encola para aprobación (nivel APPROVAL)
   */
  async queueForApproval(actionRecord) {
    logger.info({ actionId: actionRecord.action_id }, "Queueing for approval");

    await this.updateState(actionRecord.action_id, ActionState.PENDING_APPROVAL, {
      queued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(), // 48h
    });

    // Agregar a cola de aprobaciones
    await approvalService.queueForApproval(actionRecord);

    return {
      actionId: actionRecord.action_id,
      state: ActionState.PENDING_APPROVAL,
      message: "Acción en cola de aprobación",
      expiresAt: actionRecord.expires_at,
    };
  }

  /**
   * Encola para aprobación crítica con 2FA (nivel CRITICAL)
   */
  async queueForCriticalApproval(actionRecord) {
    logger.info({ actionId: actionRecord.action_id }, "Queueing for critical approval (2FA)");

    await this.updateState(actionRecord.action_id, ActionState.PENDING_APPROVAL, {
      queued_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24h
      requires_2fa: true,
    });

    // Agregar a cola de aprobaciones críticas
    await approvalService.queueForCriticalApproval(actionRecord);

    return {
      actionId: actionRecord.action_id,
      state: ActionState.PENDING_APPROVAL,
      message: "Acción crítica en cola, requiere 2FA",
      requires2FA: true,
      expiresAt: actionRecord.expires_at,
    };
  }

  /**
   * Aprueba una acción
   */
  async approve(actionId, approvedBy, options = {}) {
    const actionRecord = await this.getAction(actionId);
    
    if (!actionRecord) {
      throw new Error(`Action not found: ${actionId}`);
    }

    // Verificar estado
    if (![ActionState.DRAFT, ActionState.PENDING_APPROVAL, ActionState.PENDING_2FA].includes(actionRecord.state)) {
      throw new Error(`Action ${actionId} cannot be approved in state ${actionRecord.state}`);
    }

    // Si requiere 2FA y no se proporcionó
    if (actionRecord.requires_2fa && !options.verified2FA) {
      await this.updateState(actionId, ActionState.PENDING_2FA, {
        approval_started_by: approvedBy,
        approval_started_at: new Date().toISOString(),
      });

      return {
        actionId,
        state: ActionState.PENDING_2FA,
        message: "Requiere verificación 2FA",
      };
    }

    logger.info({ actionId, approvedBy }, "Action approved");

    await this.updateState(actionId, ActionState.APPROVED, {
      approved_at: new Date().toISOString(),
      approved_by: approvedBy,
    });

    // Ejecutar
    return this.execute(actionId);
  }

  /**
   * Confirma un draft
   */
  async confirm(actionId, confirmedBy) {
    return this.approve(actionId, confirmedBy);
  }

  /**
   * Verifica 2FA y aprueba
   */
  async verify2FAAndApprove(actionId, approvedBy, verificationCode) {
    // TODO: Verificar código 2FA real
    const isValid = verificationCode && verificationCode.length === 6;
    
    if (!isValid) {
      throw new Error("Invalid 2FA code");
    }

    return this.approve(actionId, approvedBy, { verified2FA: true });
  }

  /**
   * Rechaza una acción
   */
  async reject(actionId, rejectedBy, reason) {
    const actionRecord = await this.getAction(actionId);
    
    if (!actionRecord) {
      throw new Error(`Action not found: ${actionId}`);
    }

    logger.info({ actionId, rejectedBy, reason }, "Action rejected");

    await this.updateState(actionId, ActionState.REJECTED, {
      rejected_at: new Date().toISOString(),
      rejected_by: rejectedBy,
      rejection_reason: reason,
    });

    return {
      actionId,
      state: ActionState.REJECTED,
      message: "Acción rechazada",
      reason,
    };
  }

  /**
   * Ejecuta una acción aprobada
   */
  async execute(actionId) {
    const actionRecord = await this.getAction(actionId);
    
    if (!actionRecord) {
      throw new Error(`Action not found: ${actionId}`);
    }

    if (actionRecord.state !== ActionState.APPROVED) {
      throw new Error(`Action ${actionId} must be approved before execution`);
    }

    logger.info({ actionId, handler: actionRecord.handler }, "Executing action");

    await this.updateState(actionId, ActionState.EXECUTING, {
      execution_started_at: new Date().toISOString(),
    });

    try {
      // Ejecutar a través del ActionExecutor
      const result = await actionExecutor.execute(actionRecord);

      await this.updateState(actionId, ActionState.EXECUTED, {
        executed_at: new Date().toISOString(),
        execution_result: result,
      });

      logger.info({ actionId, result }, "Action executed successfully");

      return {
        actionId,
        state: ActionState.EXECUTED,
        result,
      };

    } catch (err) {
      logger.error({ actionId, err: err?.message }, "Action execution failed");

      await this.updateState(actionId, ActionState.FAILED, {
        failed_at: new Date().toISOString(),
        failure_reason: err?.message,
      });

      return {
        actionId,
        state: ActionState.FAILED,
        error: err?.message,
      };
    }
  }

  /**
   * Cancela una acción pendiente
   */
  async cancel(actionId, cancelledBy, reason) {
    const actionRecord = await this.getAction(actionId);
    
    if (!actionRecord) {
      throw new Error(`Action not found: ${actionId}`);
    }

    const cancellableStates = [
      ActionState.PROPOSED,
      ActionState.DRAFT,
      ActionState.PENDING_APPROVAL,
      ActionState.PENDING_2FA,
    ];

    if (!cancellableStates.includes(actionRecord.state)) {
      throw new Error(`Action ${actionId} cannot be cancelled in state ${actionRecord.state}`);
    }

    logger.info({ actionId, cancelledBy }, "Action cancelled");

    await this.updateState(actionId, ActionState.CANCELLED, {
      cancelled_at: new Date().toISOString(),
      cancelled_by: cancelledBy,
      cancellation_reason: reason,
    });

    return {
      actionId,
      state: ActionState.CANCELLED,
    };
  }

  /**
   * Rechaza acción por límites excedidos
   */
  async rejectAction(actionId, action, reason, details) {
    logger.warn({ actionId, reason, details }, "Action rejected");

    return {
      actionId,
      state: ActionState.REJECTED,
      reason,
      details,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // PERSISTENCIA
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Persiste una acción en la base de datos
   */
  async persistAction(actionRecord) {
    try {
      await query(`
        INSERT INTO luca_action_bus (
          action_id, action_type, payload, context, requested_by,
          reason, autonomy_level, handler, state, metadata, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `, [
        actionRecord.action_id,
        actionRecord.action_type,
        JSON.stringify(actionRecord.payload),
        JSON.stringify(actionRecord.context),
        actionRecord.requested_by,
        actionRecord.reason,
        actionRecord.autonomy_level,
        actionRecord.handler,
        actionRecord.state,
        JSON.stringify({}),
        actionRecord.created_at,
      ]);
    } catch (err) {
      // Si la tabla no existe, crear mock
      logger.warn({ err: err?.message }, "Failed to persist action, table may not exist");
    }
  }

  /**
   * Actualiza el estado de una acción
   */
  async updateState(actionId, newState, metadata = {}) {
    try {
      await query(`
        UPDATE luca_action_bus 
        SET state = $1, 
            metadata = metadata || $2,
            updated_at = NOW()
        WHERE action_id = $3
      `, [newState, JSON.stringify(metadata), actionId]);
    } catch (err) {
      logger.warn({ actionId, err: err?.message }, "Failed to update action state");
    }
  }

  /**
   * Obtiene una acción por ID
   */
  async getAction(actionId) {
    try {
      const result = await query(`
        SELECT * FROM luca_action_bus WHERE action_id = $1
      `, [actionId]);

      if (result.rows[0]) {
        return {
          ...result.rows[0],
          payload: result.rows[0].payload,
          context: result.rows[0].context,
          metadata: result.rows[0].metadata,
        };
      }
    } catch (err) {
      logger.warn({ actionId, err: err?.message }, "Failed to get action");
    }

    return null;
  }

  /**
   * Lista acciones pendientes
   */
  async listPending(options = {}) {
    const { state, limit = 20 } = options;

    try {
      let sql = `
        SELECT * FROM luca_action_bus 
        WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA')
      `;
      const params = [];

      if (state) {
        sql += ` AND state = $${params.length + 1}`;
        params.push(state);
      }

      sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
      params.push(limit);

      const result = await query(sql, params);
      return result.rows;
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to list pending actions");
      return [];
    }
  }
}

// Export singleton
export const actionBus = new ActionBus();

export default ActionBus;
