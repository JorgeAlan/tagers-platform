/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SHOWMAN AGENT - CX & Customer Retention
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * El Showman recupera clientes y previene churn:
 * 
 * 1. identifyAtRisk()      → Encuentra clientes en riesgo
 * 2. analyzeChurnSignals() → Analiza por qué se van
 * 3. generateWinback()     → Crea mensaje personalizado
 * 4. executeCampaign()     → Envía via ActionBus
 * 5. trackCampaign()       → Mide efectividad
 * 6. celebrateSuccess()    → Reporta wins en briefing
 * 
 * Integra: KISS (Chatwoot) + Encuestas + Reviews + Historial de compras
 */

import { logger, query } from "@tagers/shared";
import {
  calculateHealthScore,
  getRecommendedAction,
  calculateWinbackPotential,
  detectChurnSignals,
  segmentCustomers,
  HealthCategories,
} from "./CustomerHealthScore.js";
import { actionBus } from "../actions/ActionBus.js";
import { memoryService, MemoryTypes } from "../memory/MemoryService.js";
import { caseService } from "../services/caseService.js";

/**
 * Configuración del Showman
 */
const SHOWMAN_CONFIG = {
  // Límites de procesamiento
  maxCustomersPerRun: 100,
  minDaysBetweenContacts: 7,
  
  // Umbrales de acción
  healthScoreThreshold: 0.5,     // Actuar si score < 0.5
  churnSignalsThreshold: 2,      // Actuar si >= 2 señales
  
  // Configuración de campañas
  campaignTypes: {
    WINBACK_LIGHT: {
      channel: "whatsapp",
      autonomyLevel: "DRAFT",
      includeOffer: true,
      offerValue: 10, // % descuento
    },
    WINBACK_AGGRESSIVE: {
      channel: "whatsapp",
      autonomyLevel: "APPROVAL",
      includeOffer: true,
      offerValue: 20,
    },
    REACTIVATION: {
      channel: "whatsapp",
      autonomyLevel: "APPROVAL",
      includeOffer: true,
      offerValue: 30,
    },
  },
};

/**
 * Templates de mensajes por tipo de campaña
 */
const MESSAGE_TEMPLATES = {
  WINBACK_LIGHT: {
    template: `¡Hola {name}! 👋

Te extrañamos en Tagers. Han pasado {days} días desde tu última visita.

{personalized_hook}

Como agradecimiento por ser parte de nuestra familia, te regalamos un *{offer_value}% de descuento* en tu próxima visita.

¡Te esperamos! 🥐☕

_Código: {code}_`,
    hooks: {
      favorite_product: "¿Se te antoja un {product}?",
      frequent_branch: "Tu sucursal {branch} te espera con novedades.",
      seasonal: "Tenemos nuevos productos de temporada que te van a encantar.",
      default: "Tenemos algo especial preparado para ti.",
    },
  },
  
  WINBACK_AGGRESSIVE: {
    template: `¡{name}, te echamos de menos! 💙

Ha pasado un tiempo desde que nos visitaste y queremos que sepas que eres importante para nosotros.

{personalized_hook}

Para que regreses, te ofrecemos un *{offer_value}% de descuento* en todo tu pedido.

¿Qué dices? ¡Vuelve pronto! 🎁

_Código: {code} - Válido {validity}_`,
    hooks: {
      complaint: "Sabemos que tu última experiencia no fue perfecta. Queremos compensarte.",
      lapsed_vip: "Como cliente frecuente que eras, mereces un trato especial.",
      default: "Queremos reconquistarte con lo mejor de Tagers.",
    },
  },
  
  REACTIVATION: {
    template: `{name}, ¡hace mucho que no te vemos! 😢

Han pasado {days} días y realmente te extrañamos.

{personalized_hook}

Tenemos una oferta especial SOLO para ti:
🎁 *{offer_value}% de descuento* en cualquier compra

Este código es exclusivo y expira pronto. ¿Nos das otra oportunidad?

_Código: {code} - Válido hasta {expiry}_`,
    hooks: {
      default: "Mucho ha cambiado en Tagers y queremos que lo descubras.",
    },
  },
  
  NURTURE: {
    template: `¡Hola {name}! 🌟

Gracias por ser parte de la familia Tagers. Tu lealtad significa mucho para nosotros.

{personalized_hook}

Como cliente especial, te compartimos una sorpresa:
✨ *{offer_value}% de descuento* en tu próxima visita

¡Gracias por preferirnos!

_Código: {code}_`,
    hooks: {
      birthday: "¡Feliz cumpleaños! 🎂",
      milestone: "¡Celebramos {milestone} visitas contigo!",
      default: "Disfruta este regalo de nuestra parte.",
    },
  },
};

