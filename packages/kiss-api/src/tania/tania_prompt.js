/**
 * Build Tania system prompt with dynamic, safe context.
 *
 * Important:
 * - This prompt is completely separate from prompts/kiss_system.md.
 * - Only injects CS-safe context (public WordPress endpoints + curated tourism KB).
 * - Now integrates with Config Hub for centralized configuration.
 */

import { getConfigForLLM, getConfig } from "../config-hub/sync-service.js";

export function buildTaniaSystemPrompt({ basePrompt, promo, assistant }) {
  let p = String(basePrompt || "").trim();

  // ═══════════════════════════════════════════════════════════════════════════
  // CONFIG HUB INTEGRATION
  // ═══════════════════════════════════════════════════════════════════════════
  // Si hay configuración del Config Hub, usarla como fuente primaria
  const configHubLLM = getConfigForLLM();
  const configHubData = getConfig();
  
  if (configHubLLM && configHubData && !configHubData.is_fallback) {
    // Usar configuración de Ana Studio (prioridad sobre WP Assistant)
    p += "\n\n";
    p += "<!-- Base de conocimiento dinámica desde Ana Studio -->\n";
    p += configHubLLM;
    
    // Sobrescribir promo con la del Config Hub si está activa
    const configPromo = configHubData.promos?.find(promo => {
      if (!promo.enabled) return false;
      const now = new Date();
      const start = new Date(promo.start_at);
      const end = new Date(promo.end_at);
      return now >= start && now <= end;
    });
    
    if (configPromo) {
      // Ya está incluida en configHubLLM, no duplicar
      return p;
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // FALLBACK: Configuración legacy de WP Assistant
  // ═══════════════════════════════════════════════════════════════════════════
  // Solo se usa si Config Hub no está disponible o está en fallback

  // Marketing-configurable brand voice (WP Assistant tab)
  if (assistant && typeof assistant === "object") {
    p += "\n\n";
    p += "## Filosofía y tono de Tagers (configurable)\n";
    if (assistant.philosophy) p += `Filosofía: ${assistant.philosophy}\n`;
    if (assistant.tone) p += `Tono: ${assistant.tone}\n`;
    if (assistant.do) p += `Sí haz: ${assistant.do}\n`;
    if (assistant.dont) p += `No hagas: ${assistant.dont}\n`;

    if (assistant.links && typeof assistant.links === "object") {
      const linkLines = [];
      for (const [k, v] of Object.entries(assistant.links)) {
        if (!v) continue;
        linkLines.push(`${k}: ${v}`);
      }
      if (linkLines.length) {
        p += "\n## Links oficiales (no inventar)\n";
        p += linkLines.join("\n") + "\n";
      }
    }

    if (Array.isArray(assistant.faqs) && assistant.faqs.length) {
      // Keep short: only ids/titles + response.
      p += "\n## FAQ/Respuestas rápidas configurables (cuando aplique)\n";
      const maxFaq = 12;
      for (const f of assistant.faqs.slice(0, maxFaq)) {
        if (!f) continue;
        const id = f.id || f.title || "faq";
        const resp = f.response || f.answer || f.text;
        if (!resp) continue;
        p += `- ${id}: ${resp}\n`;
      }
      p += "Regla: Usa estas respuestas como base, pero adapta al caso del cliente.\n";
    }
  }

  // Inject promotions dynamically (can change in WP without code deploy).
  p += "\n\n";
  p += "## Promociones vigentes (dinámicas)\n";

  const promoActive = promo && typeof promo === "object" && (promo.activa || promo.activo);

  if (promoActive) {
    const lines = [];
    if (promo.mensaje) lines.push(`Mensaje: ${promo.mensaje}`);
    if (promo.compra) lines.push(`Compra: ${promo.compra}`);
    if (promo.regalo) lines.push(`Regalo: ${promo.regalo}`);
    const inicio = promo.fecha_inicio || promo.inicio || null;
    const fin = promo.fecha_fin || promo.fin || null;
    if (inicio || fin) {
      lines.push(`Vigencia: ${inicio || ""} ${fin ? "– " + fin : ""}`.trim());
    }

    p += "PROMO_ACTIVA = true\n";
    p += (lines.length ? lines.join("\n") : "Hay una promoción activa, pero no hay detalles.") + "\n";
    p += "Regla: Menciona la promo solo si es relevante y sin forzarla.\n";
  } else {
    p += "PROMO_ACTIVA = false\n";
    p += "Regla: No inventes promociones.\n";
  }

  return p;
}
