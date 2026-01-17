/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MEMORY SERVICE - Interface a Vector DB (pgvector)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Proporciona memoria de largo plazo a LUCA usando pgvector:
 * - Almacena embeddings de casos, contexto y conocimiento
 * - Búsqueda semántica de casos similares
 * - Recuperación de contexto relevante
 * 
 * Usa PostgreSQL con extensión pgvector (ya instalada en el stack).
 */

import { logger, query, getPool } from "@tagers/shared";
import { generateEmbedding, generateEmbeddings } from "./embeddings.js";

/**
 * Dimensión de los embeddings (OpenAI text-embedding-3-small = 1536)
 */
const EMBEDDING_DIMENSION = 1536;

/**
 * Tipos de memoria
 */
export const MemoryTypes = {
  CASE: "case",           // Casos cerrados
  CONTEXT: "context",     // Contexto del negocio
  KNOWLEDGE: "knowledge", // Conocimiento estático
  AUTOPSY: "autopsy",     // Autopsias completadas
  INSIGHT: "insight",     // Insights generados
};

export class MemoryService {
  constructor() {
    this.initialized = false;
  }

  /**
   * Inicializa las tablas de memoria vectorial
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Verificar que pgvector está instalado
      await query(`CREATE EXTENSION IF NOT EXISTS vector`);

      // Crear tabla de memorias
      await query(`
        CREATE TABLE IF NOT EXISTS luca_memories (
          memory_id TEXT PRIMARY KEY,
          memory_type TEXT NOT NULL,
          content TEXT NOT NULL,
          embedding vector(${EMBEDDING_DIMENSION}),
          metadata JSONB DEFAULT '{}',
          source_id TEXT,
          source_type TEXT,
          branch_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);

      // Crear índice para búsqueda por similitud (IVFFlat para mejor performance)
      await query(`
        CREATE INDEX IF NOT EXISTS luca_memories_embedding_idx 
        ON luca_memories 
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 100)
      `);

      // Índices adicionales
      await query(`CREATE INDEX IF NOT EXISTS luca_memories_type_idx ON luca_memories(memory_type)`);
      await query(`CREATE INDEX IF NOT EXISTS luca_memories_branch_idx ON luca_memories(branch_id)`);
      await query(`CREATE INDEX IF NOT EXISTS luca_memories_source_idx ON luca_memories(source_id)`);

      this.initialized = true;
      logger.info("MemoryService initialized with pgvector");
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to initialize MemoryService");
      throw err;
    }
  }

  /**
   * Almacena una memoria
   */
  async store(memory) {
    await this.initialize();

    const {
      id,
      type,
      content,
      metadata = {},
      sourceId,
      sourceType,
      branchId,
    } = memory;

    // Generar embedding del contenido
    const embedding = await generateEmbedding(content);

    if (!embedding) {
      logger.warn({ memoryId: id }, "Failed to generate embedding, storing without vector");
    }

    const memoryId = id || `mem_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    await query(`
      INSERT INTO luca_memories (
        memory_id, memory_type, content, embedding, metadata, 
        source_id, source_type, branch_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (memory_id) DO UPDATE SET
        content = EXCLUDED.content,
        embedding = EXCLUDED.embedding,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
    `, [
      memoryId,
      type,
      content,
      embedding ? `[${embedding.join(",")}]` : null,
      JSON.stringify(metadata),
      sourceId,
      sourceType,
      branchId,
    ]);

    logger.info({ memoryId, type }, "Memory stored");

    return memoryId;
  }

  /**
   * Almacena múltiples memorias en batch
   */
  async storeBatch(memories) {
    await this.initialize();

    // Generar embeddings en batch
    const contents = memories.map(m => m.content);
    const embeddings = await generateEmbeddings(contents);

    const results = [];

    for (let i = 0; i < memories.length; i++) {
      const memory = memories[i];
      const embedding = embeddings[i];
      const memoryId = memory.id || `mem_${Date.now()}_${i}_${Math.random().toString(36).substr(2, 6)}`;

      await query(`
        INSERT INTO luca_memories (
          memory_id, memory_type, content, embedding, metadata, 
          source_id, source_type, branch_id
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (memory_id) DO UPDATE SET
          content = EXCLUDED.content,
          embedding = EXCLUDED.embedding,
          metadata = EXCLUDED.metadata,
          updated_at = NOW()
      `, [
        memoryId,
        memory.type,
        memory.content,
        embedding ? `[${embedding.join(",")}]` : null,
        JSON.stringify(memory.metadata || {}),
        memory.sourceId,
        memory.sourceType,
        memory.branchId,
      ]);

      results.push(memoryId);
    }

    logger.info({ count: results.length }, "Batch memories stored");

    return results;
  }

  /**
   * Busca memorias similares por contenido semántico
   */
  async search(queryText, options = {}) {
    await this.initialize();

    const {
      type,
      branchId,
      limit = 5,
      minSimilarity = 0.7,
      excludeIds = [],
    } = options;

    // Generar embedding de la consulta
    const queryEmbedding = await generateEmbedding(queryText);

    if (!queryEmbedding) {
      logger.warn("Failed to generate query embedding");
      return [];
    }

    // Construir query con filtros
    let sql = `
      SELECT 
        memory_id,
        memory_type,
        content,
        metadata,
        source_id,
        source_type,
        branch_id,
        created_at,
        1 - (embedding <=> $1::vector) as similarity
      FROM luca_memories
      WHERE embedding IS NOT NULL
    `;
    const params = [`[${queryEmbedding.join(",")}]`];
    let paramIndex = 2;

    if (type) {
      sql += ` AND memory_type = $${paramIndex}`;
      params.push(type);
      paramIndex++;
    }

    if (branchId) {
      sql += ` AND (branch_id = $${paramIndex} OR branch_id IS NULL)`;
      params.push(branchId);
      paramIndex++;
    }

    if (excludeIds.length > 0) {
      sql += ` AND memory_id != ALL($${paramIndex})`;
      params.push(excludeIds);
      paramIndex++;
    }

    sql += ` AND 1 - (embedding <=> $1::vector) >= $${paramIndex}`;
    params.push(minSimilarity);
    paramIndex++;

    sql += ` ORDER BY embedding <=> $1::vector LIMIT $${paramIndex}`;
    params.push(limit);

    const result = await query(sql, params);

    return result.rows.map(row => ({
      memoryId: row.memory_id,
      type: row.memory_type,
      content: row.content,
      metadata: row.metadata,
      sourceId: row.source_id,
      sourceType: row.source_type,
      branchId: row.branch_id,
      createdAt: row.created_at,
      similarity: parseFloat(row.similarity),
    }));
  }

  /**
   * Encuentra casos similares a un hallazgo
   */
  async findSimilarCases(finding, options = {}) {
    const { limit = 3, branchId } = options;

    // Construir texto de búsqueda desde el finding
    const searchText = [
      finding.title,
      finding.description,
      `Sucursal: ${finding.branch_id}`,
      `Severidad: ${finding.severity}`,
      finding.triggers?.map(t => t.type).join(", "),
    ].filter(Boolean).join(". ");

    return this.search(searchText, {
      type: MemoryTypes.CASE,
      branchId: branchId || finding.branch_id,
      limit,
      minSimilarity: 0.65,
    });
  }

  /**
   * Encuentra autopsias similares
   */
  async findSimilarAutopsies(characteristics, options = {}) {
    const { limit = 3, branchId } = options;

    const searchText = [
      `Caída de ventas`,
      characteristics.traffic_drop ? "Caída de tráfico" : null,
      characteristics.ticket_drop ? "Caída de ticket" : null,
      characteristics.discount_spike ? "Incremento de descuentos" : null,
      characteristics.staffing_issue ? "Problema de personal" : null,
      characteristics.external_factor ? "Factor externo" : null,
      branchId ? `Sucursal: ${branchId}` : null,
    ].filter(Boolean).join(". ");

    return this.search(searchText, {
      type: MemoryTypes.AUTOPSY,
      branchId,
      limit,
      minSimilarity: 0.6,
    });
  }

  /**
   * Obtiene contexto relevante
   */
  async getRelevantContext(queryText, options = {}) {
    return this.search(queryText, {
      type: MemoryTypes.CONTEXT,
      ...options,
      minSimilarity: 0.6,
    });
  }

  /**
   * Obtiene conocimiento relevante
   */
  async getRelevantKnowledge(queryText, options = {}) {
    return this.search(queryText, {
      type: MemoryTypes.KNOWLEDGE,
      ...options,
      minSimilarity: 0.55,
    });
  }

  /**
   * Obtiene una memoria por ID
   */
  async get(memoryId) {
    const result = await query(`
      SELECT * FROM luca_memories WHERE memory_id = $1
    `, [memoryId]);

    if (result.rows[0]) {
      return {
        memoryId: result.rows[0].memory_id,
        type: result.rows[0].memory_type,
        content: result.rows[0].content,
        metadata: result.rows[0].metadata,
        sourceId: result.rows[0].source_id,
        branchId: result.rows[0].branch_id,
        createdAt: result.rows[0].created_at,
      };
    }

    return null;
  }

  /**
   * Elimina una memoria
   */
  async delete(memoryId) {
    await query(`DELETE FROM luca_memories WHERE memory_id = $1`, [memoryId]);
    logger.info({ memoryId }, "Memory deleted");
  }

  /**
   * Elimina memorias por source
   */
  async deleteBySource(sourceId, sourceType) {
    const result = await query(`
      DELETE FROM luca_memories 
      WHERE source_id = $1 AND source_type = $2
      RETURNING memory_id
    `, [sourceId, sourceType]);

    logger.info({ 
      sourceId, 
      sourceType, 
      deletedCount: result.rows.length 
    }, "Memories deleted by source");

    return result.rows.length;
  }

  /**
   * Obtiene estadísticas de la memoria
   */
  async getStats() {
    const result = await query(`
      SELECT 
        memory_type,
        COUNT(*) as count,
        COUNT(embedding) as with_embedding
      FROM luca_memories
      GROUP BY memory_type
    `);

    const totalResult = await query(`
      SELECT COUNT(*) as total FROM luca_memories
    `);

    return {
      total: parseInt(totalResult.rows[0]?.total) || 0,
      byType: result.rows.reduce((acc, row) => {
        acc[row.memory_type] = {
          count: parseInt(row.count),
          withEmbedding: parseInt(row.with_embedding),
        };
        return acc;
      }, {}),
    };
  }
}

// Export singleton
export const memoryService = new MemoryService();

export default MemoryService;