export class ShowmanAgent {
  constructor() {
    this.activeCampaigns = new Map(); // campaignId -> campaign
  }

  /**
   * Ejecuta el flujo completo del Showman
   */
  async run(context = {}) {
    const runId = `showman_${Date.now()}`;
    logger.info({ runId, context }, "ShowmanAgent starting");

    const results = {
      runId,
      startedAt: new Date().toISOString(),
      phases: {},
      customersAnalyzed: 0,
      atRiskIdentified: 0,
      campaignsCreated: [],
      wins: [],
    };

    try {
      // Fase 1: Obtener clientes para análisis
      const customers = await this.getCustomersForAnalysis(context);
      results.customersAnalyzed = customers.length;

      if (customers.length === 0) {
        results.status = "no_customers";
        results.completedAt = new Date().toISOString();
        return results;
      }

      // Fase 2: Identificar clientes en riesgo
      results.phases.identify = await this.identifyAtRisk(customers);
      results.atRiskIdentified = results.phases.identify.atRisk.length;

      // Fase 3: Analizar señales de churn
      results.phases.analyze = await this.analyzeChurnSignals(
        results.phases.identify.atRisk
      );

      // Fase 4: Generar y ejecutar campañas
      for (const customer of results.phases.analyze.customersToContact) {
        // Verificar cooldown
        if (await this.isInCooldown(customer.customerId)) {
          continue;
        }

        // Generar mensaje personalizado
        const campaign = await this.generateWinback(customer);

        // Ejecutar via ActionBus
        const actionResult = await this.executeCampaign(campaign);

        results.campaignsCreated.push({
          customerId: customer.customerId,
          customerName: customer.name,
          campaignType: campaign.type,
          actionId: actionResult.actionId,
          actionState: actionResult.state,
        });
      }

      // Fase 5: Verificar wins recientes (clientes recuperados)
      results.wins = await this.checkForWins();

      // Fase 6: Actualizar métricas
      await this.updateMetrics(results);

      results.status = "completed";
      results.completedAt = new Date().toISOString();

      logger.info({
        runId,
        analyzed: results.customersAnalyzed,
        atRisk: results.atRiskIdentified,
        campaigns: results.campaignsCreated.length,
        wins: results.wins.length,
      }, "ShowmanAgent completed");

      return results;

    } catch (err) {
      logger.error({ runId, err: err?.message }, "ShowmanAgent failed");
      results.status = "error";
      results.error = err?.message;
      return results;
    }
  }

  /**
   * Fase 1: Obtiene clientes para análisis
   */
  async getCustomersForAnalysis(context) {
    // En producción, esto vendría de Redshift
    // Por ahora, usar mock data
    return this.getMockCustomers(context);
  }

  /**
   * Fase 2: Identifica clientes en riesgo
   */
  async identifyAtRisk(customers) {
    logger.info("Phase 2: IDENTIFY AT RISK");

    const segments = {
      healthy: [],
      atRisk: [],
      churning: [],
      churned: [],
    };

    for (const customer of customers) {
      const health = calculateHealthScore(customer);
      
      const enrichedCustomer = {
        ...customer,
        healthScore: health,
        recommendedAction: getRecommendedAction(health),
      };

      // Categorizar
      switch (health.category) {
        case "HEALTHY":
          segments.healthy.push(enrichedCustomer);
          break;
        case "AT_RISK":
          segments.atRisk.push(enrichedCustomer);
          break;
        case "CHURNING":
          segments.churning.push(enrichedCustomer);
          break;
        case "CHURNED":
          segments.churned.push(enrichedCustomer);
          break;
      }
    }

    return {
      ...segments,
      summary: {
        total: customers.length,
        healthy: segments.healthy.length,
        atRisk: segments.atRisk.length,
        churning: segments.churning.length,
        churned: segments.churned.length,
        actionable: segments.atRisk.length + segments.churning.length,
      },
    };
  }

