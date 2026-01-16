/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - NOTIFIER v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Envía notificaciones a Telegram y Slack
 */

// ═══════════════════════════════════════════════════════════════════════════
// TELEGRAM
// ═══════════════════════════════════════════════════════════════════════════

async function sendTelegram(message, chatId = null) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const defaultChatId = process.env.TELEGRAM_ALERTS_CHAT_ID;
  const targetChatId = chatId || defaultChatId;
  
  if (!token || !targetChatId) {
    console.warn('[NOTIFIER] Telegram not configured');
    return false;
  }
  
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: targetChatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });
    
    return response.ok;
    
  } catch (error) {
    console.error('[NOTIFIER] Telegram error:', error.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SLACK
// ═══════════════════════════════════════════════════════════════════════════

async function sendSlack(message, blocks = null) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL;
  
  if (!webhookUrl) {
    console.warn('[NOTIFIER] Slack webhook not configured');
    return false;
  }
  
  try {
    const payload = blocks 
      ? { blocks }
      : { text: message };
    
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    
    return response.ok;
    
  } catch (error) {
    console.error('[NOTIFIER] Slack error:', error.message);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PÚBLICAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Notifica error crítico
 */
export async function notifyError({ title, message, severity = 'error' }) {
  const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  
  // Telegram
  const telegramMsg = `🔴 <b>${title}</b>\n\n${message}\n\n<i>${timestamp}</i>`;
  await sendTelegram(telegramMsg);
  
  // Slack
  const slackBlocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `🔴 ${title}` }
    },
    {
      type: 'section',
      text: { type: 'mrkdwn', text: message }
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_${timestamp}_ | Severity: ${severity}` }]
    }
  ];
  await sendSlack(null, slackBlocks);
}

/**
 * Notifica éxito/info
 */
export async function notifySuccess({ title, message }) {
  const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  
  // Solo Slack para notificaciones de éxito (menos spam)
  const slackMsg = `✅ *${title}*\n${message}\n_${timestamp}_`;
  await sendSlack(slackMsg);
}

/**
 * Notifica escalación HITL
 */
export async function notifyHITL({ 
  conversationId, 
  customerName, 
  reason, 
  priority,
  assignTo,
  pwaUrl 
}) {
  const timestamp = new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
  const emoji = priority === 'CRITICAL' ? '🚨' : priority === 'HIGH' ? '⚠️' : 'ℹ️';
  
  // Telegram
  const telegramMsg = `${emoji} <b>ESCALACIÓN ${priority}</b>

<b>Cliente:</b> ${customerName || 'Desconocido'}
<b>Razón:</b> ${reason}
<b>Asignado:</b> ${assignTo || 'Disponible'}

🔗 <a href="${pwaUrl}">Abrir en PWA</a>

<i>${timestamp}</i>`;
  
  await sendTelegram(telegramMsg);
  
  // Slack
  const slackBlocks = [
    {
      type: 'header',
      text: { type: 'plain_text', text: `${emoji} Escalación ${priority}` }
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Cliente:*\n${customerName || 'Desconocido'}` },
        { type: 'mrkdwn', text: `*Razón:*\n${reason}` },
      ]
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '📱 Abrir en PWA' },
          url: pwaUrl,
          style: 'primary'
        }
      ]
    },
    {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: `_${timestamp}_` }]
    }
  ];
  
  await sendSlack(null, slackBlocks);
}

export default {
  notifyError,
  notifySuccess,
  notifyHITL,
  sendTelegram,
  sendSlack,
};
