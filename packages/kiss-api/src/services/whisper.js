/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHISPER SERVICE - Transcripción de Audio con OpenAI Whisper
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Transcribe notas de voz de WhatsApp a texto.
 * Muy común en México - ~40% de mensajes de WhatsApp son audio.
 * 
 * Soporta:
 * - Audio de WhatsApp (opus/ogg)
 * - MP3, M4A, WAV, WEBM
 * - Hasta 25MB por archivo
 * 
 * @version 1.0.0
 */

import OpenAI from "openai";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import fetch from "node-fetch";
import { Readable } from "stream";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const whisperConfig = {
  enabled: process.env.WHISPER_ENABLED !== "false",
  model: process.env.WHISPER_MODEL || "whisper-1",
  language: process.env.WHISPER_LANGUAGE || "es", // Español por defecto
  maxFileSizeBytes: parseInt(process.env.WHISPER_MAX_FILE_SIZE || String(25 * 1024 * 1024), 10), // 25MB
  timeoutMs: parseInt(process.env.WHISPER_TIMEOUT_MS || "60000", 10), // 60s
};

// Formatos de audio soportados
const SUPPORTED_FORMATS = [
  "audio/ogg",
  "audio/opus", 
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/webm",
  "audio/x-m4a",
  "application/ogg",
];

// ═══════════════════════════════════════════════════════════════════════════
// CLIENTE OPENAI
// ═══════════════════════════════════════════════════════════════════════════

let _client = null;

function getClient() {
  if (_client) return _client;
  
  const apiKey = process.env.OPENAI_WHISPER_API_KEY || config.openaiApiKey;
  
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not set. Whisper cannot transcribe.");
  }
  
  _client = new OpenAI({
    apiKey,
    timeout: whisperConfig.timeoutMs,
    maxRetries: 2,
  });
  
  return _client;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Determina si un content-type es audio soportado
 */
function isSupportedAudio(contentType) {
  if (!contentType) return false;
  const ct = contentType.toLowerCase().split(";")[0].trim();
  return SUPPORTED_FORMATS.includes(ct);
}

/**
 * Obtiene extensión de archivo desde content-type
 */
function getExtensionFromContentType(contentType) {
  const ct = (contentType || "").toLowerCase();
  
  if (ct.includes("ogg") || ct.includes("opus")) return "ogg";
  if (ct.includes("mp3") || ct.includes("mpeg")) return "mp3";
  if (ct.includes("mp4") || ct.includes("m4a")) return "m4a";
  if (ct.includes("wav")) return "wav";
  if (ct.includes("webm")) return "webm";
  
  return "ogg"; // Default para WhatsApp
}

/**
 * Descarga archivo de audio desde URL
 */
