/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHATSAPP HANDLER - Ejecuta acciones de WhatsApp
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Acciones soportadas:
 * - NOTIFY_GERENTE: Enviar mensaje a gerente
 * - NOTIFY_SOCIO: Enviar mensaje a socio
 * - CONTACT_EVENTUAL_STAFF: Contactar staff eventual
 */

import { logger } from "@tagers/shared";
import { whatsappClient } from "../../channels/whatsapp/WhatsAppClient.js";
import { getUser } from "../../config/lucaConfig.js";

export const whatsappHandler = {
  /**
   * Ejecuta una acción de WhatsApp
   */
  async execute(actionType, payload, context) {
    logger.info({ actionType, payload }, "WhatsApp handler executing");

    switch (actionType) {
      case "NOTIFY_GERENTE":
        return this.notifyGerente(payload, context);

      case "NOTIFY_SOCIO":
        return this.notifySocio(payload, context);

      case "CONTACT_EVENTUAL_STAFF":
        return this.contactEventualStaff(payload, context);

      case "SEND_MESSAGE":
        return this.sendMessage(payload, context);

      default:
        throw new Error(`Unknown WhatsApp action: ${actionType}`);
    }
  },

  /**
   * Notifica a gerente de sucursal
   */
  async notifyGerente(payload, context) {
    const { branch_id, message, urgency = "normal" } = payload;

    // TODO: Obtener teléfono de gerente desde config
    const gerentePhone = process.env[`GERENTE_${branch_id}_PHONE`];
    
    if (!gerentePhone) {
      logger.warn({ branch_id }, "Gerente phone not configured");
      return {
        success: false,
        error: "Gerente phone not configured",
        mockMode: true,
      };
    }

    const prefix = urgency === "urgent" ? "🚨 URGENTE: " : "📋 ";
    const fullMessage = `${prefix}${message}\n\n_Enviado por LUCA_`;

    const result = await whatsappClient.sendText(gerentePhone, fullMessage);

    return {
      success: result.success,
      messageId: result.messageId,
      recipient: "gerente",
      branch_id,
    };
  },

  /**
   * Notifica a socio/dueño
   */
  async notifySocio(payload, context) {
    const { user_id, message, include_context = true } = payload;

    // Obtener datos del usuario
    const user = await getUser(user_id);
    
    if (!user?.phone) {
      throw new Error(`User ${user_id} phone not configured`);
    }

    let fullMessage = message;
    
    // Agregar contexto si se solicita
    if (include_context && context) {
      if (context.case_id) {
        fullMessage += `\n\n📁 Caso: ${context.case_id}`;
      }
      if (context.branch_id) {
        fullMessage += `\n🏪 Sucursal: ${context.branch_id}`;
      }
    }

    fullMessage += `\n\n_— LUCA 🦑_`;

    const result = await whatsappClient.sendText(user.phone, fullMessage);

    return {
      success: result.success,
      messageId: result.messageId,
      recipient: user_id,
    };
  },

  /**
   * Contacta a staff eventual para cubrir turno
   */
  async contactEventualStaff(payload, context) {
    const { 
      candidates,      // Lista de {phone, name}
      shift_date,
      shift_time,
      branch_id,
      message_template,
    } = payload;

    if (!candidates || candidates.length === 0) {
      throw new Error("No candidates provided");
    }

    const results = [];

    for (const candidate of candidates) {
      const message = (message_template || this.getDefaultShiftTemplate())
        .replace("{name}", candidate.name)
        .replace("{date}", shift_date)
        .replace("{time}", shift_time)
        .replace("{branch}", branch_id);

      try {
        const result = await whatsappClient.sendButtons(
          candidate.phone,
          message,
          [
            { id: `accept_shift_${context.action_id}_${candidate.phone}`, title: "✅ Acepto" },
            { id: `decline_shift_${context.action_id}_${candidate.phone}`, title: "❌ No puedo" },
          ]
        );

        results.push({
          phone: candidate.phone,
          name: candidate.name,
          success: result.success,
          messageId: result.messageId,
        });

      } catch (err) {
        results.push({
          phone: candidate.phone,
          name: candidate.name,
          success: false,
          error: err?.message,
        });
      }
    }

    return {
      success: results.some(r => r.success),
      totalContacted: results.length,
      successCount: results.filter(r => r.success).length,
      results,
    };
  },

  /**
   * Envía mensaje genérico
   */
  async sendMessage(payload, context) {
    const { phone, message, buttons } = payload;

    if (!phone || !message) {
      throw new Error("phone and message required");
    }

    let result;

    if (buttons && buttons.length > 0) {
      result = await whatsappClient.sendButtons(phone, message, buttons);
    } else {
      result = await whatsappClient.sendText(phone, message);
    }

    return {
      success: result.success,
      messageId: result.messageId,
    };
  },

  /**
   * Valida payload sin ejecutar
   */
  async validate(actionType, payload, context) {
    const errors = [];

    switch (actionType) {
      case "NOTIFY_GERENTE":
        if (!payload.branch_id) errors.push("branch_id required");
        if (!payload.message) errors.push("message required");
        break;

      case "NOTIFY_SOCIO":
        if (!payload.user_id) errors.push("user_id required");
        if (!payload.message) errors.push("message required");
        break;

      case "CONTACT_EVENTUAL_STAFF":
        if (!payload.candidates || payload.candidates.length === 0) {
          errors.push("candidates required");
        }
        if (!payload.shift_date) errors.push("shift_date required");
        break;

      case "SEND_MESSAGE":
        if (!payload.phone) errors.push("phone required");
        if (!payload.message) errors.push("message required");
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: errors.length === 0 
        ? `Would send WhatsApp message via ${actionType}` 
        : null,
    };
  },

  /**
   * Template por defecto para convocatoria de turno
   */
  getDefaultShiftTemplate() {
    return `Hola {name}! 👋

Tenemos un turno disponible:
📅 {date}
⏰ {time}
🏪 {branch}

¿Te interesa cubrir este turno?

_— Recursos Humanos (LUCA)_`;
  },
};

export default whatsappHandler;
