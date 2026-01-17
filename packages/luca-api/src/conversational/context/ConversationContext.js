/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONVERSATION CONTEXT - Mantiene Contexto de Conversación
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Mantiene el estado y contexto de conversaciones con usuarios:
 * - Historial de mensajes recientes
 * - Entidades mencionadas (sucursales, empleados, fechas)
 * - Estado de flujos en progreso
 * - Preferencias del usuario
 */

import { logger } from "@tagers/shared";

/**
 * TTL de contextos (30 minutos)
 */
const CONTEXT_TTL_MS = 30 * 60 * 1000;

/**
 * Máximo de mensajes en historial
 */
const MAX_HISTORY = 10;

/**
 * Store en memoria para contextos
 * En producción, usar Redis
 */
const contextStore = new Map();

export class ConversationContext {
  constructor(userId) {
    this.userId = userId;
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    
    // Historial de mensajes
    this.messages = [];
    
    // Entidades mencionadas
    this.entities = {
      branches: [],      // Sucursales mencionadas
      employees: [],     // Empleados mencionados
      dates: [],         // Fechas mencionadas
      products: [],      // Productos mencionados
      cases: [],         // Casos mencionados
      actions: [],       // Acciones en discusión
    };
    
    // Estado de flujo actual
    this.flow = {
      current: null,     // Flujo activo (approval, query, etc.)
      step: null,        // Paso dentro del flujo
      data: {},          // Datos del flujo
    };
    
    // Última respuesta de LUCA
    this.lastResponse = null;
    
    // Preferencias
    this.preferences = {
      format: "concise",  // concise, detailed
      language: "es",
    };
  }

  /**
   * Añade mensaje al historial
   */
  addMessage(role, content, metadata = {}) {
    this.messages.push({
      role,        // 'user' o 'assistant'
      content,
      timestamp: Date.now(),
      ...metadata,
    });

    // Mantener límite de historial
    if (this.messages.length > MAX_HISTORY) {
      this.messages = this.messages.slice(-MAX_HISTORY);
    }

    this.updatedAt = Date.now();
  }

  /**
   * Extrae y guarda entidades del mensaje
   */
  extractEntities(text) {
    const extracted = {};

    // Detectar sucursales
    const branchPatterns = [
      /(?:sucursal|tienda|local|en)\s+(\w+)/gi,
      /(angelópolis|san ángel|coyoacán|polanco|condesa|roma|zavaleta)/gi,
    ];
    for (const pattern of branchPatterns) {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const branch = match[1].toLowerCase();
        if (!this.entities.branches.includes(branch)) {
          this.entities.branches.push(branch);
        }
        extracted.branch = branch;
      }
    }

    // Detectar fechas relativas
    if (/ayer/i.test(text)) {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      this.entities.dates.push({ ref: "ayer", date: yesterday });
      extracted.date = "yesterday";
    }
    if (/hoy/i.test(text)) {
      this.entities.dates.push({ ref: "hoy", date: new Date() });
      extracted.date = "today";
    }
    if (/semana/i.test(text)) {
      extracted.period = "week";
    }
    if (/mes/i.test(text)) {
      extracted.period = "month";
    }

    // Detectar acciones
    if (/aprueba|aprobar|confirma|confirmar/i.test(text)) {
      extracted.action = "approve";
    }
    if (/rechaza|rechazar|cancela|cancelar/i.test(text)) {
      extracted.action = "reject";
    }
    if (/muestra|mostrar|ver|dame/i.test(text)) {
      extracted.action = "show";
    }

