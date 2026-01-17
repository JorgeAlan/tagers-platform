/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INTENTS - Manejadores de Intenciones Conversacionales
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cada intent detecta y maneja un tipo específico de pregunta/comando:
 * 
 * - statusIntent    → "¿Cómo vamos?" / "¿Cómo estamos?"
 * - branchIntent    → "¿Qué pasa en Zavaleta?" / "¿Cómo va Angelópolis?"
 * - alertsIntent    → "¿Hay alertas?" / "¿Qué alertas tenemos?"
 * - actionIntent    → "Aprueba la PO" / "Confirma el turno"
 * - helpIntent      → "¿Qué puedes hacer?" / "Ayuda"
 */

import { logger } from "@tagers/shared";

/**
 * Base Intent Class
 */
export class BaseIntent {
  constructor(name, patterns) {
    this.name = name;
    this.patterns = patterns;
    this.priority = 0;
  }

  /**
   * Verifica si el mensaje coincide con este intent
   */
  matches(message) {
    const text = message.toLowerCase();
    return this.patterns.some(pattern => {
      if (pattern instanceof RegExp) {
        return pattern.test(text);
      }
      return text.includes(pattern.toLowerCase());
    });
  }

  /**
   * Calcula confianza del match (0-1)
   */
  confidence(message) {
    const text = message.toLowerCase();
    let maxConf = 0;
    
    for (const pattern of this.patterns) {
      if (pattern instanceof RegExp) {
        if (pattern.test(text)) {
          maxConf = Math.max(maxConf, 0.9);
        }
      } else if (text.includes(pattern.toLowerCase())) {
        // Más confianza si es match exacto vs parcial
        const ratio = pattern.length / text.length;
        maxConf = Math.max(maxConf, 0.5 + ratio * 0.4);
      }
    }
    
    return maxConf;
  }

  /**
   * Extrae parámetros del mensaje
   */
  extractParams(message, context) {
    return {};
  }

