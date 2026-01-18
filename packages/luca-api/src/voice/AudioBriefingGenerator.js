/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUDIO BRIEFING GENERATOR - Genera el Podcast Matutino
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Convierte el Morning Briefing en audio:
 * 
 * 1. scriptFromBriefing() → Convierte datos a script natural
 * 2. addPauses()          → Añade pausas para ritmo natural
 * 3. generateFile()       → Genera MP3 usando TTS
 * 4. sendToWhatsApp()     → Envía el audio al usuario
 */

import { logger } from "@tagers/shared";
import { ttsService, PauseMarkers } from "./TTSService.js";
import { briefingGenerator } from "../briefing/BriefingGenerator.js";
import { whatsappClient } from "../channels/whatsapp/WhatsAppClient.js";

/**
 * Templates de audio por sección
 */
const AUDIO_TEMPLATES = {
  greeting: {
    morning: [
      "Buenos días {name}.",
      "¡Buen día {name}!",
      "Hola {name}, buenos días.",
    ],
    afternoon: [
      "Buenas tardes {name}.",
      "¡Buena tarde {name}!",
    ],
    evening: [
      "Buenas noches {name}.",
    ],
  },

  intro: [
    "Aquí está tu resumen del día.",
    "Te tengo tu briefing de hoy.",
    "Esto es lo que necesitas saber hoy.",
  ],

  sales: {
    good: [
      "Ayer cerramos en {amount}. {pause:short} Eso es {percent} arriba de la meta.",
      "Excelentes números ayer: {amount}. {pause:short} {percent} por encima del objetivo.",
      "Gran día ayer con {amount}. {pause:short} Superamos la meta por {percent}.",
    ],
    bad: [
      "Ayer cerramos en {amount}. {pause:short} Eso es {percent} abajo de la meta.",
      "Día difícil ayer: {amount}. {pause:short} Quedamos {percent} por debajo del objetivo.",
      "Cerramos en {amount}. {pause:short} Nos faltó {percent} para la meta.",
    ],
    neutral: [
      "Ayer cerramos en {amount}. {pause:short} Justo en la meta.",
      "Alcanzamos exactamente la meta con {amount}.",
    ],
  },

  branch_highlight: {
    star: [
      "La estrella fue {branch} con {amount}.",
      "{branch} brilló con {amount}.",
      "Destacó {branch} logrando {amount}.",
    ],
    concern: [
      "Ojo con {branch}, cerró {percent} abajo.",
      "Atención a {branch}: quedó {percent} por debajo.",
      "{branch} necesita atención, bajó {percent}.",
    ],
  },

  alerts: {
    none: [
      "No tienes alertas pendientes.",
      "Todo tranquilo, sin alertas activas.",
    ],
    some: [
      "Tienes {count} alertas activas.",
      "Hay {count} alertas que requieren atención.",
    ],
    critical: [
      "Una crítica: {description}.",
      "Alerta crítica: {description}.",
    ],
    high: [
      "Una importante: {description}.",
      "Alerta alta: {description}.",
    ],
    medium: [
      "Una media: {description}.",
    ],
  },

  context: {
    weather: [
      "Para hoy: {condition}.",
      "El clima: {condition}.",
    ],
    suggestion: [
      "Sugiero {action}.",
      "Te recomiendo {action}.",
      "Considera {action}.",
    ],
    reminder: [
      "Recuerda: {item}.",
      "No olvides: {item}.",
    ],
  },

  closing: [
    "Eso es todo por ahora. Que tengas un excelente día.",
    "Eso es todo. ¡Éxito hoy!",
    "Listo, eso es lo importante. ¡Buen día!",
    "Eso es todo por ahora. Aquí estoy si necesitas algo.",
  ],
};

export class AudioBriefingGenerator {
  constructor() {
    this.tts = ttsService;
  }

  /**
   * Genera briefing de audio completo
   */
  async generate(options = {}) {
    const { userId, name = "Jorge", sendToWhatsApp = false, phone } = options;

    logger.info({ userId, name }, "Generating audio briefing");

    try {
      // Obtener datos del briefing
      const briefingData = await this.getBriefingData(options);

      // Generar script
      const script = this.scriptFromBriefing(briefingData, { name });

      // Añadir pausas naturales
      const scriptWithPauses = this.addPauses(script);

      // Generar audio
      const audioResult = await this.generateFile(scriptWithPauses);

      // Enviar a WhatsApp si se solicita
      if (sendToWhatsApp && phone) {
        await this.sendToWhatsApp(audioResult.filepath, phone);
      }

      return {
        success: true,
        script,
        audio: audioResult,
        briefingData,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "Audio briefing generation failed");
      throw err;
    }
  }

