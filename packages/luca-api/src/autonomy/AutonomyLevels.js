/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUTONOMY LEVELS - Niveles de Autonomía de LUCA
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Define qué puede hacer LUCA solo y qué necesita aprobación humana.
 * 
 * Niveles:
 * - AUTO     → LUCA ejecuta solo, sin preguntar
 * - DRAFT    → LUCA prepara, humano confirma con un click
 * - APPROVAL → Humano debe revisar y aprobar explícitamente
 * - CRITICAL → Requiere 2FA o doble confirmación
 * 
 * ZERO-HARDCODE: La configuración real debe venir de Google Sheets.
 */

import { logger } from "@tagers/shared";

/**
 * Niveles de autonomía
 */
export const AutonomyLevel = {
  AUTO: "AUTO",           // Ejecuta automáticamente
  DRAFT: "DRAFT",         // Prepara draft, pide confirmación
  APPROVAL: "APPROVAL",   // Requiere aprobación explícita
  CRITICAL: "CRITICAL",   // Requiere 2FA o múltiple aprobación
};

/**
 * Configuración de acciones y sus niveles de autonomía
 * NOTA: Esto debe venir de Google Sheets en producción
 */
export const AutonomyConfig = {
  // ═══════════════════════════════════════════════════════════════════════════
  // NOTIFICACIONES
  // ═══════════════════════════════════════════════════════════════════════════
  
  NOTIFY_GERENTE: {
    level: AutonomyLevel.AUTO,
    description: "Avisar a gerente de sucursal",
    limits: { max_per_hour: 5, max_per_day: 20 },
    handler: "whatsapp",
    reversible: false,
  },
  
  NOTIFY_SOCIO: {
    level: AutonomyLevel.DRAFT,
    description: "Avisar a socio/dueño",
    limits: { max_per_day: 10 },
    handler: "whatsapp",
    reversible: false,
  },
  
  SEND_ALERT: {
    level: AutonomyLevel.AUTO,
    description: "Enviar alerta del sistema",
    limits: { max_per_hour: 20 },
    handler: "notification",
    reversible: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CHATWOOT / CRM
  // ═══════════════════════════════════════════════════════════════════════════
  
  CREATE_INTERNAL_NOTE: {
    level: AutonomyLevel.AUTO,
    description: "Crear nota interna en conversación",
    limits: { max_per_hour: 50 },
    handler: "chatwoot",
    reversible: true,
  },
  
  CREATE_TICKET: {
    level: AutonomyLevel.DRAFT,
    description: "Crear ticket de seguimiento",
    limits: { max_per_day: 20 },
    handler: "chatwoot",
    reversible: true,
  },
  
  ASSIGN_CONVERSATION: {
    level: AutonomyLevel.AUTO,
    description: "Asignar conversación a agente",
    limits: null,
    handler: "chatwoot",
    reversible: true,
  },
  
  TAG_CONVERSATION: {
    level: AutonomyLevel.AUTO,
    description: "Agregar tag a conversación",
    limits: null,
    handler: "chatwoot",
    reversible: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // STAFFING
  // ═══════════════════════════════════════════════════════════════════════════
  
  SUGGEST_SCHEDULE_CHANGE: {
    level: AutonomyLevel.DRAFT,
    description: "Sugerir cambio de turno",
    limits: null,
    handler: "sheets",
    reversible: true,
  },
  
  CONTACT_EVENTUAL_STAFF: {
    level: AutonomyLevel.APPROVAL,
    description: "Contactar staff eventual para cubrir turno",
    limits: { max_contacts: 10 },
    handler: "whatsapp",
    reversible: false,
  },
  
  APPROVE_SHIFT_SWAP: {
    level: AutonomyLevel.APPROVAL,
    description: "Aprobar intercambio de turno",
    limits: null,
    handler: "buk",
    reversible: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INVENTARIO / COMPRAS
  // ═══════════════════════════════════════════════════════════════════════════
  
  DRAFT_PURCHASE_ORDER: {
    level: AutonomyLevel.AUTO,
    description: "Crear borrador de orden de compra",
    limits: { max_amount: 5000 },
    handler: "sheets",
    reversible: true,
  },
  
  SUBMIT_PURCHASE_ORDER: {
    level: AutonomyLevel.APPROVAL,
    description: "Enviar orden de compra a proveedor",
    limits: { max_amount: 50000 },
    handler: "webhook",
    reversible: false,
  },
  
  UPDATE_INVENTORY_ALERT: {
    level: AutonomyLevel.AUTO,
    description: "Actualizar alerta de inventario",
    limits: null,
    handler: "sheets",
    reversible: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FRAUDE / AUDITORÍA
  // ═══════════════════════════════════════════════════════════════════════════
  
  FLAG_EMPLOYEE: {
    level: AutonomyLevel.APPROVAL,
    description: "Marcar empleado para auditoría",
    limits: null,
    handler: "internal",
    reversible: true,
  },
  
  SUSPEND_EMPLOYEE_ACCESS: {
    level: AutonomyLevel.CRITICAL,
    description: "Suspender acceso de empleado",
    limits: null,
    handler: "buk",
    reversible: true,
    requires_2fa: true,
  },
  
  BLOCK_POS_USER: {
    level: AutonomyLevel.CRITICAL,
    description: "Bloquear usuario en POS",
    limits: null,
    handler: "pos",
    reversible: true,
    requires_2fa: true,
  },
  
  INITIATE_INVESTIGATION: {
    level: AutonomyLevel.APPROVAL,
    description: "Iniciar investigación formal",
    limits: null,
    handler: "internal",
    reversible: false,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIGURACIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  
  UPDATE_CONFIG: {
    level: AutonomyLevel.APPROVAL,
    description: "Actualizar configuración del sistema",
    limits: null,
    handler: "sheets",
    reversible: true,
  },
  
  UPDATE_PRODUCT_AVAILABILITY: {
    level: AutonomyLevel.DRAFT,
    description: "Actualizar disponibilidad de producto",
    limits: null,
    handler: "woocommerce",
    reversible: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASOS
  // ═══════════════════════════════════════════════════════════════════════════
  
  CREATE_CASE: {
    level: AutonomyLevel.AUTO,
    description: "Crear caso de investigación",
    limits: { max_per_hour: 10 },
    handler: "internal",
    reversible: true,
  },
  
  CLOSE_CASE: {
    level: AutonomyLevel.DRAFT,
    description: "Cerrar caso de investigación",
    limits: null,
    handler: "internal",
    reversible: true,
  },
  
  ESCALATE_CASE: {
    level: AutonomyLevel.AUTO,
    description: "Escalar caso a nivel superior",
    limits: { max_per_day: 10 },
    handler: "internal",
    reversible: true,
  },
};

/**
 * Obtiene la configuración de una acción
 */
export function getActionConfig(actionType) {
  return AutonomyConfig[actionType] || null;
}

/**
 * Determina el nivel de autonomía para una acción
 */
export function getAutonomyLevel(actionType) {
  const config = AutonomyConfig[actionType];
  return config?.level || AutonomyLevel.APPROVAL; // Default a APPROVAL si no está configurado
}

/**
 * Verifica si una acción puede ejecutarse automáticamente
 */
export function canAutoExecute(actionType) {
  const level = getAutonomyLevel(actionType);
  return level === AutonomyLevel.AUTO;
}

/**
 * Verifica si una acción requiere 2FA
 */
export function requires2FA(actionType) {
  const config = AutonomyConfig[actionType];
  return config?.requires_2fa === true;
}

/**
 * Verifica si una acción es reversible
 */
export function isReversible(actionType) {
  const config = AutonomyConfig[actionType];
  return config?.reversible === true;
}

/**
 * Verifica límites de una acción
 */
export async function checkLimits(actionType, context = {}) {
  const config = AutonomyConfig[actionType];
  
  if (!config?.limits) {
    return { allowed: true };
  }

  // TODO: Implementar verificación real contra Redis/DB
  // Por ahora, siempre permitir
  return { allowed: true };
}

/**
 * Obtiene el handler para una acción
 */
export function getHandler(actionType) {
  const config = AutonomyConfig[actionType];
  return config?.handler || "internal";
}

/**
 * Lista todas las acciones disponibles
 */
export function listActions() {
  return Object.entries(AutonomyConfig).map(([type, config]) => ({
    type,
    ...config,
  }));
}

/**
 * Lista acciones por nivel de autonomía
 */
export function listActionsByLevel(level) {
  return Object.entries(AutonomyConfig)
    .filter(([_, config]) => config.level === level)
    .map(([type, config]) => ({
      type,
      ...config,
    }));
}

export default {
  AutonomyLevel,
  AutonomyConfig,
  getActionConfig,
  getAutonomyLevel,
  canAutoExecute,
  requires2FA,
  isReversible,
  checkLimits,
  getHandler,
  listActions,
  listActionsByLevel,
};
