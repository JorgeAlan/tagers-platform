/**
 * ═══════════════════════════════════════════════════════════════════════════
 * MERCADER AGENT - Supply Chain Inteligente
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El Mercader optimiza compras e inventario:
 * 
 * 1. monitorStock()       → Vigila niveles de inventario
 * 2. detectIssues()       → Detecta stock bajo, sobre-stock, próximos a vencer
 * 3. monitorPrices()      → Vigila precios y detecta inflación
 * 4. findAlternatives()   → Busca mejores precios/proveedores
 * 5. draftPO()            → Prepara órdenes de compra
 * 6. calculateSavings()   → Calcula ahorro potencial
 * 
 * Flujo: MONITOR → DETECT → ANALYZE → RECOMMEND → DRAFT PO → APPROVE
 */

import { logger, query } from "@tagers/shared";
import { inventoryClient, InventoryStatus } from "../integrations/inventory/InventoryClient.js";
import { actionBus } from "../actions/ActionBus.js";
import { getBranchList, getBranchName } from "../config/lucaConfig.js";
import { caseService } from "../services/caseService.js";

/**
 * Umbrales para detección
 */
const DETECTION_THRESHOLDS = {
  lowStockDays: 3,           // Alertar si stock cubre menos de 3 días
  priceIncreaseAlert: 10,    // Alertar si precio sube >10%
  priceIncreaseWarning: 5,   // Advertir si precio sube >5%
  minSavingsToReport: 100,   // MXN mínimo para reportar ahorro
  reorderLeadDays: 2,        // Días de anticipación para reordenar
};

/**
 * Configuración de reorden por categoría
 */
const REORDER_CONFIG = {
  ingredients: {
    reorderPoint: 1.5,  // Multiplicador del mínimo
    orderQuantity: 2.0, // Multiplicador para llegar al óptimo
    priority: "HIGH",
  },
  packaging: {
    reorderPoint: 1.2,
    orderQuantity: 3.0,
    priority: "MEDIUM",
  },
  supplies: {
    reorderPoint: 1.0,
    orderQuantity: 2.0,
    priority: "LOW",
  },
};

export class MercaderAgent {
  constructor() {
    this.priceCache = new Map(); // productId -> {price, timestamp}
  }

  /**
   * Ejecuta el flujo completo del Mercader
   */
  async run(context = {}) {
    const runId = `mercader_${Date.now()}`;
    logger.info({ runId, context }, "MercaderAgent starting");

    const results = {
      runId,
      startedAt: new Date().toISOString(),
      phases: {},
      issues_found: [],
      pos_drafted: [],
      savings_opportunities: [],
    };

    try {
      // Obtener sucursales a analizar
      const branches = context.branch_id 
        ? [{ id: context.branch_id }]
        : await getBranchList();

      // Fase 1: MONITOR - Revisar niveles de inventario
      results.phases.monitor = await this.monitorStock(branches);

      // Fase 2: DETECT - Identificar problemas
      results.phases.detect = await this.detectIssues(results.phases.monitor);
      results.issues_found = results.phases.detect.issues;

      if (results.issues_found.length === 0) {
        results.status = "no_issues";
        results.completedAt = new Date().toISOString();
        logger.info({ runId }, "No inventory issues detected");
        return results;
      }

      // Fase 3: ANALYZE - Analizar precios y alternativas
      results.phases.analyze = await this.analyzePricesAndAlternatives(
        results.issues_found
      );

      // Fase 4: RECOMMEND - Generar recomendaciones
      results.phases.recommend = await this.generateRecommendations(
        results.issues_found,
        results.phases.analyze
      );

      // Fase 5: DRAFT - Crear borradores de PO
      for (const recommendation of results.phases.recommend.purchaseOrders) {
        const draftResult = await this.draftPurchaseOrder(recommendation);
        results.pos_drafted.push(draftResult);
      }

      // Fase 6: SAVINGS - Calcular ahorros
      results.savings_opportunities = results.phases.analyze.savingsOpportunities;

      results.status = "completed";
      results.completedAt = new Date().toISOString();

      logger.info({
        runId,
        issuesFound: results.issues_found.length,
        posDrafted: results.pos_drafted.length,
        potentialSavings: results.savings_opportunities.reduce((sum, s) => sum + s.amount, 0),
      }, "MercaderAgent completed");

      return results;

    } catch (err) {
      logger.error({ runId, err: err?.message }, "MercaderAgent failed");
      results.status = "error";
      results.error = err?.message;
      return results;
    }
  }

