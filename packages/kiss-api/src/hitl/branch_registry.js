import fs from "fs";
import path from "path";
import { config } from "../config.js";

function resolveConfigPath(relOrAbs) {
  if (!relOrAbs) return null;
  if (path.isAbsolute(relOrAbs)) return relOrAbs;
  // Project root = process.cwd() when running from repo root
  return path.join(process.cwd(), relOrAbs);
}

let _cache = null;

export function loadBranchRegistry() {
  if (_cache) return _cache;
  const p = resolveConfigPath(config.branchesConfigPath);
  if (!p || !fs.existsSync(p)) {
    _cache = { branches: [] };
    return _cache;
  }
  const raw = fs.readFileSync(p, "utf-8");
  _cache = JSON.parse(raw);
  return _cache;
}

export function listBranches() {
  const reg = loadBranchRegistry();
  return (reg.branches || []).map(b => ({
    branch_id: b.branch_id,
    slug: b.slug,
    display_name: b.display_name,
    // Compat con otros módulos que esperan `name`/`nombre`
    name: b.display_name,
    nombre: b.display_name,
    short_name: b.display_name,
    city: b.city,
    ciudad: b.city,
    reservation_provider: b.reservation_provider,
    opentable_url: b.opentable_url,
  }));
}

export function getBranchById(branch_id) {
  const reg = loadBranchRegistry();
  return (reg.branches || []).find(b => (b.branch_id || "").toUpperCase() === (branch_id || "").toUpperCase()) || null;
}

export function matchBranchFromText(text) {
  if (!text) return null;
  const t = String(text).toLowerCase();
  const reg = loadBranchRegistry();
  for (const b of (reg.branches || [])) {
    const synonyms = b.synonyms || [];
    for (const s of synonyms) {
      if (s && t.includes(String(s).toLowerCase())) return b;
    }
  }
  return null;
}

export function getReservationLink(branch_id) {
  const b = getBranchById(branch_id);
  return b?.opentable_url || null;
}
