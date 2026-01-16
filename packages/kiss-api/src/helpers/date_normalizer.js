/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DATE NORMALIZER - Normaliza fechas con typos y variaciones
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Convierte textos como "9 de enro", "enero 6", "6/1", "el seis" en slugs 
 * normalizados que WordPress pueda entender.
 */

// Mapeo de meses con variaciones y typos comunes
const MONTH_VARIATIONS = {
  enero: ['enero', 'enro', 'ener', 'enrero', 'henero', 'ene', 'jan', 'january'],
  febrero: ['febrero', 'febr', 'feb', 'febreo', 'febrro', 'february'],
  marzo: ['marzo', 'marz', 'mar', 'marso', 'march'],
  abril: ['abril', 'abrl', 'abri', 'abrill', 'apr', 'april'],
  mayo: ['mayo', 'may', 'mallo', 'mayo'],
  junio: ['junio', 'juni', 'jun', 'june'],
  julio: ['julio', 'juli', 'jul', 'july'],
  agosto: ['agosto', 'agost', 'ago', 'aug', 'august'],
  septiembre: ['septiembre', 'sept', 'sep', 'setiembre', 'september'],
  octubre: ['octubre', 'oct', 'octub', 'october'],
  noviembre: ['noviembre', 'nov', 'noviem', 'november'],
  diciembre: ['diciembre', 'dic', 'diciem', 'december']
};

// Números en texto
const NUMBER_WORDS = {
  'uno': 1, 'un': 1, 'primero': 1, 'primer': 1, '1ro': 1, '1ero': 1,
  'dos': 2, 'segundo': 2, '2do': 2,
  'tres': 3, 'tercero': 3, 'tercer': 3, '3ro': 3, '3ero': 3,
  'cuatro': 4, 'cuarto': 4, '4to': 4,
  'cinco': 5, 'quinto': 5, '5to': 5,
  'seis': 6, 'sexto': 6, '6to': 6,
  'siete': 7, 'septimo': 7, 'séptimo': 7, '7mo': 7,
  'ocho': 8, 'octavo': 8, '8vo': 8,
  'nueve': 9, 'noveno': 9, '9no': 9,
  'diez': 10, 'decimo': 10, 'décimo': 10, '10mo': 10,
  'once': 11,
  'doce': 12,
  'trece': 13,
  'catorce': 14,
  'quince': 15,
  'dieciseis': 16, 'dieciséis': 16,
  'diecisiete': 17,
  'dieciocho': 18,
  'diecinueve': 19,
  'veinte': 20,
  'veintiuno': 21,
  'veintidos': 22, 'veintidós': 22,
  'veintitres': 23, 'veintitrés': 23,
  'veinticuatro': 24,
  'veinticinco': 25,
  'veintiseis': 26, 'veintiséis': 26,
  'veintisiete': 27,
  'veintiocho': 28,
  'veintinueve': 29,
  'treinta': 30,
  'treinta y uno': 31, 'treintaiuno': 31
};

/**
 * Calcula distancia de Levenshtein (para fuzzy matching)
 */
