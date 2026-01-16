/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CHUNKER - División inteligente de documentos para embeddings
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Estrategias de chunking:
 * 1. SEMANTIC - Por secciones (headers, párrafos)
 * 2. FIXED - Por tamaño fijo con overlap
 * 3. SENTENCE - Por oraciones completas
 * 4. PARAGRAPH - Por párrafos
 * 
 * El tamaño óptimo de chunk para embeddings es 200-500 tokens (~800-2000 chars)
 * 
 * @version 1.0.0
 */

import { logger } from "../utils/logger.js";
import crypto from "crypto";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const chunkerConfig = {
  // Tamaño objetivo de chunks (en caracteres)
  targetChunkSize: parseInt(process.env.RAG_CHUNK_SIZE || "1200", 10),
  
  // Overlap entre chunks (para mantener contexto)
  overlapSize: parseInt(process.env.RAG_CHUNK_OVERLAP || "200", 10),
  
  // Tamaño mínimo de chunk (evitar chunks muy pequeños)
  minChunkSize: parseInt(process.env.RAG_MIN_CHUNK_SIZE || "100", 10),
  
  // Tamaño máximo de chunk
  maxChunkSize: parseInt(process.env.RAG_MAX_CHUNK_SIZE || "3000", 10),
  
  // Estrategia por defecto
  defaultStrategy: process.env.RAG_CHUNK_STRATEGY || "semantic",
};

// ═══════════════════════════════════════════════════════════════════════════
// SEPARADORES POR PRIORIDAD
// ═══════════════════════════════════════════════════════════════════════════

const SEPARATORS = {
  // Nivel 1: Separadores de sección (máxima prioridad)
  section: [
    /\n#{1,6}\s+/,           // Headers markdown
    /\n\*{3,}/,              // Líneas de asteriscos
    /\n-{3,}/,               // Líneas de guiones
    /\n={3,}/,               // Líneas de igual
    /\n\n\n+/,               // Múltiples líneas vacías
  ],
  
  // Nivel 2: Separadores de párrafo
  paragraph: [
    /\n\n/,                  // Doble salto de línea
  ],
  
  // Nivel 3: Separadores de oración
  sentence: [
    /(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚ])/,  // Fin de oración seguido de mayúscula
    /(?<=[.!?])\n/,                  // Fin de oración + salto de línea
  ],
  
  // Nivel 4: Separadores de frase
  phrase: [
    /;\s*/,                  // Punto y coma
    /:\s*/,                  // Dos puntos
    /,\s+/,                  // Coma (con cuidado)
  ],
  
  // Nivel 5: Último recurso
  word: [
    /\s+/,                   // Cualquier espacio
  ],
};

// ═══════════════════════════════════════════════════════════════════════════
// ESTRATEGIAS DE CHUNKING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chunking semántico - Respeta estructura del documento
 * Mejor para documentos con headers y secciones claras
 */
function chunkSemantic(text, options = {}) {
  const {
    targetSize = chunkerConfig.targetChunkSize,
    overlap = chunkerConfig.overlapSize,
    minSize = chunkerConfig.minChunkSize,
  } = options;
  
  const chunks = [];
  
  // Primero dividir por secciones principales
  let sections = [text];
  
  for (const separator of SEPARATORS.section) {
    const newSections = [];
    for (const section of sections) {
      const parts = section.split(separator).filter(p => p.trim());
      newSections.push(...parts);
    }
    sections = newSections;
  }
  
  // Procesar cada sección
  for (const section of sections) {
    if (section.length <= targetSize) {
      if (section.trim().length >= minSize) {
        chunks.push(section.trim());
      }
      continue;
    }
    
    // Sección muy grande: dividir por párrafos
    const subChunks = chunkByParagraphs(section, { targetSize, overlap, minSize });
    chunks.push(...subChunks);
  }
  
  return mergeSmallChunks(chunks, { targetSize, minSize });
}

/**
 * Chunking por párrafos
 */