  /**
   * Fase 1: Monitorea niveles de stock
   */
  async monitorStock(branches) {
    logger.info("Phase 1: MONITOR STOCK");

    const inventoryByBranch = {};

    for (const branch of branches) {
      const inventory = await inventoryClient.getInventoryLevels({
        branchId: branch.id,
      });

      inventoryByBranch[branch.id] = inventory;
    }

    return { inventoryByBranch };
  }

  /**
   * Fase 2: Detecta problemas de inventario
   */
  async detectIssues(monitorData) {
    logger.info("Phase 2: DETECT ISSUES");

    const issues = [];

    for (const [branchId, inventory] of Object.entries(monitorData.inventoryByBranch)) {
      for (const item of inventory) {
        // Verificar stock bajo
        if (item.status === InventoryStatus.LOW_STOCK || 
            item.status === InventoryStatus.OUT_OF_STOCK) {
          
          // Calcular días de cobertura
          const consumption = await inventoryClient.getProjectedConsumption(
            item.productId,
            branchId,
            7
          );
          
          const daysOfStock = consumption.averageDailyConsumption > 0
            ? item.currentLevel / consumption.averageDailyConsumption
            : 999;

          if (daysOfStock < DETECTION_THRESHOLDS.lowStockDays || 
              item.status === InventoryStatus.OUT_OF_STOCK) {
            
            issues.push({
              issueId: `ISS-${branchId}-${item.productId}-${Date.now()}`,
              type: item.status === InventoryStatus.OUT_OF_STOCK ? "OUT_OF_STOCK" : "LOW_STOCK",
              branchId,
              productId: item.productId,
              productName: item.productName,
              category: item.category,
              currentLevel: item.currentLevel,
              minimumLevel: item.minimumLevel,
              unit: item.unit,
              daysOfStock: Math.round(daysOfStock * 10) / 10,
              severity: item.status === InventoryStatus.OUT_OF_STOCK ? "CRITICAL" : 
                        (daysOfStock < 1 ? "HIGH" : "MEDIUM"),
              consumption,
            });
          }
        }

        // Verificar sobre-stock (capital inmovilizado)
        if (item.status === InventoryStatus.OVERSTOCK) {
          issues.push({
            issueId: `ISS-${branchId}-${item.productId}-${Date.now()}`,
            type: "OVERSTOCK",
            branchId,
            productId: item.productId,
            productName: item.productName,
            category: item.category,
            currentLevel: item.currentLevel,
            maximumLevel: item.maximumLevel,
            unit: item.unit,
            excessAmount: item.currentLevel - item.maximumLevel,
            severity: "LOW",
          });
        }
      }
    }

    return { issues };
  }