    return extracted;
  }

  /**
   * Obtiene la última sucursal mencionada
   */
  getLastBranch() {
    return this.entities.branches[this.entities.branches.length - 1] || null;
  }

  /**
   * Obtiene el último período mencionado
   */
  getLastPeriod() {
    const dates = this.entities.dates;
    return dates[dates.length - 1] || null;
  }

  /**
   * Inicia un flujo de conversación
   */
  startFlow(flowName, data = {}) {
    this.flow = {
      current: flowName,
      step: "start",
      data,
      startedAt: Date.now(),
    };
    this.updatedAt = Date.now();
  }

  /**
   * Avanza al siguiente paso del flujo
   */
  advanceFlow(step, data = {}) {
    if (!this.flow.current) return;
    
    this.flow.step = step;
    this.flow.data = { ...this.flow.data, ...data };
    this.updatedAt = Date.now();
  }

  /**
   * Termina el flujo actual
   */
  endFlow() {
    const completed = { ...this.flow };
    this.flow = {
      current: null,
      step: null,
      data: {},
    };
    this.updatedAt = Date.now();
    return completed;
  }

  /**
   * Verifica si hay un flujo activo
   */
  hasActiveFlow() {
    return this.flow.current !== null;
  }

  /**
   * Obtiene resumen del contexto para el prompt
   */
  getContextSummary() {
    const summary = [];

    // Mensajes recientes
    if (this.messages.length > 0) {
      const recent = this.messages.slice(-3);
      summary.push(`Últimos mensajes: ${recent.map(m => `${m.role}: "${m.content.substring(0, 50)}..."`).join("; ")}`);
    }

    // Entidades activas
    if (this.entities.branches.length > 0) {
      summary.push(`Sucursales mencionadas: ${this.entities.branches.join(", ")}`);
    }

    // Flujo activo
    if (this.flow.current) {
      summary.push(`Flujo activo: ${this.flow.current} (paso: ${this.flow.step})`);
    }

    return summary.join("\n");
  }

  /**
   * Serializa el contexto
   */
  toJSON() {
    return {
      userId: this.userId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messages: this.messages,
      entities: this.entities,
      flow: this.flow,
      preferences: this.preferences,
    };
  }

  /**
   * Restaura desde JSON
   */
  static fromJSON(data) {
    const ctx = new ConversationContext(data.userId);
    ctx.createdAt = data.createdAt;
    ctx.updatedAt = data.updatedAt;
    ctx.messages = data.messages || [];
    ctx.entities = data.entities || ctx.entities;
    ctx.flow = data.flow || ctx.flow;
    ctx.preferences = data.preferences || ctx.preferences;
    return ctx;
  }
}

/**
 * Gestor de contextos de conversación
 */
export class ContextManager {
  constructor() {
    // Limpiar contextos expirados periódicamente
    setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Obtiene o crea contexto para usuario
   */
  getContext(userId) {
    let context = contextStore.get(userId);
    
    if (!context) {
      context = new ConversationContext(userId);
      contextStore.set(userId, context);
    } else if (Date.now() - context.updatedAt > CONTEXT_TTL_MS) {
      // Contexto expirado, crear nuevo
      context = new ConversationContext(userId);
      contextStore.set(userId, context);
    }
    
    return context;
  }

  /**
   * Guarda contexto
   */
  saveContext(context) {
    contextStore.set(context.userId, context);
  }

  /**
   * Elimina contexto
   */
  deleteContext(userId) {
    contextStore.delete(userId);
  }

  /**
   * Limpia contextos expirados
   */
  cleanup() {
    const now = Date.now();
    let cleaned = 0;
    
    for (const [userId, context] of contextStore.entries()) {
      if (now - context.updatedAt > CONTEXT_TTL_MS) {
        contextStore.delete(userId);
        cleaned++;
      }
    }
    
    if (cleaned > 0) {
      logger.info({ cleaned }, "Cleaned expired conversation contexts");
    }
  }

  /**
   * Obtiene estadísticas
   */
  getStats() {
    return {
      activeContexts: contextStore.size,
      ttlMs: CONTEXT_TTL_MS,
    };
  }
}

// Export singleton
export const contextManager = new ContextManager();

export default { ConversationContext, contextManager };
