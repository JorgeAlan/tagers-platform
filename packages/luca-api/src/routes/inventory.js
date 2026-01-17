/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTORY ROUTES - API para El Mercader
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { Router } from "express";
import { logger } from "@tagers/shared";
import { mercaderAgent } from "../agents/MercaderAgent.js";
import { inventoryClient, InventoryStatus } from "../integrations/inventory/InventoryClient.js";

const router = Router();

// ═══════════════════════════════════════════════════════════════════════════
// MERCADER AGENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/inventory/run
 * Ejecutar el flujo completo del Mercader
 */
router.post("/run", async (req, res) => {
  try {
    const { branch_id } = req.body;
    
    const result = await mercaderAgent.run({
      branch_id,
    });
    
    res.json(result);
  } catch (err) {
    logger.error({ err: err?.message }, "Mercader run failed");
    res.status(500).json({ error: err?.message || "Run failed" });
  }
});

/**
 * GET /api/luca/inventory/summary
 * Resumen de estado de inventario
 */
router.get("/summary", async (req, res) => {
  try {
    const { branch_id } = req.query;
    
    const summary = await mercaderAgent.getInventorySummary(branch_id);
    
    res.json(summary);
  } catch (err) {
    logger.error({ err: err?.message }, "Summary failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/issues
 * Detectar problemas de inventario
 */
router.get("/issues", async (req, res) => {
  try {
    const { branch_id } = req.query;
    
    const result = await mercaderAgent.run({
      branch_id,
      detectOnly: true,
    });
    
    res.json({
      issues: result.issues_found || [],
      summary: {
        total: result.issues_found?.length || 0,
        critical: result.issues_found?.filter(i => i.severity === "CRITICAL").length || 0,
        high: result.issues_found?.filter(i => i.severity === "HIGH").length || 0,
        lowStock: result.issues_found?.filter(i => i.type === "LOW_STOCK").length || 0,
        outOfStock: result.issues_found?.filter(i => i.type === "OUT_OF_STOCK").length || 0,
      },
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Issues detection failed");
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/savings
 * Obtener oportunidades de ahorro
 */
router.get("/savings", async (req, res) => {
  try {
    const { branch_id } = req.query;
    
    const result = await mercaderAgent.run({
      branch_id,
    });
    
    res.json({
      opportunities: result.savings_opportunities || [],
      totalPotentialSavings: (result.savings_opportunities || [])
        .reduce((sum, s) => sum + s.totalSavings, 0),
    });
  } catch (err) {
    logger.error({ err: err?.message }, "Savings analysis failed");
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// INVENTORY DATA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/inventory/levels
 * Obtener niveles de inventario
 */
router.get("/levels", async (req, res) => {
  try {
    const { branch_id, category, below_minimum } = req.query;
    
    const levels = await inventoryClient.getInventoryLevels({
      branchId: branch_id,
      category,
      belowMinimum: below_minimum === "true",
    });
    
    res.json({ 
      levels, 
      count: levels.length,
      statuses: {
        inStock: levels.filter(l => l.status === InventoryStatus.IN_STOCK).length,
        lowStock: levels.filter(l => l.status === InventoryStatus.LOW_STOCK).length,
        outOfStock: levels.filter(l => l.status === InventoryStatus.OUT_OF_STOCK).length,
        overStock: levels.filter(l => l.status === InventoryStatus.OVERSTOCK).length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/alerts
 * Obtener alertas de inventario activas
 */
router.get("/alerts", async (req, res) => {
  try {
    const { branch_id, severity } = req.query;
    
    const alerts = await inventoryClient.getInventoryAlerts({
      branchId: branch_id,
      severity,
    });
    
    res.json({ alerts, count: alerts.length });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/product/:productId
 * Obtener información de un producto
 */
router.get("/product/:productId", async (req, res) => {
  try {
    const { productId } = req.params;
    const { branch_id } = req.query;
    
    const levels = await inventoryClient.getInventoryLevels({
      branchId: branch_id,
    });
    
    const product = levels.find(l => l.productId === productId);
    
    if (!product) {
      return res.status(404).json({ error: "Product not found" });
    }
    
    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/product/:productId/prices
 * Obtener precios de un producto
 */
router.get("/product/:productId/prices", async (req, res) => {
  try {
    const { productId } = req.params;
    
    const prices = await inventoryClient.getProductPrices(productId);
    
    res.json({ 
      productId,
      prices,
      bestPrice: prices.reduce((min, p) => 
        p.unitPrice < min.unitPrice ? p : min
      , prices[0] || {}),
    });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/product/:productId/price-history
 * Obtener historial de precios
 */
router.get("/product/:productId/price-history", async (req, res) => {
  try {
    const { productId } = req.params;
    const { supplier_id, days } = req.query;
    
    const history = await inventoryClient.getPriceHistory(productId, {
      supplierId: supplier_id,
      days: days ? parseInt(days) : 90,
    });
    
    res.json({ productId, history });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/product/:productId/consumption
 * Obtener proyección de consumo
 */
router.get("/product/:productId/consumption", async (req, res) => {
  try {
    const { productId } = req.params;
    const { branch_id, days } = req.query;
    
    if (!branch_id) {
      return res.status(400).json({ error: "branch_id required" });
    }
    
    const consumption = await inventoryClient.getProjectedConsumption(
      productId,
      branch_id,
      days ? parseInt(days) : 7
    );
    
    res.json(consumption);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/luca/inventory/suppliers
 * Obtener lista de proveedores
 */
router.get("/suppliers", async (req, res) => {
  try {
    const { product_id, category } = req.query;
    
    const suppliers = await inventoryClient.getSuppliers({
      productId: product_id,
      category,
    });
    
    res.json({ suppliers, count: suppliers.length });
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/luca/inventory/po/draft
 * Crear borrador de orden de compra
 */
router.post("/po/draft", async (req, res) => {
  try {
    const { branch_id, supplier_id, items, delivery_date, notes } = req.body;
    
    if (!branch_id || !supplier_id || !items || items.length === 0) {
      return res.status(400).json({ 
        error: "branch_id, supplier_id, and items required" 
      });
    }
    
    const result = await inventoryClient.createPurchaseOrderDraft({
      branchId: branch_id,
      supplierId: supplier_id,
      items,
      deliveryDate: delivery_date,
      notes,
    });
    
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err?.message });
  }
});

/**
 * GET /api/luca/inventory/status
 * Estado del sistema de inventario
 */
router.get("/status", async (req, res) => {
  res.json({
    agent: "mercader",
    status: "operational",
    inventoryClientConfigured: inventoryClient.isConfigured(),
  });
});

export default router;
