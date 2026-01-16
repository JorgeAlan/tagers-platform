/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INSIGHTS ENGINE - Event Extractor v1.1 (HOTFIX)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * CAMBIOS EN ESTA VERSIÓN:
 * - FIX: Usa getChatParams del modelRegistry para compatibilidad con GPT-5
 *   (GPT-5 requiere max_completion_tokens en lugar de max_tokens)
 * - FIX: Manejo seguro de frustration_level cuando sentimentResult es undefined
 * - FIX: Fallback robusto cuando clasificación AI falla
 * 
 * @version 1.1.0
 */

import { logger } from "../../utils/logger.js";
import { EVENT_CATALOG, getEventsSortedByPriority } from "../eventCatalog.js";
import { getPool } from "../../db/repo.js";
import { 
  modelRegistry,
  getChatParams,
  requiresMaxCompletionTokens,
  doesNotSupportCustomTemperature
} from "../../../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const config = {
  // Umbral mínimo de confianza para clasificación por reglas
  rulesConfidenceThreshold: 0.6,
  // Umbral para usar AI cuando reglas no son suficientes
  aiClassificationThreshold: 0.4,
  // Habilitar clasificación AI cuando reglas fallan
  enableAIClassification: true,
  // Guardar mensajes no clasificados para auto-aprendizaje
  saveUnclassified: true,
};

// ═══════════════════════════════════════════════════════════════════════════
// CLASIFICADOR POR REGLAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Clasifica mensaje usando keywords y patterns
 * Retorna array de posibles eventos con scores
 */
