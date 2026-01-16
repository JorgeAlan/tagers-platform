/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ORDER MODIFY FLOW - Modificación de pedidos existentes
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * TODO: Implementar modificación de:
 * - Fecha de entrega
 * - Sucursal de recolección
 * - Cantidad (si es posible)
 * 
 * @version 2.0.0 - Arquitectura modular
 */

import { logger } from "../utils/logger.js";
import { flowStateService } from "../services/flowStateService.js";

async function handle(ctx, state) {
  const { conversationId, messageText } = ctx;
  
  logger.info({ conversationId, step: state?.step }, "OrderModify: handling");
  
  // TODO: Implementar modificación de pedido
  // Por ahora, stub que pide número de pedido
  
  const orderNumber = extractOrderNumber(messageText);
  
  if (orderNumber) {
    flowStateService.clearFlow(conversationId);
    return {
      message: `Para modificar el pedido #${orderNumber}, necesito verificar algunos datos.\n\n¿Qué te gustaría cambiar?\n1. Fecha de entrega\n2. Sucursal de recolección\n\n(Esta funcionalidad está en desarrollo)`,
    };
  }
  
  return {
    message: "Para modificar tu pedido, necesito el número de orden. Lo encuentras en el email de confirmación. ¿Cuál es tu número de pedido?",
  };
}

function extractOrderNumber(text) {
  const match = String(text || "").match(/\b(\d{4,})\b/);
  return match ? match[1] : null;
}

export const orderModifyFlow = { handle };
export default orderModifyFlow;
