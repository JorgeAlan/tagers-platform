-- Tagers KISS Production API - Postgres schema (v3)
-- Run this once in your Postgres database.

-- ==== BEACONS LOG ====
CREATE TABLE IF NOT EXISTS beacons_log (
  id BIGSERIAL PRIMARY KEY,
  beacon_id TEXT UNIQUE NOT NULL,
  timestamp_iso TIMESTAMPTZ NOT NULL,
  signal_source TEXT NOT NULL,
  location_id TEXT NOT NULL,
  actor_role TEXT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_beacons_log_ts ON beacons_log (timestamp_iso DESC);
CREATE INDEX IF NOT EXISTS idx_beacons_log_location ON beacons_log (location_id);

-- ==== INVENTORY SHADOW (T2) ====
-- Used for VIP reservations and temporary holds
CREATE TABLE IF NOT EXISTS inventory_shadow (
  id BIGSERIAL PRIMARY KEY,
  location_id VARCHAR(64) NOT NULL,
  sku VARCHAR(64) NOT NULL,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ,
  beacon_id VARCHAR(128),
  reason VARCHAR(255),
  reserved_by VARCHAR(64),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (location_id, sku)
);

CREATE INDEX IF NOT EXISTS idx_inventory_shadow_expires ON inventory_shadow(expires_at);
CREATE INDEX IF NOT EXISTS idx_inventory_shadow_location ON inventory_shadow(location_id);

-- ==== VIRTUAL STOCK BLOCKS (QA rejections) ====
-- Used when QA rejects a batch - blocks stock from being sold
CREATE TABLE IF NOT EXISTS virtual_stock_blocks (
  id BIGSERIAL PRIMARY KEY,
  batch_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  location_id TEXT NOT NULL,
  qty_blocked INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  blocked_by TEXT,
  beacon_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE, RELEASED, WRITTEN_OFF
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(batch_id, sku, location_id)
);

CREATE INDEX IF NOT EXISTS idx_vsb_active ON virtual_stock_blocks(status, location_id);
CREATE INDEX IF NOT EXISTS idx_vsb_batch ON virtual_stock_blocks(batch_id);

-- ==== OPS INSTRUCTIONS ====
CREATE TABLE IF NOT EXISTS ops_instructions (
  id BIGSERIAL PRIMARY KEY,
  instruction_id TEXT UNIQUE NOT NULL,
  beacon_id TEXT NOT NULL REFERENCES beacons_log(beacon_id) ON DELETE CASCADE,
  created_at_iso TIMESTAMPTZ NOT NULL,
  target_app TEXT NOT NULL,
  location_id TEXT NOT NULL,
  priority TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, ACKNOWLEDGED, RESOLVED, EXPIRED
  resolved_by TEXT NULL,
  resolution_beacon_id TEXT NULL,
  expires_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_instructions_pending ON ops_instructions (status, created_at_iso);
CREATE INDEX IF NOT EXISTS idx_ops_instructions_target ON ops_instructions (target_app, location_id);


-- ==== SYSTEM RECOMMENDATIONS (Auto code preview) ====
CREATE TABLE IF NOT EXISTS system_recommendations (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  component TEXT NOT NULL DEFAULT 'kiss-api',
  title TEXT NOT NULL,
  risk_level TEXT NOT NULL,
  confidence NUMERIC NOT NULL,
  model_used TEXT NULL,
  response_id TEXT NULL,
  payload JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_recommendations_created ON system_recommendations(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_recommendations_component ON system_recommendations(component);


-- ==== CHATWOOT FLOWS (Conversation state persistence) ====
-- Persist structured flow state (ORDER_CREATE, ORDER_STATUS, etc.) so the bot
-- does not lose context on restarts / multi-replica deployments.
--
-- The payload is owned by the KISS API and may change over time.
CREATE TABLE IF NOT EXISTS chatwoot_flows (
  conversation_id TEXT PRIMARY KEY,
  state JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS idx_chatwoot_flows_expires ON chatwoot_flows(expires_at);