function classifyByRules(message) {
  const normalizedMessage = message.toLowerCase().trim();
  const matches = [];
  
  for (const event of getEventsSortedByPriority()) {
    if (event.system_detected) continue;
    
    let score = 0;
    let matchedBy = [];
    
    // Check keywords
    for (const keyword of event.keywords || []) {
      if (normalizedMessage.includes(keyword.toLowerCase())) {
        score += 0.3;
        matchedBy.push(`keyword:${keyword}`);
      }
    }
    
    // Check patterns
    for (const pattern of event.patterns || []) {
      if (pattern.test(normalizedMessage)) {
        score += 0.5;
        matchedBy.push(`pattern:${pattern.toString().slice(0, 30)}`);
      }
    }
    
    // Ajustar por prioridad
    score = score * (event.priority / 100);
    
    if (score > 0) {
      matches.push({
        type: event.type,
        category: event.category,
        score: Math.min(score, 1.0),
        matchedBy,
        sentimentImpact: event.sentiment_impact || 0,
      });
    }
  }
  
  // Ordenar por score
  return matches.sort((a, b) => b.score - a.score);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLASIFICADOR AI - ACTUALIZADO PARA GPT-5
// ═══════════════════════════════════════════════════════════════════════════

let _openaiClient = null;

export function setOpenAIClient(client) {
  _openaiClient = client;
}

/**
 * Clasifica mensaje usando AI cuando reglas no son suficientes
 * ACTUALIZADO: Usa getChatParams para compatibilidad con GPT-5
 */
async function classifyByAI(message, context = {}) {
  if (!_openaiClient || !config.enableAIClassification) {
    return null;
  }
  
  try {
    const eventTypes = EVENT_CATALOG
      .filter(e => !e.system_detected)
      .map(e => `${e.type}: ${e.description}`)
      .join("\n");
    
    // ═══════════════════════════════════════════════════════════════════════
    // FIX: Obtener modelo del Registry y usar parámetros correctos
    // ═══════════════════════════════════════════════════════════════════════
    const model = modelRegistry.getModel("intent_classifier");
    
    // Construir parámetros base
    const callParams = {
      model,
      messages: [
        {
          role: "system",
          content: `Eres un clasificador de mensajes para una panadería/restaurante.
Clasifica el mensaje del cliente en UNO de estos tipos de evento:

${eventTypes}

Responde SOLO con JSON:
{
  "event_type": "tipo_de_evento",
  "confidence": 0.0-1.0,
  "entities": { ... entidades extraídas ... },
  "sentiment": "positive|neutral|negative",
  "sentiment_score": -1.0 a 1.0
}

Si no puedes clasificar con confianza > 0.5, usa event_type: "unknown".`
        },
        {
          role: "user",
          content: `Mensaje: "${message}"${context.previousMessages ? `\n\nContexto previo: ${context.previousMessages}` : ""}`
        }
      ],
    };
    
    // FIX: Usar max_completion_tokens para modelos GPT-5
    if (requiresMaxCompletionTokens(model)) {
      callParams.max_completion_tokens = 300;
    } else {
      callParams.max_tokens = 300;
    }
    
    // FIX: Solo añadir temperature si el modelo lo soporta
    if (!doesNotSupportCustomTemperature(model)) {
      callParams.temperature = 0;
    }
    
    const response = await _openaiClient.chat.completions.create(callParams);
    
    const content = response.choices[0]?.message?.content;
    if (!content) {
      logger.warn({ model }, "AI classification returned no content");
      return null;
    }
    
    // Parsear respuesta
    const result = JSON.parse(content);
    return result;
    
  } catch (error) {
    logger.warn({
      error: error.message?.substring(0, 200),
    }, "[WARN] AI classification failed");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// ANALIZADOR DE SENTIMIENTO
// ═══════════════════════════════════════════════════════════════════════════

function analyzeSentiment(message, eventSentimentImpact = 0) {
  const normalizedMessage = message.toLowerCase();
  
  // Keywords positivos
  const positiveKeywords = ["gracias", "excelente", "perfecto", "genial", "increíble", 
    "delicioso", "rico", "bueno", "feliz", "contento", "encanta", "❤", "👍", "😊", "🙏"];
  
  // Keywords negativos
  const negativeKeywords = ["mal", "horrible", "terrible", "pésimo", "nunca", "jamás",
    "molesto", "enojado", "frustrado", "queja", "reclamo", "problema", "error", "😠", "😡", "👎"];
  
  // Keywords de frustración alta
  const frustrationKeywords = ["no contestan", "nadie responde", "llevo esperando",
    "increíble que", "es el colmo", "ya van", "otra vez", "siempre lo mismo"];
  
  let score = 0;
  let frustrationLevel = 0;
  
  // Contar keywords
  for (const kw of positiveKeywords) {
    if (normalizedMessage.includes(kw)) score += 0.15;
  }
  
  for (const kw of negativeKeywords) {
    if (normalizedMessage.includes(kw)) score -= 0.2;
  }
  
  for (const kw of frustrationKeywords) {
    if (normalizedMessage.includes(kw)) {
      frustrationLevel += 1;
      score -= 0.15;
    }
  }
  
  // Ajustar por mayúsculas (gritar)
  const uppercaseRatio = (message.match(/[A-ZÁÉÍÓÚÑ]/g) || []).length / message.length;
  if (uppercaseRatio > 0.5 && message.length > 10) {
    frustrationLevel += 1;
    score -= 0.1;
  }
  
  // Ajustar por signos de exclamación múltiples
  const exclamations = (message.match(/!/g) || []).length;
  if (exclamations > 2) {
    frustrationLevel += 1;
  }
  
  // Aplicar impacto del tipo de evento
  score += eventSentimentImpact;
  
  // Normalizar
  score = Math.max(-1, Math.min(1, score));
  frustrationLevel = Math.min(5, frustrationLevel);
  
  // Determinar sentimiento
  let sentiment = "neutral";
  if (score > 0.15) sentiment = "positive";
  else if (score < -0.15) sentiment = "negative";
  
  return {
    sentiment,
    score,
    frustrationLevel,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR DE ENTIDADES
// ═══════════════════════════════════════════════════════════════════════════

function extractEntities(message, eventType) {
  const entities = {};
  
  // Extraer números de pedido (formato típico: #12345, PED-12345, etc)
  const orderMatch = message.match(/#?\b(PED[-\s]?)?\d{4,8}\b/i);
  if (orderMatch) {
    entities.orderId = orderMatch[0].replace(/[#\s-]/g, "");
  }
  
  // Extraer teléfonos
  const phoneMatch = message.match(/\b\d{10}\b|\b\d{2}[\s-]?\d{4}[\s-]?\d{4}\b/);
  if (phoneMatch) {
    entities.phone = phoneMatch[0].replace(/[\s-]/g, "");
  }
  
  // Extraer montos de dinero
  const moneyMatch = message.match(/\$\s*[\d,]+(\.\d{2})?|\b\d{2,6}\s*(pesos|mxn)\b/i);
  if (moneyMatch) {
    entities.amount = moneyMatch[0];
  }
  
  // Extraer horarios
  const timeMatch = message.match(/\b([01]?\d|2[0-3]):[0-5]\d\s*(am|pm)?\b/i);
  if (timeMatch) {
    entities.time = timeMatch[0];
  }
  
  // Extraer fechas
  const dateMatch = message.match(/\b\d{1,2}[\/\-]\d{1,2}([\/\-]\d{2,4})?\b/);
  if (dateMatch) {
    entities.date = dateMatch[0];
  }
  
  return entities;
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIÓN PRINCIPAL - ACTUALIZADA CON MANEJO SEGURO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Extrae evento de un mensaje
 * ACTUALIZADO: Manejo seguro de errores y frustration_level
 */
async function extractEvent({
  conversationId,
  messageId,
  message,
  direction = "incoming",
  contactId = null,
  channel = "unknown",
  branchId = null,
  branchName = null,
}) {
  const startTime = Date.now();
  
  // 1. Intentar clasificación por reglas
  const ruleMatches = classifyByRules(message);
  let classification = null;
  let classificationMethod = "none";
  
  if (ruleMatches.length > 0 && ruleMatches[0].score >= config.rulesConfidenceThreshold) {
    classification = ruleMatches[0];
    classificationMethod = "rules";
  } 
  // 2. Si reglas no son suficientes, usar AI
  else if (config.enableAIClassification && 
           (!ruleMatches.length || ruleMatches[0].score < config.aiClassificationThreshold)) {
    const aiResult = await classifyByAI(message);
    if (aiResult && aiResult.confidence > 0.5 && aiResult.event_type !== "unknown") {
      classification = {
        type: aiResult.event_type,
        category: EVENT_CATALOG.find(e => e.type === aiResult.event_type)?.category || "unknown",
        score: aiResult.confidence,
        aiEntities: aiResult.entities,
        aiSentiment: aiResult.sentiment,
        aiSentimentScore: aiResult.sentiment_score,
      };
      classificationMethod = "ai";
    }
  }
  // 3. Usar mejor match de reglas aunque sea bajo
  else if (ruleMatches.length > 0) {
    classification = ruleMatches[0];
    classificationMethod = "rules_low_confidence";
  }
  
  // 3. Analizar sentimiento
  const sentimentResult = analyzeSentiment(
    message, 
    classification?.sentimentImpact || 0
  );
  
  // Si AI dio sentimiento, usarlo
  if (classification?.aiSentiment) {
    sentimentResult.sentiment = classification.aiSentiment;
    sentimentResult.score = classification.aiSentimentScore;
  }
  
  // 4. Extraer entidades
  let entities = extractEntities(message, classification?.type);
  if (classification?.aiEntities) {
    entities = { ...entities, ...classification.aiEntities };
  }
  
  // ═══════════════════════════════════════════════════════════════════════
  // FIX: Manejo seguro de frustrationLevel (evita undefined)
  // ═══════════════════════════════════════════════════════════════════════
  const frustrationLevel = sentimentResult?.frustrationLevel ?? 0;
  
  // 5. Construir evento
  const event = {
    conversationId,
    messageId,
    contactId,
    channel,
    branchId,
    branchName,
    
    eventType: classification?.type || "unknown",
    eventCategory: classification?.category || "unknown",
    confidence: classification?.score || 0,
    classificationMethod,
    
    sentiment: sentimentResult?.sentiment || "neutral",
    sentimentScore: sentimentResult?.score ?? 0,
    frustrationLevel,  // Ahora siempre tiene un valor seguro
    urgencyLevel: 0,
    
    entities,
    messageContent: message,
    messageDirection: direction,
    
    processingTimeMs: Date.now() - startTime,
  };
  
  // 6. Guardar en DB
  await saveEvent(event);
  
  // 7. Si no clasificado, guardar para auto-aprendizaje
  if (event.eventType === "unknown" && config.saveUnclassified) {
    await saveUnclassifiedMessage(event);
  }
  
  logger.debug({
    conversationId,
    eventType: event.eventType,
    confidence: event.confidence,
    sentiment: event.sentiment,
    method: classificationMethod,
    processingMs: event.processingTimeMs,
  }, "Event extracted");
  
  return event;
}

// ═══════════════════════════════════════════════════════════════════════════
// PERSISTENCIA
// ═══════════════════════════════════════════════════════════════════════════

async function saveEvent(event) {
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      INSERT INTO conversation_events (
        conversation_id, message_id, contact_id,
        channel, branch_id, branch_name,
        event_type, event_category, confidence,
        sentiment, sentiment_score, frustration_level, urgency_level,
        entities, message_content, message_direction,
        processed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW())
    `, [
      event.conversationId,
      event.messageId,
      event.contactId,
      event.channel,
      event.branchId,
      event.branchName,
      event.eventType,
      event.eventCategory,
      event.confidence,
      event.sentiment,
      event.sentimentScore,
      event.frustrationLevel,
      event.urgencyLevel,
      JSON.stringify(event.entities),
      event.messageContent,
      event.messageDirection,
    ]);
    return true;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to save event");
    return false;
  }
}

async function saveUnclassifiedMessage(event) {
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      INSERT INTO unclassified_messages (
        conversation_id, message_content, channel, branch_id
      ) VALUES ($1, $2, $3, $4)
    `, [
      event.conversationId,
      event.messageContent,
      event.channel,
      event.branchId,
    ]);
    return true;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to save unclassified message");
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  extractEvent,
  classifyByRules,
  analyzeSentiment,
  extractEntities,
  setOpenAIClient,
};
