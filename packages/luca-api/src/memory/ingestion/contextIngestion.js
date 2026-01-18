/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONTEXT INGESTION - Indexa Contexto del Negocio
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Indexa conocimiento contextual en la memoria vectorial:
 * - Estacionalidad
 * - Eventos y su impacto
 * - Perfiles de sucursales
 * - Aprendizajes operativos
 */

import { logger } from "@tagers/shared";
import { memoryService, MemoryTypes } from "../MemoryService.js";
import seasonality from "../../knowledge/seasonality.json" with { type: "json" };
import eventsImpact from "../../knowledge/events_impact.json" with { type: "json" };
import branchProfiles from "../../knowledge/branch_profiles.json" with { type: "json" };

/**
 * Indexa todo el conocimiento base
 */
export async function indexAllKnowledge() {
  logger.info("Indexing all knowledge...");

  const results = {
    seasonality: await indexSeasonality(),
    events: await indexEvents(),
    branches: await indexBranchProfiles(),
  };

  logger.info(results, "Knowledge indexed");
  return results;
}

/**
 * Indexa conocimiento de estacionalidad
 */
export async function indexSeasonality() {
  const memories = [];

  for (const [month, data] of Object.entries(seasonality.monthly)) {
    memories.push({
      type: MemoryTypes.KNOWLEDGE,
      content: `Estacionalidad ${data.name}: ${data.description}. Impacto esperado: ${data.impact_description}. Productos destacados: ${data.key_products?.join(", ")}`,
      metadata: {
        knowledge_type: "seasonality",
        month,
        impact: data.expected_impact,
        products: data.key_products,
      },
      sourceId: `seasonality_${month}`,
      sourceType: "knowledge",
    });
  }

  // Patrones semanales
  for (const [day, data] of Object.entries(seasonality.weekly)) {
    memories.push({
      type: MemoryTypes.KNOWLEDGE,
      content: `Patrón ${data.name}: ${data.description}. Horario pico: ${data.peak_hours}. Productos destacados: ${data.key_products?.join(", ")}`,
      metadata: {
        knowledge_type: "weekly_pattern",
        day,
        peak_hours: data.peak_hours,
      },
      sourceId: `weekly_${day}`,
      sourceType: "knowledge",
    });
  }

  const ids = await memoryService.storeBatch(memories);
  return { indexed: ids.length };
}

/**
 * Indexa conocimiento de eventos e impacto
 */
export async function indexEvents() {
  const memories = [];

  for (const event of eventsImpact.events) {
    memories.push({
      type: MemoryTypes.KNOWLEDGE,
      content: `Evento "${event.name}": ${event.description}. Impacto histórico: ${event.historical_impact}. Sucursales más afectadas: ${event.affected_branches?.join(", ")}. Recomendaciones: ${event.recommendations?.join(". ")}`,
      metadata: {
        knowledge_type: "event",
        event_name: event.name,
        event_type: event.type,
        dates: event.dates,
        impact: event.historical_impact,
        affected_branches: event.affected_branches,
      },
      sourceId: `event_${event.id}`,
      sourceType: "knowledge",
    });
  }

  const ids = await memoryService.storeBatch(memories);
  return { indexed: ids.length };
}

/**
 * Indexa perfiles de sucursales
 */
export async function indexBranchProfiles() {
  const memories = [];

  for (const [branchId, profile] of Object.entries(branchProfiles.branches)) {
    memories.push({
      type: MemoryTypes.KNOWLEDGE,
      content: `Sucursal ${profile.name} (${branchId}): ${profile.description}. Zona: ${profile.zone}. Perfil de cliente: ${profile.customer_profile}. Horarios pico: ${profile.peak_hours?.join(", ")}. Productos estrella: ${profile.star_products?.join(", ")}. Consideraciones especiales: ${profile.special_considerations?.join(". ")}`,
      metadata: {
        knowledge_type: "branch_profile",
        branch_id: branchId,
        zone: profile.zone,
        daily_goal: profile.daily_goal,
        staff_typical: profile.typical_staff,
      },
      sourceId: `branch_${branchId}`,
      sourceType: "knowledge",
      branchId,
    });
  }

  const ids = await memoryService.storeBatch(memories);
  return { indexed: ids.length };
}

/**
 * Indexa un insight manual
 */
export async function indexInsight(insight) {
  await memoryService.store({
    type: MemoryTypes.CONTEXT,
    content: `${insight.title}: ${insight.description}`,
    metadata: {
      insight_type: insight.type,
      author: insight.author,
      created_at: insight.created_at || new Date().toISOString(),
      tags: insight.tags,
    },
    sourceId: insight.id || `insight_${Date.now()}`,
    sourceType: "manual_insight",
    branchId: insight.branch_id,
  });

  logger.info({ insightId: insight.id }, "Insight indexed");
}

export default {
  indexAllKnowledge,
  indexSeasonality,
  indexEvents,
  indexBranchProfiles,
  indexInsight,
};