  /**
   * Ejecuta la acción del intent
   */
  async execute(message, context, params) {
    throw new Error("execute() must be implemented");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATUS INTENT - "¿Cómo vamos?"
// ═══════════════════════════════════════════════════════════════════════════

export class StatusIntent extends BaseIntent {
  constructor() {
    super("status", [
      /cómo (vamos|estamos|andamos|va todo)/i,
      /qué tal (vamos|estamos)/i,
      /cómo (va|está) (el negocio|la cosa|todo)/i,
      /resumen/i,
      /status/i,
      /briefing/i,
      "dame el resumen",
      "qué hay de nuevo",
    ]);
    this.priority = 10;
  }

  async execute(message, context, params) {
    // Obtener resumen de ventas y alertas
    const summary = await this.getSummary();
    
    return {
      text: this.formatResponse(summary),
      data: summary,
      followUp: "¿Quieres más detalles de alguna sucursal?",
    };
  }

  async getSummary() {
    // TODO: Obtener de servicios reales
    return {
      salesYesterday: 487520,
      vsGoal: 8,
      topBranch: "Angelópolis",
      bottomBranch: "San Ángel",
      alertCount: 2,
      pendingApprovals: 1,
    };
  }

  formatResponse(summary) {
    const parts = [];
    
    // Ventas
    if (summary.vsGoal > 0) {
      parts.push(`Ayer cerramos en $${summary.salesYesterday.toLocaleString()}, ${summary.vsGoal}% arriba de la meta. 📈`);
    } else {
      parts.push(`Ayer cerramos en $${summary.salesYesterday.toLocaleString()}, ${Math.abs(summary.vsGoal)}% abajo de la meta. 📉`);
    }

    // Destacados
    parts.push(`Mejor: ${summary.topBranch}. Atención: ${summary.bottomBranch}.`);

    // Alertas
    if (summary.alertCount > 0) {
      parts.push(`Tienes ${summary.alertCount} alertas activas.`);
    } else {
      parts.push("Sin alertas pendientes. ✅");
    }

    // Aprobaciones
    if (summary.pendingApprovals > 0) {
      parts.push(`${summary.pendingApprovals} acción(es) esperando tu aprobación.`);
    }

    return parts.join("\n\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// BRANCH INTENT - "¿Qué pasa en Zavaleta?"
// ═══════════════════════════════════════════════════════════════════════════

export class BranchIntent extends BaseIntent {
  constructor() {
    super("branch", [
      /qué (pasa|hay|sucede) en (\w+)/i,
      /cómo (va|está|anda) (\w+)/i,
      /(\w+) cómo (va|está)/i,
      /dame (el |los )?dato(s)? de (\w+)/i,
      /detalles? de (\w+)/i,
    ]);
    this.priority = 8;

    this.branchNames = [
      "angelópolis", "san ángel", "coyoacán", 
      "polanco", "condesa", "roma", "zavaleta"
    ];
  }

  extractParams(message, context) {
    const text = message.toLowerCase();
    
    // Buscar nombre de sucursal
    for (const branch of this.branchNames) {
      if (text.includes(branch)) {
        return { branch };
      }
    }

    // Si no se encontró, usar la última mencionada en contexto
    const lastBranch = context.getLastBranch();
    if (lastBranch) {
      return { branch: lastBranch };
    }

    return { branch: null };
  }

  async execute(message, context, params) {
    if (!params.branch) {
      return {
        text: "¿De qué sucursal quieres saber? Tenemos: Angelópolis, San Ángel, Coyoacán, Polanco, Condesa, Roma y Zavaleta.",
        needsInput: true,
        inputType: "branch",
      };
    }

    // Guardar en contexto
    context.entities.branches.push(params.branch);

    // Obtener datos de la sucursal
    const branchData = await this.getBranchData(params.branch);

    return {
      text: this.formatResponse(params.branch, branchData),
      data: branchData,
    };
  }

  async getBranchData(branchName) {
    // TODO: Obtener de Redshift/servicios reales
    return {
      salesYesterday: 85000,
      vsGoal: -5,
      topProduct: "Café Americano",
      transactions: 156,
      avgTicket: 545,
      alerts: 1,
    };
  }

  formatResponse(branch, data) {
    const branchTitle = branch.charAt(0).toUpperCase() + branch.slice(1);
    
    const parts = [
      `📍 *${branchTitle}*`,
      "",
      `Ventas ayer: $${data.salesYesterday.toLocaleString()} (${data.vsGoal > 0 ? "+" : ""}${data.vsGoal}% vs meta)`,
      `Transacciones: ${data.transactions}`,
      `Ticket promedio: $${data.avgTicket}`,
      `Producto estrella: ${data.topProduct}`,
    ];

    if (data.alerts > 0) {
      parts.push("");
      parts.push(`⚠️ ${data.alerts} alerta(s) activa(s)`);
    }

    return parts.join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ALERTS INTENT - "¿Hay alertas?"
// ═══════════════════════════════════════════════════════════════════════════

export class AlertsIntent extends BaseIntent {
  constructor() {
    super("alerts", [
      /hay alertas/i,
      /qué alertas (hay|tenemos|tengo)/i,
      /alertas (pendientes|activas)/i,
      /muéstrame (las )?alertas/i,
      /dame (las )?alertas/i,
      /problemas/i,
    ]);
    this.priority = 9;
  }

  async execute(message, context, params) {
    const alerts = await this.getAlerts();

    if (alerts.length === 0) {
      return {
        text: "✅ No tienes alertas activas. Todo tranquilo.",
        data: { alerts: [] },
      };
    }

    return {
      text: this.formatResponse(alerts),
      data: { alerts },
      followUp: "¿Quieres ver detalles de alguna?",
    };
  }

  async getAlerts() {
    // TODO: Obtener de servicios reales
    return [
      {
        id: "ALT001",
        severity: "CRITICAL",
        type: "Posible fraude",
        branch: "Zavaleta",
        description: "Patrón de cancelaciones sospechosas",
      },
      {
        id: "ALT002",
        severity: "MEDIUM",
        type: "Caída en ventas",
        branch: "San Ángel",
        description: "-12% vs meta",
      },
    ];
  }

  formatResponse(alerts) {
    const parts = [`📢 Tienes ${alerts.length} alerta(s) activa(s):`];

    for (const alert of alerts) {
      const emoji = alert.severity === "CRITICAL" ? "🔴" : 
                    alert.severity === "HIGH" ? "🟠" : "🟡";
      parts.push("");
      parts.push(`${emoji} *${alert.type}* en ${alert.branch}`);
      parts.push(`   ${alert.description}`);
    }

    return parts.join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTION INTENT - "Aprueba la PO" / "Confirma"
// ═══════════════════════════════════════════════════════════════════════════

export class ActionIntent extends BaseIntent {
  constructor() {
    super("action", [
      /aprueba/i,
      /aprobar/i,
      /confirma/i,
      /confirmar/i,
      /rechaza/i,
      /rechazar/i,
      /cancela/i,
      /cancelar/i,
      /acepta/i,
      /aceptar/i,
    ]);
    this.priority = 15; // Alta prioridad
  }

  extractParams(message, context) {
    const text = message.toLowerCase();
    
    let action = null;
    if (/aprueba|aprobar|confirma|confirmar|acepta|aceptar|sí|si\b|ok|dale/i.test(text)) {
      action = "approve";
    } else if (/rechaza|rechazar|cancela|cancelar|no\b/i.test(text)) {
      action = "reject";
    }

    // Buscar ID de acción
    const idMatch = text.match(/(?:po|acción|orden|turno)?\s*#?(\w{3,10})/i);
    const actionId = idMatch ? idMatch[1] : null;

    return { action, actionId };
  }

  async execute(message, context, params) {
    // Si hay un flujo de aprobación activo, usar ese contexto
    if (context.hasActiveFlow() && context.flow.current === "approval") {
      return this.handleApprovalFlow(params.action, context);
    }

    // Si no hay acción clara
    if (!params.action) {
      return {
        text: "¿Qué acción quieres tomar? ¿Aprobar o rechazar?",
        needsInput: true,
        inputType: "action",
      };
    }

    // Obtener acciones pendientes
    const pendingActions = await this.getPendingActions();

    if (pendingActions.length === 0) {
      return {
        text: "No tienes acciones pendientes de aprobación.",
      };
    }

    if (pendingActions.length === 1) {
      // Solo hay una, preguntar confirmación
      const action = pendingActions[0];
      context.startFlow("approval", { actionId: action.id, actionType: action.type });
      
      return {
        text: `${params.action === "approve" ? "Aprobar" : "Rechazar"}: *${action.description}*\n\n¿Confirmas?`,
        needsInput: true,
        inputType: "confirmation",
      };
    }

    // Hay varias, mostrar lista
    return {
      text: this.formatPendingActions(pendingActions),
      followUp: "¿Cuál quieres aprobar o rechazar?",
    };
  }

  async handleApprovalFlow(action, context) {
    const { actionId } = context.flow.data;
    
    if (!action || action === "approve") {
      // Ejecutar aprobación
      const result = await this.executeApproval(actionId);
      context.endFlow();
      
      return {
        text: result.success 
          ? "✅ Aprobado. La acción se ejecutará." 
          : `❌ Error: ${result.error}`,
        data: result,
      };
    } else {
      // Rechazar
      context.endFlow();
      return {
        text: "❌ Rechazado.",
      };
    }
  }

  async getPendingActions() {
    // TODO: Obtener de ActionBus
    return [
      {
        id: "ACT001",
        type: "PO",
        description: "Orden de compra para café (Proveedor X)",
        amount: 15000,
      },
    ];
  }

  async executeApproval(actionId) {
    // TODO: Llamar a ActionBus.approve()
    return { success: true, actionId };
  }

  formatPendingActions(actions) {
    const parts = [`Tienes ${actions.length} acción(es) pendiente(s):`];

    for (const action of actions) {
      parts.push("");
      parts.push(`• *${action.type}*: ${action.description}`);
      if (action.amount) {
        parts.push(`  Monto: $${action.amount.toLocaleString()}`);
      }
    }

    return parts.join("\n");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELP INTENT - "¿Qué puedes hacer?"
// ═══════════════════════════════════════════════════════════════════════════

export class HelpIntent extends BaseIntent {
  constructor() {
    super("help", [
      /qué puedes hacer/i,
      /ayuda/i,
      /help/i,
      /cómo funciona/i,
      /comandos/i,
      /qué sabes hacer/i,
    ]);
    this.priority = 5;
  }

  async execute(message, context, params) {
    return {
      text: `🦑 *Soy LUCA, tu asistente de inteligencia de negocio.*

Puedes preguntarme:

📊 *Estado general*
"¿Cómo vamos?" • "Dame el resumen"

📍 *Por sucursal*
"¿Cómo va Zavaleta?" • "Detalles de Angelópolis"

🚨 *Alertas*
"¿Hay alertas?" • "¿Qué problemas hay?"

✅ *Aprobaciones*
"Aprueba la PO" • "Rechaza la acción"

🎙️ *Audio briefing*
"Mándame el audio" • "Briefing de audio"

¡Pregúntame lo que necesites!`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// INTENT REGISTRY
// ═══════════════════════════════════════════════════════════════════════════

export const intents = [
  new StatusIntent(),
  new BranchIntent(),
  new AlertsIntent(),
  new ActionIntent(),
  new HelpIntent(),
];

/**
 * Detecta el intent más probable para un mensaje
 */
export function detectIntent(message) {
  let bestIntent = null;
  let bestConfidence = 0;

  for (const intent of intents) {
    if (intent.matches(message)) {
      const conf = intent.confidence(message);
      // Considerar prioridad
      const adjustedConf = conf + (intent.priority / 100);
      
      if (adjustedConf > bestConfidence) {
        bestConfidence = adjustedConf;
        bestIntent = intent;
      }
    }
  }

  return {
    intent: bestIntent,
    confidence: Math.min(bestConfidence, 1),
  };
}

export default { intents, detectIntent };
