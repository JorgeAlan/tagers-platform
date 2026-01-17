/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHATSAPP TEMPLATES - Templates Pre-aprobados por Meta
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Estos templates deben ser creados y aprobados en Meta Business Manager
 * antes de poder usarse. El nombre debe coincidir exactamente.
 * 
 * Proceso:
 * 1. Crear template en Meta Business Manager
 * 2. Esperar aprobación (24-48h)
 * 3. Usar el nombre exacto del template aquí
 */

/**
 * Templates disponibles para LUCA
 */
export const Templates = {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ALERTAS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Alerta crítica - requiere acción inmediata
   * Variables: {{1}} = título, {{2}} = descripción, {{3}} = sucursal
   */
  ALERT_CRITICAL: {
    name: "luca_alerta_critica",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "🚨 ALERTA CRÍTICA",
      },
      {
        type: "BODY",
        text: "{{1}}\n\n{{2}}\n\n📍 Sucursal: {{3}}",
      },
      {
        type: "FOOTER",
        text: "LUCA Control Tower",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Ver detalles" },
          { type: "QUICK_REPLY", text: "Atendido" },
        ],
      },
    ],
  },

  /**
   * Alerta alta prioridad
   */
  ALERT_HIGH: {
    name: "luca_alerta_alta",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "⚠️ Alerta Alta Prioridad",
      },
      {
        type: "BODY",
        text: "{{1}}\n\n{{2}}\n\n📍 {{3}}",
      },
      {
        type: "FOOTER",
        text: "LUCA Control Tower",
      },
    ],
  },

  /**
   * Alerta informativa
   */
  ALERT_INFO: {
    name: "luca_alerta_info",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "ℹ️ *{{1}}*\n\n{{2}}",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MORNING BRIEFING
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Morning Briefing completo
   * Variables: {{1}} = nombre, {{2}} = fecha, {{3}} = contenido
   */
  MORNING_BRIEFING: {
    name: "luca_morning_briefing",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "☀️ Buenos días, {{1}}",
      },
      {
        type: "BODY",
        text: "📅 {{2}}\n\n{{3}}",
      },
      {
        type: "FOOTER",
        text: "LUCA - Tu briefing del día",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Ver detalles" },
          { type: "QUICK_REPLY", text: "OK, gracias" },
        ],
      },
    ],
  },

  /**
   * Morning Briefing - solo titulares
   */
  MORNING_HEADLINES: {
    name: "luca_morning_headlines",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "☀️ Buenos días {{1}}\n\n📊 *Ayer:* {{2}}\n\n{{3}}\n\n_LUCA_",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ACCIONES Y APROBACIONES
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Solicitud de aprobación
   */
  APPROVAL_REQUEST: {
    name: "luca_aprobacion",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "📋 Solicitud de Aprobación",
      },
      {
        type: "BODY",
        text: "*{{1}}*\n\n{{2}}\n\n🏢 Caso: {{3}}\n⚠️ Severidad: {{4}}",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "✅ Aprobar" },
          { type: "QUICK_REPLY", text: "❌ Rechazar" },
          { type: "QUICK_REPLY", text: "Ver caso" },
        ],
      },
    ],
  },

  /**
   * Confirmación de acción ejecutada
   */
  ACTION_EXECUTED: {
    name: "luca_accion_ejecutada",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "✅ *Acción ejecutada*\n\n{{1}}\n\nCaso: {{2}}\nEjecutado: {{3}}",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CASOS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Nuevo caso creado
   */
  CASE_CREATED: {
    name: "luca_caso_nuevo",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "📁 Nuevo Caso",
      },
      {
        type: "BODY",
        text: "*{{1}}*\n\n{{2}}\n\n🏢 Sucursal: {{3}}\n⚠️ Severidad: {{4}}",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Ver caso" },
          { type: "QUICK_REPLY", text: "Asignarme" },
        ],
      },
    ],
  },

  /**
   * Actualización de caso
   */
  CASE_UPDATE: {
    name: "luca_caso_actualizacion",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "BODY",
        text: "📋 *Actualización de Caso*\n\n{{1}}\n\nEstado: {{2}} → {{3}}\n\n{{4}}",
      },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // FRAUDE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Alerta de fraude
   */
  FRAUD_ALERT: {
    name: "luca_alerta_fraude",
    language: "es_MX",
    category: "UTILITY",
    components: [
      {
        type: "HEADER",
        format: "TEXT",
        text: "🔍 Posible Fraude Detectado",
      },
      {
        type: "BODY",
        text: "*{{1}}*\n\n{{2}}\n\n📍 Sucursal: {{3}}\n👤 Empleado: {{4}}\n📊 Confianza: {{5}}%",
      },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Ver expediente" },
          { type: "QUICK_REPLY", text: "Investigar" },
        ],
      },
    ],
  },
};

/**
 * Construye los componentes para un template
 */
export function buildTemplateComponents(templateId, variables = []) {
  const template = Templates[templateId];
  if (!template) {
    throw new Error(`Template not found: ${templateId}`);
  }
  
  const components = [];
  
  // Agregar variables al BODY
  if (variables.length > 0) {
    components.push({
      type: "body",
      parameters: variables.map(v => ({
        type: "text",
        text: String(v),
      })),
    });
  }
  
  return components;
}

/**
 * Obtiene el nombre del template en Meta
 */
export function getTemplateName(templateId) {
  const template = Templates[templateId];
  return template?.name || null;
}

/**
 * Lista todos los templates disponibles
 */
export function listTemplates() {
  return Object.entries(Templates).map(([id, template]) => ({
    id,
    name: template.name,
    language: template.language,
    category: template.category,
    hasButtons: template.components.some(c => c.type === "BUTTONS"),
  }));
}

export default Templates;
