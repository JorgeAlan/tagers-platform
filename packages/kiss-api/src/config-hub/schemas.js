/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - SCHEMAS ZOD v1.0
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Validación estricta de datos del Google Sheet
 * - .trim() en todos los strings
 * - Transformación de fechas DD/MM/YYYY → ISO
 * - Defaults seguros
 */

import { z } from 'zod';

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

// String que se limpia automáticamente
const cleanString = z.string().transform(s => s?.trim() || '');
const cleanStringRequired = z.string().min(1, 'Campo requerido').transform(s => s.trim());

// Boolean flexible (acepta TRUE/FALSE/true/false/1/0/sí/si/no)
const flexibleBoolean = z.preprocess((val) => {
  if (typeof val === 'boolean') return val;
  if (typeof val === 'number') return val === 1;
  if (typeof val === 'string') {
    const lower = val.toLowerCase().trim();
    return ['true', '1', 'sí', 'si', 'yes', 'activo', 'active'].includes(lower);
  }
  return false;
}, z.boolean());

// Fecha flexible (acepta DD/MM/YYYY, YYYY-MM-DD, DD-MM-YYYY)
const flexibleDate = z.string().transform((val) => {
  if (!val || val.trim() === '') return '';
  
  const trimmed = val.trim();
  
  // Ya está en formato ISO (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed;
  }
  
  // Formato DD/MM/YYYY o DD-MM-YYYY
  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Intentar parsear como fecha
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().split('T')[0];
  }
  
  return trimmed; // Devolver original si no se puede parsear
});

