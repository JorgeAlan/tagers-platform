import { config } from "../config.js";
import { logger } from "../utils/logger.js";

function formatSentiment(s) {
  if (!s || typeof s !== "object") return "(unknown)";
  const label = s.sentiment || "(unknown)";
  const conf = typeof s.confidence === "number" ? ` (${Math.round(s.confidence * 100)}%)` : "";
  return `${label}${conf}`;
}

export async function notifyOpsHeadServiceRecoveryEscalation(payload) {
  if (!config.serviceRecovery?.telegram?.botToken || !config.serviceRecovery?.telegram?.chatId) {
    logger.warn({ payload: { ...payload, conversation_messages: undefined } }, "Telegram notifier not configured; skipping escalation notification");
    return { sent: false, channel: "telegram", reason: "NOT_CONFIGURED" };
  }

  const { branch_id, instruction_id, chatwoot_context, contact, customer_text, sentiment, incident_report } = payload || {};

  const lines = [];
  lines.push("🚨 SERVICE RECOVERY ESCALATION (no atendido en tiempo)");
  if (branch_id) lines.push(`Sucursal: ${branch_id}`);
  if (chatwoot_context?.conversation_id) lines.push(`Chatwoot conversación: ${chatwoot_context.conversation_id}`);
  if (instruction_id) lines.push(`Instruction: ${instruction_id}`);
  if (contact?.name || contact?.phone) lines.push(`Cliente: ${[contact?.name, contact?.phone].filter(Boolean).join(" ")}`);
  lines.push(`Sentimiento: ${formatSentiment(sentiment)}`);
  if (customer_text) lines.push(`Último mensaje: ${String(customer_text).slice(0, 260)}`);

  if (incident_report?.summary) {
    lines.push("\nResumen IA:");
    lines.push(String(incident_report.summary).slice(0, 1100));
  }

  if (Array.isArray(incident_report?.recommended_next_steps) && incident_report.recommended_next_steps.length) {
    lines.push("\nSiguientes pasos:");
    for (const step of incident_report.recommended_next_steps.slice(0, 6)) {
      lines.push(`- ${step}`);
    }
  }

  const text = lines.join("\n");

  const url = `https://api.telegram.org/bot${config.serviceRecovery.telegram.botToken}/sendMessage`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: config.serviceRecovery.telegram.chatId,
      text,
      disable_web_page_preview: true,
    }),
  });

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    logger.error({ status: resp.status, body }, "Failed to send Telegram escalation");
    return { sent: false, channel: "telegram", status: resp.status };
  }

  return { sent: true, channel: "telegram" };
}
