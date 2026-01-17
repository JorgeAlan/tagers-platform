/**
 * ═══════════════════════════════════════════════════════════════════════════
 * VOICE ROUTES - API para Voz y Conversación
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { ttsService, Voices } from "../voice/TTSService.js";
import { audioBriefingGenerator } from "../voice/AudioBriefingGenerator.js";
import { lucaConversation } from "../conversational/LucaConversation.js";
import { contextManager } from "../conversational/context/ConversationContext.js";
import path from "path";
import fs from "fs";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// TTS - Text-to-Speech
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/voice/tts
 * Genera audio desde texto
 */
router.post("/tts", async (req, res) => {
  try {
    const { text, voice, provider, speed } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: "text required" });
    }
    
    const result = await ttsService.generateAudio(text, {
      voice,
      provider,
      speed,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "TTS generation failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/voice/tts/voices
 * Lista voces disponibles
 */
router.get("/tts/voices", (req, res) => {
  res.json({
    openai: Voices.OPENAI,
    elevenlabs: Voices.ELEVENLABS,
    default: {
      provider: "openai",
      voice: Voices.OPENAI.NOVA,
    },
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUDIO BRIEFING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/voice/briefing
 * Genera briefing de audio
 */
router.post("/briefing", async (req, res) => {
  try {
    const { user_id, name, send_to_whatsapp, phone } = req.body;
    
    const result = await audioBriefingGenerator.generate({
      userId: user_id,
      name: name || "Jorge",
      sendToWhatsApp: send_to_whatsapp,
      phone,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Audio briefing generation failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/voice/briefing/preview
 * Genera preview del script sin audio
 */
router.get("/briefing/preview", async (req, res) => {
  try {
    const { name } = req.query;
    
    const briefingData = await audioBriefingGenerator.getBriefingData({});
    const script = audioBriefingGenerator.scriptFromBriefing(briefingData, { 
      name: name || "Jorge" 
    });
    
    res.json({
      script,
      estimatedDuration: ttsService.estimateDuration(script),
      briefingData,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/voice/audio/:filename
 * Sirve archivo de audio
 */
router.get("/audio/:filename", (req, res) => {
  try {
    const { filename } = req.params;
    const filepath = path.join(process.env.AUDIO_STORAGE_PATH || "/tmp/luca-audio", filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).json({ error: "Audio not found" });
    }
    
    const stat = fs.statSync(filepath);
    const ext = path.extname(filename).toLowerCase();
    const contentType = ext === ".mp3" ? "audio/mpeg" : 
                        ext === ".ogg" ? "audio/ogg" : "audio/wav";
    
    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Length", stat.size);
    
    fs.createReadStream(filepath).pipe(res);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CONVERSATIONAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/voice/chat
 * Procesa mensaje conversacional
 */
router.post("/chat", async (req, res) => {
  try {
    const { user_id, message, channel, metadata } = req.body;
    
    if (!user_id || !message) {
      return res.status(400).json({ error: "user_id and message required" });
    }
    
    const response = await lucaConversation.processMessage(user_id, message, {
      channel,
      ...metadata,
    });
    
    // Obtener sugerencias de respuesta
    const suggestions = lucaConversation.getSuggestedReplies(response);
    
    res.json({
      ...response,
      suggestions,
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Chat processing failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/voice/chat/whatsapp
 * Procesa mensaje de WhatsApp
 */
router.post("/chat/whatsapp", async (req, res) => {
  try {
    const { phone, message, metadata } = req.body;
    
    if (!phone || !message) {
      return res.status(400).json({ error: "phone and message required" });
    }
    
    const response = await lucaConversation.processWhatsAppMessage(phone, message, metadata);
    
    res.json(response);
  } catch (err) {
    logger.error({ err: err?.message }, "WhatsApp chat processing failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/voice/chat/context/:userId
 * Obtiene contexto de conversación
 */
router.get("/chat/context/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    const context = contextManager.getContext(userId);
    
    res.json(context.toJSON());
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * DELETE /api/luca/voice/chat/context/:userId
 * Elimina contexto de conversación
 */
router.delete("/chat/context/:userId", (req, res) => {
  try {
    const { userId } = req.params;
    contextManager.deleteContext(userId);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * POST /api/luca/voice/detect-intent
 * Detecta intent sin ejecutar
 */
router.post("/detect-intent", (req, res) => {
  try {
    const { message } = req.body;
    
    if (!message) {
      return res.status(400).json({ error: "message required" });
    }
    
    const { intent, confidence } = require("../conversational/intents/index.js").detectIntent(message);
    
    res.json({
      intent: intent?.name || null,
      confidence,
      recognized: !!intent,
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// STATUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/voice/status
 * Estado del sistema de voz
 */
router.get("/status", (req, res) => {
  const stats = lucaConversation.getStats();
  
  res.json({
    service: "voice",
    status: "operational",
    tts: {
      openaiConfigured: !!process.env.OPENAI_API_KEY,
      elevenlabsConfigured: !!process.env.ELEVENLABS_API_KEY,
    },
    conversation: stats,
  });
});

/**
 * POST /api/luca/voice/cleanup
 * Limpia archivos de audio antiguos
 */
router.post("/cleanup", async (req, res) => {
  try {
    const { max_age_days } = req.body;
    const cleaned = await ttsService.cleanupOldFiles(max_age_days || 7);
    
    res.json({ success: true, cleaned });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
