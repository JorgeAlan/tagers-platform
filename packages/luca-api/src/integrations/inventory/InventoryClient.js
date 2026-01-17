/**
 * ═══════════════════════════════════════════════════════════════════════════
 * INVENTORY CLIENT - Cliente para Sistema de Inventario
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Cliente genérico para sistemas de inventario (Marketman, etc.)
 * Funcionalidades:
 * - Leer niveles de inventario
 * - Obtener precios de proveedores
 * - Crear órdenes de compra
 * - Monitorear alertas de stock
 */

import { logger } from "@tagers/shared";

const INVENTORY_API_URL = process.env.INVENTORY_API_URL;
const INVENTORY_API_KEY = process.env.INVENTORY_API_KEY;

/**
 * Estados de inventario
 */
export const InventoryStatus = {
  IN_STOCK: "in_stock",
  LOW_STOCK: "low_stock",
  OUT_OF_STOCK: "out_of_stock",
  OVERSTOCK: "overstock",
};

/**
 * Categorías de productos
 */
export const ProductCategory = {
  INGREDIENTS: "ingredients",
  PACKAGING: "packaging",
  SUPPLIES: "supplies",
  EQUIPMENT: "equipment",
};

export class InventoryClient {
  constructor() {
    this.baseUrl = INVENTORY_API_URL;
    this.apiKey = INVENTORY_API_KEY;
  }

  /**
   * Verifica si el cliente está configurado
   */
  isConfigured() {
    return !!(this.apiKey && this.baseUrl);
  }

  /**
   * Obtiene niveles de inventario por sucursal
   */
  async getInventoryLevels(options = {}) {
    const { branchId, category, belowMinimum } = options;

    if (!this.isConfigured()) {
      logger.warn("Inventory client not configured, returning mock data");
      return this.getMockInventory(options);
    }

    try {
      const params = new URLSearchParams();
      if (branchId) params.append("location_id", branchId);
      if (category) params.append("category", category);
      if (belowMinimum) params.append("below_minimum", "true");

      const response = await this.request(`/inventory?${params.toString()}`);
      return this.normalizeInventory(response.data);
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to get inventory");
      return this.getMockInventory(options);
    }
  }

  /**
   * Obtiene alertas de inventario activas
   */
  async getInventoryAlerts(options = {}) {
    const { branchId, severity } = options;

    if (!this.isConfigured()) {
      return this.getMockAlerts(options);
    }

    try {
      const params = new URLSearchParams();
      if (branchId) params.append("location_id", branchId);
      if (severity) params.append("severity", severity);
      params.append("status", "active");

      const response = await this.request(`/inventory/alerts?${params.toString()}`);
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to get inventory alerts");
      return this.getMockAlerts(options);
    }
  }

  /**
   * Obtiene lista de proveedores
   */
  async getSuppliers(options = {}) {
    const { productId, category } = options;

    if (!this.isConfigured()) {
      return this.getMockSuppliers();
    }

    try {
      const params = new URLSearchParams();
      if (productId) params.append("product_id", productId);
      if (category) params.append("category", category);

      const response = await this.request(`/suppliers?${params.toString()}`);
      return response.data;
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to get suppliers");
      return this.getMockSuppliers();
    }
  }

  /**
   * Obtiene precios actuales de un producto con todos los proveedores
   */
  async getProductPrices(productId) {
    if (!this.isConfigured()) {
      return this.getMockPrices(productId);
    }

    try {
      const response = await this.request(`/products/${productId}/prices`);
      return response.data;
    } catch (err) {
      logger.error({ productId, err: err?.message }, "Failed to get product prices");
      return this.getMockPrices(productId);
    }
  }

  /**
   * Obtiene historial de precios de un producto
   */
  async getPriceHistory(productId, options = {}) {
    const { supplierId, days = 90 } = options;

    if (!this.isConfigured()) {
      return this.getMockPriceHistory(productId);
    }

    try {
      const params = new URLSearchParams();
      params.append("days", days.toString());
      if (supplierId) params.append("supplier_id", supplierId);

      const response = await this.request(`/products/${productId}/price-history?${params.toString()}`);
      return response.data;
    } catch (err) {
      logger.error({ productId, err: err?.message }, "Failed to get price history");
      return this.getMockPriceHistory(productId);
    }
  }

