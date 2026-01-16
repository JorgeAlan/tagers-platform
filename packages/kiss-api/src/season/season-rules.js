/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SEASON RULES ENGINE v2.0 - Motor de Reglas de Temporada
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Replica la lógica del Cerebro Maestro de WordPress pero leyendo desde
 * Google Sheets (Config Hub). NO HAY REGLAS HARDCODED.
 * 
 * SINCRONIZADO CON: tagers_validar_fecha_master() de WordPress
 * 
 * PESTAÑAS REQUERIDAS EN GOOGLE SHEETS:
 * - SEASON_RULES: Reglas por fecha/tipo
 * - SEASON_CONFIG: Configuración general
 * - ORDER_MODIFY_POLICY: Políticas de modificación
 * 
 * @version 2.0.0
 */

import { getConfig } from '../config-hub/sync-service.js';
import { logger } from '../utils/logger.js';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTES (Solo identificadores, NO reglas de negocio)
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_TIMEZONE = 'America/Mexico_City';

const RULE_TYPES = Object.freeze({
  PREVENTA: 'PREVENTA',
  PUSH: 'PUSH',
  SOLO_POS: 'SOLO_POS',
  BLOQUEADO: 'BLOQUEADO',
  FIN_TEMPORADA: 'FIN_TEMPORADA',
});

const CHANNELS = Object.freeze({
  WEB: 'web',
  BOT: 'bot',
  POS: 'pos',
});

