/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEATHER SERVICE - Servicio de Clima
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Ubicaciones desde ConfigLoader (Google Sheets)
 * 
 * Integración con OpenWeather API para obtener:
 * - Clima actual por sucursal
 * - Pronóstico de 5 días
 * - Alertas meteorológicas
 */

import { logger } from "@tagers/shared";
import { configLoader } from "../../config/ConfigLoader.js";

// Mapeo de códigos OpenWeather a condiciones simplificadas
const CONDITION_MAP = {
  800: "clear",
  801: "partly_cloudy",
  802: "partly_cloudy",
  803: "cloudy",
  804: "cloudy",
  500: "light_rain",
  501: "rain",
  502: "heavy_rain",
  503: "heavy_rain",
  504: "heavy_rain",
  300: "drizzle",
  301: "drizzle",
  302: "drizzle",
  200: "thunderstorm",
  201: "thunderstorm",
  202: "thunderstorm",
  600: "snow",
  601: "snow",
  602: "snow",
  701: "mist",
  711: "mist",
  721: "mist",
  741: "fog",
};

const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutos

export class WeatherService {
  constructor() {
    this.apiKey = process.env.OPENWEATHER_API_KEY;
    this.baseUrl = "https://api.openweathermap.org/data/2.5";
    this.cache = new Map();
  }

  /**
   * Obtiene ubicación de una sucursal desde config
   */
  getBranchLocation(branchId) {
    const branch = configLoader.getBranch(branchId);
    if (!branch) return null;
    
    return {
      name: branch.name,
      lat: branch.lat,
      lon: branch.lon,
      city: branch.city,
    };
  }

  /**
   * Obtiene todas las ubicaciones de sucursales
   */
  getAllBranchLocations() {
    const branches = configLoader.getAllBranches();
    const locations = {};
    
    for (const branch of branches) {
      locations[branch.id] = {
        name: branch.name,
        lat: branch.lat,
        lon: branch.lon,
        city: branch.city,
      };
    }
    
    return locations;
  }