  /**
   * Obtiene datos del briefing
   */
  async getBriefingData(options) {
    try {
      // Usar el generador de briefing existente
      const briefing = await briefingGenerator.generate(options);
      return briefing;
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to get briefing data, using mock");
      return this.getMockBriefingData();
    }
  }

  /**
   * Convierte datos de briefing a script de audio
   */
  scriptFromBriefing(data, options = {}) {
    const { name = "Jorge" } = options;
    const sections = [];

    // 1. Saludo
    const greeting = this.selectTemplate(
      AUDIO_TEMPLATES.greeting[this.getTimeOfDay()],
      { name }
    );
    sections.push(greeting);

    // 2. Intro
    sections.push(PauseMarkers.SHORT);
    sections.push(this.selectTemplate(AUDIO_TEMPLATES.intro));

    // 3. Ventas
    sections.push(PauseMarkers.MEDIUM);
    const salesSection = this.generateSalesSection(data.sales);
    sections.push(salesSection);

    // 4. Alertas
    sections.push(PauseMarkers.MEDIUM);
    const alertsSection = this.generateAlertsSection(data.alerts);
    sections.push(alertsSection);

    // 5. Contexto (clima, sugerencias)
    if (data.context) {
      sections.push(PauseMarkers.MEDIUM);
      const contextSection = this.generateContextSection(data.context);
      sections.push(contextSection);
    }

    // 6. Cierre
    sections.push(PauseMarkers.LONG);
    sections.push(this.selectTemplate(AUDIO_TEMPLATES.closing));

    return sections.join("\n\n");
  }

