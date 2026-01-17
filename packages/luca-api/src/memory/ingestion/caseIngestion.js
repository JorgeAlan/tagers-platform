/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CASE INGESTION - Indexa Casos Cerrados en Memoria
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cuando un caso se cierra, se indexa en la memoria vectorial para:
 * - Encontrar casos similares en el futuro
 * - Aprender de las resoluciones
 * - Construir conocimiento institucional
 */

import { logger, query } from "@tagers/shared";
import { memoryService, MemoryTypes } from "../MemoryService.js";
import { getBranchName } from "../../config/lucaConfig.js";

/**
 * Indexa un caso cerrado en la memoria
 */
export async function indexClosedCase(caso) {
  try {
    const branchName = caso.scope?.branch_id 
      ? await getBranchName(caso.scope.branch_id) 
      : "General";

    // Construir contenido rico para el embedding
    const content = buildCaseContent(caso, branchName);

    // Almacenar en memoria
    await memoryService.store({
      id: `case_${caso.case_id}`,
      type: MemoryTypes.CASE,
      content,
      metadata: {
        case_id: caso.case_id,
        case_type: caso.case_type,
        severity: caso.severity,
        resolution: caso.resolution,
        resolution_notes: caso.resolution_notes,
        closed_at: caso.closed_at,
        duration_hours: caso.duration_hours,
        hypothesis_confirmed: caso.hypothesis_confirmed,
        actions_taken: caso.actions_taken,
      },
      sourceId: caso.case_id,
      sourceType: "case",
      branchId: caso.scope?.branch_id,
    });

    logger.info({ caseId: caso.case_id }, "Case indexed in memory");

    return { success: true, caseId: caso.case_id };

  } catch (err) {
    logger.error({ caseId: caso.case_id, err: err?.message }, "Failed to index case");
    return { success: false, error: err?.message };
  }
}

/**
 * Construye el contenido textual del caso para el embedding
 */
function buildCaseContent(caso, branchName) {
  const parts = [
    `Caso: ${caso.title}`,
    `Tipo: ${caso.case_type}`,
    `Severidad: ${caso.severity}`,
    `Sucursal: ${branchName}`,
    caso.description ? `Descripción: ${caso.description}` : null,
  ];

  // Agregar hipótesis
  if (caso.hypotheses?.length > 0) {
    const confirmedHypothesis = caso.hypotheses.find(h => h.is_confirmed);
    if (confirmedHypothesis) {
      parts.push(`Causa confirmada: ${confirmedHypothesis.title}`);
      parts.push(`Descripción de causa: ${confirmedHypothesis.description}`);
    }
  }

  // Agregar resolución
  if (caso.resolution) {
    parts.push(`Resolución: ${caso.resolution}`);
  }
  if (caso.resolution_notes) {
    parts.push(`Notas de resolución: ${caso.resolution_notes}`);
  }

  // Agregar acciones tomadas
  if (caso.actions_taken?.length > 0) {
    parts.push(`Acciones tomadas: ${caso.actions_taken.map(a => a.title).join(", ")}`);
  }

  // Agregar evidencia relevante
  if (caso.evidence?.length > 0) {
    const summaries = caso.evidence
      .filter(e => e.type === "AUTOPSY_REPORT" || e.type === "SUMMARY")
      .slice(0, 2)
      .map(e => typeof e.content === "string" ? e.content.substring(0, 500) : "");
    
    if (summaries.length > 0) {
      parts.push(`Evidencia: ${summaries.join(" | ")}`);
    }
  }

  return parts.filter(Boolean).join(". ");
}

/**
 * Indexa todos los casos cerrados pendientes de indexación
 */
export async function indexPendingCases() {
  try {
    // Buscar casos cerrados no indexados
    const result = await query(`
      SELECT c.*, 
             COALESCE(
               (SELECT json_agg(h.*) FROM luca_hypotheses h WHERE h.case_id = c.case_id),
               '[]'
             ) as hypotheses,
             COALESCE(
               (SELECT json_agg(e.*) FROM luca_evidence e WHERE e.case_id = c.case_id),
               '[]'
             ) as evidence,
             COALESCE(
               (SELECT json_agg(a.*) FROM luca_actions a WHERE a.case_id = c.case_id AND a.state = 'EXECUTED'),
               '[]'
             ) as actions_taken
      FROM luca_cases c
      WHERE c.state = 'CLOSED'
        AND c.case_id NOT IN (
          SELECT source_id FROM luca_memories WHERE source_type = 'case'
        )
      LIMIT 100
    `);

    const indexed = [];
    const failed = [];

    for (const caso of result.rows) {
      const indexResult = await indexClosedCase(caso);
      if (indexResult.success) {
        indexed.push(caso.case_id);
      } else {
        failed.push({ case_id: caso.case_id, error: indexResult.error });
      }
    }

    logger.info({
      total: result.rows.length,
      indexed: indexed.length,
      failed: failed.length,
    }, "Pending cases indexed");

    return { indexed, failed };

  } catch (err) {
    logger.error({ err: err?.message }, "Failed to index pending cases");
    throw err;
  }
}

/**
 * Re-indexa un caso específico (útil si se actualizó la resolución)
 */
export async function reindexCase(caseId) {
  try {
    // Eliminar memoria existente
    await memoryService.deleteBySource(caseId, "case");

    // Obtener caso actualizado
    const result = await query(`
      SELECT c.*, 
             COALESCE(
               (SELECT json_agg(h.*) FROM luca_hypotheses h WHERE h.case_id = c.case_id),
               '[]'
             ) as hypotheses,
             COALESCE(
               (SELECT json_agg(e.*) FROM luca_evidence e WHERE e.case_id = c.case_id),
               '[]'
             ) as evidence,
             COALESCE(
               (SELECT json_agg(a.*) FROM luca_actions a WHERE a.case_id = c.case_id AND a.state = 'EXECUTED'),
               '[]'
             ) as actions_taken
      FROM luca_cases c
      WHERE c.case_id = $1
    `, [caseId]);

    if (result.rows.length === 0) {
      throw new Error(`Case not found: ${caseId}`);
    }

    return indexClosedCase(result.rows[0]);

  } catch (err) {
    logger.error({ caseId, err: err?.message }, "Failed to reindex case");
    throw err;
  }
}

export default {
  indexClosedCase,
  indexPendingCases,
  reindexCase,
};
