/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INSIGHTS ENGINE - Pattern Discovery v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Sistema de auto-aprendizaje que descubre nuevos tipos de eventos.
 * 
 * Proceso:
 * 1. Obtiene mensajes no clasificados
 * 2. Genera embeddings
 * 3. Agrupa por similitud (clustering)
 * 4. Si un grupo tiene >N mensajes → Propone nuevo evento
 * 5. Envía a Google Sheet para aprobación humana
 * 6. Eventos aprobados se agregan al catálogo
 * 
 * @version 1.0.0
 */

import { logger } from "../../utils/logger.js";
import { getPool } from "../../db/repo.js";
import { modelRegistry } from "../../../config/modelRegistry.js";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

const config = {
  // Mínimo de mensajes similares para proponer nuevo evento
  minClusterSize: 10,
  // Umbral de similitud para agrupar (0-1)
  similarityThreshold: 0.85,
  // Máximo de mensajes a procesar por batch
  batchSize: 500,
  // Días hacia atrás para buscar mensajes no clasificados
  lookbackDays: 7,
};

let _openaiClient = null;

export function setOpenAIClient(client) {
  _openaiClient = client;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE EMBEDDINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Genera embedding para un texto
 */
async function generateEmbedding(text) {
  if (!_openaiClient) {
    throw new Error("OpenAI client not configured");
  }
  
  const response = await _openaiClient.embeddings.create({
    model: modelRegistry.getModel("embeddings") || "text-embedding-3-small",
    input: text.slice(0, 8000), // Limitar longitud
  });
  
  return response.data[0].embedding;
}

/**
 * Genera embeddings para múltiples textos
 */
async function generateEmbeddings(texts) {
  if (!_openaiClient) {
    throw new Error("OpenAI client not configured");
  }
  
  const response = await _openaiClient.embeddings.create({
    model: modelRegistry.getModel("embeddings") || "text-embedding-3-small",
    input: texts.map(t => t.slice(0, 8000)),
  });
  
  return response.data.map(d => d.embedding);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLUSTERING (Agrupamiento por similitud)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calcula similitud coseno entre dos vectores
 */
function cosineSimilarity(a, b) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Agrupa mensajes por similitud usando algoritmo simple
 * (Para producción se podría usar HDBSCAN o K-means)
 */
function clusterMessages(messages, embeddings) {
  const clusters = [];
  const assigned = new Set();
  
  for (let i = 0; i < messages.length; i++) {
    if (assigned.has(i)) continue;
    
    const cluster = {
      centroid: embeddings[i],
      members: [{ index: i, message: messages[i] }],
    };
    
    // Buscar mensajes similares
    for (let j = i + 1; j < messages.length; j++) {
      if (assigned.has(j)) continue;
      
      const similarity = cosineSimilarity(embeddings[i], embeddings[j]);
      if (similarity >= config.similarityThreshold) {
        cluster.members.push({ index: j, message: messages[j] });
        assigned.add(j);
      }
    }
    
    assigned.add(i);
    
    // Solo guardar clusters con suficientes miembros
    if (cluster.members.length >= config.minClusterSize) {
      clusters.push(cluster);
    }
  }
  
  return clusters;
}

// ═══════════════════════════════════════════════════════════════════════════
// GENERACIÓN DE PROPUESTAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Usa AI para generar propuesta de evento a partir de un cluster
 */
async function generateEventProposal(cluster) {
  if (!_openaiClient) return null;
  
  const sampleMessages = cluster.members
    .slice(0, 10)
    .map(m => m.message.message_content)
    .join("\n- ");
  
  try {
    const response = await _openaiClient.chat.completions.create({
      model: modelRegistry.getModel("schema_analyzer"),
      messages: [
        {
          role: "system",
          content: `Eres un analista de patrones de mensajes para una panadería/restaurante.
Analiza estos mensajes similares y propón un nuevo tipo de evento para clasificarlos.

Responde SOLO con JSON:
{
  "event_type": "nombre_snake_case",
  "category": "order|product|branch|delivery|payment|complaint|praise|service|special|operational|marketing",
  "description": "Descripción breve del evento",
  "keywords": ["palabra1", "palabra2", "..."],
  "confidence": 0.0-1.0
}

Sé específico y útil para el negocio.`
        },
        {
          role: "user",
          content: `Mensajes similares (${cluster.members.length} total):\n- ${sampleMessages}`
        }
      ],
      temperature: 0.3,
      max_tokens: 300,
      response_format: { type: "json_object" },
    });
    
    const proposal = JSON.parse(response.choices[0].message.content);
    return {
      ...proposal,
      messageCount: cluster.members.length,
      sampleMessages: cluster.members.slice(0, 10).map(m => m.message.message_content),
    };
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to generate event proposal");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// PROCESO PRINCIPAL DE DESCUBRIMIENTO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ejecuta el proceso completo de descubrimiento de patrones
 * Diseñado para correr diario (cron: 0 3 * * *)
 */
export async function discoverPatterns() {
  const pool = getPool();
  if (!pool || !_openaiClient) {
    logger.warn("DB pool or OpenAI client not available for pattern discovery");
    return { discovered: 0, proposals: [] };
  }
  
  const startTime = Date.now();
  logger.info("Starting pattern discovery...");
  
  try {
    // 1. Obtener mensajes no clasificados
    const unclassifiedResult = await pool.query(`
      SELECT id, message_content, channel, branch_id, created_at
      FROM unclassified_messages
      WHERE status = 'pending'
        AND created_at >= NOW() - INTERVAL '${config.lookbackDays} days'
      ORDER BY created_at DESC
      LIMIT $1
    `, [config.batchSize]);
    
    const messages = unclassifiedResult.rows;
    
    if (messages.length < config.minClusterSize) {
      logger.info({ messageCount: messages.length }, "Not enough unclassified messages for discovery");
      return { discovered: 0, proposals: [] };
    }
    
    logger.info({ messageCount: messages.length }, "Processing unclassified messages");
    
    // 2. Generar embeddings
    const texts = messages.map(m => m.message_content);
    const embeddings = await generateEmbeddings(texts);
    
    // 3. Actualizar embeddings en DB (para uso futuro)
    for (let i = 0; i < messages.length; i++) {
      await pool.query(`
        UPDATE unclassified_messages 
        SET embedding = $1::vector, status = 'processed'
        WHERE id = $2
      `, [`[${embeddings[i].join(",")}]`, messages[i].id]);
    }
    
    // 4. Clusterizar
    const clusters = clusterMessages(messages, embeddings);
    logger.info({ clustersFound: clusters.length }, "Clusters identified");
    
    // 5. Generar propuestas para cada cluster
    const proposals = [];
    for (const cluster of clusters) {
      const proposal = await generateEventProposal(cluster);
      if (proposal && proposal.confidence >= 0.7) {
        proposals.push(proposal);
        
        // Guardar propuesta en DB
        await saveProposal(pool, proposal, cluster);
      }
    }
    
    const processingTime = Date.now() - startTime;
    logger.info({ 
      messagesProcessed: messages.length,
      clustersFound: clusters.length,
      proposalsGenerated: proposals.length,
      processingTimeMs: processingTime,
    }, "Pattern discovery completed");
    
    return {
      discovered: proposals.length,
      proposals,
      processingTimeMs: processingTime,
    };
    
  } catch (error) {
    logger.error({ error: error.message }, "Pattern discovery failed");
    throw error;
  }
}

async function saveProposal(pool, proposal, cluster) {
  try {
    await pool.query(`
      INSERT INTO discovered_patterns (
        proposed_event_type, proposed_category, proposed_description,
        sample_messages, message_count, common_keywords, confidence_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [
      proposal.event_type,
      proposal.category,
      proposal.description,
      proposal.sampleMessages,
      proposal.messageCount,
      proposal.keywords,
      proposal.confidence,
    ]);
    
    // Marcar mensajes del cluster como "propuestos"
    const messageIds = cluster.members.map(m => m.message.id);
    await pool.query(`
      UPDATE unclassified_messages 
      SET status = 'proposed', proposed_event_type = $1
      WHERE id = ANY($2)
    `, [proposal.event_type, messageIds]);
    
  } catch (error) {
    logger.warn({ error: error.message }, "Failed to save proposal");
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// APROBACIÓN DE PATRONES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Aprueba un patrón descubierto y lo agrega al catálogo
 */
export async function approvePattern(patternId, approvedBy) {
  const pool = getPool();
  if (!pool) return false;
  
  try {
    // Obtener patrón
    const patternResult = await pool.query(`
      SELECT * FROM discovered_patterns WHERE id = $1
    `, [patternId]);
    
    if (patternResult.rows.length === 0) {
      return { success: false, error: "Pattern not found" };
    }
    
    const pattern = patternResult.rows[0];
    
    // Agregar al catálogo
    await pool.query(`
      INSERT INTO event_types_catalog (
        event_type, category, description, keywords, examples,
        is_enabled, is_auto_discovered, discovery_count, approved_at, approved_by
      ) VALUES ($1, $2, $3, $4, $5, true, true, $6, NOW(), $7)
      ON CONFLICT (event_type) DO UPDATE SET
        keywords = EXCLUDED.keywords,
        examples = EXCLUDED.examples,
        discovery_count = event_types_catalog.discovery_count + EXCLUDED.discovery_count,
        updated_at = NOW()
    `, [
      pattern.proposed_event_type,
      pattern.proposed_category,
      pattern.proposed_description,
      pattern.common_keywords,
      pattern.sample_messages,
      pattern.message_count,
      approvedBy,
    ]);
    
    // Marcar patrón como aprobado
    await pool.query(`
      UPDATE discovered_patterns 
      SET status = 'approved', reviewed_at = NOW(), reviewed_by = $2
      WHERE id = $1
    `, [patternId, approvedBy]);
    
    // Reclasificar mensajes pendientes
    await pool.query(`
      UPDATE unclassified_messages 
      SET status = 'approved'
      WHERE proposed_event_type = $1
    `, [pattern.proposed_event_type]);
    
    logger.info({ 
      patternId, 
      eventType: pattern.proposed_event_type,
      approvedBy 
    }, "Pattern approved and added to catalog");
    
    return { success: true, eventType: pattern.proposed_event_type };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to approve pattern");
    return { success: false, error: error.message };
  }
}

/**
 * Rechaza un patrón descubierto
 */
export async function rejectPattern(patternId, rejectedBy, reason = null) {
  const pool = getPool();
  if (!pool) return false;
  
  try {
    await pool.query(`
      UPDATE discovered_patterns 
      SET status = 'rejected', reviewed_at = NOW(), reviewed_by = $2
      WHERE id = $1
    `, [patternId, rejectedBy]);
    
    // Marcar mensajes como rechazados
    const pattern = await pool.query(`SELECT proposed_event_type FROM discovered_patterns WHERE id = $1`, [patternId]);
    if (pattern.rows.length > 0) {
      await pool.query(`
        UPDATE unclassified_messages 
        SET status = 'rejected'
        WHERE proposed_event_type = $1
      `, [pattern.rows[0].proposed_event_type]);
    }
    
    return { success: true };
    
  } catch (error) {
    logger.error({ error: error.message }, "Failed to reject pattern");
    return { success: false, error: error.message };
  }
}

/**
 * Obtiene patrones pendientes de revisión
 */
export async function getPendingPatterns() {
  const pool = getPool();
  if (!pool) return [];
  
  try {
    const result = await pool.query(`
      SELECT * FROM discovered_patterns
      WHERE status = 'pending'
      ORDER BY message_count DESC, confidence_score DESC
    `);
    return result.rows;
  } catch (error) {
    logger.error({ error: error.message }, "Failed to get pending patterns");
    return [];
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINCRONIZACIÓN CON GOOGLE SHEETS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Exporta patrones descubiertos a Google Sheet para revisión
 */
export async function syncToGoogleSheet() {
  // TODO: Implementar usando google-spreadsheet
  // Por ahora solo retorna los patrones pendientes
  const pending = await getPendingPatterns();
  logger.info({ pendingPatterns: pending.length }, "Patterns ready for Google Sheet sync");
  return pending;
}

/**
 * Importa aprobaciones desde Google Sheet
 */
export async function syncFromGoogleSheet() {
  // TODO: Implementar lectura de Google Sheet
  // Buscar columna "approved" = true y aprobar automáticamente
  logger.info("Google Sheet sync not yet implemented");
  return { imported: 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  discoverPatterns,
  approvePattern,
  rejectPattern,
  getPendingPatterns,
  syncToGoogleSheet,
  syncFromGoogleSheet,
  setOpenAIClient,
};
