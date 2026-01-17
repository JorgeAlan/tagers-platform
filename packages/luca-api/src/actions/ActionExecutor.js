/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ACTION EXECUTOR - Ejecuta Acciones Aprobadas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Ejecuta acciones usando el handler apropiado.
 * Maneja retry, timeouts y logging de resultados.
 */

import { logger } from "@tagers/shared";
import { whatsappHandler } from "./handlers/whatsappHandler.js";
import { chatwootHandler } from "./handlers/chatwootHandler.js";
import { sheetsHandler } from "./handlers/sheetsHandler.js";
import { webhookHandler } from "./handlers/webhookHandler.js";
import { internalHandler } from "./handlers/internalHandler.js";

/**
 * Timeout por defecto para ejecución (30 segundos)
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * Máximo de reintentos
 */
const MAX_RETRIES = 3;

export class ActionExecutor {
  constructor() {
    // Registrar handlers
    this.handlers = {
      whatsapp: whatsappHandler,
      chatwoot: chatwootHandler,
      sheets: sheetsHandler,
      webhook: webhookHandler,
      internal: internalHandler,
      notification: internalHandler, // Alias
      buk: webhookHandler,           // Por ahora usa webhook genérico
      pos: webhookHandler,           // Por ahora usa webhook genérico
      woocommerce: webhookHandler,   // Por ahora usa webhook genérico
    };
  }

  /**
   * Ejecuta una acción
   */
  async execute(actionRecord) {
    const { action_id, action_type, handler, payload, context } = actionRecord;
    
    logger.info({
      actionId: action_id,
      actionType: action_type,
      handler,
    }, "ActionExecutor executing");

    // Obtener handler
    const actionHandler = this.handlers[handler];
    
    if (!actionHandler) {
      throw new Error(`Unknown handler: ${handler}`);
    }

    // Ejecutar con timeout y retry
    let lastError;
    
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await this.executeWithTimeout(
          actionHandler,
          action_type,
          payload,
          context,
          DEFAULT_TIMEOUT_MS
        );

        logger.info({
          actionId: action_id,
          attempt,
          success: true,
        }, "Action execution succeeded");

        return {
          success: true,
          attempt,
          result,
          executedAt: new Date().toISOString(),
        };

      } catch (err) {
        lastError = err;
        
        logger.warn({
          actionId: action_id,
          attempt,
          error: err?.message,
        }, "Action execution attempt failed");

        // No reintentar si el error no es retryable
        if (!this.isRetryable(err)) {
          break;
        }

        // Esperar antes de reintentar (exponential backoff)
        if (attempt < MAX_RETRIES) {
          await this.sleep(Math.pow(2, attempt) * 1000);
        }
      }
    }

    // Todas las retries fallaron
    throw lastError || new Error("Execution failed after all retries");
  }

  /**
   * Ejecuta con timeout
   */
  async executeWithTimeout(handler, actionType, payload, context, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Execution timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      handler.execute(actionType, payload, context)
        .then(result => {
          clearTimeout(timeout);
          resolve(result);
        })
        .catch(err => {
          clearTimeout(timeout);
          reject(err);
        });
    });
  }

  /**
   * Determina si un error es retryable
   */
  isRetryable(error) {
    const nonRetryableErrors = [
      "Invalid payload",
      "Unauthorized",
      "Not found",
      "Invalid action type",
    ];

    return !nonRetryableErrors.some(msg => 
      error?.message?.includes(msg)
    );
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Registra un handler personalizado
   */
  registerHandler(name, handler) {
    this.handlers[name] = handler;
    logger.info({ handler: name }, "Handler registered");
  }

  /**
   * Lista handlers disponibles
   */
  listHandlers() {
    return Object.keys(this.handlers);
  }

  /**
   * Verifica si un handler existe
   */
  hasHandler(name) {
    return !!this.handlers[name];
  }

  /**
   * Ejecuta acción en modo dry-run (sin efectos secundarios)
   */
  async dryRun(actionRecord) {
    const { action_id, action_type, handler, payload, context } = actionRecord;
    
    logger.info({ actionId: action_id }, "Dry-run execution");

    const actionHandler = this.handlers[handler];
    
    if (!actionHandler) {
      throw new Error(`Unknown handler: ${handler}`);
    }

    // Validar sin ejecutar
    if (actionHandler.validate) {
      const validation = await actionHandler.validate(action_type, payload, context);
      return {
        valid: validation.valid,
        errors: validation.errors,
        preview: validation.preview,
      };
    }

    return {
      valid: true,
      preview: `Would execute ${action_type} via ${handler}`,
    };
  }

  /**
   * Revierte una acción ejecutada (si es reversible)
   */
  async rollback(actionRecord) {
    const { action_id, action_type, handler, payload, context, metadata } = actionRecord;
    
    logger.info({ actionId: action_id }, "Attempting rollback");

    const actionHandler = this.handlers[handler];
    
    if (!actionHandler?.rollback) {
      throw new Error(`Handler ${handler} does not support rollback`);
    }

    return actionHandler.rollback(action_type, payload, context, metadata.execution_result);
  }
}

// Export singleton
export const actionExecutor = new ActionExecutor();

export default ActionExecutor;
