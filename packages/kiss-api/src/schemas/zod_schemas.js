/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TAGERS KISS API - ZOD SCHEMAS (SOTA Architecture)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Esquemas Zod para OpenAI Structured Outputs con:
 * - openai.beta.chat.completions.parse()
 * - zodResponseFormat() helper nativo
 * 
 * IMPORTANTE: Cada campo tiene .describe() detallado para que los modelos
 * GPT-5 Nano/Mini entiendan el contexto semántico sin ambigüedad.
 * 
 * @version 2.0.0 - SOTA Structured Outputs + GPT-5 Family
 * @author Tagers Development Team
 */

import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════
// 1. CHATWOOT INTENT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Router inicial: clasifica la intención del mensaje del cliente

export const ChatwootIntentSchema = z.object({
  intent: z.enum([
    "PHYSICAL_CHECK",
    "LOST_ITEM_REPORT", 
    "AMENITY_CHECK",
    "TOURISM_ADVICE",
    "SENTIMENT_CRISIS",
    "ORDER_CREATE",
    "ORDER_STATUS",
    "ORDER_MODIFY",
    "CAREERS",
    "SUPPLIER_INQUIRY",
    "ALLIANCES_INQUIRY",
    "RESERVATION_LINK",
    "GENERAL_INFO",
    "OTHER"
  ]).describe("Intención principal del mensaje. PHYSICAL_CHECK=estado tiempo real, ORDER_CREATE=nuevo pedido, SENTIMENT_CRISIS=queja urgente, GENERAL_INFO=saludos/conversación casual"),

  branch_id: z.string()
    .nullable()
    .describe("ID de sucursal mencionada o inferida (ej: SAN_ANGEL, SONATA, ANGELOPOLIS). null si no se menciona. Las sucursales disponibles se cargan dinámicamente desde Config Hub"),

  branch_confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en la detección de sucursal. 0.0=no mencionada, 1.0=explícitamente nombrada"),

  query_category: z.enum([
    "weather",
    "occupancy", 
    "noise_level",
    "pet_area_status",
    "kids_area_status",
    "parking",
    "table_availability",
    "lost_item",
    "amenities",
    "tourism",
    "crisis",
    "order",
    "careers",
    "lead",
    "other"
  ]).describe("Categoría específica de la consulta para routing interno"),

  needs_clarification: z.boolean()
    .describe("true si falta información crítica (ej: sucursal para PHYSICAL_CHECK). false para saludos o preguntas generales"),

  clarification_question: z.string()
    .nullable()
    .describe("Pregunta para obtener el dato faltante. null si needs_clarification=false"),

  customer_wait_message: z.string()
    .max(200)
    .describe("Mensaje corto para el cliente mientras se procesa su solicitud. Máximo 200 caracteres"),

  staff_prompt: z.string()
    .nullable()
    .describe("Instrucción interna para el agente humano si se requiere escalación"),

  customer_direct_answer: z.string()
    .nullable()
    .describe("Respuesta directa al cliente si la pregunta puede responderse inmediatamente sin consultar sistemas externos"),

  reservation_link: z.string()
    .nullable()
    .describe("URL de reservación si intent=RESERVATION_LINK"),

  adhoc_object_description: z.string()
    .nullable()
    .describe("Descripción del objeto perdido si intent=LOST_ITEM_REPORT"),

  order_context: z.object({
    order_id: z.number().optional().describe("ID del pedido si se menciona"),
    product_query: z.string().optional().describe("Producto mencionado en la consulta")
  }).nullable().describe("Contexto extraído para flujos de pedido"),

  lead_context: z.object({
    company_name: z.string().optional().describe("Nombre de la empresa del lead"),
    contact_name: z.string().optional().describe("Nombre del contacto"),
    inquiry_type: z.enum(["supplier", "alliance", "wholesale"]).optional()
  }).nullable().describe("Contexto para leads B2B (proveedores, alianzas)")
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. ORDER STEP CLASSIFIER SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Slot-filling para el flujo de pedidos de rosca

export const OrderStepSchema = z.object({
  intent: z.enum([
    "select",
    "change", 
    "confirm",
    "ask_options",
    "cancel",
    "unknown"
  ]).describe("Acción que quiere realizar el cliente. select=elegir opción, change=modificar algo del pedido, confirm=aceptar el pedido, ask_options=pedir ver opciones, cancel=cancelar todo"),

  confirm_answer: z.enum([
    "yes",
    "no",
    "unknown"
  ]).describe("Respuesta a pregunta de confirmación. yes='sí/correcto/dale', no='no/otro/cambia', unknown=no aplica o ambiguo"),

  change_target: z.enum([
    "product",
    "branch",
    "date", 
    "quantity"
  ]).nullable().describe("Qué quiere cambiar el cliente si intent=change. null si no aplica"),

  selection_number: z.number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .describe("Número de opción seleccionada si el cliente dice '1', 'la primera', 'opción 2', etc. null si no selecciona número"),

  product_text: z.string()
    .nullable()
    .describe("Texto del producto mencionado tal como lo escribió el cliente. Ej: 'rosca de nutella', 'la clásica'"),

  branch_text: z.string()
    .nullable()
    .describe("Texto de sucursal mencionada. Ej: 'Sonata', 'la de Angelópolis'"),

  date_text: z.string()
    .nullable()
    .describe("Texto de fecha mencionada. Ej: 'mañana', 'el 6 de enero', 'para el sábado'"),

  quantity: z.number()
    .int()
    .min(1)
    .max(50)
    .nullable()
    .describe("Cantidad de roscas si se menciona explícitamente. null si no se menciona"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en la clasificación. <0.6 sugiere pedir clarificación"),

  notes: z.string()
    .max(200)
    .describe("Breve explicación del razonamiento de clasificación para debugging")
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. FLOW CONTROL CLASSIFIER SCHEMA  
// ═══════════════════════════════════════════════════════════════════════════
// Detecta cambios de flujo, cancelaciones, solicitudes de humano

export const FlowControlSchema = z.object({
  action: z.enum([
    "continue",
    "switch_flow",
    "cancel_flow",
    "handoff_human",
    "restart"
  ]).describe("continue=seguir en flujo actual, switch_flow=cambiar a otro flujo, cancel_flow=cancelar todo, handoff_human=pasar a agente humano, restart=empezar de nuevo"),

  target_flow: z.enum([
    "ORDER_CREATE",
    "ORDER_STATUS", 
    "ORDER_MODIFY",
    "GENERAL_INFO",
    "RESERVATION",
    "SUPPORT"
  ]).nullable().describe("Flujo destino si action=switch_flow. null para otras acciones"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en la detección. Umbral para switch_flow: 0.65, para cancel_flow: 0.7"),

  reasoning: z.string()
    .max(150)
    .describe("Explicación breve de por qué se detectó esta acción")
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. SENTIMENT ANALYSIS SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Semáforo de sentimiento para escalación

export const SentimentSchema = z.object({
  sentiment: z.enum([
    "POSITIVE",
    "NEUTRAL", 
    "NEGATIVE_LOW",
    "NEGATIVE_HIGH"
  ]).describe("POSITIVE=cliente contento, NEUTRAL=normal, NEGATIVE_LOW=molesto pero manejable, NEGATIVE_HIGH=muy enojado/urgente"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en la clasificación de sentimiento"),

  signals: z.array(z.string())
    .max(8)
    .describe("Lista de palabras/frases clave que indican el sentimiento. Ej: ['molesto', 'ya esperé mucho', 'pésimo servicio']"),

  recommended_action: z.enum([
    "NORMAL",
    "ESCALATE_MANAGER",
    "ASK_BRANCH",
    "OFFER_CALLBACK"
  ]).describe("NORMAL=continuar, ESCALATE_MANAGER=pasar a gerente, ASK_BRANCH=preguntar sucursal para escalar, OFFER_CALLBACK=ofrecer que le llamen"),

  notes: z.string()
    .max(300)
    .nullable()
    .describe("Contexto adicional sobre el estado emocional del cliente")
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. TANIA REPLY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Respuesta generada por Ana/Tania al cliente

export const TaniaReplySchema = z.object({
  customer_message: z.string()
    .min(1)
    .max(1800)
    .describe("Mensaje para enviar al cliente. Tono amigable, profesional, máximo 1800 caracteres"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en que esta respuesta resuelve la consulta del cliente"),

  used_promo: z.boolean()
    .describe("true si la respuesta incluye información promocional o de temporada"),

  recommended_branches: z.array(z.object({
    branch_id: z.string().describe("ID de la sucursal recomendada"),
    reason: z.string().max(140).nullable().describe("Razón de la recomendación")
  })).max(3).describe("Sucursales recomendadas basadas en la consulta (máximo 3)")
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. HITL CUSTOMER REPLY SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Human-in-the-loop: respuesta asistida

export const HitlCustomerReplySchema = z.object({
  reply_text: z.string()
    .min(1)
    .max(2000)
    .describe("Texto de respuesta para el cliente"),

  sentiment_detected: z.enum([
    "positive",
    "neutral", 
    "negative"
  ]).describe("Sentimiento detectado en el mensaje original del cliente"),

  needs_escalation: z.boolean()
    .describe("true si el caso requiere atención de un supervisor"),

  suggested_actions: z.array(z.string())
    .max(5)
    .describe("Acciones sugeridas para el agente humano"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en la respuesta generada")
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. INCIDENT REPORT SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Reporte de incidentes para logging

export const IncidentReportSchema = z.object({
  incident_type: z.enum([
    "complaint",
    "technical_issue",
    "order_problem",
    "service_failure",
    "safety_concern",
    "other"
  ]).describe("Tipo de incidente detectado"),

  severity: z.enum([
    "low",
    "medium", 
    "high",
    "critical"
  ]).describe("Severidad del incidente"),

  summary: z.string()
    .max(500)
    .describe("Resumen del incidente"),

  affected_branch: z.string()
    .nullable()
    .describe("Sucursal afectada si aplica"),

  customer_impact: z.string()
    .max(200)
    .describe("Impacto en el cliente"),

  recommended_resolution: z.string()
    .max(300)
    .describe("Resolución sugerida"),

  requires_followup: z.boolean()
    .describe("true si requiere seguimiento posterior")
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. CONVERSATION ANALYSIS SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Análisis de conversación completa

export const ConversationAnalysisSchema = z.object({
  conversation_summary: z.string()
    .max(500)
    .describe("Resumen de la conversación"),

  customer_intents: z.array(z.string())
    .max(5)
    .describe("Intenciones identificadas del cliente durante la conversación"),

  resolution_status: z.enum([
    "resolved",
    "partially_resolved",
    "unresolved",
    "escalated"
  ]).describe("Estado de resolución de la conversación"),

  customer_satisfaction_estimate: z.enum([
    "satisfied",
    "neutral",
    "dissatisfied"
  ]).describe("Estimación de satisfacción del cliente"),

  key_topics: z.array(z.string())
    .max(5)
    .describe("Temas principales discutidos"),

  improvement_suggestions: z.array(z.string())
    .max(3)
    .describe("Sugerencias para mejorar futuras interacciones")
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. RESPONSE VALIDATION SCHEMA
// ═══════════════════════════════════════════════════════════════════════════
// Validación de calidad de respuesta antes de enviar

export const ResponseValidationSchema = z.object({
  quality_checks: z.object({
    answers_question: z.boolean().describe("¿La respuesta contesta lo que el cliente preguntó?"),
    includes_required_info: z.boolean().describe("¿Incluye toda la información necesaria?"),
    appropriate_tone: z.boolean().describe("¿El tono es apropiado para el estado emocional del cliente?"),
    not_repetitive: z.boolean().describe("¿Es diferente a respuestas anteriores que fallaron?"),
    clear_next_step: z.boolean().describe("¿Queda claro qué debe hacer el cliente ahora?")
  }).describe("Checklist de calidad de la respuesta"),

  issues_found: z.array(z.object({
    issue_type: z.enum([
      "missing_list",
      "missing_apology",
      "too_vague",
      "wrong_tone",
      "repeating_failure",
      "too_many_questions",
      "missing_info",
      "missing_proactive_close",
      "missing_alt_date_option"
    ]).describe("Tipo de problema"),
    description: z.string().max(200).describe("Descripción del problema"),
    severity: z.enum(["low", "medium", "high"]).describe("Severidad")
  })).max(5).describe("Problemas encontrados en la respuesta"),

  verdict: z.enum([
    "approve",
    "needs_revision",
    "reject"
  ]).describe("Decisión final sobre la respuesta"),

  revision_instructions: z.string()
    .max(500)
    .nullable()
    .describe("Instrucciones de revisión si verdict=needs_revision"),

  confidence: z.number()
    .min(0)
    .max(1)
    .describe("Confianza en que esta respuesta resolverá el problema del cliente")
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTACIONES AGRUPADAS
// ═══════════════════════════════════════════════════════════════════════════

export const ZodSchemas = {
  chatwoot_intent: ChatwootIntentSchema,
  order_step_classifier: OrderStepSchema,
  flow_control_classifier: FlowControlSchema,
  sentiment_result: SentimentSchema,
  tania_reply: TaniaReplySchema,
  hitl_customer_reply: HitlCustomerReplySchema,
  incident_report: IncidentReportSchema,
  conversation_analysis: ConversationAnalysisSchema,
  response_validation: ResponseValidationSchema,
};

export default ZodSchemas;