  /**
   * Fase 3: Analiza precios y busca alternativas
   */
  async analyzePricesAndAlternatives(issues) {
    logger.info("Phase 3: ANALYZE PRICES");

    const priceAnalysis = [];
    const savingsOpportunities = [];

    // Obtener productos únicos con issues
    const productIds = [...new Set(issues.map(i => i.productId))];

    for (const productId of productIds) {
      // Obtener precios actuales de todos los proveedores
      const prices = await inventoryClient.getProductPrices(productId);
      
      // Obtener historial de precios
      const history = await inventoryClient.getPriceHistory(productId);

      // Analizar tendencia de precios
      const priceChange = this.calculatePriceChange(history);

      // Encontrar mejor precio
      const bestPrice = prices.reduce((min, p) => 
        p.unitPrice < min.unitPrice ? p : min
      , prices[0] || { unitPrice: Infinity });

      const currentPrice = prices.find(p => p.isCurrentSupplier) || prices[0];

      priceAnalysis.push({
        productId,
        currentPrice: currentPrice?.unitPrice,
        currentSupplier: currentPrice?.supplierName,
        bestPrice: bestPrice?.unitPrice,
        bestSupplier: bestPrice?.supplierName,
        priceChange,
        allPrices: prices,
      });

      // Detectar oportunidad de ahorro
      if (currentPrice && bestPrice && currentPrice.unitPrice > bestPrice.unitPrice) {
        const savings = currentPrice.unitPrice - bestPrice.unitPrice;
        const issue = issues.find(i => i.productId === productId);
        const orderQuantity = issue 
          ? (issue.minimumLevel - issue.currentLevel) * 2 
          : 10;
        
        const totalSavings = savings * orderQuantity;

        if (totalSavings >= DETECTION_THRESHOLDS.minSavingsToReport) {
          savingsOpportunities.push({
            productId,
            productName: issue?.productName,
            currentSupplier: currentPrice.supplierName,
            currentPrice: currentPrice.unitPrice,
            alternativeSupplier: bestPrice.supplierName,
            alternativePrice: bestPrice.unitPrice,
            savingsPerUnit: savings,
            estimatedQuantity: orderQuantity,
            totalSavings,
          });
        }
      }

      // Detectar inflación significativa
      if (priceChange.percentChange >= DETECTION_THRESHOLDS.priceIncreaseAlert) {
        const issue = issues.find(i => i.productId === productId);
        
        // Crear caso de inflación
        await this.createInflationCase({
          productId,
          productName: issue?.productName,
          priceChange,
          currentPrice: currentPrice?.unitPrice,
        });
      }
    }

    return { priceAnalysis, savingsOpportunities };
  }

  /**
   * Calcula cambio de precio desde historial
   */
  calculatePriceChange(history) {
    if (!history || history.length < 2) {
      return { percentChange: 0, trend: "stable" };
    }

    const recent = history[history.length - 1].price;
    const older = history[0].price;
    const percentChange = ((recent - older) / older) * 100;

    let trend = "stable";
    if (percentChange > 5) trend = "increasing";
    else if (percentChange < -5) trend = "decreasing";

    return {
      percentChange: Math.round(percentChange * 10) / 10,
      trend,
      oldestPrice: older,
      newestPrice: recent,
      period: `${history.length * 7} days`,
    };
  }