const PRODUCT_CATEGORIES = Object.freeze({
  ROSCAS: 'roscas',
  POSTRES: 'postres',
  EXTRAS: 'extras',
  ALL: 'all',
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS DE FECHA (Zona horaria México)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene fecha actual en zona horaria de México
 */
function getNowMX() {
  const config = getSeasonConfig();
  const tz = config.timezone || DEFAULT_TIMEZONE;
  
  try {
    return new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  } catch {
    return new Date();
  }
}

/**
 * Parsea fecha de entrega desde slug (formato: "enero-06", "diciembre-24")
 * Replica la lógica de WordPress exactamente
 * 
 * @param {string} slug - Slug de fecha
 * @returns {Date|null} Fecha parseada o null
 */
function parseDateSlug(slug) {
  if (!slug) return null;
  
  const normalized = String(slug).toLowerCase().trim().replace(/\s+/g, '-');
  const parts = normalized.split('-');
  if (parts.length < 2) return null;
  
  // Mapa de meses (igual que WordPress)
  const MONTHS = {
    'ene': 1, 'enero': 1,
    'feb': 2, 'febrero': 2,
    'mar': 3, 'marzo': 3,
    'abr': 4, 'abril': 4,
    'may': 5, 'mayo': 5,
    'jun': 6, 'junio': 6,
    'jul': 7, 'julio': 7,
    'ago': 8, 'agosto': 8,
    'sep': 9, 'septiembre': 9,
    'oct': 10, 'octubre': 10,
    'nov': 11, 'noviembre': 11,
    'dic': 12, 'diciembre': 12,
  };
  
  const monthKey = parts[0];
  const dayNum = parseInt(parts[1], 10);
  
  if (!MONTHS[monthKey] || !dayNum || dayNum < 1 || dayNum > 31) return null;
  
  const monthNum = MONTHS[monthKey];
  const now = getNowMX();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  
  // Determinar año correcto (cruce de año) - igual que WordPress
  let targetYear = currentYear;
  if (currentMonth === 12 && monthNum === 1) {
    targetYear = currentYear + 1;
  } else if (currentMonth === 1 && monthNum === 12) {
    targetYear = currentYear - 1;
  }
  
  const date = new Date(targetYear, monthNum - 1, dayNum);
  date.setHours(0, 0, 0, 0);
  
  return date;
}

/**
 * Convierte fecha ISO a Date object
 */
function parseISODate(isoString) {
  if (!isoString) return null;
  
  try {
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Calcula días de diferencia entre hoy y fecha objetivo
 * Replica $dias_restantes de WordPress
 */
function getDaysUntil(targetDate) {
  if (!targetDate) return null;
  
  const now = getNowMX();
  now.setHours(0, 0, 0, 0);
  
  const target = new Date(targetDate);
  target.setHours(0, 0, 0, 0);
  
  const diffMs = target.getTime() - now.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Verifica si una fecha (slug) cae dentro de un rango de regla
 */
function isDateInRuleRange(targetDate, rule) {
  if (!targetDate) return false;
  
  const target = targetDate.getTime();
  
  const startDate = parseISODate(rule.start_date);
  const endDate = parseISODate(rule.end_date);
  
  const start = startDate ? startDate.setHours(0, 0, 0, 0) : 0;
  const end = endDate ? new Date(endDate).setHours(23, 59, 59, 999) : Infinity;
  
  return target >= start && target <= end;
}

// ═══════════════════════════════════════════════════════════════════════════
// ACCESO A CONFIG HUB
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Obtiene las reglas de temporada desde Config Hub
 */
function getSeasonRules() {
  try {
    const config = getConfig();
    
    // Buscar en diferentes ubicaciones posibles
    const rules = config?.season_rules || 
                  config?.SEASON_RULES ||
                  config?.push_rules ||
                  config?.temporada?.reglas ||
                  [];
    
    if (!Array.isArray(rules)) {
      logger.warn('[SEASON-RULES] season_rules no es un array, usando fallback vacío');
      return [];
    }
    
    // Filtrar solo reglas habilitadas
    return rules.filter(r => r.enabled !== false && r.enabled !== 'FALSE');
  } catch (err) {
    logger.error({ err: err?.message }, '[SEASON-RULES] Error obteniendo reglas');
    return [];
  }
}

/**
 * Obtiene configuración general de temporada
 */
function getSeasonConfig() {
  try {
    const config = getConfig();
    
    const seasonConfig = config?.season_config ||
                         config?.SEASON_CONFIG ||
                         config?.temporada?.config ||
                         {};
    
    return {
      season_name: seasonConfig.season_name || 'Temporada',
      season_start: seasonConfig.season_start || null,
      season_end: seasonConfig.season_end || null,
      default_min_lead_days: parseInt(seasonConfig.default_min_lead_days) || 2,
      timezone: seasonConfig.timezone || DEFAULT_TIMEZONE,
      bot_channel_id: seasonConfig.bot_channel_id || CHANNELS.BOT,
    };
  } catch {
    return {
      season_name: 'Temporada',
      season_start: null,
      season_end: null,
      default_min_lead_days: 2,
      timezone: DEFAULT_TIMEZONE,
      bot_channel_id: CHANNELS.BOT,
    };
  }
}

/**
 * Obtiene política de modificación de pedidos
 */
function getOrderModifyPolicy() {
  try {
    const config = getConfig();
    
    const policy = config?.order_modify_policy ||
                   config?.ORDER_MODIFY_POLICY ||
                   config?.pedidos?.modificacion ||
                   {};
    
    // Parsear fechas bloqueadas
    let blockedDates = [];
    if (policy.blocked_dates_for_modify) {
      const raw = String(policy.blocked_dates_for_modify);
      blockedDates = raw.split(',').map(d => d.trim()).filter(Boolean);
    }
    
    return {
      enabled: policy.enabled !== false && policy.enabled !== 'FALSE',
      require_verification: policy.require_verification !== false,
      verification_fields: String(policy.verification_fields || 'phone,email').split(',').map(f => f.trim()),
      blocked_dates: blockedDates,
      blocked_modify_message: policy.blocked_modify_message || 
        'Para cambios en pedidos de esa fecha, contacta directamente a la sucursal.',
      min_hours_before_modify: parseInt(policy.min_hours_before_modify) || 24,
    };
  } catch {
    return {
      enabled: true,
      require_verification: true,
      verification_fields: ['phone', 'email'],
      blocked_dates: [],
      blocked_modify_message: 'Para cambios en pedidos de esa fecha, contacta directamente a la sucursal.',
      min_hours_before_modify: 24,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE REGLAS PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encuentra la regla aplicable para una fecha, canal y categoría
 * Replica la lógica de tagers_validar_fecha_master() de WordPress
 * 
 * @param {string} dateSlug - Slug de fecha (ej: "enero-06")
 * @param {string} channel - Canal: 'web', 'bot', 'pos'
 * @param {string} productCategory - Categoría del producto (opcional)
 * @returns {Object} Resultado con regla aplicable
 */
function findApplicableRule(dateSlug, channel = 'bot', productCategory = 'roscas') {
  const targetDate = parseDateSlug(dateSlug);
  
  if (!targetDate) {
    return { 
      allowed: false, 
      reason: 'invalid_date',
      message: 'No pude interpretar la fecha.',
      can_check_stock: false,
      can_suggest_branch: false,
    };
  }
  
  const daysUntil = getDaysUntil(targetDate);
  const rules = getSeasonRules();
  const seasonConfig = getSeasonConfig();
  
  // ─────────────────────────────────────────────────────────────────────────
  // A) VERIFICAR FIN DE TEMPORADA
  // ─────────────────────────────────────────────────────────────────────────
  
  if (seasonConfig.season_end) {
    const seasonEndDate = parseISODate(seasonConfig.season_end);
    if (seasonEndDate && targetDate > seasonEndDate) {
      // Buscar regla FIN_TEMPORADA para mensaje personalizado
      const finRule = rules.find(r => r.rule_type === RULE_TYPES.FIN_TEMPORADA);
      
      return {
        allowed: false,
        reason: 'season_ended',
        rule_type: RULE_TYPES.FIN_TEMPORADA,
        message: finRule?.message_bot || 
          `La temporada de ${seasonConfig.season_name} terminó el ${formatDateHuman(seasonEndDate)}.`,
        season_end: seasonConfig.season_end,
        can_check_stock: false,
        can_suggest_branch: false,
      };
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // B) FECHA PASADA
  // ─────────────────────────────────────────────────────────────────────────
  
  if (daysUntil < 0) {
    return {
      allowed: false,
      reason: 'past_date',
      message: 'Esa fecha ya pasó.',
      days_until: daysUntil,
      can_check_stock: false,
      can_suggest_branch: false,
    };
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // C) BUSCAR REGLA ESPECÍFICA
  // ─────────────────────────────────────────────────────────────────────────
  
  // Normalizar categoría
  const normalizedCategory = String(productCategory || 'roscas').toLowerCase();
  
  // Filtrar y ordenar reglas aplicables
  const applicableRules = rules
    .filter(r => {
      // Verificar si la fecha cae en el rango de la regla
      if (!isDateInRuleRange(targetDate, r)) return false;
      
      // Verificar categoría de producto
      const ruleCats = String(r.product_categories || 'all').toLowerCase();
      if (ruleCats !== 'all') {
        const cats = ruleCats.split(/[,;]/).map(c => c.trim());
        if (!cats.includes(normalizedCategory) && !cats.includes('all')) {
          return false;
        }
      }
      
      return true;
    })
    .sort((a, b) => (parseInt(b.priority) || 0) - (parseInt(a.priority) || 0));
  
  const rule = applicableRules[0];
  
  // ─────────────────────────────────────────────────────────────────────────
  // D) SIN REGLA ESPECÍFICA → APLICAR PREVENTA POR DEFECTO
  // ─────────────────────────────────────────────────────────────────────────
  
  if (!rule) {
    const defaultLeadDays = seasonConfig.default_min_lead_days || 2;
    
    if (daysUntil >= defaultLeadDays) {
      return {
        allowed: true,
        reason: 'preventa_default',
        rule_type: RULE_TYPES.PREVENTA,
        days_until: daysUntil,
        min_lead_days: defaultLeadDays,
        can_check_stock: true,
        can_suggest_branch: false,
      };
    } else {
      return {
        allowed: false,
        reason: 'insufficient_lead_time',
        rule_type: RULE_TYPES.PREVENTA,
        days_until: daysUntil,
        min_lead_days: defaultLeadDays,
        message: `Para esa fecha necesitas ordenar con al menos ${defaultLeadDays} días de anticipación.`,
        can_check_stock: true,
        can_suggest_branch: false,
      };
    }
  }
  
  // ─────────────────────────────────────────────────────────────────────────
  // E) APLICAR REGLA ENCONTRADA
  // ─────────────────────────────────────────────────────────────────────────
  
  const ruleType = String(rule.rule_type || '').toUpperCase();
  
  // Parsear canales permitidos
  const ruleChannels = String(rule.channels || 'all')
    .toLowerCase()
    .split(/[,;]/)
    .map(c => c.trim())
    .filter(Boolean);
  
  const channelAllowed = ruleChannels.includes('all') || 
                         ruleChannels.includes(channel) ||
                         ruleChannels.length === 0;
  
  // Parsear flags booleanos
  const canCheckStock = rule.can_check_stock === true || 
                        rule.can_check_stock === 'TRUE' ||
                        rule.can_check_stock === '1';
  
  const canSuggestBranch = rule.can_suggest_branch === true || 
                           rule.can_suggest_branch === 'TRUE' ||
                           rule.can_suggest_branch === '1';
  
  switch (ruleType) {
    // ─────────────────────────────────────────────────────────────────────
    // PUSH: Venta el mismo día
    // ─────────────────────────────────────────────────────────────────────
    case RULE_TYPES.PUSH:
      if (channelAllowed) {
        return {
          allowed: true,
          reason: 'push_enabled',
          rule_type: RULE_TYPES.PUSH,
          rule_id: rule.rule_id,
          days_until: daysUntil,
          message: rule.message_bot || null,
          can_check_stock: true,
          can_suggest_branch: false,
        };
      } else {
        return {
          allowed: false,
          reason: 'channel_not_allowed',
          rule_type: RULE_TYPES.PUSH,
          rule_id: rule.rule_id,
          days_until: daysUntil,
          allowed_channels: ruleChannels,
          message: rule.message_bot || 
            `Para esa fecha solo puedes comprar en: ${ruleChannels.join(', ')}.`,
          can_check_stock: canCheckStock,
          can_suggest_branch: canSuggestBranch,
        };
      }
    
    // ─────────────────────────────────────────────────────────────────────
    // SOLO_POS: Solo punto de venta físico
    // ─────────────────────────────────────────────────────────────────────
    case RULE_TYPES.SOLO_POS:
      if (channel === CHANNELS.POS) {
        return {
          allowed: true,
          reason: 'pos_allowed',
          rule_type: RULE_TYPES.SOLO_POS,
          rule_id: rule.rule_id,
          days_until: daysUntil,
          can_check_stock: true,
          can_suggest_branch: false,
        };
      } else {
        return {
          allowed: false,
          reason: 'pos_only',
          rule_type: RULE_TYPES.SOLO_POS,
          rule_id: rule.rule_id,
          days_until: daysUntil,
          message: rule.message_bot || 
            '📍 Para esa fecha solo vendemos en sucursal. Te puedo decir dónde hay disponibilidad.',
          can_check_stock: canCheckStock,  // Puede ver stock aunque no genere carrito
          can_suggest_branch: canSuggestBranch,
        };
      }
    
    // ─────────────────────────────────────────────────────────────────────
    // BLOQUEADO: Sin venta en ningún canal
    // ─────────────────────────────────────────────────────────────────────
    case RULE_TYPES.BLOQUEADO:
      return {
        allowed: false,
        reason: 'blocked',
        rule_type: RULE_TYPES.BLOQUEADO,
        rule_id: rule.rule_id,
        message: rule.message_bot || 'Esa fecha no está disponible para pedidos.',
        can_check_stock: canCheckStock,
        can_suggest_branch: canSuggestBranch,
      };
    
    // ─────────────────────────────────────────────────────────────────────
    // PREVENTA: Requiere anticipación mínima
    // ─────────────────────────────────────────────────────────────────────
    case RULE_TYPES.PREVENTA:
    default:
      const minLeadDays = parseInt(rule.min_lead_days) || seasonConfig.default_min_lead_days || 2;
      
      if (daysUntil >= minLeadDays) {
        return {
          allowed: true,
          reason: 'preventa',
          rule_type: RULE_TYPES.PREVENTA,
          rule_id: rule.rule_id,
          days_until: daysUntil,
          min_lead_days: minLeadDays,
          can_check_stock: true,
          can_suggest_branch: false,
        };
      } else if (daysUntil === 0) {
        // Día 0 sin regla PUSH = no disponible
        return {
          allowed: false,
          reason: 'same_day_no_push',
          rule_type: RULE_TYPES.PREVENTA,
          rule_id: rule.rule_id,
          days_until: 0,
          min_lead_days: minLeadDays,
          message: rule.message_bot || 
            'No hay venta el mismo día para esa fecha. Necesitas ordenar con anticipación.',
          can_check_stock: canCheckStock,
          can_suggest_branch: canSuggestBranch,
        };
      } else {
        return {
          allowed: false,
          reason: 'insufficient_lead_time',
          rule_type: RULE_TYPES.PREVENTA,
          rule_id: rule.rule_id,
          days_until: daysUntil,
          min_lead_days: minLeadDays,
          message: rule.message_bot || 
            `Necesitas ordenar con al menos ${minLeadDays} días de anticipación.`,
          can_check_stock: canCheckStock,
          can_suggest_branch: canSuggestBranch,
        };
      }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// FUNCIONES PÚBLICAS DE VALIDACIÓN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valida si se puede crear/modificar un pedido para una fecha
 */
export function validateOrderDate(params) {
  const {
    dateSlug,
    branchId = null,
    channel = 'bot',
    productCategory = 'roscas',
    action = 'create',
  } = params;
  
  const result = findApplicableRule(dateSlug, channel, productCategory);
  
  // Para modificaciones, verificar reglas adicionales
  if (action === 'modify') {
    const modifyPolicy = getOrderModifyPolicy();
    
    if (!modifyPolicy.enabled) {
      return {
        ...result,
        can_modify: false,
        message: 'Las modificaciones de pedido están deshabilitadas temporalmente.',
      };
    }
    
    // Verificar si la fecha está bloqueada para modificaciones
    if (modifyPolicy.blocked_dates.length > 0) {
      const targetDate = parseDateSlug(dateSlug);
      if (targetDate) {
        const targetISO = targetDate.toISOString().split('T')[0];
        const targetMD = `${String(targetDate.getMonth() + 1).padStart(2, '0')}-${String(targetDate.getDate()).padStart(2, '0')}`;
        
        const isBlocked = modifyPolicy.blocked_dates.some(d => {
          return d === targetISO || d.includes(targetMD) || targetISO.includes(d);
        });
        
        if (isBlocked) {
          return {
            ...result,
            can_modify: false,
            reason: 'modify_blocked_date',
            message: modifyPolicy.blocked_modify_message,
          };
        }
      }
    }
    
    // Si SOLO_POS y es para modificar
    if (result.rule_type === RULE_TYPES.SOLO_POS) {
      return {
        ...result,
        can_modify: false,
        message: modifyPolicy.blocked_modify_message,
      };
    }
  }
  
  // Agregar info de sucursal si aplica
  if (result.can_suggest_branch && branchId) {
    result.suggested_branch = branchId;
  }
  
  return result;
}

/**
 * Verifica disponibilidad para fecha + sucursal
 */
export function checkDateAvailability(dateSlug, branchId = null, productCategory = 'roscas') {
  const validation = validateOrderDate({
    dateSlug,
    branchId,
    channel: 'bot',
    productCategory,
    action: 'create',
  });
  
  return {
    date_slug: dateSlug,
    branch_id: branchId,
    product_category: productCategory,
    ...validation,
    can_generate_cart: validation.allowed,
    show_stock_info: validation.can_check_stock,
  };
}

/**
 * Obtiene mensaje contextual para el bot según la regla
 */
export function getBotMessageForRule(validation) {
  if (validation.allowed) {
    return null;
  }
  
  if (validation.message) {
    return validation.message;
  }
  
  switch (validation.rule_type) {
    case RULE_TYPES.SOLO_POS:
      return '📍 Para esa fecha, solo vendemos en sucursal. ¿Te digo dónde hay disponibilidad?';
    case RULE_TYPES.BLOQUEADO:
      return '⚠️ Esa fecha no está disponible para pedidos.';
    case RULE_TYPES.FIN_TEMPORADA:
      return '📅 La temporada ya terminó para esa fecha.';
    case RULE_TYPES.PREVENTA:
      const days = validation.min_lead_days || 2;
      return `⏰ Para esa fecha necesitas ordenar con al menos ${days} días de anticipación.`;
    default:
      return 'Esa fecha no está disponible en este momento.';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE MODIFICACIONES DE PEDIDO
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Valida si el usuario puede modificar un pedido
 * Requiere verificación de teléfono o email
 */
export function validateOrderModificationAccess(params) {
  const { orderId, customerPhone, customerEmail, orderData } = params;
  
  const policy = getOrderModifyPolicy();
  
  if (!policy.enabled) {
    return {
      authorized: false,
      reason: 'modifications_disabled',
      message: 'Las modificaciones de pedido están deshabilitadas temporalmente.',
    };
  }
  
  if (!policy.require_verification) {
    return {
      authorized: true,
      reason: 'verification_not_required',
      order_id: orderId,
    };
  }
  
  if (!orderData) {
    return {
      authorized: false,
      reason: 'order_not_found',
      message: 'No encontré ese pedido. ¿Puedes verificar el número?',
    };
  }
  
  // Normalizar teléfonos
  const normalizePhone = (p) => {
    if (!p) return '';
    return String(p).replace(/\D/g, '').slice(-10);
  };
  
  const orderPhone = normalizePhone(orderData.billing_phone || orderData.phone || orderData.billing?.phone);
  const inputPhone = normalizePhone(customerPhone);
  
  const orderEmail = String(orderData.billing_email || orderData.email || orderData.billing?.email || '').toLowerCase().trim();
  const inputEmail = String(customerEmail || '').toLowerCase().trim();
  
  // Verificar coincidencia
  if (orderPhone && inputPhone && orderPhone === inputPhone) {
    return { authorized: true, reason: 'phone_match', order_id: orderId, verified_by: 'phone' };
  }
  
  if (orderEmail && inputEmail && orderEmail === inputEmail) {
    return { authorized: true, reason: 'email_match', order_id: orderId, verified_by: 'email' };
  }
  
  const requiresField = orderPhone ? 'phone' : (orderEmail ? 'email' : 'phone');
  
  return {
    authorized: false,
    reason: 'credentials_mismatch',
    message: 'Los datos no coinciden con el pedido. Por seguridad, necesito verificar que eres el titular.',
    requires: requiresField,
    hint: requiresField === 'phone' 
      ? '¿Me puedes dar el teléfono con el que hiciste el pedido?' 
      : '¿Me puedes dar el email con el que hiciste el pedido?',
  };
}

/**
 * Verifica si una fecha de entrega permite modificaciones
 */
export function canModifyOrderForDate(dateSlug, productCategory = 'roscas') {
  const policy = getOrderModifyPolicy();
  
  if (!policy.enabled) {
    return { can_modify: false, reason: 'modifications_disabled', message: 'Las modificaciones están deshabilitadas.' };
  }
  
  const targetDate = parseDateSlug(dateSlug);
  if (targetDate && policy.blocked_dates.length > 0) {
    const targetISO = targetDate.toISOString().split('T')[0];
    const isBlocked = policy.blocked_dates.some(d => targetISO.includes(d) || d.includes(targetISO.slice(5)));
    
    if (isBlocked) {
      return { can_modify: false, reason: 'blocked_date', message: policy.blocked_modify_message };
    }
  }
  
  const validation = validateOrderDate({ dateSlug, channel: 'bot', productCategory, action: 'modify' });
  
  if (validation.can_modify === false) {
    return { can_modify: false, reason: validation.reason, message: validation.message };
  }
  
  return { can_modify: true, reason: 'allowed' };
}

// ═══════════════════════════════════════════════════════════════════════════
// UTILIDADES PARA SUCURSALES
// ═══════════════════════════════════════════════════════════════════════════

export function getBranchesForDateSuggestion() {
  try {
    const config = getConfig();
    const branches = config?.branches || config?.sucursales || [];
    
    return branches
      .filter(b => b.enabled !== false)
      .map(b => ({
        branch_id: b.branch_id || b.id || b.slug,
        name: b.name || b.nombre,
        short_name: b.short_name || b.nombre_corto,
        city: b.city || b.ciudad,
        phone: b.phone || b.telefono,
        address: b.address || b.direccion,
        maps_url: b.maps_url || b.google_maps,
        hours: b.hours_default || b.horario,
      }));
  } catch {
    return [];
  }
}

export function formatBranchesMessage(branches) {
  if (!Array.isArray(branches) || branches.length === 0) {
    return 'No hay sucursales configuradas.';
  }
  
  return branches.map(b => {
    let info = `📍 *${b.name}*`;
    if (b.city) info += ` (${b.city})`;
    if (b.address) info += `\n   ${b.address}`;
    if (b.phone) info += `\n   📞 ${b.phone}`;
    if (b.hours) info += `\n   🕐 ${b.hours}`;
    return info;
  }).join('\n\n');
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

function formatDateHuman(date) {
  if (!date) return '';
  const d = new Date(date);
  const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 
                  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${d.getDate()} de ${months[d.getMonth()]}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

export default {
  validateOrderDate,
  checkDateAvailability,
  findApplicableRule,
  getBotMessageForRule,
  getBranchesForDateSuggestion,
  formatBranchesMessage,
  validateOrderModificationAccess,
  canModifyOrderForDate,
  getOrderModifyPolicy,
  getSeasonRules,
  getSeasonConfig,
  parseDateSlug,
  getDaysUntil,
  getNowMX,
  RULE_TYPES,
  CHANNELS,
  PRODUCT_CATEGORIES,
};

export {
  RULE_TYPES,
  CHANNELS,
  PRODUCT_CATEGORIES,
  parseDateSlug,
  getDaysUntil,
  getNowMX,
  getSeasonConfig,
  getSeasonRules,
  getOrderModifyPolicy,
};
