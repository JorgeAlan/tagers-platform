/**
 * ═══════════════════════════════════════════════════════════════════════════
 * LUCA CONFIG LOADER - Pipeline de Configuración
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Carga TODA la configuración desde Google Sheets.
 * ZERO HARDCODE - Todo es configurable.
 * 
 * Sheets esperados en LUCA_CONFIG_SHEET_ID:
 * - LUCA_BRANCHES: Sucursales con ubicación, baselines, horarios
 * - LUCA_STAFFING: Personal por sucursal y turno
 * - LUCA_THRESHOLDS: Umbrales de detección
 * - LUCA_WEATHER_IMPACT: Impacto del clima en ventas
 * - LUCA_HOLIDAYS: Feriados y temporadas
 * - LUCA_FRAUD_PATTERNS: Patrones de fraude y pesos
 * - LUCA_ROI_VALUES: Valores de referencia para ROI
 * - LUCA_CAPACITY: Capacidades por rol
 * - LUCA_SEASONALITY: Factores estacionales
 * - LUCA_AUTONOMY: Niveles de autonomía
 */

import { google } from "googleapis";
import { logger } from "@tagers/shared";

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURACIÓN DEL LOADER
// ═══════════════════════════════════════════════════════════════════════════

const SHEET_CONFIGS = {
  branches: {
    sheetName: "LUCA_BRANCHES",
    keyField: "branch_id",
    transform: (row) => ({
      id: row.branch_id,
      name: row.name,
      city: row.city,
      type: row.type || "standard",
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      timezone: row.timezone || "America/Mexico_City",
      openHour: row.open_hour || "07:00",
      closeHour: row.close_hour || "22:00",
      peakHours: row.peak_hours ? row.peak_hours.split(",").map(s => s.trim()) : [],
      baseline: {
        dailySales: parseFloat(row.daily_sales_baseline) || 0,
        avgTicket: parseFloat(row.avg_ticket) || 0,
        dailyTransactions: parseFloat(row.daily_transactions) || 0,
        peakHourFactor: parseFloat(row.peak_factor) || 1.5,
      },
      capacity: {
        tables: parseInt(row.tables) || 0,
        seats: parseInt(row.seats) || 0,
        maxOccupancy: parseInt(row.max_occupancy) || 0,
        kitchenStations: parseInt(row.kitchen_stations) || 0,
        bakeryStations: parseInt(row.bakery_stations) || 0,
        cashRegisters: parseInt(row.cash_registers) || 0,
      },
      schoolZoneDensity: row.school_zone_density || "medium",
      deliveryBaselineRatio: parseFloat(row.delivery_baseline_ratio) || 0.25,
    }),
  },

  staffing: {
    sheetName: "LUCA_STAFFING",
    keyField: "branch_id",
    multiKey: true, // Múltiples rows por branch_id
    transform: (row) => ({
      branchId: row.branch_id,
      shift: row.shift,
      baristas: parseInt(row.baristas) || 0,
      kitchen: parseInt(row.kitchen) || 0,
      floor: parseInt(row.floor) || 0,
      cashier: parseInt(row.cashier) || 0,
    }),
  },

  thresholds: {
    sheetName: "LUCA_THRESHOLDS",
    keyField: "detector_id",
    multiKey: true,
    transform: (row) => ({
      detectorId: row.detector_id,
      metric: row.metric,
      threshold: parseFloat(row.threshold),
      severity: row.severity || "MEDIUM",
      enabled: row.enabled !== "FALSE",
      description: row.description || "",
      direction: row.direction || "above", // above, below, either
    }),
  },

  weatherImpact: {
    sheetName: "LUCA_WEATHER_IMPACT",
    keyField: "condition",
    transform: (row) => ({
      condition: row.condition,
      dineIn: parseFloat(row.dine_in) || 0,
      delivery: parseFloat(row.delivery) || 0,
      takeaway: parseFloat(row.takeaway) || 0,
      beveragesCold: parseFloat(row.beverages_cold) || 0,
      beveragesHot: parseFloat(row.beverages_hot) || 0,
      bakery: parseFloat(row.bakery) || 0,
      overall: parseFloat(row.overall) || 0,
    }),
  },

  holidays: {
    sheetName: "LUCA_HOLIDAYS",
    keyField: "date_key",
    transform: (row) => ({
      dateKey: row.date_key, // MM-DD format
      name: row.name,
      type: row.type || "national", // national, commercial, cultural
      salesImpact: parseFloat(row.sales_impact) || 1.0,
      isClosedDay: row.is_closed === "TRUE",
      notes: row.notes || "",
      affectedCategories: row.affected_categories ? row.affected_categories.split(",").map(s => s.trim()) : [],
    }),
  },

  seasons: {
    sheetName: "LUCA_SEASONS",
    keyField: "season_id",
    transform: (row) => ({
      seasonId: row.season_id,
      name: row.name,
      startDate: row.start_date, // MM-DD
      endDate: row.end_date,     // MM-DD
      salesImpact: parseFloat(row.sales_impact) || 1.0,
      affectedProducts: row.affected_products ? row.affected_products.split(",").map(s => s.trim()) : [],
    }),
  },

  fraudPatterns: {
    sheetName: "LUCA_FRAUD_PATTERNS",
    keyField: "pattern_id",
    transform: (row) => ({
      patternId: row.pattern_id,
      name: row.name,
      enabled: row.enabled !== "FALSE",
      minScore: parseFloat(row.min_score) || 0.6,
      weights: {
        time: parseFloat(row.weight_time) || 0,
        discount: parseFloat(row.weight_discount) || 0,
        employee: parseFloat(row.weight_employee) || 0,
        sequence: parseFloat(row.weight_sequence) || 0,
        amount: parseFloat(row.weight_amount) || 0,
        frequency: parseFloat(row.weight_frequency) || 0,
      },
    }),
  },

  roiValues: {
    sheetName: "LUCA_ROI_VALUES",
    keyField: "key",
    transform: (row) => ({
      key: row.key,
      value: parseFloat(row.value) || 0,
      unit: row.unit || "",
      description: row.description || "",
    }),
  },

  capacity: {
    sheetName: "LUCA_CAPACITY",
    keyField: "role",
    transform: (row) => ({
      role: row.role,
      drinksPerHour: parseFloat(row.drinks_per_hour) || 0,
      dishesPerHour: parseFloat(row.dishes_per_hour) || 0,
      bakeryPerHour: parseFloat(row.bakery_per_hour) || 0,
      customersPerHour: parseFloat(row.customers_per_hour) || 0,
      transactionsPerHour: parseFloat(row.transactions_per_hour) || 0,
      costPerHour: parseFloat(row.cost_per_hour) || 0,
    }),
  },

  seasonality: {
    sheetName: "LUCA_SEASONALITY",
    keyField: "period_type",
    multiKey: true,
    transform: (row) => ({
      periodType: row.period_type, // day_of_week, month, hour
      periodValue: row.period_value, // 0-6 for day, 1-12 for month, 0-23 for hour
      factor: parseFloat(row.factor) || 1.0,
      description: row.description || "",
    }),
  },

  autonomy: {
    sheetName: "LUCA_AUTONOMY",
    keyField: "level",
    transform: (row) => ({
      level: parseInt(row.level),
      name: row.name,
      description: row.description || "",
      requiresApproval: row.requires_approval === "TRUE",
      maxAmountMXN: parseFloat(row.max_amount_mxn) || 0,
      allowedActions: row.allowed_actions ? row.allowed_actions.split(",").map(s => s.trim()) : [],
    }),
  },

  cityAdjustments: {
    sheetName: "LUCA_CITY_ADJUSTMENTS",
    keyField: "city",
    transform: (row) => ({
      city: row.city,
      rainSensitivity: parseFloat(row.rain_sensitivity) || 1.0,
      heatSensitivity: parseFloat(row.heat_sensitivity) || 1.0,
      trafficFactor: parseFloat(row.traffic_factor) || 1.0,
      deliveryBaselineRatio: parseFloat(row.delivery_baseline_ratio) || 0.25,
    }),
  },

  venues: {
    sheetName: "LUCA_VENUES",
    keyField: "venue_id",
    transform: (row) => ({
      venueId: row.venue_id,
      name: row.name,
      city: row.city,
      lat: parseFloat(row.lat),
      lon: parseFloat(row.lon),
      capacity: parseInt(row.capacity) || 0,
      type: row.type || "other",
    }),
  },

  schoolCalendar: {
    sheetName: "LUCA_SCHOOL_CALENDAR",
    keyField: "period_id",
    transform: (row) => ({
      periodId: row.period_id,
      name: row.name,
      startDate: row.start_date,
      endDate: row.end_date,
      type: row.type, // vacation, school_year, enrollment
      trafficImpact: parseFloat(row.traffic_impact) || 1.0,
    }),
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONFIG LOADER CLASS
// ═══════════════════════════════════════════════════════════════════════════

class ConfigLoader {
  constructor() {
    this.cache = new Map();
    this.lastRefresh = null;
    this.refreshIntervalMs = parseInt(process.env.LUCA_CONFIG_REFRESH_MS) || 5 * 60 * 1000;
    this.initialized = false;
    this.sheets = null;
  }

  /**
   * Inicializa el loader y carga toda la configuración
   */
  async initialize() {
    if (this.initialized) return;

    try {
      // Autenticación con Google Sheets
      const auth = new google.auth.GoogleAuth({
        credentials: process.env.GOOGLE_SERVICE_ACCOUNT 
          ? JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT)
          : undefined,
        scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
      });

      this.sheets = google.sheets({ version: "v4", auth });
      
      await this.refreshAll();
      
      // Auto-refresh periódico
      setInterval(() => this.refreshAll(), this.refreshIntervalMs);
      
      this.initialized = true;
      logger.info({ refreshInterval: this.refreshIntervalMs }, "LUCA ConfigLoader initialized");
    } catch (err) {
      logger.error({ err: err?.message }, "Failed to initialize ConfigLoader");
      // Cargar defaults si falla
      this.loadDefaults();
    }
  }

  /**
   * Recarga toda la configuración desde Sheets
   */
  async refreshAll() {
    const sheetId = process.env.LUCA_CONFIG_SHEET_ID;
    
    if (!sheetId) {
      logger.warn("LUCA_CONFIG_SHEET_ID not set, using defaults");
      this.loadDefaults();
      return;
    }

    for (const [key, config] of Object.entries(SHEET_CONFIGS)) {
      try {
        await this.loadSheet(key, config, sheetId);
      } catch (err) {
        logger.warn({ sheet: key, err: err?.message }, "Failed to load sheet, using cached/defaults");
      }
    }

    this.lastRefresh = new Date();
    logger.info({ sheets: Object.keys(SHEET_CONFIGS).length }, "Config refreshed");
  }

  /**
   * Carga una hoja específica
   */
  async loadSheet(key, config, sheetId) {
    const response = await this.sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${config.sheetName}!A:Z`,
    });

    const rows = response.data.values;
    if (!rows || rows.length < 2) {
      logger.warn({ sheet: config.sheetName }, "Sheet empty or missing");
      return;
    }

    const headers = rows[0].map(h => h.toLowerCase().replace(/\s+/g, "_"));
    const data = config.multiKey ? new Map() : new Map();

    for (let i = 1; i < rows.length; i++) {
      const rowObj = {};
      headers.forEach((header, idx) => {
        rowObj[header] = rows[i][idx] || "";
      });

      const transformed = config.transform(rowObj);
      const keyValue = rowObj[config.keyField];

      if (config.multiKey) {
        if (!data.has(keyValue)) {
          data.set(keyValue, []);
        }
        data.get(keyValue).push(transformed);
      } else {
        data.set(keyValue, transformed);
      }
    }

    this.cache.set(key, data);
  }

  /**
   * Carga valores por defecto (fallback)
   */
  loadDefaults() {
    // Defaults mínimos para que el sistema funcione
    logger.warn("Loading default configuration - configure LUCA_CONFIG_SHEET_ID for production");
    
    // Se cargarán desde archivos JSON de defaults si existen
    // Por ahora, dejar cache vacío y que los getters manejen el fallback
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - BRANCHES
  // ═══════════════════════════════════════════════════════════════════════════

  getBranch(branchId) {
    return this.cache.get("branches")?.get(branchId) || null;
  }

  getAllBranches() {
    const branches = this.cache.get("branches");
    return branches ? [...branches.values()] : [];
  }

  getBranchIds() {
    const branches = this.cache.get("branches");
    return branches ? [...branches.keys()] : [];
  }

  getBranchesByCity(city) {
    return this.getAllBranches().filter(b => b.city === city);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - STAFFING
  // ═══════════════════════════════════════════════════════════════════════════

  getStaffing(branchId, shift = null) {
    const staffing = this.cache.get("staffing")?.get(branchId) || [];
    if (shift) {
      return staffing.find(s => s.shift === shift) || null;
    }
    return staffing;
  }

  getStaffingByShift(branchId, shift) {
    return this.getStaffing(branchId, shift);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - THRESHOLDS
  // ═══════════════════════════════════════════════════════════════════════════

  getThreshold(detectorId, metric) {
    const thresholds = this.cache.get("thresholds")?.get(detectorId) || [];
    return thresholds.find(t => t.metric === metric) || null;
  }

  getThresholdValue(detectorId, metric, defaultValue = 0) {
    const threshold = this.getThreshold(detectorId, metric);
    return threshold?.threshold ?? defaultValue;
  }

  getDetectorThresholds(detectorId) {
    return this.cache.get("thresholds")?.get(detectorId) || [];
  }

  getAllThresholds() {
    const thresholds = this.cache.get("thresholds");
    if (!thresholds) return [];
    const all = [];
    for (const arr of thresholds.values()) {
      all.push(...arr);
    }
    return all;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - WEATHER
  // ═══════════════════════════════════════════════════════════════════════════

  getWeatherImpact(condition) {
    return this.cache.get("weatherImpact")?.get(condition) || null;
  }

  getAllWeatherImpacts() {
    const impacts = this.cache.get("weatherImpact");
    return impacts ? [...impacts.values()] : [];
  }

  getCityAdjustment(city) {
    return this.cache.get("cityAdjustments")?.get(city) || {
      rainSensitivity: 1.0,
      heatSensitivity: 1.0,
      trafficFactor: 1.0,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - HOLIDAYS & SEASONS
  // ═══════════════════════════════════════════════════════════════════════════

  getHoliday(date) {
    const d = new Date(date);
    const key = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return this.cache.get("holidays")?.get(key) || null;
  }

  getAllHolidays() {
    const holidays = this.cache.get("holidays");
    return holidays ? [...holidays.values()] : [];
  }

  getSeason(date) {
    const d = new Date(date);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    
    const seasons = this.cache.get("seasons");
    if (!seasons) return null;

    for (const season of seasons.values()) {
      if (mmdd >= season.startDate && mmdd <= season.endDate) {
        return season;
      }
    }
    return null;
  }

  getAllSeasons() {
    const seasons = this.cache.get("seasons");
    return seasons ? [...seasons.values()] : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - FRAUD PATTERNS
  // ═══════════════════════════════════════════════════════════════════════════

  getFraudPattern(patternId) {
    return this.cache.get("fraudPatterns")?.get(patternId) || null;
  }

  getAllFraudPatterns() {
    const patterns = this.cache.get("fraudPatterns");
    return patterns ? [...patterns.values()] : [];
  }

  getEnabledFraudPatterns() {
    return this.getAllFraudPatterns().filter(p => p.enabled);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - ROI VALUES
  // ═══════════════════════════════════════════════════════════════════════════

  getRoiValue(key, defaultValue = 0) {
    const entry = this.cache.get("roiValues")?.get(key);
    return entry?.value ?? defaultValue;
  }

  getAllRoiValues() {
    const values = this.cache.get("roiValues");
    if (!values) return {};
    const obj = {};
    for (const [k, v] of values.entries()) {
      obj[k] = v.value;
    }
    return obj;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - CAPACITY
  // ═══════════════════════════════════════════════════════════════════════════

  getRoleCapacity(role) {
    return this.cache.get("capacity")?.get(role) || null;
  }

  getAllRoleCapacities() {
    const capacities = this.cache.get("capacity");
    return capacities ? [...capacities.values()] : [];
  }

  getRoleCost(role, defaultValue = 0) {
    const cap = this.getRoleCapacity(role);
    return cap?.costPerHour ?? defaultValue;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - SEASONALITY
  // ═══════════════════════════════════════════════════════════════════════════

  getSeasonalityFactor(periodType, periodValue) {
    const seasonality = this.cache.get("seasonality")?.get(periodType) || [];
    const entry = seasonality.find(s => String(s.periodValue) === String(periodValue));
    return entry?.factor ?? 1.0;
  }

  getDayOfWeekFactor(dayOfWeek) {
    return this.getSeasonalityFactor("day_of_week", dayOfWeek);
  }

  getMonthFactor(month) {
    return this.getSeasonalityFactor("month", month);
  }

  getHourFactor(hour) {
    return this.getSeasonalityFactor("hour", hour);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - AUTONOMY
  // ═══════════════════════════════════════════════════════════════════════════

  getAutonomyLevel(level) {
    return this.cache.get("autonomy")?.get(String(level)) || null;
  }

  getAllAutonomyLevels() {
    const levels = this.cache.get("autonomy");
    return levels ? [...levels.values()].sort((a, b) => a.level - b.level) : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - VENUES
  // ═══════════════════════════════════════════════════════════════════════════

  getVenue(venueId) {
    return this.cache.get("venues")?.get(venueId) || null;
  }

  getVenuesByCity(city) {
    const venues = this.cache.get("venues");
    if (!venues) return [];
    return [...venues.values()].filter(v => v.city === city);
  }

  getAllVenues() {
    const venues = this.cache.get("venues");
    return venues ? [...venues.values()] : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // GETTERS - SCHOOL CALENDAR
  // ═══════════════════════════════════════════════════════════════════════════

  getSchoolPeriod(date) {
    const d = new Date(date);
    const dateStr = d.toISOString().split("T")[0];
    
    const periods = this.cache.get("schoolCalendar");
    if (!periods) return null;

    for (const period of periods.values()) {
      if (dateStr >= period.startDate && dateStr <= period.endDate) {
        return period;
      }
    }
    return null;
  }

  isSchoolDay(date) {
    const period = this.getSchoolPeriod(date);
    return period?.type === "school_year";
  }

  getAllSchoolPeriods() {
    const periods = this.cache.get("schoolCalendar");
    return periods ? [...periods.values()] : [];
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  getStatus() {
    return {
      initialized: this.initialized,
      lastRefresh: this.lastRefresh,
      refreshIntervalMs: this.refreshIntervalMs,
      cachedSheets: [...this.cache.keys()],
      counts: {
        branches: this.cache.get("branches")?.size || 0,
        thresholds: this.getAllThresholds().length,
        holidays: this.cache.get("holidays")?.size || 0,
        fraudPatterns: this.cache.get("fraudPatterns")?.size || 0,
      },
    };
  }

  async forceRefresh() {
    await this.refreshAll();
    return this.getStatus();
  }
}

// Singleton
export const configLoader = new ConfigLoader();

export default ConfigLoader;
