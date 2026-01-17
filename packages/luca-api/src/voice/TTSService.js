/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TTS SERVICE - Text-to-Speech para Audio Briefing
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Convierte texto en audio usando:
 * - OpenAI TTS (primario)
 * - ElevenLabs (alternativo)
 * 
 * Características:
 * - Voz natural en español mexicano
 * - Soporte para pausas y énfasis
 * - Optimización para móvil
 * - Upload a storage para envío por WhatsApp
 */

import { logger } from "@tagers/shared";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const STORAGE_PATH = process.env.AUDIO_STORAGE_PATH || "/tmp/luca-audio";

/**
 * Voces disponibles
 */
export const Voices = {
  // OpenAI voices
  OPENAI: {
    ALLOY: "alloy",      // Neutral
    ECHO: "echo",        // Male
    FABLE: "fable",      // British
    ONYX: "onyx",        // Deep male
    NOVA: "nova",        // Female
    SHIMMER: "shimmer",  // Female soft
  },
  // ElevenLabs voices
  ELEVENLABS: {
    RACHEL: "21m00Tcm4TlvDq8ikWAM", // Calm female
    DOMI: "AZnzlk1XvdvUeBnXmlld",   // Strong female
    BELLA: "EXAVITQu4vr4xnSDxMaL",  // Soft female
    ANTONI: "ErXwobaYiN019PkySvjV", // Nice male
    JOSH: "TxGEqnHWrfWFTfGW9XjX",   // Deep male
  },
};

/**
 * Configuración de voz por defecto para LUCA
 */
const DEFAULT_CONFIG = {
  provider: "openai",
  voice: Voices.OPENAI.NOVA,
  model: "tts-1-hd",      // Alta calidad
  speed: 1.0,             // Velocidad normal
  format: "mp3",
  sampleRate: 24000,
};

/**
 * Marcadores de pausa para el script
 */
export const PauseMarkers = {
  SHORT: "{pause:short}",    // 0.3s
  MEDIUM: "{pause:medium}",  // 0.7s
  LONG: "{pause:long}",      // 1.5s
  BREATH: "{pause:breath}",  // 0.2s (respiro natural)
};

/**
 * Duración de pausas en segundos
 */
const PAUSE_DURATIONS = {
  short: 0.3,
  medium: 0.7,
  long: 1.5,
  breath: 0.2,
};

export class TTSService {
  constructor(config = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.ensureStorageDir();
  }

  /**
   * Asegura que existe el directorio de storage
   */
  ensureStorageDir() {
    if (!fs.existsSync(STORAGE_PATH)) {
      fs.mkdirSync(STORAGE_PATH, { recursive: true });
    }
  }

  /**
   * Genera audio desde texto
   */
  async generateAudio(text, options = {}) {
    const config = { ...this.config, ...options };
    
    logger.info({ 
      textLength: text.length, 
      provider: config.provider 
    }, "Generating TTS audio");

    try {
      // Preprocesar texto (convertir números, añadir pausas SSML-like)
      const processedText = this.preprocessText(text);

      let audioBuffer;
      
      if (config.provider === "openai") {
        audioBuffer = await this.generateWithOpenAI(processedText, config);
      } else if (config.provider === "elevenlabs") {
        audioBuffer = await this.generateWithElevenLabs(processedText, config);
      } else {
        throw new Error(`Unknown TTS provider: ${config.provider}`);
      }

      // Guardar archivo
      const filename = `briefing_${Date.now()}.${config.format}`;
      const filepath = path.join(STORAGE_PATH, filename);
      
      fs.writeFileSync(filepath, audioBuffer);

      // Calcular duración estimada
      const duration = this.estimateDuration(text);

      logger.info({ filepath, duration }, "TTS audio generated");

      return {
        success: true,
        filepath,
        filename,
        duration,
        format: config.format,
        size: audioBuffer.length,
      };

    } catch (err) {
      logger.error({ err: err?.message }, "TTS generation failed");
      
      // Intentar fallback
      if (config.provider === "openai" && ELEVENLABS_API_KEY) {
        logger.info("Trying ElevenLabs fallback");
        return this.generateAudio(text, { ...options, provider: "elevenlabs" });
      }
      
      throw err;
    }
  }