  /**
   * Crea borrador de orden de compra
   */
  async createPurchaseOrderDraft(po) {
    const { branchId, supplierId, items, deliveryDate, notes } = po;

    if (!this.isConfigured()) {
      return {
        success: true,
        mock: true,
        poId: `PO-MOCK-${Date.now()}`,
        status: "draft",
        ...po,
      };
    }

    try {
      const response = await this.request("/purchase-orders", "POST", {
        location_id: branchId,
        supplier_id: supplierId,
        items: items.map(i => ({
          product_id: i.productId,
          quantity: i.quantity,
          unit_price: i.unitPrice,
        })),
        delivery_date: deliveryDate,
        notes,
        status: "draft",
      });

      return {
        success: true,
        poId: response.data.id,
        status: "draft",
      };
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to create PO draft");
      throw err;
    }
  }

  /**
   * Obtiene consumo proyectado basado en historial
   */
  async getProjectedConsumption(productId, branchId, days = 7) {
    if (!this.isConfigured()) {
      return this.getMockConsumption(productId, days);
    }

    try {
      const response = await this.request(
        `/products/${productId}/consumption?location_id=${branchId}&days=${days}`
      );
      return response.data;
    } catch (err) {
      logger.error({ productId, err: err?.message }, "Failed to get consumption");
      return this.getMockConsumption(productId, days);
    }
  }