  /**
   * Genera sección de ventas
   */
  generateSalesSection(sales) {
    if (!sales) return "No tengo datos de ventas de ayer.";

    const parts = [];

    // Total y comparación con meta
    const percentDiff = sales.vsGoal || 0;
    let template;
    
    if (percentDiff > 2) {
      template = this.selectTemplate(AUDIO_TEMPLATES.sales.good, {
        amount: this.formatMoney(sales.total),
        percent: Math.abs(percentDiff) + " por ciento",
      });
    } else if (percentDiff < -2) {
      template = this.selectTemplate(AUDIO_TEMPLATES.sales.bad, {
        amount: this.formatMoney(sales.total),
        percent: Math.abs(percentDiff) + " por ciento",
      });
    } else {
      template = this.selectTemplate(AUDIO_TEMPLATES.sales.neutral, {
        amount: this.formatMoney(sales.total),
      });
    }
    parts.push(template);

    // Sucursal estrella
    if (sales.topBranch) {
      parts.push(PauseMarkers.SHORT);
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.branch_highlight.star, {
        branch: sales.topBranch.name,
        amount: this.formatMoney(sales.topBranch.total),
      }));
    }

    // Sucursal preocupante
    if (sales.bottomBranch && sales.bottomBranch.vsGoal < -10) {
      parts.push(PauseMarkers.SHORT);
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.branch_highlight.concern, {
        branch: sales.bottomBranch.name,
        percent: Math.abs(sales.bottomBranch.vsGoal) + " por ciento",
      }));
    }

    return parts.join("\n");
  }

  /**
   * Genera sección de alertas
   */
  generateAlertsSection(alerts) {
    if (!alerts || alerts.length === 0) {
      return this.selectTemplate(AUDIO_TEMPLATES.alerts.none);
    }

    const parts = [];

    // Conteo total
    parts.push(this.selectTemplate(AUDIO_TEMPLATES.alerts.some, {
      count: alerts.length.toString(),
    }));

    // Detallar las más importantes (máximo 3)
    const critical = alerts.filter(a => a.severity === "CRITICAL");
    const high = alerts.filter(a => a.severity === "HIGH");
    const medium = alerts.filter(a => a.severity === "MEDIUM");

    let detailed = 0;
    const maxDetails = 3;

    for (const alert of critical) {
      if (detailed >= maxDetails) break;
      parts.push(PauseMarkers.SHORT);
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.alerts.critical, {
        description: this.summarizeAlert(alert),
      }));
      detailed++;
    }

    for (const alert of high) {
      if (detailed >= maxDetails) break;
      parts.push(PauseMarkers.SHORT);
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.alerts.high, {
        description: this.summarizeAlert(alert),
      }));
      detailed++;
    }

    for (const alert of medium) {
      if (detailed >= maxDetails) break;
      parts.push(PauseMarkers.SHORT);
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.alerts.medium, {
        description: this.summarizeAlert(alert),
      }));
      detailed++;
    }

    return parts.join("\n");
  }

  /**
   * Genera sección de contexto
   */
  generateContextSection(context) {
    const parts = [];

    // Clima
    if (context.weather) {
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.context.weather, {
        condition: context.weather,
      }));
    }

    // Sugerencia
    if (context.suggestion) {
      parts.push(this.selectTemplate(AUDIO_TEMPLATES.context.suggestion, {
        action: context.suggestion,
      }));
    }

    // Recordatorios
    if (context.reminders && context.reminders.length > 0) {
      for (const reminder of context.reminders.slice(0, 2)) {
        parts.push(this.selectTemplate(AUDIO_TEMPLATES.context.reminder, {
          item: reminder,
        }));
      }
    }

    return parts.join(" ");
  }

  /**
   * Añade pausas naturales al script
   */
  addPauses(script) {
    let result = script;

    // Añadir pausas después de puntos
    result = result.replace(/\.\s+(?=[A-ZÁÉÍÓÚ])/g, ". " + PauseMarkers.BREATH + " ");

    // Añadir pausas antes de "pero", "sin embargo", etc.
    result = result.replace(/\s+(pero|sin embargo|aunque|no obstante)/gi, 
      " " + PauseMarkers.BREATH + " $1");

    // Añadir pausa antes de números importantes
    result = result.replace(/:\s*(\d)/g, ": " + PauseMarkers.SHORT + " $1");

    return result;
  }

  /**
   * Genera archivo de audio
   */
  async generateFile(script) {
    return await this.tts.generateAudio(script);
  }

  /**
   * Envía audio por WhatsApp
   */
  async sendToWhatsApp(filepath, phone) {
    try {
      // Subir a storage y obtener URL
      const { url } = await this.tts.uploadToStorage(filepath);

      // Enviar por WhatsApp
      await whatsappClient.sendAudio(phone, url, {
        caption: "🦑 Tu briefing de LUCA",
      });

      logger.info({ phone }, "Audio briefing sent to WhatsApp");
      return true;
    } catch (err) {
      logger.error({ err: err?.message, phone }, "Failed to send audio to WhatsApp");
      throw err;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Selecciona template aleatorio y reemplaza variables
   */
  selectTemplate(templates, variables = {}) {
    if (!Array.isArray(templates)) return templates;
    
    const template = templates[Math.floor(Math.random() * templates.length)];
    
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{${key}}`, "g"), value);
    }
    
    return result;
  }

  /**
   * Obtiene momento del día
   */
  getTimeOfDay() {
    const hour = new Date().getHours();
    if (hour < 12) return "morning";
    if (hour < 18) return "afternoon";
    return "evening";
  }

  /**
   * Formatea dinero para lectura natural
   */
  formatMoney(amount) {
    if (!amount) return "cero pesos";
    
    // El TTSService convertirá esto a palabras
    return `$${amount.toLocaleString("es-MX")} pesos`;
  }

  /**
   * Resume alerta para audio
   */
  summarizeAlert(alert) {
    // Crear resumen corto y natural
    const type = alert.type || "anomalía";
    const branch = alert.branch?.name || "";
    const desc = alert.description || "";

    if (branch && desc) {
      return `${type} en ${branch}, ${desc.substring(0, 50)}`;
    } else if (desc) {
      return desc.substring(0, 80);
    } else {
      return `${type}${branch ? " en " + branch : ""} que necesita tu atención`;
    }
  }

  /**
   * Mock data para desarrollo
   */
  getMockBriefingData() {
    return {
      sales: {
        total: 487520,
        vsGoal: 8,
        topBranch: {
          name: "Angelópolis",
          total: 142000,
        },
        bottomBranch: {
          name: "San Ángel",
          total: 45000,
          vsGoal: -12,
        },
      },
      alerts: [
        {
          severity: "CRITICAL",
          type: "posible fraude",
          branch: { name: "Zavaleta" },
          description: "patrón de cancelaciones sospechosas",
        },
        {
          severity: "MEDIUM",
          type: "caída en ventas",
          branch: { name: "San Ángel" },
          description: "investigando causa",
        },
      ],
      context: {
        weather: "se espera lluvia en la tarde en la Ciudad de México",
        suggestion: "reforzar delivery en San Ángel",
      },
    };
  }
}

export const audioBriefingGenerator = new AudioBriefingGenerator();

export default AudioBriefingGenerator;