function chunkByParagraphs(text, options = {}) {
  const {
    targetSize = chunkerConfig.targetChunkSize,
    overlap = chunkerConfig.overlapSize,
    minSize = chunkerConfig.minChunkSize,
  } = options;
  
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  const chunks = [];
  let currentChunk = "";
  
  for (const para of paragraphs) {
    const trimmedPara = para.trim();
    
    if (!trimmedPara) continue;
    
    // Si el párrafo solo cabe en chunk actual
    if (currentChunk.length + trimmedPara.length + 2 <= targetSize) {
      currentChunk = currentChunk 
        ? currentChunk + "\n\n" + trimmedPara 
        : trimmedPara;
      continue;
    }
    
    // Si hay chunk acumulado, guardarlo
    if (currentChunk.length >= minSize) {
      chunks.push(currentChunk);
    }
    
    // Si el párrafo es muy grande, dividirlo por oraciones
    if (trimmedPara.length > targetSize) {
      const subChunks = chunkBySentences(trimmedPara, { targetSize, overlap, minSize });
      chunks.push(...subChunks);
      currentChunk = "";
    } else {
      currentChunk = trimmedPara;
    }
  }
  
  // No olvidar el último chunk
  if (currentChunk.length >= minSize) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Chunking por oraciones
 */
function chunkBySentences(text, options = {}) {
  const {
    targetSize = chunkerConfig.targetChunkSize,
    overlap = chunkerConfig.overlapSize,
    minSize = chunkerConfig.minChunkSize,
  } = options;
  
  // Dividir en oraciones
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim());
  
  const chunks = [];
  let currentChunk = "";
  
  for (const sentence of sentences) {
    const trimmedSentence = sentence.trim();
    
    if (currentChunk.length + trimmedSentence.length + 1 <= targetSize) {
      currentChunk = currentChunk 
        ? currentChunk + " " + trimmedSentence 
        : trimmedSentence;
      continue;
    }
    
    if (currentChunk.length >= minSize) {
      chunks.push(currentChunk);
    }
    
    // Si oración individual es muy grande, dividir por comas
    if (trimmedSentence.length > targetSize) {
      const subChunks = chunkByPhrases(trimmedSentence, { targetSize, minSize });
      chunks.push(...subChunks);
      currentChunk = "";
    } else {
      currentChunk = trimmedSentence;
    }
  }
  
  if (currentChunk.length >= minSize) {
    chunks.push(currentChunk);
  }
  
  return chunks;
}

/**
 * Chunking por frases (último recurso antes de fixed)
 */
function chunkByPhrases(text, options = {}) {
  const { targetSize, minSize } = options;
  
  const phrases = text.split(/[,;:]\s*/).filter(p => p.trim());
  const chunks = [];
  let currentChunk = "";
  
  for (const phrase of phrases) {
    if (currentChunk.length + phrase.length + 2 <= targetSize) {
      currentChunk = currentChunk ? currentChunk + ", " + phrase : phrase;
    } else {
      if (currentChunk.length >= minSize) {
        chunks.push(currentChunk);
      }
      currentChunk = phrase;
    }
  }
  
  if (currentChunk.length >= minSize) {
    chunks.push(currentChunk);
  }
  
  return chunks.length ? chunks : [text]; // Fallback al texto original
}

/**
 * Chunking de tamaño fijo con overlap
 * Mejor para textos sin estructura clara
 */
function chunkFixed(text, options = {}) {
  const {
    targetSize = chunkerConfig.targetChunkSize,
    overlap = chunkerConfig.overlapSize,
    minSize = chunkerConfig.minChunkSize,
  } = options;
  
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    let end = start + targetSize;
    
    // No cortar palabras a la mitad
    if (end < text.length) {
      // Buscar el espacio más cercano hacia atrás
      const lastSpace = text.lastIndexOf(" ", end);
      if (lastSpace > start) {
        end = lastSpace;
      }
    }
    
    const chunk = text.slice(start, end).trim();
    
    if (chunk.length >= minSize) {
      chunks.push(chunk);
    }
    
    // Siguiente chunk empieza con overlap
    start = end - overlap;
    if (start <= 0) start = end;
  }
  
  return chunks;
}

/**
 * Merge chunks pequeños adyacentes
 */
function mergeSmallChunks(chunks, options = {}) {
  const { targetSize, minSize } = options;
  
  if (chunks.length <= 1) return chunks;
  
  const merged = [];
  let buffer = "";
  
  for (const chunk of chunks) {
    if (buffer.length + chunk.length + 2 <= targetSize) {
      buffer = buffer ? buffer + "\n\n" + chunk : chunk;
    } else {
      if (buffer) merged.push(buffer);
      buffer = chunk;
    }
  }
  
  if (buffer) merged.push(buffer);
  
  return merged;
}

// ═══════════════════════════════════════════════════════════════════════════
// API PÚBLICA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Divide un documento en chunks óptimos para embedding
 * 
 * @param {string} text - Texto a dividir
 * @param {Object} options
 * @param {string} [options.strategy="semantic"] - Estrategia: semantic, fixed, sentence, paragraph
 * @param {number} [options.targetSize] - Tamaño objetivo en caracteres
 * @param {number} [options.overlap] - Overlap entre chunks
 * @param {Object} [options.metadata] - Metadata a incluir en cada chunk
 * @returns {Array<{text: string, index: number, metadata: Object}>}
 */