function levenshtein(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Busca el mes más cercano usando fuzzy matching
 */
function fuzzyMatchMonth(input) {
  const normalized = input.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  // Primero buscar match exacto en variaciones
  for (const [month, variations] of Object.entries(MONTH_VARIATIONS)) {
    if (variations.includes(normalized)) {
      return month;
    }
  }
  
  // Si no hay match exacto, usar Levenshtein con threshold
  let bestMatch = null;
  let bestDistance = Infinity;
  
  for (const [month, variations] of Object.entries(MONTH_VARIATIONS)) {
    for (const variant of variations) {
      const distance = levenshtein(normalized, variant);
      // Permitir hasta 2 errores para palabras de 4+ letras
      const maxAllowedDistance = variant.length >= 4 ? 2 : 1;
      
      if (distance < bestDistance && distance <= maxAllowedDistance) {
        bestDistance = distance;
        bestMatch = month;
      }
    }
  }
  
  return bestMatch;
}

/**
 * Extrae número del texto (soporta dígitos y palabras)
 */
function extractNumber(text) {
  const normalized = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  
  // Primero buscar dígitos
  const digitMatch = normalized.match(/\d+/);
  if (digitMatch) {
    const num = parseInt(digitMatch[0], 10);
    if (num >= 1 && num <= 31) return num;
  }
  
  // Buscar en palabras
  for (const [word, num] of Object.entries(NUMBER_WORDS)) {
    if (normalized.includes(word)) {
      return num;
    }
  }
  
  return null;
}

/**
 * Normaliza una fecha en texto libre a un formato estándar
 * 
 * Ejemplos de entrada:
 * - "9 de enro" → { day: 9, month: 'enero', normalized: 'enero-09' }
 * - "enero 6" → { day: 6, month: 'enero', normalized: 'enero-06' }
 * - "6/1" → { day: 6, month: 'enero', normalized: 'enero-06' }
 * - "el seis de enero" → { day: 6, month: 'enero', normalized: 'enero-06' }
 * - "mañana" → null (requiere contexto externo)
 */
export function normalizeDate(text) {
  if (!text) return null;
  
  const input = String(text).toLowerCase().trim();
  
  // ═══════════════════════════════════════════════════════════════════════════
  // NUEVO: Rechazar textos que claramente NO son fechas
  // ═══════════════════════════════════════════════════════════════════════════
  
  // Si tiene más de 8 palabras, probablemente no es una fecha
  const wordCount = input.split(/\s+/).length;
  if (wordCount > 8) {
    return null;
  }
  
  // Patrones que indican que NO es una fecha
  const nonDatePatterns = [
    /\b(cuando|cuándo)\s+(tienes?|hay|tienen|puedo)/i,  // "cuando tienes disponibilidad"
    /\bpuedo\s+(hablar|pedir|ordenar)/i,               // "puedo hablar con..."
    /\b(humano|persona|agente|alguien)\b/i,            // solicitud de humano
    /\b(quiero|quisiera)\s+saber\b/i,                  // "quiero saber..."
    /\b(cancelar?|cancela|ya\s+no|no\s+quiero)\b/i,    // cancelaciones
    /\b(ayuda|help|auxilio)\b/i,                       // solicitud de ayuda
    /\b(gracias|adios|adiós|bye|chao)\b/i,             // despedidas
    /\?$/,                                              // termina en pregunta
    /\b(que|qué|como|cómo|donde|dónde|cual|cuál)\b.*\?/i, // preguntas
  ];
  
  for (const pattern of nonDatePatterns) {
    if (pattern.test(input)) {
      return null;  // Definitivamente no es una fecha
    }
  }
  
  // Si contiene más de 3 verbos conjugados, probablemente es una oración, no fecha
  const verbPatterns = /\b(quiero|puedo|tienes|tienen|hay|es|son|esta|están|saber|hablar|pedir)\b/gi;
  const verbMatches = input.match(verbPatterns);
  if (verbMatches && verbMatches.length > 2) {
    return null;
  }
  
  // Caso especial: formato DD/MM o DD-MM
  const slashMatch = input.match(/(\d{1,2})[\/\-](\d{1,2})/);
  if (slashMatch) {
    const day = parseInt(slashMatch[1], 10);
    const monthNum = parseInt(slashMatch[2], 10);
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 
                    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    if (monthNum >= 1 && monthNum <= 12 && day >= 1 && day <= 31) {
      const month = months[monthNum - 1];
      return {
        day,
        month,
        normalized: `${month}-${String(day).padStart(2, '0')}`,
        confidence: 0.9
      };
    }
  }
  
  // Tokenizar y buscar día y mes
  const tokens = input.split(/[\s,]+/).filter(t => t && t !== 'de' && t !== 'del' && t !== 'el' && t !== 'para');
  
  let day = null;
  let month = null;
  
  for (const token of tokens) {
    // Intentar extraer día
    if (!day) {
      const num = extractNumber(token);
      if (num) day = num;
    }
    
    // Intentar extraer mes
    if (!month) {
      const m = fuzzyMatchMonth(token);
      if (m) month = m;
    }
  }
  
  // Si encontramos ambos, retornar normalizado
  if (day && month) {
    return {
      day,
      month,
      normalized: `${month}-${String(day).padStart(2, '0')}`,
      confidence: 0.85
    };
  }
  
  // NUEVO: Si solo encontramos día, ser MUY conservador
  // Solo asumir si el mensaje es CORTO y SOLO contiene el día
  if (day && !month) {
    // El mensaje debe ser muy corto para asumir (solo el número)
    const cleanInput = input.replace(/[^\w\s]/g, '').trim();
    const words = cleanInput.split(/\s+/).filter(w => w.length > 0);
    
    // Solo asumir si es literalmente solo el número o "el X"
    if (words.length <= 2) {
      const currentMonth = new Date().getMonth();
      if (currentMonth === 11 || currentMonth === 0) { // dic o ene
        month = 'enero';
        return {
          day,
          month,
          normalized: `${month}-${String(day).padStart(2, '0')}`,
          confidence: 0.5,  // REDUCIDO de 0.7 a 0.5
          assumed_month: true
        };
      }
    }
    // Si hay más palabras, NO asumir - el cliente probablemente no está dando una fecha
  }
  
  return null;
}

/**
 * Intenta hacer match de texto libre con una lista de fechas disponibles
 * 
 * @param {string} text - Texto del usuario (ej: "9 de enro")
 * @param {Array} availableDates - Lista de fechas disponibles con {slug, nombre}
 * @returns {object|null} - Fecha que mejor matchea o null
 */
function getIsoDateInTimeZone(dateObj, timeZone) {
  try {
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return fmt.format(d); // YYYY-MM-DD (en-CA)
  } catch {
    // Fallback: local ISO date
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
  }
}

function spanishMonthNameFromNumber(monthNum) {
  const MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];
  const idx = Number(monthNum) - 1;
  return idx >= 0 && idx < MONTHS.length ? MONTHS[idx] : null;
}