// DateTime flexible
const flexibleDateTime = z.string().transform((val) => {
  if (!val || val.trim() === '') return '';
  
  const trimmed = val.trim();
  
  // Ya tiene formato ISO completo
  if (/^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}/.test(trimmed)) {
    return trimmed.replace(' ', 'T');
  }
  
  // Solo fecha, agregar hora por defecto
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return `${trimmed}T00:00:00`;
  }
  
  // Formato DD/MM/YYYY HH:MM
  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\s*(\d{2}):(\d{2})/);
  if (match) {
    const [, day, month, year, hour, min] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}T${hour}:${min}:00`;
  }
  
  return trimmed;
});

// Número flexible
const flexibleNumber = z.preprocess((val) => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const num = parseFloat(val.replace(/[,$]/g, '').trim());
    return isNaN(num) ? 0 : num;
  }
  return 0;
}, z.number());

// Número entero flexible
const flexibleInt = z.preprocess((val) => {
  if (typeof val === 'number') return Math.round(val);
  if (typeof val === 'string') {
    const num = parseInt(val.replace(/[,$]/g, '').trim(), 10);
    return isNaN(num) ? 0 : num;
  }
  return 0;
}, z.number().int());

// Array desde string separado por comas
const commaArray = z.string().transform((val) => {
  if (!val || val.trim() === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMAS POR PESTAÑA
// ═══════════════════════════════════════════════════════════════════════════

// META (key-value)
export const MetaSchema = z.record(z.string(), z.union([
  cleanString,
  flexibleNumber,
  flexibleBoolean
]));

// BRAND (key-value)
export const BrandSchema = z.object({
  brand_name: cleanStringRequired,
  tagline: cleanString.default(''),
  description: cleanString.default(''),
  website: cleanString.default(''),
  whatsapp_number: cleanString.default(''),
  whatsapp_display: cleanString.default(''),
  whatsapp_url: cleanString.default(''),
  instagram: cleanString.default(''),
  instagram_url: cleanString.default(''),
  facebook: cleanString.default(''),
  facebook_url: cleanString.default(''),
  email_contacto: cleanString.default(''),
  email_pedidos: cleanString.default(''),
  email_eventos: cleanString.default(''),
  menu_general_url: cleanString.default(''),
  tienda_url: cleanString.default(''),
  facturacion_url: cleanString.default(''),
  trabaja_url: cleanString.default(''),
  staff_pwa_url: cleanString.default(''),
}).passthrough(); // Permitir campos adicionales

// PERSONA (key-value)
export const PersonaSchema = z.object({
  agent_name: cleanStringRequired.default('Ana'),
  agent_suffix: cleanString.default('• IA'),
  agent_full: cleanString.default('Ana • IA'),
  tone: cleanString.default('cálido, amigable, profesional'),
  emoji_level: z.enum(['none', 'low', 'medium', 'high']).catch('medium'),
  language: cleanString.default('es-MX'),
  greeting: cleanString.default('¡Hola! ¿En qué te puedo ayudar?'),
  greeting_returning: cleanString.default(''),
  fallback_message: cleanString.default(''),
  goodbye: cleanString.default(''),
  wait_message: cleanString.default(''),
  transfer_message: cleanString.default(''),
  do_not: cleanString.default(''),
  always_do: cleanString.default(''),
  escalate_when: cleanString.default(''),
}).passthrough();

// BRANCH
export const BranchSchema = z.object({
  branch_id: cleanStringRequired,
  name: cleanStringRequired,
  short_name: cleanString.default(''),
  city: cleanString.default(''),
  zone: cleanString.default(''),
  address: cleanString.default(''),
  phone: cleanString.default(''),
  phone_display: cleanString.default(''),
  google_maps_url: cleanString.default(''),
  waze_url: cleanString.default(''),
  reservation_url: cleanString.default(''),
  order_url: cleanString.default(''),
  lat: flexibleNumber.default(0),
  lng: flexibleNumber.default(0),
  parking: cleanString.default(''),
  parking_cost: cleanString.default(''),
  wifi: cleanString.default(''),
  wifi_password: cleanString.default(''),
  kids_area: flexibleBoolean.default(false),
  pet_friendly: flexibleBoolean.default(false),
  terrace: flexibleBoolean.default(false),
  private_room: flexibleBoolean.default(false),
  ac: flexibleBoolean.default(false),
  live_music: flexibleBoolean.default(false),
  capacity_indoor: flexibleInt.default(0),
  capacity_terrace: flexibleInt.default(0),
  capacity_private: flexibleInt.default(0),
  accepts_cash: flexibleBoolean.default(true),
  accepts_card: flexibleBoolean.default(true),
  accepts_amex: flexibleBoolean.default(true),
  accepts_mercadopago: flexibleBoolean.default(true),
  delivery_available: flexibleBoolean.default(false),
  pickup_available: flexibleBoolean.default(true),
  enabled: flexibleBoolean.default(true),
}).passthrough();

// BRANCH_HOURS
export const BranchHoursSchema = z.object({
  branch_id: cleanStringRequired,
  dow: flexibleInt.refine(n => n >= 1 && n <= 7, 'dow debe ser 1-7'),
  dow_name: cleanString.default(''),
  open: cleanString.default('08:00'),
  close: cleanString.default('22:00'),
  kitchen_close: cleanString.default(''),
  notes: cleanString.default(''),
  enabled: flexibleBoolean.default(true),
});

// MENU
export const MenuSchema = z.object({
  menu_id: cleanStringRequired,
  name: cleanStringRequired,
  description: cleanString.default(''),
  url: cleanString.default(''),
  branches: cleanString.default('ALL'),
  available_start: cleanString.default(''),
  available_end: cleanString.default(''),
  days: cleanString.default('1,2,3,4,5,6,7'),
  enabled: flexibleBoolean.default(true),
});

// SEASON
export const SeasonSchema = z.object({
  season_id: cleanStringRequired,
  name: cleanStringRequired,
  start_at: flexibleDate,
  end_at: flexibleDate,
  min_lead_days: flexibleInt.default(2),
  max_lead_days: flexibleInt.default(30),
  categories: cleanString.default(''),
  branches: cleanString.default('ALL'),
  description: cleanString.default(''),
  enabled: flexibleBoolean.default(true),
});

// PROMO
export const PromoSchema = z.object({
  promo_id: cleanStringRequired,
  name: cleanStringRequired,
  enabled: flexibleBoolean.default(false),
  start_at: flexibleDateTime,
  end_at: flexibleDateTime,
  gift_product_id: flexibleInt.default(0),
  gift_product_name: cleanString.default(''),
  buy_qty: flexibleInt.default(1),
  gift_qty: flexibleInt.default(1),
  trigger_cat_slugs: cleanString.default(''),
  trigger_product_ids: cleanString.default(''),
  max_gifts: flexibleInt.default(0),
  ux_message: cleanString.default(''),
  ux_badge: cleanString.default(''),
  ux_nudge_title: cleanString.default(''),
  terms: cleanString.default(''),
});

// PUSH_RULE
export const PushRuleSchema = z.object({
  rule_id: cleanStringRequired,
  priority: flexibleInt.default(100),
  start_date: flexibleDate,
  end_date: flexibleDate,
  allow_web: flexibleBoolean.default(true),
  allow_pos: flexibleBoolean.default(true),
  blocked_categories: cleanString.default(''),
  branches: cleanString.default('ALL'),
  message_internal: cleanString.default(''),
  message_customer: cleanString.default(''),
  enabled: flexibleBoolean.default(true),
});

// FAQ
export const FaqSchema = z.object({
  faq_id: cleanStringRequired,
  category: cleanString.default('general'),
  question: cleanStringRequired,
  answer: cleanStringRequired,
  keywords: cleanString.default(''),
  branch_specific: flexibleBoolean.default(false),
  channel: cleanString.default('all'),
  priority: flexibleInt.default(10),
  enabled: flexibleBoolean.default(true),
});

// NOTICE
export const NoticeSchema = z.object({
  notice_id: cleanStringRequired,
  start_at: flexibleDateTime,
  end_at: flexibleDateTime,
  branch_id: cleanString.default('ALL'),
  channel: cleanString.default('all'),
  category: cleanString.default('general'),
  message: cleanStringRequired,
  priority: z.enum(['low', 'medium', 'high']).catch('medium'),
  show_in_chat: flexibleBoolean.default(true),
  enabled: flexibleBoolean.default(true),
});

// STAFF
export const StaffSchema = z.object({
  staff_id: cleanStringRequired,
  name: cleanStringRequired,
  display_name: cleanString.default(''),
  email: cleanString.default(''),
  phone: cleanString.default(''),
  telegram_id: cleanString.default(''),
  slack_id: cleanString.default(''),
  branches: cleanString.default('ALL'),
  role: z.enum(['admin', 'agent', 'viewer']).catch('agent'),
  permissions: cleanString.default(''),
  shift_start: cleanString.default('09:00'),
  shift_end: cleanString.default('18:00'),
  shift_days: cleanString.default('1,2,3,4,5,6,7'),
  channels: cleanString.default('widget'),
  max_concurrent: flexibleInt.default(3),
  notify_telegram: flexibleBoolean.default(false),
  notify_slack: flexibleBoolean.default(false),
  notify_pwa: flexibleBoolean.default(true),
  notify_email: flexibleBoolean.default(false),
  enabled: flexibleBoolean.default(true),
});

// ESCALATION
export const EscalationSchema = z.object({
  rule_id: cleanStringRequired,
  name: cleanString.default(''),
  trigger_type: z.enum(['sentiment', 'intent', 'keyword', 'fallback']),
  trigger_value: cleanStringRequired,
  priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).catch('MEDIUM'),
  assign_strategy: z.enum(['first_available', 'by_branch', 'round_robin', 'specific']).catch('first_available'),
  assign_to: cleanString.default(''),
  notify_channels: cleanString.default('pwa'),
  auto_message_internal: cleanString.default(''),
  auto_message_customer: cleanString.default(''),
  sla_minutes: flexibleInt.default(5),
  auto_close_minutes: flexibleInt.default(120),
  enabled: flexibleBoolean.default(true),
});

// CANNED
export const CannedSchema = z.object({
  canned_id: cleanStringRequired,
  category: cleanString.default('general'),
  title: cleanStringRequired,
  message: cleanStringRequired,
  use_case: cleanString.default(''),
  shortcut: cleanString.default(''),
  enabled: flexibleBoolean.default(true),
});

// ROSCAS (productos temporada)
export const RoscaSchema = z.object({
  product_id: cleanString.default(''),
  sku: cleanString.default(''),
  name: cleanStringRequired,
  size: cleanString.default(''),
  portions: cleanString.default(''),
  price: flexibleNumber.default(0),
  type: cleanString.default('tradicional'),
  description: cleanString.default(''),
  image_url: cleanString.default(''),
  available: flexibleBoolean.default(true),
  enabled: flexibleBoolean.default(true),
});

// PUBLISH
export const PublishSchema = z.object({
  env: z.enum(['prod', 'staging', 'dev']),
  active_revision: flexibleInt.default(1),
  published_at: flexibleDateTime,
  published_by: cleanString.default(''),
  notes: cleanString.default(''),
  status: z.enum(['DRAFT', 'LIVE', 'ROLLBACK']).catch('DRAFT'),
});

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA COMPLETO DE CONFIGURACIÓN
// ═══════════════════════════════════════════════════════════════════════════

export const FullConfigSchema = z.object({
  // Metadata
  version: flexibleInt,
  updated_at: cleanString,
  config_hash: cleanString.optional(),
  
  // Datos
  meta: MetaSchema,
  brand: BrandSchema,
  persona: PersonaSchema,
  branches: z.array(BranchSchema),
  branch_hours: z.array(BranchHoursSchema),
  menus: z.array(MenuSchema),
  seasons: z.array(SeasonSchema),
  promos: z.array(PromoSchema),
  push_rules: z.array(PushRuleSchema),
  faq: z.array(FaqSchema),
  notices: z.array(NoticeSchema),
  staff: z.array(StaffSchema),
  escalation: z.array(EscalationSchema),
  canned: z.array(CannedSchema),
  roscas: z.array(RoscaSchema),
});

// ═══════════════════════════════════════════════════════════════════════════
// TIPOS TYPESCRIPT (para referencia)
// ═══════════════════════════════════════════════════════════════════════════

/** @typedef {z.infer<typeof FullConfigSchema>} FullConfig */
/** @typedef {z.infer<typeof BranchSchema>} Branch */
/** @typedef {z.infer<typeof PromoSchema>} Promo */
/** @typedef {z.infer<typeof SeasonSchema>} Season */
/** @typedef {z.infer<typeof StaffSchema>} Staff */
/** @typedef {z.infer<typeof EscalationSchema>} Escalation */

export default FullConfigSchema;