  /**
   * Fase 4: Genera recomendaciones de compra
   */
  async generateRecommendations(issues, analysis) {
    logger.info("Phase 4: GENERATE RECOMMENDATIONS");

    const purchaseOrders = [];

    // Agrupar issues por sucursal y proveedor
    const grouped = {};

    for (const issue of issues) {
      if (issue.type !== "LOW_STOCK" && issue.type !== "OUT_OF_STOCK") continue;

      const priceInfo = analysis.priceAnalysis.find(p => p.productId === issue.productId);
      const supplier = priceInfo?.bestSupplier || priceInfo?.currentSupplier || "DEFAULT";
      
      const key = `${issue.branchId}-${supplier}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          branchId: issue.branchId,
          supplier,
          supplierId: priceInfo?.allPrices?.find(p => p.supplierName === supplier)?.supplierId,
          items: [],
        };
      }

      // Calcular cantidad a ordenar
      const config = REORDER_CONFIG[issue.category] || REORDER_CONFIG.supplies;
      const orderQuantity = Math.ceil(
        (issue.minimumLevel * config.orderQuantity) - issue.currentLevel
      );

      grouped[key].items.push({
        productId: issue.productId,
        productName: issue.productName,
        quantity: orderQuantity,
        unit: issue.unit,
        unitPrice: priceInfo?.bestPrice || priceInfo?.currentPrice || 0,
        currentLevel: issue.currentLevel,
        minimumLevel: issue.minimumLevel,
        priority: config.priority,
      });
    }

    // Convertir a lista de POs
    for (const [key, po] of Object.entries(grouped)) {
      if (po.items.length === 0) continue;

      const total = po.items.reduce((sum, item) => 
        sum + (item.quantity * item.unitPrice), 0
      );

      const branchName = await getBranchName(po.branchId);

      purchaseOrders.push({
        poId: `PO-DRAFT-${Date.now()}-${po.branchId}`,
        branchId: po.branchId,
        branchName,
        supplierId: po.supplierId,
        supplierName: po.supplier,
        items: po.items,
        subtotal: total,
        estimatedTotal: total * 1.16, // +IVA
        priority: po.items.some(i => i.priority === "HIGH") ? "HIGH" : "MEDIUM",
        suggestedDeliveryDate: this.calculateDeliveryDate(2),
      });
    }

    return { purchaseOrders };
  }

  /**
   * Fase 5: Crea borrador de orden de compra
   */
  async draftPurchaseOrder(recommendation) {
    logger.info({ poId: recommendation.poId }, "Phase 5: DRAFT PO");

    // Crear draft en sistema de inventario
    const draft = await inventoryClient.createPurchaseOrderDraft({
      branchId: recommendation.branchId,
      supplierId: recommendation.supplierId,
      items: recommendation.items.map(i => ({
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
      })),
      deliveryDate: recommendation.suggestedDeliveryDate,
      notes: `Generado automáticamente por LUCA - ${recommendation.items.length} productos`,
    });

    // Proponer acción via ActionBus
    const actionResult = await actionBus.propose({
      type: "DRAFT_PURCHASE_ORDER",
      payload: {
        po_id: draft.poId,
        branch_id: recommendation.branchId,
        supplier_id: recommendation.supplierId,
        supplier_name: recommendation.supplierName,
        items: recommendation.items,
        total: recommendation.estimatedTotal,
        delivery_date: recommendation.suggestedDeliveryDate,
      },
      context: {
        items_count: recommendation.items.length,
        priority: recommendation.priority,
      },
      reason: `Reabastecer ${recommendation.items.length} productos en ${recommendation.branchName}`,
      requestedBy: "mercader_agent",
    });

    return {
      ...recommendation,
      draftId: draft.poId,
      actionId: actionResult.actionId,
      actionState: actionResult.state,
    };
  }

  /**
   * Crea caso por inflación significativa
   */
  async createInflationCase(data) {
    try {
      await caseService.createCase({
        title: `Alerta de inflación: ${data.productName || data.productId}`,
        description: `El precio de ${data.productName || data.productId} ha subido ${data.priceChange.percentChange}% en los últimos ${data.priceChange.period}.\n\nPrecio anterior: $${data.priceChange.oldestPrice}\nPrecio actual: $${data.priceChange.newestPrice}`,
        case_type: "PRICE_ALERT",
        severity: data.priceChange.percentChange >= 15 ? "HIGH" : "MEDIUM",
        scope: {
          product_id: data.productId,
        },
        source: {
          detector: "mercader",
          created_by: "LUCA",
        },
      });
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to create inflation case");
    }
  }

  /**
   * Calcula fecha de entrega sugerida
   */
  calculateDeliveryDate(leadDays) {
    const date = new Date();
    date.setDate(date.getDate() + leadDays + DETECTION_THRESHOLDS.reorderLeadDays);
    
    // Ajustar si cae en fin de semana
    const dayOfWeek = date.getDay();
    if (dayOfWeek === 0) date.setDate(date.getDate() + 1);
    if (dayOfWeek === 6) date.setDate(date.getDate() + 2);
    
    return date.toISOString().split("T")[0];
  }

  /**
   * Obtiene resumen de estado de inventario
   */
  async getInventorySummary(branchId = null) {
    const branches = branchId 
      ? [{ id: branchId }]
      : await getBranchList();

    const summary = {
      totalProducts: 0,
      inStock: 0,
      lowStock: 0,
      outOfStock: 0,
      overStock: 0,
      byBranch: {},
    };

    for (const branch of branches) {
      const inventory = await inventoryClient.getInventoryLevels({
        branchId: branch.id,
      });

      const branchSummary = {
        total: inventory.length,
        inStock: inventory.filter(i => i.status === InventoryStatus.IN_STOCK).length,
        lowStock: inventory.filter(i => i.status === InventoryStatus.LOW_STOCK).length,
        outOfStock: inventory.filter(i => i.status === InventoryStatus.OUT_OF_STOCK).length,
        overStock: inventory.filter(i => i.status === InventoryStatus.OVERSTOCK).length,
      };

      summary.byBranch[branch.id] = branchSummary;
      summary.totalProducts += branchSummary.total;
      summary.inStock += branchSummary.inStock;
      summary.lowStock += branchSummary.lowStock;
      summary.outOfStock += branchSummary.outOfStock;
      summary.overStock += branchSummary.overStock;
    }

    return summary;
  }
}

export const mercaderAgent = new MercaderAgent();

export default MercaderAgent;