  /**
   * Genera audio con OpenAI TTS
   */
  async generateWithOpenAI(text, config) {
    if (!OPENAI_API_KEY) {
      throw new Error("OpenAI API key not configured");
    }

    // Dividir texto en chunks si es muy largo (máx 4096 chars)
    const chunks = this.splitIntoChunks(text, 4000);
    const audioBuffers = [];

    for (const chunk of chunks) {
      const response = await fetch("https://api.openai.com/v1/audio/speech", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: config.model || "tts-1-hd",
          voice: config.voice || "nova",
          input: chunk,
          response_format: config.format || "mp3",
          speed: config.speed || 1.0,
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error?.message || `OpenAI TTS error: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      audioBuffers.push(Buffer.from(arrayBuffer));
    }

    // Concatenar buffers si hay múltiples chunks
    return Buffer.concat(audioBuffers);
  }

  /**
   * Genera audio con ElevenLabs
   */
  async generateWithElevenLabs(text, config) {
    if (!ELEVENLABS_API_KEY) {
      throw new Error("ElevenLabs API key not configured");
    }

    const voiceId = config.voice || Voices.ELEVENLABS.RACHEL;

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
      {
        method: "POST",
        headers: {
          "xi-api-key": ELEVENLABS_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: "eleven_multilingual_v2",
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.5,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail?.message || `ElevenLabs error: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  /**
   * Preprocesa texto para TTS
   */
  preprocessText(text) {
    let processed = text;

    // Convertir números a palabras para mejor pronunciación
    processed = this.numbersToWords(processed);

    // Convertir marcadores de pausa a silencios naturales
    // OpenAI no soporta SSML, usamos puntuación para pausas
    processed = processed
      .replace(/{pause:short}/g, "...")
      .replace(/{pause:medium}/g, ". . .")
      .replace(/{pause:long}/g, ". . . . .")
      .replace(/{pause:breath}/g, ",");

    // Añadir énfasis con puntuación
    processed = processed
      .replace(/{emphasis}(.*?){\/emphasis}/g, "¡$1!")
      .replace(/{slow}(.*?){\/slow}/g, "... $1 ...");

    // Limpiar múltiples espacios
    processed = processed.replace(/\s+/g, " ").trim();

    return processed;
  }

  /**
   * Convierte números a palabras en español
   */
  numbersToWords(text) {
    // Números con formato de moneda
    text = text.replace(/\$?([\d,]+(?:\.\d{2})?)\s*(?:pesos|MXN)?/gi, (match, num) => {
      const cleanNum = parseFloat(num.replace(/,/g, ""));
      return this.numberToSpanish(cleanNum) + " pesos";
    });

    // Porcentajes
    text = text.replace(/(\d+(?:\.\d+)?)\s*%/g, (match, num) => {
      return this.numberToSpanish(parseFloat(num)) + " por ciento";
    });

    // Años
    text = text.replace(/\b(20\d{2})\b/g, (match, year) => {
      return this.yearToSpanish(parseInt(year));
    });

    // Horas
    text = text.replace(/(\d{1,2}):(\d{2})\s*(am|pm)?/gi, (match, h, m, ampm) => {
      const hour = parseInt(h);
      const min = parseInt(m);
      let result = this.numberToSpanish(hour);
      if (min > 0) {
        result += " y " + this.numberToSpanish(min);
      }
      if (ampm) {
        result += ampm.toLowerCase() === "am" ? " de la mañana" : " de la tarde";
      }
      return result;
    });

    return text;
  }

  /**
   * Convierte número a español
   */
  numberToSpanish(num) {
    if (num === 0) return "cero";
    
    const units = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve"];
    const teens = ["diez", "once", "doce", "trece", "catorce", "quince", "dieciséis", "diecisiete", "dieciocho", "diecinueve"];
    const tens = ["", "", "veinte", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
    const hundreds = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];

    if (num < 0) return "menos " + this.numberToSpanish(-num);
    if (num < 10) return units[num];
    if (num < 20) return teens[num - 10];
    if (num < 100) {
      if (num === 20) return "veinte";
      if (num < 30) return "veinti" + units[num - 20];
      const ten = Math.floor(num / 10);
      const unit = num % 10;
      return tens[ten] + (unit > 0 ? " y " + units[unit] : "");
    }
    if (num === 100) return "cien";
    if (num < 1000) {
      const hundred = Math.floor(num / 100);
      const rest = num % 100;
      return hundreds[hundred] + (rest > 0 ? " " + this.numberToSpanish(rest) : "");
    }
    if (num < 1000000) {
      const thousands = Math.floor(num / 1000);
      const rest = num % 1000;
      const prefix = thousands === 1 ? "mil" : this.numberToSpanish(thousands) + " mil";
      return prefix + (rest > 0 ? " " + this.numberToSpanish(rest) : "");
    }
    if (num < 1000000000) {
      const millions = Math.floor(num / 1000000);
      const rest = num % 1000000;
      const prefix = millions === 1 ? "un millón" : this.numberToSpanish(millions) + " millones";
      return prefix + (rest > 0 ? " " + this.numberToSpanish(rest) : "");
    }

    // Para números muy grandes, usar formato simplificado
    return num.toLocaleString("es-MX");
  }

  /**
   * Convierte año a español
   */
  yearToSpanish(year) {
    if (year >= 2000 && year < 2100) {
      return "dos mil " + (year > 2000 ? this.numberToSpanish(year - 2000) : "");
    }
    return this.numberToSpanish(year);
  }

  /**
   * Divide texto en chunks
   */
  splitIntoChunks(text, maxLength) {
    if (text.length <= maxLength) return [text];

    const chunks = [];
    const sentences = text.split(/(?<=[.!?])\s+/);
    let currentChunk = "";

    for (const sentence of sentences) {
      if ((currentChunk + sentence).length > maxLength) {
        if (currentChunk) {
          chunks.push(currentChunk.trim());
          currentChunk = "";
        }
        // Si una sola oración es muy larga, dividir por comas
        if (sentence.length > maxLength) {
          const parts = sentence.split(/(?<=,)\s+/);
          for (const part of parts) {
            if ((currentChunk + part).length > maxLength) {
              chunks.push(currentChunk.trim());
              currentChunk = part;
            } else {
              currentChunk += " " + part;
            }
          }
        } else {
          currentChunk = sentence;
        }
      } else {
        currentChunk += " " + sentence;
      }
    }

    if (currentChunk.trim()) {
      chunks.push(currentChunk.trim());
    }

    return chunks;
  }

  /**
   * Estima duración del audio en segundos
   */
  estimateDuration(text) {
    // Aproximadamente 150 palabras por minuto en español
    const words = text.split(/\s+/).length;
    const baseSeconds = (words / 150) * 60;

    // Añadir tiempo de pausas
    const shortPauses = (text.match(/{pause:short}/g) || []).length * PAUSE_DURATIONS.short;
    const mediumPauses = (text.match(/{pause:medium}/g) || []).length * PAUSE_DURATIONS.medium;
    const longPauses = (text.match(/{pause:long}/g) || []).length * PAUSE_DURATIONS.long;

    return Math.ceil(baseSeconds + shortPauses + mediumPauses + longPauses);
  }

  /**
   * Optimiza audio para móvil (reduce bitrate)
   */
  async optimizeForMobile(filepath) {
    // TODO: Usar ffmpeg para optimizar
    // Por ahora retorna el mismo archivo
    logger.info({ filepath }, "Audio optimization (placeholder)");
    return filepath;
  }

  /**
   * Sube audio a storage (S3, GCS, etc.)
   */
  async uploadToStorage(filepath, options = {}) {
    // TODO: Implementar upload a cloud storage
    // Por ahora retorna URL local
    const filename = path.basename(filepath);
    const publicUrl = `${process.env.API_URL || "http://localhost:3000"}/audio/${filename}`;
    
    logger.info({ filepath, publicUrl }, "Audio upload (placeholder)");
    
    return {
      url: publicUrl,
      filepath,
    };
  }

  /**
   * Limpia archivos de audio antiguos
   */
  async cleanupOldFiles(maxAgeDays = 7) {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();
    let cleaned = 0;

    const files = fs.readdirSync(STORAGE_PATH);
    for (const file of files) {
      const filepath = path.join(STORAGE_PATH, file);
      const stat = fs.statSync(filepath);
      
      if (now - stat.mtimeMs > maxAge) {
        fs.unlinkSync(filepath);
        cleaned++;
      }
    }

    logger.info({ cleaned }, "Cleaned old audio files");
    return cleaned;
  }
}

// Export singleton
export const ttsService = new TTSService();

export default TTSService;