  /**
   * Obtiene clima actual para una sucursal
   */
  async getCurrentWeather(branchId) {
    const location = this.getBranchLocation(branchId);
    if (!location) {
      throw new Error(`Branch ${branchId} not found in configuration`);
    }

    const cacheKey = `current_${branchId}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    if (!this.apiKey) {
      return this.getMockWeather(branchId, location);
    }

    try {
      const url = `${this.baseUrl}/weather?lat=${location.lat}&lon=${location.lon}&appid=${this.apiKey}&units=metric&lang=es`;
      const response = await fetch(url);
      const data = await response.json();

      const weather = this.parseCurrentWeather(data, branchId, location);
      this.setCache(cacheKey, weather);
      return weather;
    } catch (err) {
      logger.warn({ branchId, err: err?.message }, "Failed to fetch weather");
      return this.getMockWeather(branchId, location);
    }
  }

  /**
   * Parsea respuesta de clima actual
   */
  parseCurrentWeather(data, branchId, location) {
    const conditionId = data.weather?.[0]?.id || 800;
    const condition = this.mapCondition(conditionId);

    return {
      branchId,
      branchName: location.name,
      city: location.city,
      timestamp: new Date().toISOString(),
      condition,
      conditionId,
      description: data.weather?.[0]?.description || "desconocido",
      icon: data.weather?.[0]?.icon,
      temperature: Math.round(data.main?.temp || 20),
      feelsLike: Math.round(data.main?.feels_like || 20),
      humidity: data.main?.humidity || 50,
      windSpeed: data.wind?.speed ? Math.round(data.wind.speed * 3.6) : 0,
      visibility: data.visibility ? Math.round(data.visibility / 1000) : 10,
      clouds: data.clouds?.all || 0,
      flags: {
        isRainy: this.isRainy(conditionId),
        isHot: (data.main?.temp || 20) >= 30,
        isCold: (data.main?.temp || 20) <= 15,
        isSevere: this.isSevere(conditionId),
      },
    };
  }

  /**
   * Obtiene pronóstico para una sucursal
   */
  async getForecast(branchId, days = 5) {
    const location = this.getBranchLocation(branchId);
    if (!location) {
      throw new Error(`Branch ${branchId} not found in configuration`);
    }

    const cacheKey = `forecast_${branchId}_${days}`;
    const cached = this.getFromCache(cacheKey);
    if (cached) return cached;

    if (!this.apiKey) {
      return this.getMockForecast(branchId, location, days);
    }

    try {
      const url = `${this.baseUrl}/forecast?lat=${location.lat}&lon=${location.lon}&appid=${this.apiKey}&units=metric&lang=es&cnt=${days * 8}`;
      const response = await fetch(url);
      const data = await response.json();

      const forecast = this.parseForecast(data, branchId, location, days);
      this.setCache(cacheKey, forecast);
      return forecast;
    } catch (err) {
      logger.warn({ branchId, err: err?.message }, "Failed to fetch forecast");
      return this.getMockForecast(branchId, location, days);
    }
  }

  /**
   * Parsea respuesta de pronóstico
   */
  parseForecast(data, branchId, location, days) {
    const dailyForecasts = [];
    const list = data.list || [];

    // Agrupar por día
    const byDay = {};
    for (const item of list) {
      const date = item.dt_txt.split(" ")[0];
      if (!byDay[date]) {
        byDay[date] = [];
      }
      byDay[date].push(item);
    }

    // Procesar cada día
    for (const [date, items] of Object.entries(byDay).slice(0, days)) {
      const temps = items.map(i => i.main.temp);
      const conditions = items.map(i => i.weather[0].id);
      const rain = items.reduce((sum, i) => sum + (i.rain?.["3h"] || 0), 0);

      dailyForecasts.push({
        date,
        tempMin: Math.round(Math.min(...temps)),
        tempMax: Math.round(Math.max(...temps)),
        tempAvg: Math.round(temps.reduce((a, b) => a + b, 0) / temps.length),
        condition: this.mapCondition(this.getMostFrequent(conditions)),
        description: items[Math.floor(items.length / 2)].weather[0].description,
        rainProbability: rain > 0 ? Math.min(100, Math.round(rain * 10)) : 0,
        rainAmount: Math.round(rain * 10) / 10,
      });
    }

    return {
      branchId,
      branchName: location.name,
      city: location.city,
      generated: new Date().toISOString(),
      days: dailyForecasts,
    };
  }

  /**
   * Obtiene clima de todas las sucursales
   */
  async getAllBranchesWeather() {
    const branchIds = configLoader.getBranchIds();
    const results = {};

    for (const branchId of branchIds) {
      try {
        results[branchId] = await this.getCurrentWeather(branchId);
      } catch (err) {
        logger.warn({ branchId, err: err?.message }, "Failed to get weather");
      }
    }

    return results;
  }

  /**
   * Obtiene resumen de clima
   */
  async getWeatherSummary() {
    const allWeather = await this.getAllBranchesWeather();
    const branches = Object.values(allWeather);

    return {
      timestamp: new Date().toISOString(),
      branches: branches.length,
      summary: {
        avgTemperature: Math.round(branches.reduce((sum, b) => sum + b.temperature, 0) / branches.length),
        rainyBranches: branches.filter(b => b.flags.isRainy).map(b => b.branchName),
        hotBranches: branches.filter(b => b.flags.isHot).map(b => b.branchName),
        coldBranches: branches.filter(b => b.flags.isCold).map(b => b.branchName),
      },
      byBranch: allWeather,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  mapCondition(conditionId) {
    if (CONDITION_MAP[conditionId]) {
      return CONDITION_MAP[conditionId];
    }
    const group = Math.floor(conditionId / 100) * 100;
    return CONDITION_MAP[group] || "unknown";
  }

  isRainy(conditionId) {
    return conditionId >= 200 && conditionId < 700;
  }

  isSevere(conditionId) {
    return [200, 201, 202, 211, 212, 504, 781].includes(conditionId);
  }

  getMostFrequent(arr) {
    const counts = {};
    for (const val of arr) {
      counts[val] = (counts[val] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
  }

  getFromCache(key) {
    const item = this.cache.get(key);
    if (item && Date.now() - item.timestamp < CACHE_TTL_MS) {
      return item.data;
    }
    return null;
  }

  setCache(key, data) {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOCK DATA (cuando no hay API key)
  // ═══════════════════════════════════════════════════════════════════════════

  getMockWeather(branchId, location) {
    return {
      branchId,
      branchName: location.name,
      city: location.city,
      timestamp: new Date().toISOString(),
      condition: "clear",
      conditionId: 800,
      description: "cielo claro",
      icon: "01d",
      temperature: 22,
      feelsLike: 23,
      humidity: 45,
      windSpeed: 12,
      visibility: 10,
      clouds: 10,
      flags: {
        isRainy: false,
        isHot: false,
        isCold: false,
        isSevere: false,
      },
      _mock: true,
    };
  }

  getMockForecast(branchId, location, days) {
    const forecasts = [];
    const d = new Date();

    for (let i = 0; i < days; i++) {
      d.setDate(d.getDate() + (i === 0 ? 0 : 1));
      forecasts.push({
        date: d.toISOString().split("T")[0],
        tempMin: 15,
        tempMax: 25,
        tempAvg: 20,
        condition: "clear",
        description: "cielo claro",
        rainProbability: 10,
        rainAmount: 0,
      });
    }

    return {
      branchId,
      branchName: location.name,
      city: location.city,
      generated: new Date().toISOString(),
      days: forecasts,
      _mock: true,
    };
  }
}

export const weatherService = new WeatherService();

export default WeatherService;
