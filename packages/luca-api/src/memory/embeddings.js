/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EMBEDDINGS - Genera Embeddings con OpenAI
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Genera embeddings vectoriales para búsqueda semántica.
 * Usa OpenAI text-embedding-3-small (1536 dimensiones, económico).
 */

import { logger } from "@tagers/shared";

const OPENAI_API_URL = "https://api.openai.com/v1/embeddings";
const EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_BATCH_SIZE = 100;
const MAX_TEXT_LENGTH = 8000; // Límite de tokens aproximado

/**
 * Genera embedding para un texto
 */
export async function generateEmbedding(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not configured, using mock embedding");
    return generateMockEmbedding(text);
  }

  try {
    // Truncar texto si es muy largo
    const truncatedText = text.length > MAX_TEXT_LENGTH 
      ? text.substring(0, MAX_TEXT_LENGTH) 
      : text;

    const response = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: EMBEDDING_MODEL,
        input: truncatedText,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      logger.error({ error }, "OpenAI embedding request failed");
      return null;
    }

    const data = await response.json();
    return data.data[0].embedding;

  } catch (err) {
    logger.error({ err: err?.message }, "Failed to generate embedding");
    return null;
  }
}

/**
 * Genera embeddings para múltiples textos en batch
 */
export async function generateEmbeddings(texts) {
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!apiKey) {
    logger.warn("OPENAI_API_KEY not configured, using mock embeddings");
    return texts.map(t => generateMockEmbedding(t));
  }

  const results = [];

  // Procesar en batches
  for (let i = 0; i < texts.length; i += MAX_BATCH_SIZE) {
    const batch = texts.slice(i, i + MAX_BATCH_SIZE);
    
    try {
      // Truncar textos largos
      const truncatedBatch = batch.map(t => 
        t.length > MAX_TEXT_LENGTH ? t.substring(0, MAX_TEXT_LENGTH) : t
      );

      const response = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: EMBEDDING_MODEL,
          input: truncatedBatch,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        logger.error({ error }, "OpenAI batch embedding failed");
        // Rellenar con nulls para este batch
        results.push(...batch.map(() => null));
        continue;
      }

      const data = await response.json();
      
      // Los embeddings vienen ordenados por índice
      const sortedEmbeddings = data.data
        .sort((a, b) => a.index - b.index)
        .map(item => item.embedding);
      
      results.push(...sortedEmbeddings);

    } catch (err) {
      logger.error({ err: err?.message, batchStart: i }, "Batch embedding failed");
      results.push(...batch.map(() => null));
    }
  }

  return results;
}

/**
 * Calcula similitud coseno entre dos embeddings
 */
export function cosineSimilarity(embedding1, embedding2) {
  if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
    return 0;
  }

  let dotProduct = 0;
  let norm1 = 0;
  let norm2 = 0;

  for (let i = 0; i < embedding1.length; i++) {
    dotProduct += embedding1[i] * embedding2[i];
    norm1 += embedding1[i] * embedding1[i];
    norm2 += embedding2[i] * embedding2[i];
  }

  const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
  
  return denominator === 0 ? 0 : dotProduct / denominator;
}

/**
 * Genera embedding mock para desarrollo sin API key
 * Produce un vector pseudo-determinístico basado en el texto
 */
function generateMockEmbedding(text) {
  const DIMENSION = 1536;
  const embedding = new Array(DIMENSION).fill(0);
  
  // Generar valores basados en el hash del texto
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash) + text.charCodeAt(i);
    hash = hash & hash;
  }
  
  // Usar el hash como seed para generar valores
  const seed = Math.abs(hash);
  for (let i = 0; i < DIMENSION; i++) {
    // Pseudo-random basado en posición y seed
    const val = Math.sin(seed * (i + 1)) * 10000;
    embedding[i] = val - Math.floor(val);
    // Normalizar a rango típico de embeddings
    embedding[i] = (embedding[i] - 0.5) * 0.2;
  }
  
  // Normalizar el vector
  const norm = Math.sqrt(embedding.reduce((sum, v) => sum + v * v, 0));
  return embedding.map(v => v / norm);
}

/**
 * Preprocesa texto antes de generar embedding
 */
export function preprocessText(text) {
  if (!text) return "";
  
  return text
    .toLowerCase()
    .replace(/\s+/g, " ")           // Normalizar espacios
    .replace(/[^\w\sáéíóúñü.,;:]/gi, "") // Remover caracteres especiales
    .trim();
}

/**
 * Combina múltiples textos en uno para embedding
 */
export function combineTexts(texts, separator = ". ") {
  return texts.filter(Boolean).join(separator);
}

export default {
  generateEmbedding,
  generateEmbeddings,
  cosineSimilarity,
  preprocessText,
  combineTexts,
};
