import { Pool } from "pg";
import fs from "fs";
import path from "path";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { getPoolConfig } from "./poolConfig.js";

let pool = null;

// In-memory fallback for local dev
const mem = {
  beacons: new Map(), // beacon_id -> beacon
  instructions: [],   // array
  inventoryShadow: new Map(), // `${location_id}:${sku}` -> record
  virtualStockBlocks: new Map(), // `${batch_id}:${sku}:${location_id}` -> record
  systemRecommendations: [], // array
  chatwootFlows: new Map(), // conversation_id -> { state, updated_at_ms, expires_at_ms }
};

function ensurePool() {
  if (!config.databaseUrl) return null;
  if (pool) return pool;
  
  pool = new Pool(getPoolConfig(config.databaseUrl));
  pool.on("error", (err) => logger.error({ err }, "Postgres pool error"));
  
  return pool;
}

// Initialize database schema (idempotent). If DATABASE_URL is not set, this is a no-op.
export async function initDb() {
  const p = ensurePool();
  if (!p) {
    logger.warn("DATABASE_URL not set. Using in-memory storage for beacons/instructions.");
    return { ok: true, storage: "memory" };
  }

  const __dirname = path.dirname(new URL(import.meta.url).pathname);
  const schemaPath = path.join(__dirname, "schema.sql");
  const ddl = fs.readFileSync(schemaPath, "utf-8");

  // Very small SQL splitter: good enough for our schema.sql (no $$ blocks).
  const statements = ddl
    .split(/;\s*\n/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s.endsWith(";") ? s : s + ";"));

  for (const stmt of statements) {
    await p.query(stmt);
  }

  logger.info("Postgres schema ensured.");
  return { ok: true, storage: "postgres" };
}

// ==== BEACONS ====

export async function saveBeacon(beacon) {
  const p = ensurePool();
  if (!p) {
    mem.beacons.set(beacon.beacon_id, beacon);
    return { stored: "memory" };
  }

  await p.query(
    `INSERT INTO beacons_log (beacon_id, timestamp_iso, signal_source, location_id, actor_role, payload)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (beacon_id) DO NOTHING`,
    [
      beacon.beacon_id,
      beacon.timestamp_iso,
      beacon.signal_source,
      beacon.location_id,
      beacon?.actor?.role || null,
      beacon,
    ],
  );
  return { stored: "postgres" };
}

// ==== INSTRUCTIONS ====

export async function saveInstruction(instruction) {
  const p = ensurePool();
  if (!p) {
    mem.instructions.push({ ...instruction, status: "PENDING" });
    return { stored: "memory" };
  }

  await p.query(
    `INSERT INTO ops_instructions (instruction_id, beacon_id, created_at_iso, target_app, location_id, priority, message, payload, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PENDING')
     ON CONFLICT (instruction_id) DO NOTHING`,
    [
      instruction.instruction_id,
      instruction.beacon_id,
      instruction.created_at_iso,
      instruction.target.app,
      instruction.target.location_id,
      instruction.priority,
      instruction.message,
      instruction,
    ],
  );
  return { stored: "postgres" };
}

export async function listPendingInstructions({ target_app, location_id, limit = 25 }) {
  const p = ensurePool();
  if (!p) {
    return mem.instructions
      .filter(x => x.status === "PENDING")
      .filter(x => (!target_app || x.target?.app === target_app))
      .filter(x => (!location_id || x.target?.location_id === location_id))
      .slice(0, limit);
  }

  const res = await p.query(
    `SELECT payload
       FROM ops_instructions
      WHERE status='PENDING'
        AND ($1::text IS NULL OR target_app=$1)
        AND ($2::text IS NULL OR location_id=$2)
      ORDER BY created_at_iso ASC
      LIMIT $3`,
    [target_app || null, location_id || null, limit],
  );

  return res.rows.map(r => r.payload);
}

