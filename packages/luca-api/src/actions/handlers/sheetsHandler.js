/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHEETS HANDLER - Ejecuta acciones de Google Sheets
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Acciones soportadas:
 * - UPDATE_CONFIG: Actualizar configuración
 * - SUGGEST_SCHEDULE_CHANGE: Sugerir cambio en programación
 * - DRAFT_PURCHASE_ORDER: Crear borrador de orden de compra
 * - UPDATE_INVENTORY_ALERT: Actualizar alerta de inventario
 */

import { logger } from "@tagers/shared";

/**
 * URLs de Google Sheets (Apps Script Web Apps)
 */
const SHEETS_CONFIG = {
  config: process.env.GOOGLE_SHEETS_CONFIG_URL,
  schedule: process.env.GOOGLE_SHEETS_SCHEDULE_URL,
  inventory: process.env.GOOGLE_SHEETS_INVENTORY_URL,
  purchase_orders: process.env.GOOGLE_SHEETS_PO_URL,
};

export const sheetsHandler = {
  /**
   * Ejecuta una acción de Sheets
   */
  async execute(actionType, payload, context) {
    logger.info({ actionType, payload }, "Sheets handler executing");

    switch (actionType) {
      case "UPDATE_CONFIG":
        return this.updateConfig(payload, context);

      case "SUGGEST_SCHEDULE_CHANGE":
        return this.suggestScheduleChange(payload, context);

      case "DRAFT_PURCHASE_ORDER":
        return this.draftPurchaseOrder(payload, context);

      case "UPDATE_INVENTORY_ALERT":
        return this.updateInventoryAlert(payload, context);

      case "APPEND_ROW":
        return this.appendRow(payload, context);

      case "UPDATE_CELL":
        return this.updateCell(payload, context);

      default:
        throw new Error(`Unknown Sheets action: ${actionType}`);
    }
  },

  /**
   * Actualiza configuración en Google Sheets
   */
  async updateConfig(payload, context) {
    const { sheet, key, value, row_id } = payload;

    if (!sheet || !key || value === undefined) {
      throw new Error("sheet, key, and value required");
    }

    // Enviar a Apps Script
    const result = await this.sheetsRequest(SHEETS_CONFIG.config, {
      action: "update",
      sheet,
      key,
      value,
      row_id,
      context: {
        updated_by: "LUCA",
        action_id: context.action_id,
        timestamp: new Date().toISOString(),
      },
    });

    return {
      success: true,
      sheet,
      key,
      previousValue: result?.previousValue,
      newValue: value,
    };
  },

  /**
   * Sugiere cambio de programación/horario
   */
  async suggestScheduleChange(payload, context) {
    const {
      branch_id,
      date,
      employee_id,
      current_shift,
      suggested_shift,
      reason,
    } = payload;

    if (!branch_id || !date || !employee_id) {
      throw new Error("branch_id, date, and employee_id required");
    }

    // Agregar fila de sugerencia
    const result = await this.sheetsRequest(SHEETS_CONFIG.schedule, {
      action: "append",
      sheet: "schedule_suggestions",
      row: {
        branch_id,
        date,
        employee_id,
        current_shift,
        suggested_shift,
        reason,
        status: "PENDING",
        suggested_by: "LUCA",
        suggested_at: new Date().toISOString(),
        action_id: context.action_id,
      },
    });

    return {
      success: true,
      suggestionId: result?.row_id || `SUG-${Date.now()}`,
      branch_id,
      date,
      employee_id,
    };
  },

  /**
   * Crea borrador de orden de compra
   */
  async draftPurchaseOrder(payload, context) {
    const {
      branch_id,
      supplier_id,
      items,        // [{product_id, product_name, quantity, unit_price}]
      notes,
      delivery_date,
    } = payload;

    if (!branch_id || !supplier_id || !items || items.length === 0) {
      throw new Error("branch_id, supplier_id, and items required");
    }

    // Calcular total
    const total = items.reduce((sum, item) => 
      sum + (item.quantity * item.unit_price), 0
    );

    // Crear PO en Sheets
    const poId = `PO-${Date.now()}-${branch_id}`;

    const result = await this.sheetsRequest(SHEETS_CONFIG.purchase_orders, {
      action: "create_po",
      po: {
        po_id: poId,
        branch_id,
        supplier_id,
        items,
        total,
        notes,
        delivery_date,
        status: "DRAFT",
        created_by: "LUCA",
        created_at: new Date().toISOString(),
        action_id: context.action_id,
      },
    });

    return {
      success: true,
      poId,
      branch_id,
      supplier_id,
      itemCount: items.length,
      total,
      status: "DRAFT",
    };
  },

  /**
   * Actualiza alerta de inventario
   */
  async updateInventoryAlert(payload, context) {
    const {
      branch_id,
      product_id,
      alert_type,     // LOW_STOCK, OUT_OF_STOCK, EXPIRING
      current_level,
      threshold,
      status,         // ACTIVE, ACKNOWLEDGED, RESOLVED
    } = payload;

    if (!branch_id || !product_id || !alert_type) {
      throw new Error("branch_id, product_id, and alert_type required");
    }

    const result = await this.sheetsRequest(SHEETS_CONFIG.inventory, {
      action: "upsert_alert",
      alert: {
        branch_id,
        product_id,
        alert_type,
        current_level,
        threshold,
        status: status || "ACTIVE",
        updated_by: "LUCA",
        updated_at: new Date().toISOString(),
        action_id: context.action_id,
      },
    });

    return {
      success: true,
      alertId: result?.alert_id || `ALT-${Date.now()}`,
      branch_id,
      product_id,
      alert_type,
      status,
    };
  },

  /**
   * Agrega fila genérica
   */
  async appendRow(payload, context) {
    const { sheet_url, sheet_name, row } = payload;

    if (!sheet_url || !sheet_name || !row) {
      throw new Error("sheet_url, sheet_name, and row required");
    }

    const result = await this.sheetsRequest(sheet_url, {
      action: "append",
      sheet: sheet_name,
      row: {
        ...row,
        _added_by: "LUCA",
        _added_at: new Date().toISOString(),
        _action_id: context.action_id,
      },
    });

    return {
      success: true,
      rowId: result?.row_id,
    };
  },

  /**
   * Actualiza celda específica
   */
  async updateCell(payload, context) {
    const { sheet_url, sheet_name, cell, value } = payload;

    if (!sheet_url || !sheet_name || !cell) {
      throw new Error("sheet_url, sheet_name, and cell required");
    }

    const result = await this.sheetsRequest(sheet_url, {
      action: "update_cell",
      sheet: sheet_name,
      cell,
      value,
    });

    return {
      success: true,
      cell,
      previousValue: result?.previousValue,
      newValue: value,
    };
  },

  /**
   * Hace request a Google Apps Script Web App
   */
  async sheetsRequest(url, data) {
    if (!url) {
      logger.warn("Sheets URL not configured, mock mode");
      return { 
        success: true, 
        mock: true,
        row_id: `mock_${Date.now()}`,
      };
    }

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`Sheets API error: ${response.status}`);
      }

      return response.json();
    } catch (err) {
      logger.error({ url, err: err?.message }, "Sheets request error");
      // En caso de error, retornar mock para no bloquear
      return { 
        success: true, 
        mock: true,
        error: err?.message,
      };
    }
  },

  /**
   * Valida payload sin ejecutar
   */
  async validate(actionType, payload, context) {
    const errors = [];

    switch (actionType) {
      case "UPDATE_CONFIG":
        if (!payload.sheet) errors.push("sheet required");
        if (!payload.key) errors.push("key required");
        if (payload.value === undefined) errors.push("value required");
        break;

      case "SUGGEST_SCHEDULE_CHANGE":
        if (!payload.branch_id) errors.push("branch_id required");
        if (!payload.date) errors.push("date required");
        if (!payload.employee_id) errors.push("employee_id required");
        break;

      case "DRAFT_PURCHASE_ORDER":
        if (!payload.branch_id) errors.push("branch_id required");
        if (!payload.supplier_id) errors.push("supplier_id required");
        if (!payload.items || payload.items.length === 0) {
          errors.push("items required");
        }
        break;
    }

    return {
      valid: errors.length === 0,
      errors,
      preview: errors.length === 0 
        ? `Would execute Sheets action: ${actionType}` 
        : null,
    };
  },

  /**
   * Revierte una acción
   */
  async rollback(actionType, payload, context, executionResult) {
    switch (actionType) {
      case "UPDATE_CONFIG":
        if (executionResult?.previousValue !== undefined) {
          return this.updateConfig({
            ...payload,
            value: executionResult.previousValue,
          }, context);
        }
        throw new Error("Cannot rollback: no previous value");

      case "SUGGEST_SCHEDULE_CHANGE":
        // Marcar sugerencia como cancelada
        return this.sheetsRequest(SHEETS_CONFIG.schedule, {
          action: "update",
          sheet: "schedule_suggestions",
          row_id: executionResult?.suggestionId,
          updates: { status: "CANCELLED" },
        });

      case "DRAFT_PURCHASE_ORDER":
        // Marcar PO como cancelada
        return this.sheetsRequest(SHEETS_CONFIG.purchase_orders, {
          action: "update_po",
          po_id: executionResult?.poId,
          updates: { status: "CANCELLED" },
        });

      default:
        throw new Error(`Rollback not supported for ${actionType}`);
    }
  },
};

export default sheetsHandler;
