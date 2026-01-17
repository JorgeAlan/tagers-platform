/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA CONVERSATION - Handler de Chat Conversacional
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Maneja conversaciones naturales con usuarios:
 * 
 * "Oye LUCA, ¿cómo vamos?"
 * "¿Qué pasa en Zavaleta?"
 * "Aprueba la PO"
 * 
 * Características:
 * - Detección de intents
 * - Mantenimiento de contexto
 * - Flujos de múltiples turnos
 * - Fallback a LLM para preguntas complejas
 */

import { logger } from "@tagers/shared";
import { contextManager, ConversationContext } from "./context/ConversationContext.js";
import { intents, detectIntent } from "./intents/index.js";
import { audioBriefingGenerator } from "../voice/AudioBriefingGenerator.js";
import OpenAI from "openai";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Configuración
 */
const CONFIG = {
  minConfidenceThreshold: 0.4,  // Mínimo para usar intent
  llmFallbackEnabled: true,     // Usar LLM para preguntas no reconocidas
  llmModel: "gpt-4o-mini",
  maxTokens: 500,
};

/**
 * Personalidad de LUCA para el LLM
 */
const LUCA_SYSTEM_PROMPT = `Eres LUCA, el asistente de inteligencia de negocio de Tagers, una cadena de panaderías y restaurantes en México.

Tu personalidad:
- Profesional pero amigable
- Conciso y directo
- Usas datos concretos cuando los tienes
- Hablas en español mexicano informal pero respetuoso

Tu rol:
- Ayudas a Jorge (CEO) y los socios a entender el negocio
- Respondes sobre ventas, alertas, empleados, inventario
- Puedes aprobar/rechazar acciones cuando te lo piden
- Si no sabes algo, lo dices honestamente

Contexto actual:
{context}

Responde de forma concisa (máximo 2-3 párrafos cortos).`;

export class LucaConversation {
  constructor() {
    this.openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
  }

  /**
   * Procesa un mensaje del usuario
   */
  async processMessage(userId, message, metadata = {}) {
    logger.info({ userId, message: message.substring(0, 50) }, "Processing conversation message");

    try {
      // Obtener/crear contexto
      const context = contextManager.getContext(userId);

      // Guardar mensaje del usuario
      context.addMessage("user", message, metadata);

      // Extraer entidades del mensaje
      const entities = context.extractEntities(message);

      // Si hay un flujo activo, manejarlo primero
      if (context.hasActiveFlow()) {
        const flowResponse = await this.handleActiveFlow(message, context);
        if (flowResponse) {
          context.addMessage("assistant", flowResponse.text);
          contextManager.saveContext(context);
          return flowResponse;
        }
      }

      // Detectar intent
      const { intent, confidence } = detectIntent(message);

      let response;

      if (intent && confidence >= CONFIG.minConfidenceThreshold) {
        // Ejecutar intent detectado
        const params = intent.extractParams(message, context);
        response = await intent.execute(message, context, params);
        response.intent = intent.name;
        response.confidence = confidence;
      } else if (this.isAudioRequest(message)) {
        // Solicitud de audio briefing
        response = await this.handleAudioRequest(userId, context);
      } else if (CONFIG.llmFallbackEnabled && this.openai) {
        // Fallback a LLM
        response = await this.handleWithLLM(message, context);
        response.intent = "llm_fallback";
      } else {
        // No se pudo procesar
        response = {
          text: "No estoy seguro de entender. ¿Puedes reformular tu pregunta?\n\nEscribe 'ayuda' para ver qué puedo hacer.",
          intent: "unknown",
        };
      }

      // Guardar respuesta
      context.addMessage("assistant", response.text);
      context.lastResponse = response;
      contextManager.saveContext(context);

      return response;

    } catch (err) {
      logger.error({ userId, err: err?.message }, "Error processing message");
      return {
        text: "Ups, tuve un problema procesando tu mensaje. ¿Puedes intentar de nuevo?",
        error: err?.message,
      };
    }
  }

  /**
   * Maneja flujo activo
   */
  async handleActiveFlow(message, context) {
    const { current, step, data } = context.flow;

    // Flujo de aprobación
    if (current === "approval") {
      const text = message.toLowerCase();
      
      if (/sí|si\b|yes|ok|dale|confirmo|apruebo/i.test(text)) {
        context.endFlow();
        return {
          text: "✅ Aprobado. La acción se ejecutará.",
          flowCompleted: true,
        };
      } else if (/no|cancel|rechaz/i.test(text)) {
        context.endFlow();
        return {
          text: "❌ Cancelado.",
          flowCompleted: true,
        };
      }
    }

    // Flujo de selección de sucursal
    if (current === "branch_selection") {
      const entities = context.extractEntities(message);
      if (entities.branch) {
        context.endFlow();
        // Re-procesar con la sucursal
        return null; // Permitir que se procese normalmente
      }
    }

    return null; // No manejado
  }