export function chunkDocument(text, options = {}) {
  if (!text || typeof text !== "string") {
    return [];
  }
  
  const {
    strategy = chunkerConfig.defaultStrategy,
    targetSize = chunkerConfig.targetChunkSize,
    overlap = chunkerConfig.overlapSize,
    metadata = {},
  } = options;
  
  const cleanText = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  
  if (!cleanText) return [];
  
  // Si el texto es pequeño, un solo chunk
  if (cleanText.length <= chunkerConfig.maxChunkSize) {
    return [{
      text: cleanText,
      index: 0,
      charStart: 0,
      charEnd: cleanText.length,
      hash: hashText(cleanText),
      metadata: {
        ...metadata,
        strategy: "single",
        totalChunks: 1,
      },
    }];
  }
  
  // Aplicar estrategia
  let rawChunks;
  
  switch (strategy) {
    case "fixed":
      rawChunks = chunkFixed(cleanText, { targetSize, overlap });
      break;
    case "sentence":
      rawChunks = chunkBySentences(cleanText, { targetSize, overlap });
      break;
    case "paragraph":
      rawChunks = chunkByParagraphs(cleanText, { targetSize, overlap });
      break;
    case "semantic":
    default:
      rawChunks = chunkSemantic(cleanText, { targetSize, overlap });
      break;
  }
  
  // Enriquecer chunks con metadata
  let charOffset = 0;
  const chunks = rawChunks.map((chunkText, index) => {
    // Encontrar posición real en texto original
    const charStart = cleanText.indexOf(chunkText, charOffset);
    const charEnd = charStart + chunkText.length;
    charOffset = charStart;
    
    return {
      text: chunkText,
      index,
      charStart,
      charEnd,
      hash: hashText(chunkText),
      metadata: {
        ...metadata,
        strategy,
        chunkIndex: index,
        totalChunks: rawChunks.length,
        charLength: chunkText.length,
        wordCount: chunkText.split(/\s+/).length,
      },
    };
  });
  
  logger.debug({
    strategy,
    inputLength: cleanText.length,
    outputChunks: chunks.length,
    avgChunkSize: Math.round(cleanText.length / chunks.length),
  }, "Document chunked");
  
  return chunks;
}

/**
 * Genera hash único para un chunk
 */
function hashText(text) {
  return crypto
    .createHash("sha256")
    .update(text.toLowerCase().trim())
    .digest("hex")
    .substring(0, 12);
}

/**
 * Estima número de tokens (aproximado)
 * Regla: ~4 caracteres = 1 token en español
 */
export function estimateTokens(text) {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Valida si un chunk es de tamaño apropiado
 */
export function isValidChunkSize(text) {
  if (!text) return false;
  const len = text.length;
  return len >= chunkerConfig.minChunkSize && len <= chunkerConfig.maxChunkSize;
}

/**
 * Obtiene configuración actual
 */
export function getChunkerConfig() {
  return { ...chunkerConfig };
}

/**
 * Detecta mejor estrategia para un documento
 */
export function detectBestStrategy(text, metadata = {}) {
  if (!text) return "semantic";
  
  // Si es muy corto, no importa
  if (text.length < chunkerConfig.targetChunkSize) {
    return "single";
  }
  
  // Detectar estructura
  const hasHeaders = /^#{1,6}\s+/m.test(text) || /\n[A-Z][^a-z]*\n/m.test(text);
  const hasSections = /\n{3,}/.test(text) || /\n[-=*]{3,}\n/.test(text);
  const hasParagraphs = /\n\n/.test(text);
  
  if (hasHeaders || hasSections) {
    return "semantic";
  }
  
  if (hasParagraphs) {
    return "paragraph";
  }
  
  // Detectar formato específico
  const format = metadata.format?.toLowerCase();
  
  if (format === "json") {
    return "fixed"; // JSON convertido a texto no tiene estructura natural
  }
  
  if (format === "pdf") {
    return "semantic"; // PDFs suelen tener secciones
  }
  
  return "sentence"; // Default para texto sin estructura
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export const chunker = {
  chunk: chunkDocument,
  estimateTokens,
  isValidChunkSize,
  getConfig: getChunkerConfig,
  detectBestStrategy,
  strategies: ["semantic", "fixed", "sentence", "paragraph"],
};

export default chunker;