  /**
   * Fase 3: Analiza señales de churn
   */
  async analyzeChurnSignals(atRiskCustomers) {
    logger.info("Phase 3: ANALYZE CHURN SIGNALS");

    const analyzed = [];
    const customersToContact = [];

    for (const customer of atRiskCustomers) {
      // Obtener datos históricos
      const historicalData = await this.getCustomerHistory(customer.customerId);

      // Detectar señales
      const signals = detectChurnSignals(customer, historicalData);

      // Calcular potencial de recuperación
      const winbackPotential = calculateWinbackPotential(
        customer.healthScore,
        historicalData
      );

      const analysis = {
        ...customer,
        churnSignals: signals,
        signalCount: signals.length,
        winbackPotential: Math.round(winbackPotential * 100),
        historicalData,
      };

      analyzed.push(analysis);

      // Determinar si contactar
      if (
        signals.length >= SHOWMAN_CONFIG.churnSignalsThreshold ||
        customer.healthScore.score < SHOWMAN_CONFIG.healthScoreThreshold
      ) {
        customersToContact.push(analysis);
      }
    }

    // Ordenar por potencial de win-back (más alto primero)
    customersToContact.sort((a, b) => b.winbackPotential - a.winbackPotential);

    // Limitar cantidad
    const limited = customersToContact.slice(0, SHOWMAN_CONFIG.maxCustomersPerRun);

    return {
      analyzed,
      customersToContact: limited,
      summary: {
        totalAnalyzed: analyzed.length,
        toContact: limited.length,
        avgWinbackPotential: limited.length > 0
          ? Math.round(limited.reduce((sum, c) => sum + c.winbackPotential, 0) / limited.length)
          : 0,
      },
    };
  }

  /**
   * Fase 4: Genera mensaje de win-back personalizado
   */
  async generateWinback(customer) {
    logger.info({ customerId: customer.customerId }, "Phase 4: GENERATE WINBACK");

    const campaignType = customer.recommendedAction.type;
    const template = MESSAGE_TEMPLATES[campaignType] || MESSAGE_TEMPLATES.WINBACK_LIGHT;
    const config = SHOWMAN_CONFIG.campaignTypes[campaignType] || SHOWMAN_CONFIG.campaignTypes.WINBACK_LIGHT;

    // Seleccionar hook personalizado
    let hook = template.hooks.default;
    if (customer.favoriteProduct && template.hooks.favorite_product) {
      hook = template.hooks.favorite_product.replace("{product}", customer.favoriteProduct);
    } else if (customer.frequentBranch && template.hooks.frequent_branch) {
      hook = template.hooks.frequent_branch.replace("{branch}", customer.frequentBranch);
    } else if (customer.hadComplaint && template.hooks.complaint) {
      hook = template.hooks.complaint;
    }

    // Generar código único
    const code = this.generateOfferCode(customer.customerId, campaignType);

    // Construir mensaje
    const message = template.template
      .replace("{name}", customer.name || "Cliente")
      .replace("{days}", customer.daysSinceLastVisit?.toString() || "varios")
      .replace("{personalized_hook}", hook)
      .replace("{offer_value}", config.offerValue.toString())
      .replace("{code}", code)
      .replace("{validity}", "7 días")
      .replace("{expiry}", this.getExpiryDate(7))
      .replace("{product}", customer.favoriteProduct || "")
      .replace("{branch}", customer.frequentBranch || "");

    const campaign = {
      campaignId: `CAMP-${Date.now()}-${customer.customerId}`,
      customerId: customer.customerId,
      customerName: customer.name,
      customerPhone: customer.phone,
      type: campaignType,
      channel: config.channel,
      autonomyLevel: config.autonomyLevel,
      message,
      offerCode: code,
      offerValue: config.offerValue,
      healthScore: customer.healthScore.score,
      winbackPotential: customer.winbackPotential,
      churnSignals: customer.churnSignals,
      createdAt: new Date().toISOString(),
      expiresAt: this.getExpiryDate(7),
    };

    // Guardar campaña
    this.activeCampaigns.set(campaign.campaignId, campaign);

    return campaign;
  }