async function downloadAudio(url, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const contentType = response.headers.get("content-type") || "";
    const contentLength = parseInt(response.headers.get("content-length") || "0", 10);
    
    if (contentLength > whisperConfig.maxFileSizeBytes) {
      throw new Error(`File too large: ${contentLength} bytes (max: ${whisperConfig.maxFileSizeBytes})`);
    }
    
    const buffer = await response.buffer();
    
    return {
      buffer,
      contentType,
      size: buffer.length,
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transcribe audio desde URL
 * 
 * @param {string} audioUrl - URL del archivo de audio
 * @param {Object} options
 * @param {Object} [options.headers] - Headers para descargar (auth de Chatwoot)
 * @param {string} [options.language] - Código de idioma (es, en, etc.)
 * @param {string} [options.prompt] - Prompt para guiar transcripción
 * @returns {Promise<{text: string, duration?: number}|null>}
 */
export async function transcribeFromUrl(audioUrl, options = {}) {
  if (!whisperConfig.enabled) {
    logger.debug("Whisper disabled");
    return null;
  }
  
  if (!audioUrl) {
    return null;
  }
  
  const startTime = Date.now();
  
  try {
    // 1. Descargar audio
    logger.debug({ url: audioUrl.substring(0, 100) }, "Downloading audio for transcription");
    
    const { buffer, contentType, size } = await downloadAudio(audioUrl, options.headers || {});
    
    if (!isSupportedAudio(contentType)) {
      logger.warn({ contentType }, "Unsupported audio format");
      return null;
    }
    
    // 2. Preparar para OpenAI
    const extension = getExtensionFromContentType(contentType);
    const filename = `audio.${extension}`;
    
    // Crear File object para OpenAI
    const file = new File([buffer], filename, { type: contentType });
    
    // 3. Transcribir con Whisper
    const client = getClient();
    
    const transcription = await client.audio.transcriptions.create({
      file,
      model: whisperConfig.model,
      language: options.language || whisperConfig.language,
      prompt: options.prompt || "Transcripción de nota de voz de cliente de panadería/restaurante en México.",
      response_format: "json",
    });
    
    const text = transcription.text?.trim();
    
    if (!text) {
      logger.warn("Whisper returned empty transcription");
      return null;
    }
    
    logger.info({
      durationMs: Date.now() - startTime,
      audioSize: size,
      textLength: text.length,
    }, "Audio transcribed successfully");
    
    return {
      text,
      duration: transcription.duration,
    };
    
  } catch (error) {
    logger.error({
      err: error?.message,
      url: audioUrl?.substring(0, 100),
    }, "Failed to transcribe audio");
    
    return null;
  }
}

/**
 * Transcribe audio desde buffer
 * 
 * @param {Buffer} audioBuffer - Buffer del audio
 * @param {Object} options
 * @param {string} [options.contentType] - MIME type del audio
 * @param {string} [options.language] - Código de idioma
 * @returns {Promise<{text: string, duration?: number}|null>}
 */
export async function transcribeFromBuffer(audioBuffer, options = {}) {
  if (!whisperConfig.enabled) {
    return null;
  }
  
  if (!audioBuffer || audioBuffer.length === 0) {
    return null;
  }
  
  if (audioBuffer.length > whisperConfig.maxFileSizeBytes) {
    logger.warn({ size: audioBuffer.length }, "Audio buffer too large");
    return null;
  }
  
  const startTime = Date.now();
  
  try {
    const contentType = options.contentType || "audio/ogg";
    const extension = getExtensionFromContentType(contentType);
    const filename = `audio.${extension}`;
    
    const file = new File([audioBuffer], filename, { type: contentType });
    
    const client = getClient();
    
    const transcription = await client.audio.transcriptions.create({
      file,
      model: whisperConfig.model,
      language: options.language || whisperConfig.language,
      prompt: options.prompt || "Transcripción de nota de voz de cliente.",
      response_format: "json",
    });
    
    const text = transcription.text?.trim();
    
    if (!text) {
      return null;
    }
    
    logger.info({
      durationMs: Date.now() - startTime,
      audioSize: audioBuffer.length,
      textLength: text.length,
    }, "Audio buffer transcribed");
    
    return {
      text,
      duration: transcription.duration,
    };
    
  } catch (error) {
    logger.error({ err: error?.message }, "Failed to transcribe audio buffer");
    return null;
  }
}

/**
 * Verifica si Whisper está habilitado y configurado
 */
export function isWhisperEnabled() {
  return whisperConfig.enabled && !!config.openaiApiKey;
}

/**
 * Verifica si un attachment de Chatwoot es audio transcribible
 */
export function isTranscribableAttachment(attachment) {
  if (!attachment) return false;
  
  const fileType = attachment.file_type || "";
  const contentType = attachment.content_type || "";
  
  // Chatwoot marca audios como file_type: "audio"
  if (fileType === "audio") return true;
  
  return isSupportedAudio(contentType);
}

/**
 * Obtiene configuración actual
 */
export function getWhisperConfig() {
  return { ...whisperConfig };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════

export const whisperService = {
  transcribeFromUrl,
  transcribeFromBuffer,
  isEnabled: isWhisperEnabled,
  isTranscribableAttachment,
  getConfig: getWhisperConfig,
};

export default whisperService;