  /**
   * Hace request a la API de inventario
   */
  async request(endpoint, method = "GET", body = null) {
    const url = `${this.baseUrl}${endpoint}`;
    
    const options = {
      method,
      headers: {
        "Authorization": `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
    };

    if (body && method !== "GET") {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.message || `Inventory API error: ${response.status}`);
    }

    return response.json();
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // DATOS MOCK PARA DESARROLLO
  // ═══════════════════════════════════════════════════════════════════════════

  getMockInventory(options) {
    const { branchId = "SUC01", belowMinimum } = options;
    
    const inventory = [
      {
        productId: "PROD001",
        productName: "Harina de trigo",
        category: ProductCategory.INGREDIENTS,
        branchId,
        currentLevel: 15,
        minimumLevel: 20,
        maximumLevel: 100,
        unit: "kg",
        status: InventoryStatus.LOW_STOCK,
        lastUpdated: new Date().toISOString(),
      },
      {
        productId: "PROD002",
        productName: "Azúcar",
        category: ProductCategory.INGREDIENTS,
        branchId,
        currentLevel: 8,
        minimumLevel: 15,
        maximumLevel: 50,
        unit: "kg",
        status: InventoryStatus.LOW_STOCK,
        lastUpdated: new Date().toISOString(),
      },
      {
        productId: "PROD003",
        productName: "Café molido",
        category: ProductCategory.INGREDIENTS,
        branchId,
        currentLevel: 5,
        minimumLevel: 10,
        maximumLevel: 30,
        unit: "kg",
        status: InventoryStatus.LOW_STOCK,
        lastUpdated: new Date().toISOString(),
      },
      {
        productId: "PROD004",
        productName: "Leche",
        category: ProductCategory.INGREDIENTS,
        branchId,
        currentLevel: 50,
        minimumLevel: 40,
        maximumLevel: 100,
        unit: "L",
        status: InventoryStatus.IN_STOCK,
        lastUpdated: new Date().toISOString(),
      },
      {
        productId: "PROD005",
        productName: "Vasos desechables",
        category: ProductCategory.PACKAGING,
        branchId,
        currentLevel: 200,
        minimumLevel: 500,
        maximumLevel: 2000,
        unit: "pz",
        status: InventoryStatus.LOW_STOCK,
        lastUpdated: new Date().toISOString(),
      },
    ];

    if (belowMinimum) {
      return inventory.filter(i => i.currentLevel < i.minimumLevel);
    }

    return inventory;
  }

  getMockAlerts(options) {
    return [
      {
        alertId: "ALT001",
        productId: "PROD001",
        productName: "Harina de trigo",
        branchId: options.branchId || "SUC01",
        alertType: "LOW_STOCK",
        currentLevel: 15,
        minimumLevel: 20,
        severity: "HIGH",
        createdAt: new Date().toISOString(),
      },
      {
        alertId: "ALT002",
        productId: "PROD003",
        productName: "Café molido",
        branchId: options.branchId || "SUC01",
        alertType: "LOW_STOCK",
        currentLevel: 5,
        minimumLevel: 10,
        severity: "CRITICAL",
        createdAt: new Date().toISOString(),
      },
    ];
  }

  getMockSuppliers() {
    return [
      {
        supplierId: "SUP001",
        name: "Distribuidora Alimentos SA",
        category: ProductCategory.INGREDIENTS,
        contactName: "Juan Pérez",
        phone: "5555551234",
        email: "ventas@distrib.com",
        leadTimeDays: 2,
        minimumOrder: 1000,
        rating: 4.5,
      },
      {
        supplierId: "SUP002",
        name: "Café Premium MX",
        category: ProductCategory.INGREDIENTS,
        contactName: "María López",
        phone: "5555555678",
        email: "pedidos@cafepremium.mx",
        leadTimeDays: 3,
        minimumOrder: 500,
        rating: 4.8,
      },
      {
        supplierId: "SUP003",
        name: "Empaques y Más",
        category: ProductCategory.PACKAGING,
        contactName: "Carlos Ruiz",
        phone: "5555559012",
        email: "ventas@empaquesymas.com",
        leadTimeDays: 1,
        minimumOrder: 200,
        rating: 4.2,
      },
    ];
  }

  getMockPrices(productId) {
    return [
      {
        supplierId: "SUP001",
        supplierName: "Distribuidora Alimentos SA",
        unitPrice: 25.50,
        currency: "MXN",
        minQuantity: 10,
        lastUpdated: new Date().toISOString(),
      },
      {
        supplierId: "SUP002",
        supplierName: "Café Premium MX",
        unitPrice: 28.00,
        currency: "MXN",
        minQuantity: 5,
        lastUpdated: new Date().toISOString(),
      },
    ];
  }

  getMockPriceHistory(productId) {
    const history = [];
    const basePrice = 25;
    
    for (let i = 90; i >= 0; i -= 7) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const variation = (Math.random() - 0.5) * 5;
      
      history.push({
        date: date.toISOString().split("T")[0],
        price: Math.round((basePrice + variation + i * 0.05) * 100) / 100,
        supplierId: "SUP001",
      });
    }

    return history;
  }

  getMockConsumption(productId, days) {
    return {
      productId,
      averageDailyConsumption: 3.5,
      projectedConsumption: 3.5 * days,
      trend: "stable", // increasing, decreasing, stable
      confidence: 0.85,
    };
  }

  normalizeInventory(data) {
    if (!Array.isArray(data)) return [];
    return data.map(item => ({
      productId: item.id || item.product_id,
      productName: item.name || item.product_name,
      category: item.category,
      branchId: item.location_id,
      currentLevel: item.current_level || item.quantity,
      minimumLevel: item.minimum_level || item.min_quantity,
      maximumLevel: item.maximum_level || item.max_quantity,
      unit: item.unit,
      status: this.calculateStatus(item),
      lastUpdated: item.updated_at,
    }));
  }

  calculateStatus(item) {
    const current = item.current_level || item.quantity;
    const min = item.minimum_level || item.min_quantity;
    const max = item.maximum_level || item.max_quantity;

    if (current <= 0) return InventoryStatus.OUT_OF_STOCK;
    if (current < min) return InventoryStatus.LOW_STOCK;
    if (current > max) return InventoryStatus.OVERSTOCK;
    return InventoryStatus.IN_STOCK;
  }
}

// Export singleton
export const inventoryClient = new InventoryClient();

export default InventoryClient;