  /**
   * Fase 5: Ejecuta campaña via ActionBus
   */
  async executeCampaign(campaign) {
    logger.info({ campaignId: campaign.campaignId }, "Phase 5: EXECUTE CAMPAIGN");

    const result = await actionBus.propose({
      type: "NOTIFY_SOCIO", // Usar DRAFT level
      payload: {
        user_id: campaign.customerId,
        phone: campaign.customerPhone,
        message: campaign.message,
        campaign_id: campaign.campaignId,
        offer_code: campaign.offerCode,
      },
      context: {
        campaign_id: campaign.campaignId,
        campaign_type: campaign.type,
        health_score: campaign.healthScore,
        winback_potential: campaign.winbackPotential,
      },
      reason: `Win-back: ${campaign.customerName} (Health: ${Math.round(campaign.healthScore * 100)}%, Potential: ${campaign.winbackPotential}%)`,
      requestedBy: "showman_agent",
    });

    // Actualizar estado de campaña
    campaign.actionId = result.actionId;
    campaign.actionState = result.state;

    return result;
  }

  /**
   * Fase 6: Verifica wins (clientes recuperados)
   */
  async checkForWins() {
    logger.info("Phase 6: CHECK FOR WINS");

    const wins = [];

    // Verificar campañas activas
    for (const [campaignId, campaign] of this.activeCampaigns) {
      // Verificar si el cliente volvió
      const returned = await this.checkCustomerReturned(campaign.customerId, campaign.createdAt);

      if (returned) {
        wins.push({
          campaignId,
          customerId: campaign.customerId,
          customerName: campaign.customerName,
          campaignType: campaign.type,
          daysToReturn: returned.daysToReturn,
          orderValue: returned.orderValue,
          usedOffer: returned.usedOffer,
          recoveredAt: returned.returnDate,
        });

        // Marcar campaña como exitosa
        campaign.status = "WON";
        campaign.wonAt = returned.returnDate;

        // Guardar en memoria para aprendizaje
        await this.learnFromWin(campaign, returned);
      }
    }

    return wins;
  }

  /**
   * Aprende de un win exitoso
   */
  async learnFromWin(campaign, returned) {
    try {
      await memoryService.store({
        type: MemoryTypes.INSIGHT,
        content: JSON.stringify({
          insight_type: "WINBACK_SUCCESS",
          campaign_type: campaign.type,
          health_score_at_contact: campaign.healthScore,
          winback_potential: campaign.winbackPotential,
          churn_signals: campaign.churnSignals,
          days_to_return: returned.daysToReturn,
          used_offer: returned.usedOffer,
          order_value: returned.orderValue,
        }),
        metadata: {
          campaign_id: campaign.campaignId,
          customer_id: campaign.customerId,
          success: true,
        },
      });
    } catch (err) {
      logger.warn({ err: err?.message }, "Failed to store win in memory");
    }
  }