export async function listInstructions({ sinceIso = null, status = null, target_app = null, location_id = null, limit = 50 } = {}) {
  const p = ensurePool();
  if (!p) {
    return mem.instructions
      .filter(x => (!sinceIso || new Date(x.created_at_iso).getTime() >= new Date(sinceIso).getTime()))
      .filter(x => (!status || x.status === status))
      .filter(x => (!target_app || x.target?.app === target_app))
      .filter(x => (!location_id || x.target?.location_id === location_id))
      .slice(0, limit);
  }

  const res = await p.query(
    `SELECT status, payload, resolved_by, resolution_beacon_id
       FROM ops_instructions
      WHERE ($1::timestamptz IS NULL OR (created_at_iso)::timestamptz >= $1::timestamptz)
        AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR target_app = $3)
        AND ($4::text IS NULL OR location_id = $4)
      ORDER BY (created_at_iso)::timestamptz DESC
      LIMIT $5`,
    [sinceIso, status, target_app, location_id, limit],
  );

  return res.rows.map(r => ({
    ...r.payload,
    status: r.status,
    resolved_by: r.resolved_by,
    resolution_beacon_id: r.resolution_beacon_id,
  }));
}

export async function updateInstructionStatus({ instruction_id, status, resolved_by, resolution_beacon_id }) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const idx = mem.instructions.findIndex(x => x.instruction_id === instruction_id);
    if (idx >= 0) {
      mem.instructions[idx].status = status;
      mem.instructions[idx].resolved_by = resolved_by;
      mem.instructions[idx].resolution_beacon_id = resolution_beacon_id;
    }
    return { updated: "memory", found: idx >= 0 };
  }

  const result = await p.query(`
    UPDATE ops_instructions
    SET status = $2, 
        resolved_by = $3,
        resolution_beacon_id = $4,
        payload = jsonb_set(
          jsonb_set(
            COALESCE(payload, '{}'::jsonb), 
            '{resolved_by}', 
            to_jsonb($3::text)
          ),
          '{resolution_beacon_id}', 
          to_jsonb($4::text)
        )
    WHERE instruction_id = $1
    RETURNING instruction_id
  `, [instruction_id, status, resolved_by || null, resolution_beacon_id || null]);

  return { updated: "postgres", found: result.rowCount > 0 };
}

// ==== SHADOW INVENTORY (T2) ====

export async function reserveShadowInventory({ location_id, sku, qty, expires_at, beacon_id, reason, reserved_by }) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const key = `${location_id}:${sku}`;
    const existing = mem.inventoryShadow.get(key) || { location_id, sku, qty_reserved: 0 };
    existing.qty_reserved += qty;
    existing.expires_at = expires_at || existing.expires_at;
    existing.beacon_id = beacon_id;
    existing.reason = reason;
    existing.reserved_by = reserved_by;
    existing.updated_at = new Date().toISOString();
    mem.inventoryShadow.set(key, existing);
    logger.info({ location_id, sku, qty, reason }, "reserveShadowInventory (memory)");
    return { reserved: true, record: existing, storage: "memory" };
  }

  const query = `
    INSERT INTO inventory_shadow (location_id, sku, qty_reserved, expires_at, beacon_id, reason, reserved_by, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (location_id, sku) 
    DO UPDATE SET 
      qty_reserved = inventory_shadow.qty_reserved + EXCLUDED.qty_reserved,
      expires_at = COALESCE(EXCLUDED.expires_at, inventory_shadow.expires_at),
      beacon_id = EXCLUDED.beacon_id,
      reason = EXCLUDED.reason,
      reserved_by = EXCLUDED.reserved_by,
      updated_at = NOW()
    RETURNING *;
  `;

  const res = await p.query(query, [location_id, sku, qty, expires_at || null, beacon_id || null, reason || null, reserved_by || null]);
  logger.info({ location_id, sku, qty, reason }, "reserveShadowInventory (postgres)");
  return { reserved: true, record: res.rows[0], storage: "postgres" };
}

