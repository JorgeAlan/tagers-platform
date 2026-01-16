/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CONFIG HUB - FORMAT FOR LLM v2.0 (Agentic Pro)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Transforma TODA la configuración de Google Sheets en contexto rico para Ana.
 * 
 * PRINCIPIOS:
 * - TODA información relevante para responder al cliente
 * - Formato estructurado pero natural
 * - Incluye campos que antes se omitían
 * - Optimizado para que el LLM encuentre la info fácilmente
 */

/**
 * Formatea la configuración completa para inyectar en el prompt de Ana
 * 
 * @param {Object} config - Configuración completa validada desde Google Sheets
 * @returns {string} Markdown completo para LLM
 */
export function formatConfigForLLM(config) {
  const sections = [];
  const now = new Date();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 1. IDENTIDAD Y PERSONALIDAD
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (config.persona) {
    const p = config.persona;
    let identitySection = `## Tu Identidad\n`;
    identitySection += `Eres **${p.agent_name || 'Ana'}${p.agent_suffix ? ` ${p.agent_suffix}` : ''}**, asistente virtual de ${config.brand?.brand_name || 'Tagers'}.\n`;
    
    if (p.tone) identitySection += `\n**Tono:** ${p.tone}`;
    if (p.personality) identitySection += `\n**Personalidad:** ${p.personality}`;
    if (p.always_do) identitySection += `\n\n**SIEMPRE:** ${p.always_do}`;
    if (p.do_not) identitySection += `\n**NUNCA:** ${p.do_not}`;
    if (p.greeting) identitySection += `\n\n**Saludo sugerido:** "${p.greeting}"`;
    if (p.farewell) identitySection += `\n**Despedida sugerida:** "${p.farewell}"`;
    
    sections.push(identitySection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 2. MARCA Y CONTACTO COMPLETO
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (config.brand) {
    const b = config.brand;
    let brandSection = `## Información de ${b.brand_name || 'Tagers'}\n`;
    
    if (b.tagline) brandSection += `_"${b.tagline}"_\n`;
    if (b.description) brandSection += `\n${b.description}\n`;
    
    // Contacto principal
    brandSection += `\n### Contacto\n`;
    if (b.whatsapp_display) brandSection += `- **WhatsApp:** ${b.whatsapp_display}${b.whatsapp_url ? ` (${b.whatsapp_url})` : ''}\n`;
    if (b.phone) brandSection += `- **Teléfono:** ${b.phone}\n`;
    if (b.website) brandSection += `- **Web:** ${b.website}\n`;
    if (b.tienda_url) brandSection += `- **Tienda en línea:** ${b.tienda_url}\n`;
    
    // Redes sociales
    if (b.instagram || b.facebook) {
      brandSection += `\n### Redes Sociales\n`;
      if (b.instagram) brandSection += `- **Instagram:** ${b.instagram}${b.instagram_url ? ` (${b.instagram_url})` : ''}\n`;
      if (b.facebook) brandSection += `- **Facebook:** ${b.facebook}${b.facebook_url ? ` (${b.facebook_url})` : ''}\n`;
    }
    
    // Emails por departamento
    if (b.email_contacto || b.email_pedidos || b.email_eventos) {
      brandSection += `\n### Emails\n`;
      if (b.email_contacto) brandSection += `- **Contacto general:** ${b.email_contacto}\n`;
      if (b.email_pedidos) brandSection += `- **Pedidos:** ${b.email_pedidos}\n`;
      if (b.email_eventos) brandSection += `- **Eventos:** ${b.email_eventos}\n`;
    }
    
    // Links útiles
    if (b.menu_general_url || b.facturacion_url || b.trabaja_url) {
      brandSection += `\n### Links Útiles\n`;
      if (b.menu_general_url) brandSection += `- **Menú general:** ${b.menu_general_url}\n`;
      if (b.facturacion_url) brandSection += `- **Facturación:** ${b.facturacion_url}\n`;
      if (b.trabaja_url) brandSection += `- **Trabaja con nosotros:** ${b.trabaja_url}\n`;
    }
    
    sections.push(brandSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 3. SUCURSALES COMPLETAS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const enabledBranches = config.branches?.filter(b => b.enabled) || [];
  
  if (enabledBranches.length > 0) {
    let branchSection = `## Sucursales (${enabledBranches.length} ubicaciones)\n`;
    
    // Resumen rápido primero
    const branchNames = enabledBranches.map(b => `${b.short_name || b.name} (${b.city})`);
    branchSection += `\n**Ubicaciones:** ${branchNames.join(' • ')}\n`;
    
    // Detalle de cada sucursal
    enabledBranches.forEach(b => {
      branchSection += `\n### ${b.name}${b.short_name && b.short_name !== b.name ? ` (${b.short_name})` : ''}\n`;
      branchSection += `**Ciudad:** ${b.city || 'México'}${b.zone ? ` - Zona ${b.zone}` : ''}\n`;
      
      // Ubicación y contacto
      if (b.address) branchSection += `- **Dirección:** ${b.address}\n`;
      if (b.phone_display || b.phone) branchSection += `- **Teléfono:** ${b.phone_display || b.phone}\n`;
      if (b.google_maps_url) branchSection += `- **Google Maps:** ${b.google_maps_url}\n`;
      if (b.waze_url) branchSection += `- **Waze:** ${b.waze_url}\n`;
      
      // WiFi - MUY IMPORTANTE
      if (b.wifi || b.wifi_password) {
        branchSection += `- **WiFi:** ${b.wifi || 'Sí, disponible'}\n`;
        if (b.wifi_password) {
          branchSection += `- **🔑 CLAVE WIFI: ${b.wifi_password}**\n`;
        }
      }
      
      // Estacionamiento
      if (b.parking) {
        branchSection += `- **Estacionamiento:** ${b.parking}`;
        if (b.parking_cost && b.parking_cost !== 'Gratis' && b.parking_cost !== 'gratis') {
          branchSection += ` (${b.parking_cost})`;
        }
        branchSection += `\n`;
      }
      
      // Capacidades
      const capacities = [];
      if (b.capacity_indoor) capacities.push(`Interior: ${b.capacity_indoor}`);
      if (b.capacity_terrace) capacities.push(`Terraza: ${b.capacity_terrace}`);
      if (b.capacity_private) capacities.push(`Privado: ${b.capacity_private}`);
      if (capacities.length > 0) {
        branchSection += `- **Capacidad:** ${capacities.join(', ')} personas\n`;
      }
      
      // Amenidades (lo que SÍ tiene)
      const amenities = [];
      if (b.kids_area) amenities.push('👶 Área infantil');
      if (b.pet_friendly) amenities.push('🐕 Pet friendly');
      if (b.terrace) amenities.push('🌳 Terraza');
      if (b.private_room) amenities.push('🚪 Salón privado');
      if (b.ac) amenities.push('❄️ Aire acondicionado');
      if (b.live_music) amenities.push('🎵 Música en vivo');
      
      if (amenities.length > 0) {
        branchSection += `- **✅ Amenidades:** ${amenities.join(', ')}\n`;
      }
      
      // Lo que NO tiene (importante para no prometer)
      const noAmenities = [];
      if (!b.kids_area) noAmenities.push('área infantil');
      if (!b.pet_friendly) noAmenities.push('mascotas');
      if (!b.terrace) noAmenities.push('terraza');
      if (!b.private_room) noAmenities.push('salón privado');
      
      if (noAmenities.length > 0 && noAmenities.length <= 2) {
        branchSection += `- **❌ No disponible:** ${noAmenities.join(', ')}\n`;
      }
      
      // Métodos de pago
      const payments = [];
      if (b.accepts_cash) payments.push('Efectivo');
      if (b.accepts_card) payments.push('Tarjeta');
      if (b.accepts_amex) payments.push('AMEX');
      if (b.accepts_mercadopago) payments.push('Mercado Pago');
      if (payments.length > 0) {
        branchSection += `- **Formas de pago:** ${payments.join(', ')}\n`;
      }
      
      // Opciones de entrega
      const delivery = [];
      if (b.pickup_available) delivery.push('Recoger en sucursal');
      if (b.delivery_available) delivery.push('Envío a domicilio');
      if (delivery.length > 0) {
        branchSection += `- **Opciones:** ${delivery.join(', ')}\n`;
      }
      
      // Links de acción
      if (b.reservation_url) branchSection += `- **🔗 Reservar mesa:** ${b.reservation_url}\n`;
      if (b.order_url) branchSection += `- **🛒 Ordenar en línea:** ${b.order_url}\n`;
    });
    
    sections.push(branchSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 4. HORARIOS POR SUCURSAL
  // ═══════════════════════════════════════════════════════════════════════════
  
  if (config.branch_hours?.length > 0) {
    const hoursByBranch = {};
    config.branch_hours.filter(h => h.enabled).forEach(h => {
      if (!hoursByBranch[h.branch_id]) hoursByBranch[h.branch_id] = [];
      hoursByBranch[h.branch_id].push(h);
    });
    
    let hoursSection = `## Horarios\n`;
    
    enabledBranches.forEach(branch => {
      const hours = hoursByBranch[branch.branch_id] || [];
      if (hours.length === 0) return;
      
      hoursSection += `\n**${branch.short_name || branch.name}:**\n`;
      
      // Agrupar días similares
      const weekdays = hours.filter(h => h.dow >= 1 && h.dow <= 5);
      const saturday = hours.find(h => h.dow === 6);
      const sunday = hours.find(h => h.dow === 7);
      
      // Verificar si todos los días entre semana son iguales
      const weekdayHours = weekdays[0];
      const allWeekdaysSame = weekdays.every(h => h.open === weekdayHours?.open && h.close === weekdayHours?.close);
      
      if (allWeekdaysSame && weekdayHours) {
        hoursSection += `- Lunes a Viernes: ${weekdayHours.open} - ${weekdayHours.close}`;
        if (weekdayHours.kitchen_close) hoursSection += ` (cocina cierra ${weekdayHours.kitchen_close})`;
        hoursSection += `\n`;
      } else {
        weekdays.forEach(h => {
          const dayName = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie'][h.dow];
          hoursSection += `- ${dayName}: ${h.open} - ${h.close}\n`;
        });
      }
      
      if (saturday) {
        hoursSection += `- Sábado: ${saturday.open} - ${saturday.close}`;
        if (saturday.kitchen_close) hoursSection += ` (cocina cierra ${saturday.kitchen_close})`;
        hoursSection += `\n`;
      }
      
      if (sunday) {
        hoursSection += `- Domingo: ${sunday.open} - ${sunday.close}`;
        if (sunday.kitchen_close) hoursSection += ` (cocina cierra ${sunday.kitchen_close})`;
        hoursSection += `\n`;
      }
    });
    
    sections.push(hoursSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 5. PROMOCIONES ACTIVAS (con todos los detalles)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const activePromos = config.promos?.filter(p => {
    if (!p.enabled) return false;
    const start = new Date(p.start_at);
    const end = new Date(p.end_at);
    return now >= start && now <= end;
  }) || [];
  
  if (activePromos.length > 0) {
    let promoSection = `## 🎉 Promociones Activas\n`;
    
    activePromos.forEach(p => {
      promoSection += `\n### ${p.name}`;
      if (p.ux_badge) promoSection += ` ${p.ux_badge}`;
      promoSection += `\n`;
      
      // Mecánica
      if (p.buy_qty && p.gift_qty) {
        promoSection += `**Mecánica:** Compra ${p.buy_qty}, te regalamos ${p.gift_qty}`;
        if (p.gift_product_name) promoSection += ` ${p.gift_product_name}`;
        promoSection += `\n`;
      }
      
      // Mensaje para cliente
      if (p.ux_message) {
        promoSection += `**Mensaje:** "${p.ux_message}"\n`;
      }
      
      // Términos y condiciones
      if (p.terms) {
        promoSection += `**Términos:** ${p.terms}\n`;
      }
      
      // Vigencia
      const endDate = new Date(p.end_at);
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      promoSection += `**Vigencia:** Hasta ${formatDateSpanish(p.end_at)}`;
      if (daysLeft <= 7) promoSection += ` ⚠️ ¡Quedan ${daysLeft} días!`;
      promoSection += `\n`;
    });
    
    sections.push(promoSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 6. TEMPORADAS Y PRODUCTOS DE TEMPORADA
  // ═══════════════════════════════════════════════════════════════════════════
  
  const activeSeasons = config.seasons?.filter(s => {
    if (!s.enabled) return false;
    const start = new Date(s.start_at);
    const end = new Date(s.end_at);
    return now >= start && now <= end;
  }) || [];
  
  if (activeSeasons.length > 0) {
    let seasonSection = `## 📅 Temporadas Activas\n`;
    
    activeSeasons.forEach(s => {
      const endDate = new Date(s.end_at);
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      
      seasonSection += `\n### ${s.name}\n`;
      if (s.description) seasonSection += `${s.description}\n`;
      seasonSection += `- **Disponible hasta:** ${formatDateSpanish(s.end_at)}`;
      if (daysLeft <= 7) seasonSection += ` ⚠️ ¡Últimos ${daysLeft} días!`;
      seasonSection += `\n`;
      
      if (s.min_lead_days) {
        seasonSection += `- **Anticipación requerida:** ${s.min_lead_days} días mínimo\n`;
      }
      if (s.max_lead_days) {
        seasonSection += `- **Máximo anticipación:** ${s.max_lead_days} días\n`;
      }
      if (s.branches && s.branches !== 'ALL') {
        seasonSection += `- **Sucursales:** ${s.branches}\n`;
      }
    });
    
    sections.push(seasonSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 7. ROSCAS Y PRODUCTOS DE TEMPORADA (completo)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const enabledRoscas = config.roscas?.filter(r => r.enabled && r.available) || [];
  
  if (enabledRoscas.length > 0) {
    let roscaSection = `## 🥯 Roscas de Reyes - Precios y Opciones\n`;
    
    // Agrupar por tipo
    const byType = {};
    enabledRoscas.forEach(r => {
      const type = r.type || 'tradicional';
      if (!byType[type]) byType[type] = [];
      byType[type].push(r);
    });
    
    Object.entries(byType).forEach(([type, items]) => {
      const typeLabel = type === 'rellena' ? '🍫 Roscas Rellenas' : '🥖 Roscas Tradicionales';
      roscaSection += `\n### ${typeLabel}\n`;
      
      // Ordenar por precio
      items.sort((a, b) => (a.price || 0) - (b.price || 0));
      
      items.forEach(r => {
        roscaSection += `- **${r.name || r.size}:** $${r.price}`;
        if (r.portions) roscaSection += ` (${r.portions} porciones)`;
        roscaSection += `\n`;
        if (r.description) roscaSection += `  _${r.description}_\n`;
      });
    });
    
    sections.push(roscaSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 8. MENÚS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const enabledMenus = config.menus?.filter(m => m.enabled) || [];
  
  if (enabledMenus.length > 0) {
    let menuSection = `## 📋 Menús\n`;
    
    enabledMenus.forEach(m => {
      menuSection += `- **${m.name}:** ${m.url}\n`;
      if (m.description) menuSection += `  _${m.description}_\n`;
      if (m.available_start && m.available_end) {
        menuSection += `  Disponible de ${m.available_start} a ${m.available_end}\n`;
      }
    });
    
    sections.push(menuSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 9. AVISOS IMPORTANTES
  // ═══════════════════════════════════════════════════════════════════════════
  
  const activeNotices = config.notices?.filter(n => {
    if (!n.enabled || !n.show_in_chat) return false;
    const start = new Date(n.start_at);
    const end = new Date(n.end_at);
    return now >= start && now <= end;
  }) || [];
  
  if (activeNotices.length > 0) {
    let noticeSection = `## ⚠️ Avisos Importantes\n`;
    
    // Ordenar por prioridad (high primero)
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    activeNotices.sort((a, b) => (priorityOrder[a.priority] || 1) - (priorityOrder[b.priority] || 1));
    
    activeNotices.forEach(n => {
      const icon = n.priority === 'high' ? '🚨' : n.priority === 'medium' ? '⚠️' : 'ℹ️';
      const branch = n.branch_id && n.branch_id !== 'ALL' ? ` (${n.branch_id})` : '';
      noticeSection += `${icon} ${n.message}${branch}\n`;
    });
    
    sections.push(noticeSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 10. RESTRICCIONES DE PRODUCTOS (Push Rules)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const activePushRules = config.push_rules?.filter(r => {
    if (!r.enabled) return false;
    if (!r.start_date || !r.end_date) return false;
    const start = new Date(r.start_date);
    const end = new Date(r.end_date);
    return now >= start && now <= end;
  }) || [];
  
  if (activePushRules.length > 0) {
    let rulesSection = `## ⛔ Restricciones Actuales\n`;
    
    activePushRules.forEach(r => {
      if (r.message_customer) {
        rulesSection += `- ${r.message_customer}\n`;
      } else if (r.blocked_categories) {
        rulesSection += `- Categorías no disponibles: ${r.blocked_categories}\n`;
      }
      if (r.branches && r.branches !== 'ALL') {
        rulesSection += `  _Aplica en: ${r.branches}_\n`;
      }
    });
    
    sections.push(rulesSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 11. FAQ COMPLETAS
  // ═══════════════════════════════════════════════════════════════════════════
  
  const enabledFaq = config.faq?.filter(f => f.enabled) || [];
  
  if (enabledFaq.length > 0) {
    let faqSection = `## ❓ Preguntas Frecuentes\n`;
    
    // Agrupar por categoría
    const byCategory = {};
    enabledFaq.forEach(f => {
      const cat = f.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(f);
    });
    
    // Ordenar categorías (general primero)
    const categoryOrder = ['general', 'reservaciones', 'pedidos', 'eventos', 'wifi', 'estacionamiento', 'otros'];
    const sortedCategories = Object.keys(byCategory).sort((a, b) => {
      const aIdx = categoryOrder.indexOf(a.toLowerCase());
      const bIdx = categoryOrder.indexOf(b.toLowerCase());
      return (aIdx === -1 ? 99 : aIdx) - (bIdx === -1 ? 99 : bIdx);
    });
    
    sortedCategories.forEach(category => {
      const faqs = byCategory[category];
      const catTitle = category.charAt(0).toUpperCase() + category.slice(1);
      faqSection += `\n### ${catTitle}\n`;
      
      faqs.forEach(f => {
        faqSection += `\n**P: ${f.question}**\n`;
        faqSection += `R: ${f.answer}\n`;
        if (f.keywords) {
          faqSection += `_[Buscar por: ${f.keywords}]_\n`;
        }
      });
    });
    
    sections.push(faqSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 12. RESPUESTAS PREDEFINIDAS (Canned)
  // ═══════════════════════════════════════════════════════════════════════════
  
  const enabledCanned = config.canned?.filter(c => c.enabled) || [];
  
  if (enabledCanned.length > 0) {
    let cannedSection = `## 💬 Respuestas Sugeridas\n`;
    cannedSection += `_Usa estas respuestas como base cuando apliquen:_\n`;
    
    // Agrupar por categoría
    const byCategory = {};
    enabledCanned.forEach(c => {
      const cat = c.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(c);
    });
    
    Object.entries(byCategory).forEach(([category, items]) => {
      cannedSection += `\n### ${category.charAt(0).toUpperCase() + category.slice(1)}\n`;
      items.forEach(c => {
        cannedSection += `\n**${c.title}**${c.use_case ? ` (${c.use_case})` : ''}\n`;
        cannedSection += `> ${c.message}\n`;
      });
    });
    
    sections.push(cannedSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // 13. REGLAS DE ESCALACIÓN
  // ═══════════════════════════════════════════════════════════════════════════
  
  const escalationRules = config.escalation?.filter(e => e.enabled) || [];
  
  if (escalationRules.length > 0) {
    let escSection = `## 🚨 Cuándo Escalar a Humano\n`;
    
    escalationRules.forEach(e => {
      if (e.trigger_type === 'keyword') {
        escSection += `- Si mencionan: "${e.trigger_value}" → Escalar\n`;
      } else if (e.trigger_type === 'sentiment') {
        escSection += `- Cliente muy molesto/frustrado → Escalar inmediatamente\n`;
      } else if (e.trigger_type === 'fallback') {
        escSection += `- Si no puedes ayudar después de ${e.trigger_value || '3'} intentos → Escalar\n`;
      } else if (e.trigger_type === 'intent') {
        escSection += `- Intent "${e.trigger_value}" → Escalar\n`;
      }
      
      if (e.auto_message_customer) {
        escSection += `  _Mensaje al cliente: "${e.auto_message_customer}"_\n`;
      }
    });
    
    sections.push(escSection);
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMPILAR TODO
  // ═══════════════════════════════════════════════════════════════════════════
  
  const header = `# 📚 Base de Conocimiento - ${config.brand?.brand_name || 'Tagers'}
_Versión ${config.version || 1} | Actualizado: ${formatDateSpanish(config.updated_at || new Date().toISOString())}_
_Publicado por: ${config.published_by || 'Sistema'}_

---`;
  
  return `${header}\n\n${sections.join('\n\n---\n\n')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Formatea fecha en español
 */
function formatDateSpanish(dateStr) {
  if (!dateStr) return '';
  
  try {
    const date = new Date(dateStr);
    const options = { 
      day: 'numeric', 
      month: 'long', 
      year: 'numeric',
      timeZone: 'America/Mexico_City'
    };
    return date.toLocaleDateString('es-MX', options);
  } catch {
    return dateStr;
  }
}

/**
 * Versión resumida (para emergencias de tokens)
 */
export function formatConfigMinimal(config) {
  const lines = [];
  
  // Brand
  if (config.brand?.brand_name) lines.push(`**${config.brand.brand_name}**`);
  if (config.brand?.whatsapp_display) lines.push(`WhatsApp: ${config.brand.whatsapp_display}`);
  
  // Sucursales con WiFi
  const branches = config.branches?.filter(b => b.enabled) || [];
  if (branches.length > 0) {
    lines.push(`\n**Sucursales:**`);
    branches.forEach(b => {
      let line = `• ${b.short_name || b.name}`;
      if (b.wifi_password) line += ` | WiFi: ${b.wifi_password}`;
      lines.push(line);
    });
  }
  
  // Promo activa
  const now = new Date();
  const activePromo = config.promos?.find(p => {
    if (!p.enabled) return false;
    return now >= new Date(p.start_at) && now <= new Date(p.end_at);
  });
  if (activePromo) {
    lines.push(`\n**Promo:** ${activePromo.name}`);
  }
  
  // FAQ más importantes (top 3)
  const topFaq = config.faq?.filter(f => f.enabled).slice(0, 3) || [];
  if (topFaq.length > 0) {
    lines.push(`\n**FAQ:**`);
    topFaq.forEach(f => {
      lines.push(`• ${f.question}: ${f.answer.substring(0, 100)}...`);
    });
  }
  
  return lines.join('\n');
}

export default { formatConfigForLLM, formatConfigMinimal };
