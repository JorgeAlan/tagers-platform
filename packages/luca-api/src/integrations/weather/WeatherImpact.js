/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WEATHER IMPACT - Modelo de Impacto del Clima
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * ZERO HARDCODE - Impactos desde ConfigLoader (Google Sheets)
 * 
 * Calcula el impacto del clima en las ventas:
 * - Por tipo de servicio (dine-in, delivery, takeaway)
 * - Por categoría de producto
 * - Con ajustes por ciudad
 */

import { logger } from "@tagers/shared";
import { configLoader } from "../../config/ConfigLoader.js";
import { weatherService } from "./WeatherService.js";

export class WeatherImpact {
  /**
   * Obtiene impacto de una condición climática desde config
   */
  getConditionImpact(condition) {
    const impact = configLoader.getWeatherImpact(condition);
    
    if (!impact) {
      // Fallback para condiciones no configuradas
      return {
        condition,
        dineIn: 0,
        delivery: 0,
        takeaway: 0,
        beveragesCold: 0,
        beveragesHot: 0,
        bakery: 0,
        overall: 0,
      };
    }
    
    return impact;
  }

  /**
   * Obtiene ajustes de ciudad desde config
   */
  getCityAdjustment(city) {
    return configLoader.getCityAdjustment(city);
  }

  /**
   * Calcula impacto basado en condición y temperatura
   */
  calculateImpact(condition, temperature, city = null) {
    const baseImpact = this.getConditionImpact(condition);
    const cityAdj = city ? this.getCityAdjustment(city) : { rainSensitivity: 1.0, heatSensitivity: 1.0 };

    // Ajustar por temperatura
    let tempImpact = this.getConditionImpact("clear"); // Default
    
    if (temperature >= 30) {
      tempImpact = this.getConditionImpact("extreme_heat");
    } else if (temperature <= 15) {
      tempImpact = this.getConditionImpact("cold");
    } else if (temperature >= 18 && temperature <= 24 && condition === "clear") {
      tempImpact = this.getConditionImpact("perfect");
    }

    // Combinar impactos
    const isRainy = ["light_rain", "rain", "heavy_rain", "drizzle", "thunderstorm"].includes(condition);
    const rainFactor = isRainy ? cityAdj.rainSensitivity : 1.0;
    const heatFactor = temperature >= 30 ? cityAdj.heatSensitivity : 1.0;

    const combined = {
      condition,
      temperature,
      city,
      byService: {
        dine_in: (baseImpact.dineIn || 0) * rainFactor + (tempImpact.dineIn || 0) * heatFactor,
        delivery: (baseImpact.delivery || 0) * rainFactor + (tempImpact.delivery || 0),
        takeaway: (baseImpact.takeaway || 0) * rainFactor + (tempImpact.takeaway || 0),
      },
      byCategory: {
        beverages_cold: tempImpact.beveragesCold || 0,
        beverages_hot: tempImpact.beveragesHot || 0,
        bakery: baseImpact.bakery || tempImpact.bakery || 0,
      },
      overall: this.calculateOverallImpact(baseImpact, tempImpact, rainFactor),
      recommendations: this.generateRecommendations(condition, temperature),
    };

    return combined;
  }

  /**
   * Calcula impacto desde datos de clima
   */
  calculateImpactFromWeather(weatherData) {
    return this.calculateImpact(
      weatherData.condition,
      weatherData.temperature,
      weatherData.city
    );
  }

  /**
   * Calcula impacto general ponderado
   */
  calculateOverallImpact(baseImpact, tempImpact, rainFactor) {
    // Ponderación por tipo de servicio (desde config o defaults)
    const weights = {
      dineIn: 0.5,
      delivery: 0.3,
      takeaway: 0.2,
    };

    const overall = 
      weights.dineIn * ((baseImpact.dineIn || 0) * rainFactor + (tempImpact.dineIn || 0)) +
      weights.delivery * ((baseImpact.delivery || 0) * rainFactor + (tempImpact.delivery || 0)) +
      weights.takeaway * ((baseImpact.takeaway || 0) * rainFactor + (tempImpact.takeaway || 0));

    return Math.round(overall * 100) / 100;
  }

  /**
   * Genera recomendaciones basadas en clima
   */
  generateRecommendations(condition, temperature) {
    const recommendations = [];

    // Recomendaciones por lluvia
    if (["rain", "heavy_rain", "thunderstorm"].includes(condition)) {
      recommendations.push({
        priority: "HIGH",
        action: "Reforzar delivery",
        description: "Esperar aumento en pedidos a domicilio",
      });
      recommendations.push({
        priority: "MEDIUM",
        action: "Promoción Día Lluvioso",
        description: "Activar promoción especial para delivery",
      });
    }

    // Recomendaciones por calor
    if (temperature >= 30) {
      recommendations.push({
        priority: "HIGH",
        action: "Push bebidas frías",
        description: "Destacar frappés, smoothies, bebidas frías",
      });
      recommendations.push({
        priority: "MEDIUM",
        action: "Verificar AC",
        description: "Asegurar confort en sucursal",
      });
    }

    // Recomendaciones por frío
    if (temperature <= 15) {
      recommendations.push({
        priority: "HIGH",
        action: "Destacar bebidas calientes",
        description: "Promover café caliente, chocolate, pan dulce",
      });
    }

    // Clima perfecto
    if (temperature >= 18 && temperature <= 24 && condition === "clear") {
      recommendations.push({
        priority: "LOW",
        action: "Aprovechar terraza",
        description: "Clima ideal para área exterior",
      });
    }

    return recommendations;
  }

  /**
   * Predice ajuste de ventas para una sucursal
   */
  async predictAdjustedSales(branchId, baseSales) {
    const weather = await weatherService.getCurrentWeather(branchId);
    const impact = this.calculateImpactFromWeather(weather);

    return {
      branchId,
      baseSales,
      weather: {
        condition: weather.condition,
        temperature: weather.temperature,
      },
      impact,
      adjustedSales: Math.round(baseSales * (1 + impact.overall)),
      adjustedByService: {
        dine_in: Math.round(baseSales * 0.5 * (1 + impact.byService.dine_in)),
        delivery: Math.round(baseSales * 0.3 * (1 + impact.byService.delivery)),
        takeaway: Math.round(baseSales * 0.2 * (1 + impact.byService.takeaway)),
      },
    };
  }

  /**
   * Obtiene resumen de impacto para briefing
   */
  async getImpactSummary() {
    const branchIds = configLoader.getBranchIds();
    const impacts = [];

    for (const branchId of branchIds) {
      try {
        const weather = await weatherService.getCurrentWeather(branchId);
        const impact = this.calculateImpactFromWeather(weather);
        
        impacts.push({
          branchId,
          branchName: weather.branchName,
          weather: weather.condition,
          temperature: weather.temperature,
          overallImpact: impact.overall,
          impactFormatted: `${impact.overall >= 0 ? "+" : ""}${Math.round(impact.overall * 100)}%`,
        });
      } catch (err) {
        logger.warn({ branchId, err: err?.message }, "Failed to get impact");
      }
    }

    return {
      timestamp: new Date().toISOString(),
      branches: impacts,
      summary: {
        positive: impacts.filter(i => i.overallImpact > 0.05).length,
        neutral: impacts.filter(i => Math.abs(i.overallImpact) <= 0.05).length,
        negative: impacts.filter(i => i.overallImpact < -0.05).length,
      },
    };
  }
}

export const weatherImpact = new WeatherImpact();

export default WeatherImpact;