export async function releaseShadowInventory({ location_id, sku, qty, beacon_id, reason }) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const key = `${location_id}:${sku}`;
    const existing = mem.inventoryShadow.get(key);
    if (existing) {
      existing.qty_reserved = Math.max(0, existing.qty_reserved - qty);
      existing.beacon_id = beacon_id;
      existing.reason = reason;
      existing.updated_at = new Date().toISOString();
    }
    logger.info({ location_id, sku, qty, reason }, "releaseShadowInventory (memory)");
    return { released: true, storage: "memory" };
  }

  const query = `
    UPDATE inventory_shadow 
    SET qty_reserved = GREATEST(0, qty_reserved - $3),
        beacon_id = $4,
        reason = $5,
        updated_at = NOW()
    WHERE location_id = $1 AND sku = $2
    RETURNING *;
  `;

  const res = await p.query(query, [location_id, sku, qty, beacon_id || null, reason || null]);
  logger.info({ location_id, sku, qty, reason }, "releaseShadowInventory (postgres)");
  return { released: true, record: res.rows[0], storage: "postgres" };
}

export async function getShadowInventory({ location_id, sku }) {
  const p = ensurePool();
  if (!p) {
    const key = `${location_id}:${sku}`;
    return mem.inventoryShadow.get(key) || null;
  }

  const res = await p.query(
    `SELECT * FROM inventory_shadow WHERE location_id = $1 AND sku = $2`,
    [location_id, sku]
  );
  return res.rows[0] || null;
}

// ==== VIRTUAL STOCK BLOCKS (QA) ====

export async function blockVirtualStockBatch({ batch_id, sku, location_id, qty, reason, blocked_by, beacon_id }) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const key = `${batch_id}:${sku}:${location_id}`;
    const record = {
      batch_id,
      sku,
      location_id,
      qty_blocked: qty || 0,
      reason,
      blocked_by,
      beacon_id,
      status: "ACTIVE",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    mem.virtualStockBlocks.set(key, record);
    logger.warn({ batch_id, sku, location_id, reason }, "blockVirtualStockBatch (memory)");
    return { blocked: true, record, storage: "memory" };
  }

  const query = `
    INSERT INTO virtual_stock_blocks (batch_id, sku, location_id, qty_blocked, reason, blocked_by, beacon_id, updated_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    ON CONFLICT (batch_id, sku, location_id)
    DO UPDATE SET
      qty_blocked = EXCLUDED.qty_blocked,
      reason = EXCLUDED.reason,
      blocked_by = EXCLUDED.blocked_by,
      beacon_id = EXCLUDED.beacon_id,
      status = 'ACTIVE',
      updated_at = NOW()
    RETURNING *;
  `;

  const res = await p.query(query, [batch_id, sku, location_id, qty || 0, reason || null, blocked_by || null, beacon_id || null]);
  logger.warn({ batch_id, sku, location_id, reason }, "blockVirtualStockBatch (postgres)");
  return { blocked: true, record: res.rows[0], storage: "postgres" };
}

export async function releaseVirtualStockBlock({ batch_id, sku, location_id, reason }) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const key = `${batch_id}:${sku}:${location_id}`;
    const existing = mem.virtualStockBlocks.get(key);
    if (existing && existing.status === "ACTIVE") {
      existing.status = "RELEASED";
      existing.reason = reason;
      existing.updated_at = new Date().toISOString();
    }
    logger.info({ batch_id, sku, location_id, reason }, "releaseVirtualStockBlock (memory)");
    return { released: true, storage: "memory" };
  }

  await p.query(`
    UPDATE virtual_stock_blocks
    SET status = 'RELEASED', reason = $4, updated_at = NOW()
    WHERE batch_id = $1 AND sku = $2 AND location_id = $3 AND status = 'ACTIVE'
  `, [batch_id, sku, location_id, reason || null]);

  logger.info({ batch_id, sku, location_id, reason }, "releaseVirtualStockBlock (postgres)");
  return { released: true, storage: "postgres" };
}

export async function writeOffVirtualStockBlock({ batch_id, sku, location_id, reason }) {
  const p = ensurePool();
  if (!p) {
    const key = `${batch_id}:${sku}:${location_id}`;
    const existing = mem.virtualStockBlocks.get(key);
    if (existing && existing.status === "ACTIVE") {
      existing.status = "WRITTEN_OFF";
      existing.reason = reason;
      existing.updated_at = new Date().toISOString();
    }
    logger.info({ batch_id, sku, location_id, reason }, "writeOffVirtualStockBlock (memory)");
    return { written_off: true, storage: "memory" };
  }

  await p.query(`
    UPDATE virtual_stock_blocks
    SET status = 'WRITTEN_OFF', reason = $4, updated_at = NOW()
    WHERE batch_id = $1 AND sku = $2 AND location_id = $3 AND status = 'ACTIVE'
  `, [batch_id, sku, location_id, reason || null]);

  logger.info({ batch_id, sku, location_id, reason }, "writeOffVirtualStockBlock (postgres)");
  return { written_off: true, storage: "postgres" };
}

