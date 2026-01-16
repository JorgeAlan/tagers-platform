// Curated, lightweight tourism knowledge base for Puebla.
// This is intentionally limited and safe (no internal ops data).

// Approximate coordinates (WGS84). Use for distance estimation.
// If you need higher accuracy, replace with an authoritative dataset.

export const PUEBLA_TOURISM_SPOTS = [
  {
    id: "catedral_puebla",
    name: "Catedral de Puebla (Zócalo)",
    categories: ["centro", "arquitectura", "historia"],
    short: "Catedral y plaza principal; ideal para una caminata por el Centro Histórico.",
    lat: 19.04142,
    lng: -98.20633,
  },
  {
    id: "capilla_rosario",
    name: "Capilla del Rosario (Templo de Santo Domingo)",
    categories: ["centro", "arte", "historia"],
    short: "Una de las joyas barrocas más famosas de Puebla.",
    lat: 19.04416,
    lng: -98.20187,
  },
  {
    id: "callejon_sapos",
    name: "Callejón de los Sapos",
    categories: ["centro", "mercados", "arte"],
    short: "Zona de antigüedades, artesanías y paseo; muy buen ambiente en fin de semana.",
    lat: 19.03877,
    lng: -98.20696,
  },
  {
    id: "museo_barroco",
    name: "Museo Internacional del Barroco",
    categories: ["museos", "arquitectura"],
    short: "Museo moderno y fotogénico; buen plan si te gusta arquitectura contemporánea.",
    lat: 19.03361,
    lng: -98.25631,
  },
  {
    id: "estrella_puebla",
    name: "Estrella de Puebla",
    categories: ["familia", "miradores"],
    short: "Rueda panorámica con vistas; buen plan por la tarde-noche.",
    lat: 19.03175,
    lng: -98.23437,
  },
  {
    id: "cholula_piramide",
    name: "Gran Pirámide de Cholula y Santuario de los Remedios",
    categories: ["historia", "arqueologia", "cholula"],
    short: "Zona arqueológica + vista; se combina bien con paseo por Cholula.",
    lat: 19.05852,
    lng: -98.30184,
  },
  {
    id: "africam_safari",
    name: "Africam Safari",
    categories: ["familia", "animales"],
    short: "Safari en auto; plan de medio día si vas con familia.",
    lat: 18.95389,
    lng: -98.18038,
  },
];

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

const KEYWORDS = [
  { spot: "catedral_puebla", keys: ["catedral", "zocalo", "zócalo", "centro"] },
  { spot: "capilla_rosario", keys: ["rosario", "santo domingo", "templo", "barroco"] },
  { spot: "callejon_sapos", keys: ["sapos", "antiguedades", "antigüedades", "artesanias", "artesanías"] },
  { spot: "museo_barroco", keys: ["museo barroco", "barroco", "museo"] },
  { spot: "estrella_puebla", keys: ["estrella", "rueda", "panoramica", "panorámica", "angelopolis", "angelópolis"] },
  { spot: "cholula_piramide", keys: ["cholula", "piramide", "pirámide", "remedios"] },
  { spot: "africam_safari", keys: ["africam", "safari", "animales"] },
];

export function retrieveTourismCandidates(queryText, max = 4) {
  const q = norm(queryText);
  const scores = new Map();

  for (const { spot, keys } of KEYWORDS) {
    let score = 0;
    for (const k of keys) {
      if (q.includes(norm(k))) score += 2;
    }
    if (score > 0) scores.set(spot, score);
  }

  // Default suggestions if user is generic ("qué hacer en puebla")
  if (scores.size === 0) {
    const defaults = [
      "catedral_puebla",
      "capilla_rosario",
      "callejon_sapos",
      "cholula_piramide",
    ];
    return defaults
      .map((id) => PUEBLA_TOURISM_SPOTS.find((s) => s.id === id))
      .filter(Boolean)
      .slice(0, max);
  }

  const ranked = Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => PUEBLA_TOURISM_SPOTS.find((s) => s.id === id))
    .filter(Boolean);

  return ranked.slice(0, max);
}

// Haversine distance (km)
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function getBranchCoords(b) {
  if (!b || typeof b !== "object") return null;
  const lat = b?.coords?.lat ?? b?.lat ?? null;
  const lng = b?.coords?.lng ?? b?.lng ?? b?.lon ?? null;
  if (typeof lat === "number" && typeof lng === "number") return { lat, lng };
  const latN = Number(lat);
  const lngN = Number(lng);
  if (Number.isFinite(latN) && Number.isFinite(lngN)) return { lat: latN, lng: lngN };
  return null;
}

export function augmentTourismCandidatesWithNearestBranch(candidates, branches) {
  const brs = Array.isArray(branches) ? branches : [];
  const withCoords = brs
    .map((b) => {
      const c = getBranchCoords(b);
      if (!c) return null;
      return {
        branch_id: b.branch_id || b.id || null,
        name: b.display_name || b.nombre || b.name || b.branch_id || null,
        lat: c.lat,
        lng: c.lng,
      };
    })
    .filter(Boolean);

  if (!withCoords.length) return candidates;

  return (candidates || []).map((spot) => {
    if (!spot || typeof spot !== "object") return spot;
    if (typeof spot.lat !== "number" || typeof spot.lng !== "number") return spot;

    let best = null;
    for (const b of withCoords) {
      const d = haversineKm(spot.lat, spot.lng, b.lat, b.lng);
      if (!best || d < best.distance_km) {
        best = { branch_id: b.branch_id, name: b.name, distance_km: d };
      }
    }

    if (!best) return spot;
    return {
      ...spot,
      nearest_branch_id: best.branch_id,
      nearest_branch_name: best.name,
      distance_to_nearest_branch_km: Math.round(best.distance_km * 10) / 10,
    };
  });
}