  /**
   * Actualiza métricas del Showman
   */
  async updateMetrics(results) {
    // TODO: Persistir métricas para dashboard
    logger.info({
      campaigns: results.campaignsCreated.length,
      wins: results.wins.length,
    }, "Showman metrics updated");
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // HELPERS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Verifica si cliente está en cooldown
   */
  async isInCooldown(customerId) {
    // TODO: Verificar última campaña enviada
    return false;
  }

  /**
   * Obtiene historial de un cliente
   */
  async getCustomerHistory(customerId) {
    // TODO: Obtener de Redshift
    return {
      avgVisitsPerMonth: 3,
      avgTicket: 150,
      monthsAsCustomer: 8,
      wasVIP: Math.random() > 0.7,
      respondedToWinback: Math.random() > 0.5,
      hadBadExperience: Math.random() > 0.8,
    };
  }

  /**
   * Verifica si cliente volvió después de campaña
   */
  async checkCustomerReturned(customerId, campaignDate) {
    // TODO: Verificar en datos de ventas
    // Mock: 30% de probabilidad de retorno
    if (Math.random() < 0.3) {
      return {
        returnDate: new Date().toISOString(),
        daysToReturn: Math.floor(Math.random() * 7) + 1,
        orderValue: Math.floor(Math.random() * 200) + 50,
        usedOffer: Math.random() > 0.3,
      };
    }
    return null;
  }

  /**
   * Genera código de oferta único
   */
  generateOfferCode(customerId, campaignType) {
    const prefix = campaignType.substring(0, 3).toUpperCase();
    const suffix = customerId.substring(0, 4).toUpperCase();
    const random = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `${prefix}${suffix}${random}`;
  }

  /**
   * Obtiene fecha de expiración
   */
  getExpiryDate(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toLocaleDateString("es-MX", { day: "numeric", month: "long" });
  }

  /**
   * Obtiene resumen de CX para briefing
   */
  async getCXSummary() {
    const recentWins = Array.from(this.activeCampaigns.values())
      .filter(c => c.status === "WON")
      .slice(-5);

    const activeCampaigns = Array.from(this.activeCampaigns.values())
      .filter(c => !c.status || c.status === "SENT")
      .length;

    return {
      activeCampaigns,
      recentWins: recentWins.length,
      winDetails: recentWins.map(w => ({
        name: w.customerName,
        type: w.type,
        wonAt: w.wonAt,
      })),
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MOCK DATA
  // ═══════════════════════════════════════════════════════════════════════════

  getMockCustomers(context) {
    return [
      {
        customerId: "CUST001",
        name: "María García",
        phone: "5255123456701",
        email: "maria@email.com",
        daysSinceLastVisit: 45,
        visitsLast30Days: 0,
        avgTicketRatio: 1.2,
        avgSentiment: 3.5,
        interactionsLast30Days: 1,
        favoriteProduct: "Café Americano",
        frequentBranch: "San Ángel",
      },
      {
        customerId: "CUST002",
        name: "Carlos López",
        phone: "5255123456702",
        email: "carlos@email.com",
        daysSinceLastVisit: 25,
        visitsLast30Days: 1,
        avgTicketRatio: 0.9,
        avgSentiment: 4.0,
        interactionsLast30Days: 0,
        favoriteProduct: "Rosca de Reyes",
        frequentBranch: "Coyoacán",
      },
      {
        customerId: "CUST003",
        name: "Ana Martínez",
        phone: "5255123456703",
        email: "ana@email.com",
        daysSinceLastVisit: 65,
        visitsLast30Days: 0,
        avgTicketRatio: 1.8,
        avgSentiment: 2.5,
        interactionsLast30Days: 2,
        favoriteProduct: "Pastel de chocolate",
        frequentBranch: "Polanco",
        hadComplaint: true,
        unresolvedComplaints: 1,
      },
      {
        customerId: "CUST004",
        name: "Roberto Sánchez",
        phone: "5255123456704",
        email: "roberto@email.com",
        daysSinceLastVisit: 10,
        visitsLast30Days: 3,
        avgTicketRatio: 1.5,
        avgSentiment: 4.5,
        interactionsLast30Days: 1,
        favoriteProduct: "Croissant",
        frequentBranch: "Condesa",
      },
      {
        customerId: "CUST005",
        name: "Laura Torres",
        phone: "5255123456705",
        email: "laura@email.com",
        daysSinceLastVisit: 90,
        visitsLast30Days: 0,
        avgTicketRatio: 0.6,
        avgSentiment: 3.0,
        interactionsLast30Days: 0,
        frequentBranch: "Roma",
      },
    ];
  }
}

export const showmanAgent = new ShowmanAgent();

export default ShowmanAgent;