export async function getActiveBlocksForLocation(location_id) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const results = [];
    for (const [key, record] of mem.virtualStockBlocks) {
      if (record.location_id === location_id && record.status === "ACTIVE") {
        results.push(record);
      }
    }
    return results;
  }

  const res = await p.query(`
    SELECT * FROM virtual_stock_blocks
    WHERE location_id = $1 AND status = 'ACTIVE'
    ORDER BY created_at DESC
  `, [location_id]);

  return res.rows;
}

export async function getVirtualStockBlock({ batch_id, sku, location_id }) {
  const p = ensurePool();
  if (!p) {
    const key = `${batch_id}:${sku}:${location_id}`;
    return mem.virtualStockBlocks.get(key) || null;
  }

  const res = await p.query(`
    SELECT * FROM virtual_stock_blocks
    WHERE batch_id = $1 AND sku = $2 AND location_id = $3
  `, [batch_id, sku, location_id]);

  return res.rows[0] || null;
}



export async function getBeaconSourceCounts(days = 7) {
  const p = ensurePool();
  if (!p) {
    // Memory fallback
    const counts = new Map();
    const cutoff = Date.now() - Math.max(0, Number(days)) * 24 * 60 * 60 * 1000;
    for (const b of mem.beacons.values()) {
      const ts = Date.parse(b.timestamp_iso || b.created_at_iso || "");
      if (Number.isFinite(ts) && ts < cutoff) continue;
      const src = String(b.signal_source || "UNKNOWN");
      counts.set(src, (counts.get(src) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([signal_source, count]) => ({ signal_source, count }))
      .sort((a, b) => b.count - a.count);
  }

  const res = await p.query(
    `SELECT signal_source, COUNT(*)::int AS count
       FROM beacons_log
      WHERE timestamp_iso > NOW() - ($1 || ' days')::interval
      GROUP BY 1
      ORDER BY count DESC`,
    [String(days)],
  );
  return res.rows;
}

// ==== SYSTEM RECOMMENDATIONS ====
export async function saveSystemRecommendation(rec) {
  const p = ensurePool();
  if (!p) {
    const row = {
      id: mem.systemRecommendations.length + 1,
      created_at: new Date().toISOString(),
      ...rec,
    };
    mem.systemRecommendations.unshift(row);
    return row;
  }

  const { component = "kiss-api", title, risk_level, confidence, model_used = null, response_id = null, payload } = rec;
  const q = `
    INSERT INTO system_recommendations (component, title, risk_level, confidence, model_used, response_id, payload)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    RETURNING id, created_at
  `;
  const vals = [component, title, risk_level, confidence, model_used, response_id, payload];
  const { rows } = await p.query(q, vals);
  return rows[0];
}

export async function listSystemRecommendations(limit = 20) {
  const p = ensurePool();
  if (!p) {
    return mem.systemRecommendations.slice(0, limit);
  }

  const q = `
    SELECT id, created_at, component, title, risk_level, confidence, model_used, response_id, payload
    FROM system_recommendations
    ORDER BY created_at DESC
    LIMIT $1
  `;
  const { rows } = await p.query(q, [limit]);
  return rows;
}

// Convenience for debugging: fetch a beacon by id
export async function getBeaconById(beacon_id) {
  const p = ensurePool();
  if (!p) {
    return mem.beacons.get(beacon_id) || null;
  }

  const { rows } = await p.query(
    `SELECT beacon_id, payload, created_at
       FROM beacons_log
      WHERE beacon_id=$1`,
    [beacon_id],
  );
  return rows[0] || null;
}

export async function getInstruction(instruction_id) {
  const p = ensurePool();
  if (!p) {
    return mem.instructions.find((x) => x.instruction_id === instruction_id) || null;
  }

  const q = `
    SELECT status, resolved_by, resolution_beacon_id, payload
      FROM ops_instructions
     WHERE instruction_id = $1
     LIMIT 1
  `;
  const { rows } = await p.query(q, [instruction_id]);
  if (!rows.length) return null;
  const r = rows[0];
  return {
    ...r.payload,
    status: r.status,
    resolved_by: r.resolved_by,
    resolution_beacon_id: r.resolution_beacon_id,
  };
}

// ==== CHATWOOT FLOWS (Structured conversation state) ====

/**
 * Guarda (upsert) el estado de flujo estructurado por conversation_id.
 *
 * Nota: Esto NO guarda historial (eso lo maneja agentic_flow en memoria y/o Chatwoot).
 * Aquí sólo persistimos el state machine (ORDER_CREATE, STATUS, etc.) para
 * evitar pérdida de contexto por reinicios.
 */
export async function upsertChatwootFlow({ conversation_id, state, ttl_ms } = {}) {
  const conversationId = String(conversation_id || '').trim();
  if (!conversationId) return { stored: false, storage: 'none' };

  const nowMs = Date.now();
  const ttl = Number(ttl_ms) > 0 ? Number(ttl_ms) : null;
  const expiresAtMs = ttl ? nowMs + ttl : null;

  const p = ensurePool();
  if (!p) {
    mem.chatwootFlows.set(conversationId, {
      state,
      updated_at_ms: nowMs,
      expires_at_ms: expiresAtMs,
    });
    return { stored: true, storage: 'memory' };
  }

  const expiresAtIso = expiresAtMs ? new Date(expiresAtMs).toISOString() : null;
  await p.query(
    `INSERT INTO chatwoot_flows (conversation_id, state, updated_at, expires_at)
     VALUES ($1, $2, NOW(), $3)
     ON CONFLICT (conversation_id)
     DO UPDATE SET state = EXCLUDED.state, updated_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [conversationId, state, expiresAtIso]
  );
  return { stored: true, storage: 'postgres' };
}

/**
 * Lee el estado de flujo estructurado por conversation_id.
 * Devuelve null si no existe o si está expirado.
 */
export async function getChatwootFlow(conversation_id) {
  const conversationId = String(conversation_id || '').trim();
  if (!conversationId) return null;

  const nowMs = Date.now();

  const p = ensurePool();
  if (!p) {
    const entry = mem.chatwootFlows.get(conversationId);
    if (!entry) return null;
    if (entry.expires_at_ms && entry.expires_at_ms <= nowMs) {
      mem.chatwootFlows.delete(conversationId);
      return null;
    }
    return entry.state || null;
  }

  const { rows } = await p.query(
    `SELECT state, expires_at
       FROM chatwoot_flows
      WHERE conversation_id = $1
      LIMIT 1`,
    [conversationId]
  );

  if (!rows.length) return null;
  const r = rows[0];
  const expiresAt = r.expires_at ? new Date(r.expires_at).getTime() : null;
  if (expiresAt && expiresAt <= nowMs) {
    // Clean up expired rows.
    await p.query(`DELETE FROM chatwoot_flows WHERE conversation_id = $1`, [conversationId]);
    return null;
  }
  return r.state || null;
}

/**
 * Elimina el estado de flujo de una conversación.
 */
export async function deleteChatwootFlow(conversation_id) {
  const conversationId = String(conversation_id || '').trim();
  if (!conversationId) return { deleted: false, storage: 'none' };

  const p = ensurePool();
  if (!p) {
    const existed = mem.chatwootFlows.delete(conversationId);
    return { deleted: existed, storage: 'memory' };
  }

  const res = await p.query(`DELETE FROM chatwoot_flows WHERE conversation_id = $1`, [conversationId]);
  return { deleted: res.rowCount > 0, storage: 'postgres' };
}

/**
 * Obtiene el pool de conexiones de PostgreSQL
 * Útil para otros módulos que necesitan acceso directo a la DB
 */
export function getPool() {
  return ensurePool();
}
