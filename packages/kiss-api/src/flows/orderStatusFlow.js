/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDER STATUS FLOW - Consulta de estado de pedidos
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * TODO: Implementar búsqueda de pedido por:
 * - Número de pedido
 * - Teléfono
 * - Email
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { logger } from "../utils/logger.js";
import { flowStateService } from "../services/flowStateService.js";

async function handle(ctx, state) {
  const { conversationId, messageText } = ctx;
  
  logger.info({ conversationId, step: state?.step }, "OrderStatus: handling");
  
  // TODO: Implementar búsqueda de pedido
  // Por ahora, stub que pide número de pedido
  
  const orderNumber = extractOrderNumber(messageText);
  
  if (orderNumber) {
    // TODO: Consultar WooCommerce
    flowStateService.clearFlow(conversationId);
    return {
      message: `Buscando el pedido #${orderNumber}...\n\n⏳ Por favor espera mientras consulto el sistema.\n\n(Esta funcionalidad está en desarrollo)`,
    };
  }
  
  return {
    message: "Para consultar tu pedido, necesito el número de orden. Lo encuentras en el email de confirmación. ¿Cuál es tu número de pedido?",
  };
}

function extractOrderNumber(text) {
  const match = String(text || "").match(/\b(\d{4,})\b/);
  return match ? match[1] : null;
}

export const orderStatusFlow = { handle };
export default orderStatusFlow;