  /**
   * Verifica si es solicitud de audio
   */
  isAudioRequest(message) {
    const patterns = [
      /audio/i,
      /podcast/i,
      /mándame el audio/i,
      /envíame el audio/i,
      /briefing de audio/i,
      /audio briefing/i,
      /quiero escuchar/i,
    ];
    return patterns.some(p => p.test(message));
  }

  /**
   * Maneja solicitud de audio briefing
   */
  async handleAudioRequest(userId, context) {
    try {
      const result = await audioBriefingGenerator.generate({
        userId,
        name: context.preferences?.name || "Jorge",
      });

      if (result.success) {
        return {
          text: "🎙️ Aquí está tu briefing de audio. Duración aproximada: " + 
                this.formatDuration(result.audio.duration),
          audio: {
            url: result.audio.filepath,
            duration: result.audio.duration,
          },
          intent: "audio_briefing",
        };
      } else {
        return {
          text: "No pude generar el audio en este momento. ¿Quieres el resumen en texto?",
          intent: "audio_briefing_error",
        };
      }
    } catch (err) {
      logger.error({ err: err?.message }, "Audio generation failed");
      return {
        text: "Tuve un problema generando el audio. Te doy el resumen en texto.",
        intent: "audio_briefing_error",
      };
    }
  }

  /**
   * Maneja con LLM para preguntas complejas
   */
  async handleWithLLM(message, context) {
    try {
      const contextSummary = context.getContextSummary();
      const systemPrompt = LUCA_SYSTEM_PROMPT.replace("{context}", contextSummary);

      // Construir historial de conversación
      const messages = [
        { role: "system", content: systemPrompt },
      ];

      // Añadir últimos mensajes del contexto
      for (const msg of context.messages.slice(-6)) {
        messages.push({
          role: msg.role === "user" ? "user" : "assistant",
          content: msg.content,
        });
      }

      const completion = await this.openai.chat.completions.create({
        model: CONFIG.llmModel,
        messages,
        max_tokens: CONFIG.maxTokens,
        temperature: 0.7,
      });

      const response = completion.choices[0]?.message?.content || 
        "No pude procesar esa pregunta.";

      return {
        text: response,
        usedLLM: true,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "LLM fallback failed");
      return {
        text: "No pude procesar esa pregunta. ¿Puedes ser más específico?",
        error: err?.message,
      };
    }
  }

  /**
   * Formatea duración en texto
   */
  formatDuration(seconds) {
    if (seconds < 60) {
      return `${seconds} segundos`;
    }
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    if (secs === 0) {
      return `${mins} minuto${mins > 1 ? "s" : ""}`;
    }
    return `${mins}:${secs.toString().padStart(2, "0")} minutos`;
  }

  /**
   * Procesa mensaje de WhatsApp
   */
  async processWhatsAppMessage(phone, message, metadata = {}) {
    // Usar teléfono como userId
    const userId = `wa_${phone}`;
    
    const response = await this.processMessage(userId, message, {
      ...metadata,
      channel: "whatsapp",
      phone,
    });

    return response;
  }

  /**
   * Obtiene sugerencias de respuesta rápida
   */
  getSuggestedReplies(lastResponse) {
    const suggestions = [];

    // Basado en el intent
    switch (lastResponse?.intent) {
      case "status":
        suggestions.push("Más detalles de ventas");
        suggestions.push("¿Hay alertas?");
        suggestions.push("¿Cómo va Angelópolis?");
        break;
      case "alerts":
        suggestions.push("Detalles de la primera");
        suggestions.push("¿Cómo vamos?");
        break;
      case "branch":
        suggestions.push("¿Y las otras sucursales?");
        suggestions.push("¿Hay alertas aquí?");
        break;
      default:
        suggestions.push("¿Cómo vamos?");
        suggestions.push("¿Hay alertas?");
        suggestions.push("Ayuda");
    }

    return suggestions.slice(0, 3);
  }

  /**
   * Obtiene estadísticas de conversaciones
   */
  getStats() {
    return {
      ...contextManager.getStats(),
      intentsRegistered: intents.length,
      llmEnabled: CONFIG.llmFallbackEnabled && !!this.openai,
    };
  }
}

export const lucaConversation = new LucaConversation();

export default LucaConversation;