function isoToSpanishDayMonth(iso) {
  const m = String(iso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const month = spanishMonthNameFromNumber(m[2]);
  const dayNum = parseInt(m[3], 10);
  if (!month || !Number.isFinite(dayNum)) return null;
  return `${dayNum} de ${month}`;
}

function resolveRelativeIsoFromText(textRaw, { now = new Date(), timeZone = null } = {}) {
  const t = String(textRaw || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();

  let offsetDays = null;
  if (/\b(hoy|para hoy|hoy mismo)\b/.test(t)) offsetDays = 0;
  if (/\b(manana|para manana)\b/.test(t)) offsetDays = 1;
  if (/\b(pasado\s+manana|pasado\s+manana)\b/.test(t)) offsetDays = 2;

  if (offsetDays == null) {
    // Weekday support: "este viernes", "el sabado", "domingo"...
    const weekdayMap = {
      domingo: 0,
      lunes: 1,
      martes: 2,
      miercoles: 3,
      jueves: 4,
      viernes: 5,
      sabado: 6,
    };
    const m = t.match(/\b(?:este|el)?\s*(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\b/);
    if (m) {
      const target = weekdayMap[m[1]];
      if (Number.isFinite(target)) {
        // Determine "today" weekday in the given timezone
        const weekdayStr = new Intl.DateTimeFormat("en-US", {
          timeZone: timeZone || undefined,
          weekday: "short",
        }).format(now);
        const todayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
        const today = todayMap[weekdayStr] ?? null;
        if (today != null) {
          let diff = target - today;
          if (diff < 0) diff += 7;
          offsetDays = diff;
        }
      }
    }
  }

  if (offsetDays == null) return null;

  // Base ISO date in target timezone
  const baseIso = getIsoDateInTimeZone(now, timeZone);
  const m2 = String(baseIso || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m2) return null;
  const y = parseInt(m2[1], 10);
  const mo = parseInt(m2[2], 10);
  const d = parseInt(m2[3], 10);
  if (![y, mo, d].every(Number.isFinite)) return null;

  // Use noon UTC to avoid DST edge cases when adding days.
  const base = new Date(Date.UTC(y, mo - 1, d, 12, 0, 0));
  const targetDate = new Date(base.getTime() + offsetDays * 86400000);
  return getIsoDateInTimeZone(targetDate, timeZone);
}

export function matchDateFromText(text, availableDates = [], opts = {}) {
  if (!text || !Array.isArray(availableDates) || !availableDates.length) {
    return null;
  }

  const normalizePlain = (s) =>
    String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const inputRaw = String(text || "");
  const input = normalizePlain(inputRaw);

  const MONTHS = [
    "enero",
    "febrero",
    "marzo",
    "abril",
    "mayo",
    "junio",
    "julio",
    "agosto",
    "septiembre",
    "octubre",
    "noviembre",
    "diciembre",
  ];

  const MONTH_ABBREV = {
    enero: ["ene", "ener"],
    febrero: ["feb"],
    marzo: ["mar"],
    abril: ["abr"],
    mayo: ["may"],
    junio: ["jun"],
    julio: ["jul"],
    agosto: ["ago"],
    septiembre: ["sep", "set", "sept"],
    octubre: ["oct"],
    noviembre: ["nov"],
    diciembre: ["dic"],
  };

  // Relative date support (hoy/mañana/este viernes...).
  const relIso = resolveRelativeIsoFromText(inputRaw, {
    now: opts?.now || new Date(),
    timeZone: opts?.timeZone || null,
  });

  // If relative date is detected, convert to a Spanish day/month string so the
  // rest of the matching logic (which is month-name based) can work.
  const normalized = normalizeDate(relIso ? (isoToSpanishDayMonth(relIso) || inputRaw) : inputRaw);

  // ──────────────────────────────────────────────────────────────────────────
  // If we could not normalize, fallback to a permissive substring match against
  // "nombre" and "slug" (still accent-insensitive).
  // ──────────────────────────────────────────────────────────────────────────
  if (!normalized) {
    for (const date of availableDates) {
      const nombre = normalizePlain(date?.nombre || date?.label || date?.fecha || date?.slug || "");
      const slug = normalizePlain(date?.slug || "");
      if (!input) continue;
      if (nombre.includes(input) || input.includes(nombre) || slug.includes(input) || input.includes(slug)) {
        return date;
      }
    }
    return null;
  }

  const expectedMonthIdx = MONTHS.indexOf(normalized.month);
  const expectedMonthNum = expectedMonthIdx >= 0 ? expectedMonthIdx + 1 : null;
  const expectedDayNum = Number(normalized.day);

  let best = null;
  let bestScore = 0;

  for (const date of availableDates) {
    const slugRaw = String(date?.slug || "").toLowerCase();
    const slug = normalizePlain(slugRaw);
    const nombre = normalizePlain(date?.nombre || date?.label || date?.fecha || "");
    const fechaIso = String(date?.fecha_iso || date?.iso || "").trim();

    let score = 0;

    // 1) Strong match: normalized "enero-09" appears in slug (legacy format)
    if (slug === normalized.normalized || slug.includes(normalized.normalized)) {
      score = Math.max(score, Math.min(1, (normalized.confidence || 0.8) + 0.1));
    }

    // 2) Strong match: ISO slug like "2026-01-09"
    const isoMatch = slugRaw.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if (isoMatch) {
      const m = parseInt(isoMatch[2], 10);
      const d = parseInt(isoMatch[3], 10);
      if (Number.isFinite(d) && d === expectedDayNum) {
        if (expectedMonthNum && Number.isFinite(m) && m === expectedMonthNum) {
          score = Math.max(score, Math.max(normalized.confidence || 0.85, 0.92));
        } else {
          // Day matches but month does not: keep low.
          score = Math.max(score, Math.min(0.6, (normalized.confidence || 0.85) * 0.7));
        }
      }
    }

    // 3) Match by readable name: day + month name/abbrev
    const monthTokens = [normalized.month, ...((MONTH_ABBREV[normalized.month] || []))].filter(Boolean);
    if (nombre && nombre.includes(String(expectedDayNum)) && monthTokens.some((tok) => tok && nombre.includes(tok))) {
      score = Math.max(score, Math.max(normalized.confidence || 0.85, 0.85));
    }

    // 4) Match by "MM-DD" inside slug (no year)
    if (expectedMonthNum) {
      const mm = String(expectedMonthNum).padStart(2, "0");
      const dd = String(expectedDayNum).padStart(2, "0");
      if (slugRaw.includes(`${mm}-${dd}`) || slugRaw.includes(`${mm}/${dd}`)) {
        score = Math.max(score, Math.max(normalized.confidence || 0.85, 0.9));
      }
    }

    // 5) Last resort: match by day only inside slug (avoid rejecting valid dates)
    //    We keep a medium score; the caller can apply a MIN confidence threshold.
    const dd2 = String(expectedDayNum).padStart(2, "0");
    if (slugRaw.includes(`-${dd2}`) || slugRaw.endsWith(`/${dd2}`) || slugRaw.endsWith(`-${dd2}`)) {
      score = Math.max(score, Math.max((normalized.confidence || 0.85) * 0.9, 0.65));
    }

    // 6) Direct match against explicit ISO field (if provided by backend)
    if (relIso && fechaIso && fechaIso.startsWith(relIso)) {
      score = Math.max(score, 0.96);
    }

    if (score > bestScore) {
      bestScore = score;
      best = { ...date, match_confidence: score };
    }
  }

  return bestScore > 0 ? best : null;
}


export default {
  normalizeDate,
  matchDateFromText,
  fuzzyMatchMonth,
  extractNumber
};
