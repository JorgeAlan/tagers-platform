/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INSIGHTS ENGINE - Event Catalog v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Catálogo completo de eventos que el sistema puede detectar.
 * Cada evento tiene:
 * - keywords: palabras clave para matching rápido
 * - patterns: regex para matching preciso
 * - entities: qué datos extraer del mensaje
 * 
 * Este catálogo se sincroniza con Google Sheets para permitir
 * edición sin deploy.
 * 
 * @version 1.0.0
 */

export const EVENT_CATEGORIES = {
  order: "Pedidos y órdenes",
  product: "Productos y menú",
  branch: "Sucursales",
  delivery: "Entregas y envíos",
  payment: "Pagos y precios",
  complaint: "Quejas",
  praise: "Elogios",
  service: "Servicio al cliente",
  special: "Eventos especiales",
  operational: "Operacional",
  marketing: "Marketing",
  bot: "Interacción con bot",
  unknown: "Sin clasificar",
};

/**
 * Catálogo maestro de eventos
 * Orden de prioridad: eventos más específicos primero
 */
export const EVENT_CATALOG = [
  // ═══════════════════════════════════════════════════════════════════════════
  // PEDIDOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "order_completed",
    category: "order",
    description: "Pedido confirmado/completado",
    keywords: ["confirmado", "listo", "gracias por tu pedido", "orden lista"],
    patterns: [/pedido.*(confirmado|listo|completado)/i, /orden.*#?\d+/i],
    entities: ["order_id", "total", "products"],
    priority: 100,
  },
  {
    type: "order_started",
    category: "order",
    description: "Cliente inició proceso de pedido",
    keywords: ["quiero pedir", "me das", "dame", "quiero ordenar", "quisiera"],
    patterns: [/quiero\s+(pedir|ordenar|comprar)/i, /(me\s+das?|dame)\s+\d+/i],
    entities: ["products", "quantity"],
    priority: 90,
  },
  {
    type: "order_inquiry",
    category: "order",
    description: "Pregunta sobre hacer pedido",
    keywords: ["puedo pedir", "hacen pedidos", "para llevar", "domicilio", "cómo pido"],
    patterns: [/(puedo|cómo)\s+(pedir|ordenar)/i, /hacen\s+(pedidos|envíos)/i],
    entities: [],
    priority: 80,
  },
  {
    type: "order_status_check",
    category: "order",
    description: "Pregunta estado de pedido",
    keywords: ["mi pedido", "mi orden", "dónde está", "ya está listo", "cuánto falta"],
    patterns: [/(mi|el)\s+(pedido|orden)/i, /dónde\s+está/i, /ya\s+(está|va)/i],
    entities: ["order_id"],
    priority: 85,
  },
  {
    type: "order_modified",
    category: "order",
    description: "Modificación de pedido existente",
    keywords: ["cambiar", "modificar", "agregar", "quitar", "en vez de"],
    patterns: [/(cambiar|modificar|agregar|quitar).*(pedido|orden)/i],
    entities: ["order_id", "changes"],
    priority: 85,
  },
  {
    type: "order_cancelled",
    category: "order",
    description: "Cancelación de pedido",
    keywords: ["cancelar", "ya no quiero", "no lo quiero"],
    patterns: [/cancelar.*(pedido|orden)/i, /ya\s+no\s+(lo\s+)?quiero/i],
    entities: ["order_id", "reason"],
    priority: 90,
  },
  {
    type: "order_abandoned",
    category: "order",
    description: "Pedido no completado (detectado por sistema)",
    keywords: [],
    patterns: [],
    entities: ["step_abandoned", "reason"],
    priority: 0, // Solo se detecta por lógica, no por mensaje
    system_detected: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PRODUCTOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "product_inquiry",
    category: "product",
    description: "Pregunta general sobre producto",
    keywords: ["tienen", "hay", "venden", "manejan"],
    patterns: [/(tienen|hay|venden)\s+\w+/i],
    entities: ["product", "attribute"],
    priority: 70,
  },
  {
    type: "product_price_inquiry",
    category: "product",
    description: "Pregunta por precio",
    keywords: ["cuánto cuesta", "precio", "cuánto es", "a cómo"],
    patterns: [/(cuánto|precio|costo|a cómo).*(cuesta|es|sale)?/i],
    entities: ["product"],
    priority: 75,
  },
  {
    type: "product_availability",
    category: "product",
    description: "Pregunta disponibilidad de producto",
    keywords: ["hay", "tienen", "disponible", "quedó", "todavía hay"],
    patterns: [/(hay|tienen|queda).*(disponible)?/i, /todavía\s+hay/i],
    entities: ["product", "branch"],
    priority: 75,
  },
  {
    type: "product_not_found",
    category: "product",
    description: "Buscó producto que no existe",
    keywords: [],
    patterns: [],
    entities: ["searched_term"],
    priority: 0,
    system_detected: true,
  },
  {
    type: "product_unavailable",
    category: "product",
    description: "Producto agotado",
    keywords: ["no hay", "se acabó", "agotado"],
    patterns: [/(no hay|se acabó|agotado)/i],
    entities: ["product", "branch"],
    priority: 80,
  },
  {
    type: "product_recommendation_request",
    category: "product",
    description: "Pide recomendación de producto",
    keywords: ["recomiendas", "sugieres", "qué me recomiendas", "algo rico", "qué está bueno"],
    patterns: [/(recomiendas?|sugieres?|qué.*(rico|bueno))/i],
    entities: ["occasion", "preferences"],
    priority: 70,
  },
  {
    type: "product_ingredients",
    category: "product",
    description: "Pregunta ingredientes",
    keywords: ["ingredientes", "qué lleva", "qué tiene", "de qué es"],
    patterns: [/(ingredientes|qué\s+lleva|qué\s+tiene|de\s+qué\s+es)/i],
    entities: ["product"],
    priority: 70,
  },
  {
    type: "dietary_restriction",
    category: "product",
    description: "Pregunta por restricciones dietéticas",
    keywords: ["sin gluten", "vegano", "sin azúcar", "sin lactosa", "diabético", "alérgico", "vegetariano"],
    patterns: [/(sin\s+(gluten|azúcar|lactosa)|vegano|vegetariano|diabétic|alérgic)/i],
    entities: ["restriction"],
    priority: 80,
  },
  {
    type: "product_customization",
    category: "product",
    description: "Pide personalización de producto",
    keywords: ["sin", "extra", "más", "menos", "aparte", "cambiar por"],
    patterns: [/(sin|extra|más|menos)\s+\w+/i, /cambiar.+por/i],
    entities: ["product", "customization"],
    priority: 70,
  },
  {
    type: "seasonal_product_inquiry",
    category: "product",
    description: "Pregunta por producto de temporada",
    keywords: ["rosca", "pan de muerto", "navidad", "temporada", "cuándo hay", "ya tienen"],
    patterns: [/(rosca|pan de muerto|navide|temporada)/i, /cuándo\s+(hay|tienen)/i],
    entities: ["product", "season"],
    priority: 75,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUCURSALES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "branch_hours_inquiry",
    category: "branch",
    description: "Pregunta horarios de sucursal",
    keywords: ["horario", "a qué hora", "abren", "cierran", "hasta qué hora"],
    patterns: [/(horario|a qué hora|abren|cierran|hasta qué hora)/i],
    entities: ["branch", "day"],
    priority: 75,
  },
  {
    type: "branch_location_inquiry",
    category: "branch",
    description: "Pregunta ubicación/cómo llegar",
    keywords: ["dónde están", "ubicación", "dirección", "cómo llego", "mapa"],
    patterns: [/(dónde\s+están|ubicación|dirección|cómo\s+llego)/i],
    entities: ["branch"],
    priority: 75,
  },
  {
    type: "branch_amenities_inquiry",
    category: "branch",
    description: "Pregunta servicios de sucursal",
    keywords: ["wifi", "estacionamiento", "terraza", "niños", "mascotas", "privado"],
    patterns: [/(wifi|estacionamiento|terraza|niños|mascotas|privado|área)/i],
    entities: ["branch", "amenity"],
    priority: 70,
  },
  {
    type: "branch_is_open",
    category: "branch",
    description: "Pregunta si está abierto ahora",
    keywords: ["está abierto", "están abiertos", "ya abrieron", "todavía abren"],
    patterns: [/(está[ns]?\s+abiert|ya\s+abrieron|todavía)/i],
    entities: ["branch"],
    priority: 80,
  },
  {
    type: "branch_contact",
    category: "branch",
    description: "Pide teléfono o contacto de sucursal",
    keywords: ["teléfono", "número", "llamar", "contacto"],
    patterns: [/(teléfono|número|llamar|contacto)/i],
    entities: ["branch"],
    priority: 70,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ENTREGAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "delivery_inquiry",
    category: "delivery",
    description: "Pregunta si hacen envío",
    keywords: ["envío", "domicilio", "entregan", "llevan", "mandan"],
    patterns: [/(envío|domicilio|entregan|llevan|mandan)/i],
    entities: ["zone"],
    priority: 75,
  },
  {
    type: "delivery_zone_check",
    category: "delivery",
    description: "Pregunta si llegan a su zona",
    keywords: ["llegan a", "entregan en", "hacen envío a", "mi zona"],
    patterns: [/(llegan|entregan|envío)\s*(a|en|hasta)/i],
    entities: ["zone", "address"],
    priority: 75,
  },
  {
    type: "delivery_time_inquiry",
    category: "delivery",
    description: "Pregunta tiempo de entrega",
    keywords: ["cuánto tarda", "tiempo de entrega", "cuándo llega"],
    patterns: [/(cuánto\s+tarda|tiempo.*entrega|cuándo\s+llega)/i],
    entities: ["zone"],
    priority: 70,
  },
  {
    type: "delivery_cost_inquiry",
    category: "delivery",
    description: "Pregunta costo de envío",
    keywords: ["costo de envío", "cuánto cuesta el envío", "cobran envío"],
    patterns: [/(costo|cuánto).*(envío|domicilio)/i],
    entities: ["zone"],
    priority: 70,
  },
  {
    type: "delivery_tracking",
    category: "delivery",
    description: "Rastrea pedido en camino",
    keywords: ["dónde está mi pedido", "ya viene", "repartidor", "tracking"],
    patterns: [/(dónde\s+está|ya\s+viene|repartidor)/i],
    entities: ["order_id"],
    priority: 80,
  },
  {
    type: "delivery_zone_unavailable",
    category: "delivery",
    description: "No entregan a su zona",
    keywords: [],
    patterns: [],
    entities: ["zone"],
    priority: 0,
    system_detected: true,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PAGOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "payment_method_inquiry",
    category: "payment",
    description: "Pregunta métodos de pago",
    keywords: ["pago", "tarjeta", "efectivo", "transferencia", "aceptan"],
    patterns: [/(aceptan|formas?\s+de\s+pago|tarjeta|efectivo|transferencia)/i],
    entities: ["payment_method"],
    priority: 70,
  },
  {
    type: "promo_inquiry",
    category: "payment",
    description: "Pregunta promociones",
    keywords: ["promoción", "descuento", "oferta", "2x1", "cupón"],
    patterns: [/(promoción|descuento|oferta|cupón|\dx\d)/i],
    entities: [],
    priority: 70,
  },
  {
    type: "invoice_request",
    category: "payment",
    description: "Solicita factura",
    keywords: ["factura", "facturar", "datos fiscales", "RFC"],
    patterns: [/(factura|facturar|RFC|fiscal)/i],
    entities: ["order_id"],
    priority: 75,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // QUEJAS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "complaint_wait_time",
    category: "complaint",
    description: "Queja por tiempo de espera",
    keywords: ["tardaron", "esperando", "mucho tiempo", "demora", "lento"],
    patterns: [/(tardaron|esperando|mucho\s+tiempo|demora|lento)/i],
    entities: ["wait_minutes", "branch"],
    priority: 85,
    sentiment_impact: -0.5,
  },
  {
    type: "complaint_wrong_order",
    category: "complaint",
    description: "Pedido incorrecto",
    keywords: ["equivocaron", "no es lo que pedí", "incorrecto", "error en el pedido"],
    patterns: [/(equivocaron|no es lo que|incorrecto|error)/i],
    entities: ["order_id", "issue"],
    priority: 90,
    sentiment_impact: -0.7,
  },
  {
    type: "complaint_missing_items",
    category: "complaint",
    description: "Faltaron artículos",
    keywords: ["faltó", "falta", "incompleto", "no viene", "no está"],
    patterns: [/(faltó|falta|incompleto|no\s+viene)/i],
    entities: ["order_id", "missing_items"],
    priority: 85,
    sentiment_impact: -0.6,
  },
  {
    type: "complaint_food_quality",
    category: "complaint",
    description: "Queja de calidad de comida",
    keywords: ["frío", "crudo", "viejo", "duro", "feo", "mal sabor", "echado a perder"],
    patterns: [/(frío|crudo|viejo|duro|mal\s+sabor|echado)/i],
    entities: ["product", "issue"],
    priority: 90,
    sentiment_impact: -0.8,
  },
  {
    type: "complaint_staff",
    category: "complaint",
    description: "Queja del personal",
    keywords: ["grosero", "mala atención", "mal servicio", "actitud", "mesero"],
    patterns: [/(grosero|mala\s+atención|mal\s+servicio|actitud)/i],
    entities: ["branch", "staff_type"],
    priority: 85,
    sentiment_impact: -0.7,
  },
  {
    type: "complaint_cleanliness",
    category: "complaint",
    description: "Queja de limpieza",
    keywords: ["sucio", "cochino", "baño", "limpieza", "mosca", "cucaracha"],
    patterns: [/(sucio|cochino|limpieza|mosca|cucaracha)/i],
    entities: ["branch", "area"],
    priority: 85,
    sentiment_impact: -0.8,
  },
  {
    type: "complaint_delivery",
    category: "complaint",
    description: "Queja de entrega",
    keywords: ["llegó tarde", "no llegó", "repartidor", "golpeado", "derramado"],
    patterns: [/(llegó\s+tarde|no\s+llegó|golpeado|derramado)/i],
    entities: ["order_id", "issue"],
    priority: 85,
    sentiment_impact: -0.6,
  },
  {
    type: "complaint_price",
    category: "complaint",
    description: "Queja de precio",
    keywords: ["caro", "costoso", "mucho dinero", "subieron", "antes costaba"],
    patterns: [/(caro|costoso|subieron|antes\s+costaba)/i],
    entities: ["product"],
    priority: 70,
    sentiment_impact: -0.4,
  },
  {
    type: "complaint_general",
    category: "complaint",
    description: "Queja general",
    keywords: ["queja", "molesto", "decepcionado", "mal", "pésimo", "horrible"],
    patterns: [/(queja|molesto|decepcionado|pésimo|horrible)/i],
    entities: ["issue"],
    priority: 80,
    sentiment_impact: -0.5,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // ELOGIOS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "praise_general",
    category: "praise",
    description: "Elogio general",
    keywords: ["excelente", "delicioso", "increíble", "los amo", "felicidades", "buenísimo"],
    patterns: [/(excelente|delicioso|increíble|los\s+amo|felicidades|buenísimo)/i],
    entities: [],
    priority: 70,
    sentiment_impact: 0.8,
  },
  {
    type: "praise_product",
    category: "praise",
    description: "Elogio de producto",
    keywords: ["rica", "rico", "delicioso", "el mejor", "me encantó"],
    patterns: [/(rica|rico|delicioso|el\s+mejor|me\s+encantó)/i],
    entities: ["product"],
    priority: 75,
    sentiment_impact: 0.7,
  },
  {
    type: "praise_staff",
    category: "praise",
    description: "Elogio del personal",
    keywords: ["amable", "atento", "excelente servicio", "muy bien atendido"],
    patterns: [/(amable|atento|excelente\s+servicio|bien\s+atendido)/i],
    entities: ["branch"],
    priority: 75,
    sentiment_impact: 0.7,
  },
  {
    type: "recommendation_given",
    category: "praise",
    description: "Cliente recomienda el negocio",
    keywords: ["los recomiendo", "recomendado", "les cuento", "vayan"],
    patterns: [/(los\s+recomiendo|recomendado|vayan\s+a)/i],
    entities: [],
    priority: 80,
    sentiment_impact: 0.9,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SERVICIO AL CLIENTE
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "human_handoff_request",
    category: "service",
    description: "Pide hablar con humano",
    keywords: ["hablar con alguien", "persona real", "humano", "gerente", "encargado", "supervisor"],
    patterns: [/(hablar\s+con|persona\s+real|humano|gerente|encargado|supervisor)/i],
    entities: ["reason"],
    priority: 90,
  },
  {
    type: "greeting",
    category: "service",
    description: "Saludo inicial",
    keywords: ["hola", "buenos días", "buenas tardes", "buenas noches", "qué tal"],
    patterns: [/^(hola|buenos?\s+(días|tardes|noches)|qué\s+tal)/i],
    entities: [],
    priority: 50,
  },
  {
    type: "thanks",
    category: "service",
    description: "Agradecimiento",
    keywords: ["gracias", "muchas gracias", "se los agradezco", "mil gracias"],
    patterns: [/(gracias|agradezco)/i],
    entities: [],
    priority: 50,
  },
  {
    type: "goodbye",
    category: "service",
    description: "Despedida",
    keywords: ["adiós", "bye", "hasta luego", "nos vemos", "chao"],
    patterns: [/(adiós|bye|hasta\s+luego|nos\s+vemos|chao)/i],
    entities: [],
    priority: 50,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EVENTOS ESPECIALES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "catering_inquiry",
    category: "special",
    description: "Pregunta por catering/eventos",
    keywords: ["catering", "evento", "fiesta", "boda", "corporativo", "muchas personas"],
    patterns: [/(catering|evento|fiesta|boda|corporativo)/i],
    entities: ["event_type", "guest_count"],
    priority: 80,
  },
  {
    type: "bulk_order_inquiry",
    category: "special",
    description: "Pedido mayoreo",
    keywords: ["mayoreo", "muchos", "cantidad grande", "por caja", "al por mayor"],
    patterns: [/(mayoreo|cantidad\s+grande|por\s+caja|al\s+por\s+mayor)/i],
    entities: ["products", "quantity"],
    priority: 80,
  },
  {
    type: "custom_order_request",
    category: "special",
    description: "Pedido personalizado",
    keywords: ["pastel personalizado", "encargo especial", "quiero que diga", "con nombre"],
    patterns: [/(personalizado|encargo\s+especial|que\s+diga|con\s+nombre)/i],
    entities: ["product", "customization"],
    priority: 80,
  },
  {
    type: "reservation_request",
    category: "special",
    description: "Reservación de mesa",
    keywords: ["reservar", "reservación", "mesa para", "apartar"],
    patterns: [/(reservar|reservación|mesa\s+para|apartar)/i],
    entities: ["guest_count", "date", "time", "branch"],
    priority: 85,
  },
  {
    type: "lost_and_found",
    category: "special",
    description: "Objetos perdidos",
    keywords: ["olvidé", "perdí", "dejé", "se me quedó", "encontraron"],
    patterns: [/(olvidé|perdí|dejé|se\s+me\s+quedó|encontraron)/i],
    entities: ["item", "branch", "date"],
    priority: 80,
  },
  {
    type: "gift_inquiry",
    category: "special",
    description: "Pregunta tarjetas de regalo",
    keywords: ["tarjeta de regalo", "gift card", "certificado", "regalar"],
    patterns: [/(tarjeta\s+de\s+regalo|gift\s+card|certificado)/i],
    entities: [],
    priority: 70,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // OPERACIONAL
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "equipment_issue",
    category: "operational",
    description: "Problema con equipamiento",
    keywords: ["no sirve", "no funciona", "descompuesto", "aire", "baño"],
    patterns: [/(no\s+(sirve|funciona)|descompuesto)/i],
    entities: ["equipment", "branch"],
    priority: 75,
    sentiment_impact: -0.3,
  },
  {
    type: "parking_issue",
    category: "operational",
    description: "Problema de estacionamiento",
    keywords: ["estacionamiento", "no hay lugar", "valet", "donde estacionarse"],
    patterns: [/(estacionamiento|no\s+hay\s+lugar|valet)/i],
    entities: ["branch"],
    priority: 70,
    sentiment_impact: -0.3,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MARKETING
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "competitor_mention",
    category: "marketing",
    description: "Menciona competidor",
    keywords: ["otra panadería", "en X", "la competencia", "mejor que"],
    patterns: [/(otra\s+panadería|la\s+competencia|mejor\s+que)/i],
    entities: ["competitor"],
    priority: 70,
  },
  {
    type: "discovery_source",
    category: "marketing",
    description: "Cómo descubrió el negocio",
    keywords: ["los vi en", "me recomendaron", "por Instagram", "por TikTok"],
    patterns: [/(los\s+vi\s+en|me\s+recomendaron|por\s+(Instagram|TikTok|Facebook))/i],
    entities: ["source"],
    priority: 65,
  },
  {
    type: "job_inquiry",
    category: "marketing",
    description: "Pregunta por trabajo",
    keywords: ["trabajan", "vacante", "empleo", "contratan", "solicitud"],
    patterns: [/(trabajan|vacante|empleo|contratan|solicitud)/i],
    entities: [],
    priority: 70,
  },
  {
    type: "franchise_inquiry",
    category: "marketing",
    description: "Pregunta por franquicia",
    keywords: ["franquicia", "abrir una", "cómo pongo una"],
    patterns: [/(franquicia|abrir\s+una|cómo\s+pongo)/i],
    entities: [],
    priority: 75,
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // BOT INTERACTION
  // ═══════════════════════════════════════════════════════════════════════════
  {
    type: "bot_confusion",
    category: "bot",
    description: "Confundido por respuesta del bot",
    keywords: ["no entiendo", "qué", "de qué hablas", "eso no es", "no te pregunté"],
    patterns: [/(no\s+entiendo|de\s+qué\s+hablas|eso\s+no|no\s+te\s+pregunté)/i],
    entities: [],
    priority: 75,
    sentiment_impact: -0.3,
  },
  {
    type: "repeat_request",
    category: "bot",
    description: "Usuario repite pregunta",
    keywords: ["te dije", "ya te dije", "repito", "otra vez"],
    patterns: [/(te\s+dije|ya\s+te|repito|otra\s+vez)/i],
    entities: [],
    priority: 70,
    sentiment_impact: -0.2,
  },
  {
    type: "frustration_detected",
    category: "bot",
    description: "Usuario frustrado",
    keywords: ["ay", "ugh", "no mames", "ya", "dios", "por favor"],
    patterns: [/(no\s+mam|ugh|dios\s+mío|por\s+favor\s+por\s+favor)/i],
    entities: ["frustration_level"],
    priority: 80,
    sentiment_impact: -0.5,
  },
];

/**
 * Obtiene evento por tipo
 */
export function getEventByType(type) {
  return EVENT_CATALOG.find(e => e.type === type);
}

/**
 * Obtiene eventos por categoría
 */
export function getEventsByCategory(category) {
  return EVENT_CATALOG.filter(e => e.category === category);
}

/**
 * Obtiene eventos ordenados por prioridad para clasificación
 */
export function getEventsSortedByPriority() {
  return [...EVENT_CATALOG].sort((a, b) => b.priority - a.priority);
}

export default {
  EVENT_CATEGORIES,
  EVENT_CATALOG,
  getEventByType,
  getEventsByCategory,
  getEventsSortedByPriority,
};
