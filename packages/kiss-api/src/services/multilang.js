/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MULTILANG SERVICE - Soporte multi-idioma para turistas
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Detecta el idioma del cliente y adapta las respuestas.
 * Soporta: Español (default), Inglés, Francés, Alemán, Portugués
 * 
 * Usa detección basada en patrones + OpenAI para casos ambiguos.
 * Cachea el idioma por conversación.
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const multilangConfig = {
  enabled: process.env.MULTILANG_ENABLED !== "false",
  defaultLanguage: process.env.MULTILANG_DEFAULT || "es",
  supportedLanguages: ["es", "en", "fr", "de", "pt"],
  useAIDetection: process.env.MULTILANG_AI_DETECTION === "true",
  cacheEnabled: true,
};

// Cache de idioma por conversación
const languageCache = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// PATRONES DE DETECCIÓN DE IDIOMA
// ═══════════════════════════════════════════════════════════════════════════

const languagePatterns = {
  en: {
    greetings: /\b(hi|hello|hey|good morning|good afternoon|good evening|what's up)\b/i,
    questions: /\b(what|where|when|how|why|which|who|can you|could you|would you|do you|are you|is there)\b/i,
    common: /\b(please|thank you|thanks|sorry|excuse me|help|need|want|looking for|order|book|reserve)\b/i,
    phrases: /\b(i would like|i'd like|i want to|can i|how much|what time|is it possible)\b/i,
  },
  fr: {
    greetings: /\b(bonjour|bonsoir|salut|coucou|allô)\b/i,
    questions: /\b(qu'est-ce|comment|pourquoi|quand|où|combien|quel|quelle)\b/i,
    common: /\b(s'il vous plaît|merci|pardon|excusez-moi|je voudrais|j'aimerais)\b/i,
    phrases: /\b(est-ce que|y a-t-il|pouvez-vous|puis-je)\b/i,
  },
  de: {
    greetings: /\b(hallo|guten tag|guten morgen|guten abend|hi|servus)\b/i,
    questions: /\b(was|wo|wann|wie|warum|welch|wer|können sie)\b/i,
    common: /\b(bitte|danke|entschuldigung|ich möchte|ich hätte gern)\b/i,
    phrases: /\b(gibt es|ist es möglich|können sie mir)\b/i,
  },
  pt: {
    greetings: /\b(olá|oi|bom dia|boa tarde|boa noite|e aí)\b/i,
    questions: /\b(o que|onde|quando|como|por que|qual|quem|você pode)\b/i,
    common: /\b(por favor|obrigado|obrigada|desculpe|eu quero|eu gostaria)\b/i,
    phrases: /\b(tem como|é possível|você pode me|quanto custa)\b/i,
  },
  es: {
    greetings: /\b(hola|buenos días|buenas tardes|buenas noches|qué tal|qué onda)\b/i,
    questions: /\b(qué|dónde|cuándo|cómo|por qué|cuál|quién|puede|puedo)\b/i,
    common: /\b(por favor|gracias|perdón|disculpa|quiero|quisiera|necesito)\b/i,
    phrases: /\b(me gustaría|hay disponible|cuánto cuesta|a qué hora)\b/i,
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// RESPUESTAS TRADUCIDAS
// ═══════════════════════════════════════════════════════════════════════════

const translations = {
  // Saludos
  greeting: {
    es: "¡Hola! Soy Tan • IA de Tagers. ¿En qué te puedo ayudar hoy? 🥐",
    en: "Hi! I'm Tan • IA from Tagers. How can I help you today? 🥐",
    fr: "Bonjour! Je suis Tan • IA de Tagers. Comment puis-je vous aider? 🥐",
    de: "Hallo! Ich bin Tan • IA von Tagers. Wie kann ich Ihnen helfen? 🥐",
    pt: "Olá! Sou Tan • IA da Tagers. Como posso ajudá-lo hoje? 🥐",
  },
  
  // Despedida
  goodbye: {
    es: "¡Gracias por tu preferencia! Que disfrutes tu rosca 🥐",
    en: "Thank you for choosing us! Enjoy your rosca 🥐",
    fr: "Merci de nous avoir choisis! Profitez de votre rosca 🥐",
    de: "Danke, dass Sie sich für uns entschieden haben! Genießen Sie Ihre Rosca 🥐",
    pt: "Obrigado pela preferência! Aproveite sua rosca 🥐",
  },
  
  // Confirmar pedido
  orderConfirm: {
    es: "¿Confirmas tu pedido?",
    en: "Do you confirm your order?",
    fr: "Confirmez-vous votre commande?",
    de: "Bestätigen Sie Ihre Bestellung?",
    pt: "Você confirma seu pedido?",
  },
  
  // Preguntar producto
  askProduct: {
    es: "¿Qué rosca te gustaría ordenar?",
    en: "Which rosca would you like to order?",
    fr: "Quelle rosca souhaitez-vous commander?",
    de: "Welche Rosca möchten Sie bestellen?",
    pt: "Qual rosca você gostaria de pedir?",
  },
  
  // Preguntar sucursal
  askBranch: {
    es: "¿En qué sucursal te gustaría recogerla?",
    en: "Which branch would you like to pick it up from?",
    fr: "Dans quelle succursale souhaitez-vous la récupérer?",
    de: "In welcher Filiale möchten Sie sie abholen?",
    pt: "Em qual filial você gostaria de retirar?",
  },
  
  // Preguntar fecha
  askDate: {
    es: "¿Para qué fecha la necesitas?",
    en: "What date do you need it for?",
    fr: "Pour quelle date en avez-vous besoin?",
    de: "Für welches Datum benötigen Sie sie?",
    pt: "Para qual data você precisa?",
  },
  
  // Preguntar cantidad
  askQuantity: {
    es: "¿Cuántas roscas necesitas?",
    en: "How many roscas do you need?",
    fr: "Combien de roscas avez-vous besoin?",
    de: "Wie viele Roscas benötigen Sie?",
    pt: "Quantas roscas você precisa?",
  },
  
  // Pedido confirmado
  orderConfirmed: {
    es: "¡Excelente! Tu pedido está confirmado.",
    en: "Excellent! Your order is confirmed.",
    fr: "Excellent! Votre commande est confirmée.",
    de: "Ausgezeichnet! Ihre Bestellung ist bestätigt.",
    pt: "Excelente! Seu pedido está confirmado.",
  },
  
  // Pago exitoso
  paymentSuccess: {
    es: "✅ ¡Pago recibido! Tu pedido está confirmado.",
    en: "✅ Payment received! Your order is confirmed.",
    fr: "✅ Paiement reçu! Votre commande est confirmée.",
    de: "✅ Zahlung eingegangen! Ihre Bestellung ist bestätigt.",
    pt: "✅ Pagamento recebido! Seu pedido está confirmado.",
  },
  
  // Error genérico
  error: {
    es: "Disculpa, tuve un problema. ¿Me puedes repetir qué necesitas?",
    en: "Sorry, I had a problem. Could you repeat what you need?",
    fr: "Désolé, j'ai eu un problème. Pouvez-vous répéter ce dont vous avez besoin?",
    de: "Entschuldigung, ich hatte ein Problem. Können Sie wiederholen, was Sie brauchen?",
    pt: "Desculpe, tive um problema. Pode repetir o que você precisa?",
  },
  
  // Conectar con humano
  connectHuman: {
    es: "Te conecto con un agente humano.",
    en: "I'll connect you with a human agent.",
    fr: "Je vous connecte avec un agent humain.",
    de: "Ich verbinde Sie mit einem menschlichen Mitarbeiter.",
    pt: "Vou conectá-lo com um agente humano.",
  },
  
  // Horarios
  hoursInfo: {
    es: "Nuestro horario de atención es:",
    en: "Our business hours are:",
    fr: "Nos heures d'ouverture sont:",
    de: "Unsere Öffnungszeiten sind:",
    pt: "Nosso horário de atendimento é:",
  },
  
  // Ubicación
  locationInfo: {
    es: "Puedes encontrarnos en:",
    en: "You can find us at:",
    fr: "Vous pouvez nous trouver à:",
    de: "Sie finden uns unter:",
    pt: "Você pode nos encontrar em:",
  },
  
  // Cancelar
  cancelled: {
    es: "Listo, cancelamos el pedido. ¿Te ayudo con algo más?",
    en: "Done, order cancelled. Can I help you with anything else?",
    fr: "C'est fait, commande annulée. Puis-je vous aider avec autre chose?",
    de: "Erledigt, Bestellung storniert. Kann ich Ihnen noch mit etwas anderem helfen?",
    pt: "Pronto, pedido cancelado. Posso ajudá-lo com mais alguma coisa?",
  },
  
  // Resumen del pedido
  orderSummary: {
    es: "📋 *Resumen de tu pedido:*",
    en: "📋 *Order Summary:*",
    fr: "📋 *Récapitulatif de votre commande:*",
    de: "📋 *Bestellübersicht:*",
    pt: "📋 *Resumo do seu pedido:*",
  },
  
  // Link de pago
  paymentLink: {
    es: "💳 Realiza tu pago aquí:",
    en: "💳 Make your payment here:",
    fr: "💳 Effectuez votre paiement ici:",
    de: "💳 Zahlen Sie hier:",
    pt: "💳 Faça seu pagamento aqui:",
  },
  
  // === NUEVAS TRADUCCIONES PARA FLUJOS ===
  
  // Carrito
  cartEmpty: {
    es: "(carrito vacío)",
    en: "(empty cart)",
    fr: "(panier vide)",
    de: "(leerer Warenkorb)",
    pt: "(carrinho vazio)",
  },
  
  estimatedTotal: {
    es: "💰 Total estimado:",
    en: "💰 Estimated total:",
    fr: "💰 Total estimé:",
    de: "💰 Geschätzte Summe:",
    pt: "💰 Total estimado:",
  },
  
  // Mensajes proactivos
  cartAbandoned: {
    es: "👋 Notamos que no completaste tu pedido. ¿Necesitas ayuda?",
    en: "👋 We noticed you didn't complete your order. Need help?",
    fr: "👋 Nous avons remarqué que vous n'avez pas finalisé votre commande. Besoin d'aide?",
    de: "👋 Wir haben bemerkt, dass Sie Ihre Bestellung nicht abgeschlossen haben. Brauchen Sie Hilfe?",
    pt: "👋 Notamos que você não completou seu pedido. Precisa de ajuda?",
  },
  
  postPurchase: {
    es: "¿Qué te pareció tu pedido? Tu opinión nos ayuda a mejorar 💛",
    en: "How was your order? Your feedback helps us improve 💛",
    fr: "Comment était votre commande? Votre avis nous aide à nous améliorer 💛",
    de: "Wie war Ihre Bestellung? Ihr Feedback hilft uns besser zu werden 💛",
    pt: "O que achou do seu pedido? Sua opinião nos ajuda a melhorar 💛",
  },
  
  csatPrompt: {
    es: "¿Cómo calificarías tu experiencia? (1-5 ⭐)",
    en: "How would you rate your experience? (1-5 ⭐)",
    fr: "Comment évalueriez-vous votre expérience? (1-5 ⭐)",
    de: "Wie würden Sie Ihre Erfahrung bewerten? (1-5 ⭐)",
    pt: "Como você avaliaria sua experiência? (1-5 ⭐)",
  },
  
  optOutConfirm: {
    es: "Entendido, no recibirás más mensajes promocionales. Si cambias de opinión, escríbenos.",
    en: "Got it, you won't receive more promotional messages. Let us know if you change your mind.",
    fr: "Compris, vous ne recevrez plus de messages promotionnels. Contactez-nous si vous changez d'avis.",
    de: "Verstanden, Sie erhalten keine Werbebotschaften mehr. Melden Sie sich, wenn Sie Ihre Meinung ändern.",
    pt: "Entendido, você não receberá mais mensagens promocionais. Nos avise se mudar de ideia.",
  },
  
  // Flujo de creación de pedido
  selectPickupDate: {
    es: "¿Para qué fecha necesitas tu pedido?",
    en: "What date do you need your order for?",
    fr: "Pour quelle date avez-vous besoin de votre commande?",
    de: "Für welches Datum benötigen Sie Ihre Bestellung?",
    pt: "Para qual data você precisa do seu pedido?",
  },
  
  selectPickupBranch: {
    es: "¿En qué sucursal deseas recoger tu pedido?",
    en: "Which branch would you like to pick up your order from?",
    fr: "Dans quelle succursale souhaitez-vous récupérer votre commande?",
    de: "In welcher Filiale möchten Sie Ihre Bestellung abholen?",
    pt: "Em qual filial você gostaria de retirar seu pedido?",
  },
  
  confirmOrder: {
    es: "¿Confirmas este pedido?",
    en: "Do you confirm this order?",
    fr: "Confirmez-vous cette commande?",
    de: "Bestätigen Sie diese Bestellung?",
    pt: "Você confirma este pedido?",
  },
  
  orderPlaced: {
    es: "✅ ¡Pedido registrado! Te enviaremos el link de pago.",
    en: "✅ Order placed! We'll send you the payment link.",
    fr: "✅ Commande enregistrée! Nous vous enverrons le lien de paiement.",
    de: "✅ Bestellung aufgegeben! Wir senden Ihnen den Zahlungslink.",
    pt: "✅ Pedido registrado! Enviaremos o link de pagamento.",
  },
  
  // Modificación de pedido
  modifyOptions: {
    es: "¿Qué te gustaría modificar?\n1. Fecha de recolección\n2. Sucursal\n3. Hablar con alguien",
    en: "What would you like to modify?\n1. Pickup date\n2. Branch\n3. Talk to someone",
    fr: "Que souhaitez-vous modifier?\n1. Date de retrait\n2. Succursale\n3. Parler à quelqu'un",
    de: "Was möchten Sie ändern?\n1. Abholtermin\n2. Filiale\n3. Mit jemandem sprechen",
    pt: "O que você gostaria de modificar?\n1. Data de retirada\n2. Filial\n3. Falar com alguém",
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// DETECCIÓN DE IDIOMA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detecta el idioma de un mensaje usando patrones
 * @param {string} text - Texto a analizar
 * @returns {string|null} - Código de idioma o null si no se detecta
 */
function detectLanguageByPatterns(text) {
  if (!text || typeof text !== "string") return null;
  
  const normalizedText = text.toLowerCase().trim();
  
  // Contar matches por idioma
  const scores = {};
  
  for (const [lang, patterns] of Object.entries(languagePatterns)) {
    scores[lang] = 0;
    
    for (const pattern of Object.values(patterns)) {
      const matches = normalizedText.match(pattern);
      if (matches) {
        scores[lang] += matches.length;
      }
    }
  }
  
  // Encontrar el idioma con más matches
  let bestLang = null;
  let bestScore = 0;
  
  for (const [lang, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestLang = lang;
    }
  }
  
  // Requiere al menos 1 match para ser considerado
  return bestScore >= 1 ? bestLang : null;
}

/**
 * Detecta el idioma usando OpenAI (para casos ambiguos)
 * @param {string} text - Texto a analizar
 * @param {Object} openaiClient - Cliente de OpenAI
 * @returns {Promise<string>} - Código de idioma
 */
async function detectLanguageWithAI(text, openaiClient) {
  if (!openaiClient) return multilangConfig.defaultLanguage;
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Detect the language of the following text. 
Return ONLY the ISO 639-1 code (es, en, fr, de, pt).
If unsure, return "es".`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      max_tokens: 10,
      temperature: 0,
    });
    
    const detected = response.choices[0]?.message?.content?.trim().toLowerCase();
    
    if (multilangConfig.supportedLanguages.includes(detected)) {
      return detected;
    }
    
    return multilangConfig.defaultLanguage;
    
  } catch (error) {
    logger.warn({ err: error.message }, "[MULTILANG] AI detection failed");
    return multilangConfig.defaultLanguage;
  }
}

/**
 * Detecta el idioma de un mensaje
 * @param {string} text - Texto a analizar
 * @param {string} conversationId - ID de conversación (para cache)
 * @param {Object} [options] - Opciones
 * @returns {Promise<string>} - Código de idioma
 */
export async function detectLanguage(text, conversationId, options = {}) {
  if (!multilangConfig.enabled) {
    return multilangConfig.defaultLanguage;
  }
  
  // Verificar cache primero
  if (multilangConfig.cacheEnabled && conversationId && languageCache.has(conversationId)) {
    return languageCache.get(conversationId);
  }
  
  // Intentar detección por patrones
  let detected = detectLanguageByPatterns(text);
  
  // Si no se detecta y AI está habilitado, usar AI
  if (!detected && multilangConfig.useAIDetection && options.openaiClient) {
    detected = await detectLanguageWithAI(text, options.openaiClient);
  }
  
  // Default a español
  if (!detected) {
    detected = multilangConfig.defaultLanguage;
  }
  
  // Guardar en cache
  if (multilangConfig.cacheEnabled && conversationId) {
    languageCache.set(conversationId, detected);
  }
  
  logger.debug({ conversationId, detected, textPreview: text?.substring(0, 30) }, "[MULTILANG] Language detected");
  
  return detected;
}

/**
 * Establece el idioma de una conversación manualmente
 */
export function setConversationLanguage(conversationId, language) {
  if (multilangConfig.supportedLanguages.includes(language)) {
    languageCache.set(conversationId, language);
    return true;
  }
  return false;
}

/**
 * Obtiene el idioma de una conversación desde cache
 */
export function getConversationLanguage(conversationId) {
  return languageCache.get(conversationId) || multilangConfig.defaultLanguage;
}

/**
 * Limpia el idioma de una conversación del cache
 */
export function clearConversationLanguage(conversationId) {
  languageCache.delete(conversationId);
}

// ═══════════════════════════════════════════════════════════════════════════
// TRADUCCIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene una traducción por clave
 * @param {string} key - Clave de traducción
 * @param {string} language - Código de idioma
 * @returns {string} - Texto traducido
 */
export function getTranslation(key, language = "es") {
  const lang = multilangConfig.supportedLanguages.includes(language) 
    ? language 
    : multilangConfig.defaultLanguage;
  
  return translations[key]?.[lang] || translations[key]?.es || key;
}

/**
 * Traduce una respuesta usando OpenAI
 * @param {string} text - Texto a traducir
 * @param {string} targetLanguage - Idioma destino
 * @param {Object} openaiClient - Cliente de OpenAI
 * @returns {Promise<string>} - Texto traducido
 */
export async function translateWithAI(text, targetLanguage, openaiClient) {
  if (!openaiClient || targetLanguage === "es") {
    return text;
  }
  
  const languageNames = {
    en: "English",
    fr: "French",
    de: "German",
    pt: "Portuguese",
  };
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `Translate the following text to ${languageNames[targetLanguage] || "English"}.
Keep the same tone and emojis. Preserve any formatting like ** for bold.
Only return the translation, nothing else.`,
        },
        {
          role: "user",
          content: text,
        },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });
    
    return response.choices[0]?.message?.content?.trim() || text;
    
  } catch (error) {
    logger.warn({ err: error.message, targetLanguage }, "[MULTILANG] AI translation failed");
    return text;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS PARA RESPUESTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera un saludo en el idioma del cliente
 */
export function getLocalizedGreeting(conversationId) {
  const lang = getConversationLanguage(conversationId);
  return getTranslation("greeting", lang);
}

/**
 * Genera un mensaje de error en el idioma del cliente
 */
export function getLocalizedError(conversationId) {
  const lang = getConversationLanguage(conversationId);
  return getTranslation("error", lang);
}

/**
 * Genera despedida en el idioma del cliente
 */
export function getLocalizedGoodbye(conversationId) {
  const lang = getConversationLanguage(conversationId);
  return getTranslation("goodbye", lang);
}

/**
 * Genera mensaje de pago exitoso en el idioma del cliente
 */
export function getLocalizedPaymentSuccess(conversationId) {
  const lang = getConversationLanguage(conversationId);
  return getTranslation("paymentSuccess", lang);
}

// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE PARA RESPUESTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Wrapper que detecta idioma y traduce respuestas automáticamente
 * @param {Function} handler - Handler original
 * @param {Object} options - Opciones con openaiClient
 */
export function withMultilang(handler, options = {}) {
  return async (context) => {
    const { conversationId, messageText } = context;
    
    // Detectar idioma del mensaje entrante
    await detectLanguage(messageText, conversationId, {
      openaiClient: options.openaiClient,
    });
    
    // Ejecutar handler original
    const result = await handler(context);
    
    // Si hay respuesta y el idioma no es español, traducir
    if (result?.message && getConversationLanguage(conversationId) !== "es") {
      if (options.autoTranslate && options.openaiClient) {
        result.message = await translateWithAI(
          result.message,
          getConversationLanguage(conversationId),
          options.openaiClient
        );
      }
    }
    
    return result;
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

export function isEnabled() {
  return multilangConfig.enabled;
}

export function getConfig() {
  return {
    enabled: multilangConfig.enabled,
    defaultLanguage: multilangConfig.defaultLanguage,
    supportedLanguages: multilangConfig.supportedLanguages,
    useAIDetection: multilangConfig.useAIDetection,
  };
}

export function getSupportedLanguages() {
  return multilangConfig.supportedLanguages;
}

// ═══════════════════════════════════════════════════════════════════════════
// INITIALIZATION LOG
// ═══════════════════════════════════════════════════════════════════════════

logger.info(`[MULTILANG] ✓ Service initialized`, {
  enabled: multilangConfig.enabled,
  defaultLanguage: multilangConfig.defaultLanguage,
  supportedLanguages: multilangConfig.supportedLanguages.join(", "),
});

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const multilangService = {
  // Detection
  detectLanguage,
  detectLanguageByPatterns,
  detectLanguageWithAI,
  
  // Cache
  setConversationLanguage,
  getConversationLanguage,
  clearConversationLanguage,
  
  // Translation
  getTranslation,
  translateWithAI,
  
  // Localized helpers
  getLocalizedGreeting,
  getLocalizedError,
  getLocalizedGoodbye,
  getLocalizedPaymentSuccess,
  
  // Middleware
  withMultilang,
  
  // Config
  isEnabled,
  getConfig,
  getSupportedLanguages,
  
  // Constants
  translations,
};

export default multilangService;
