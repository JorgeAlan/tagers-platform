-- ═══════════════════════════════════════════════════════════════════════════
-- LUCA SCHEMA - Initial Migration (Simplified - No PL/pgSQL functions)
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- IDs (case_id, alert_id, action_id) are generated from JavaScript code
-- to avoid PL/pgSQL parsing issues with the migration system.
-- 
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- CASES - Investigaciones
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_cases (
  id SERIAL PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE,
  case_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  state TEXT NOT NULL DEFAULT 'OPEN',
  title TEXT NOT NULL,
  description TEXT,
  scope JSONB DEFAULT '{}',
  evidence JSONB DEFAULT '[]',
  hypotheses JSONB DEFAULT '[]',
  diagnosis JSONB DEFAULT NULL,
  recommended_actions JSONB DEFAULT '[]',
  outcome JSONB DEFAULT NULL,
  source TEXT,
  detector_id TEXT,
  run_id TEXT,
  playbook_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_luca_cases_state ON luca_cases(state);

CREATE INDEX IF NOT EXISTS idx_luca_cases_type ON luca_cases(case_type);

CREATE INDEX IF NOT EXISTS idx_luca_cases_severity ON luca_cases(severity);

CREATE INDEX IF NOT EXISTS idx_luca_cases_created ON luca_cases(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTS - Alertas
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_alerts (
  id SERIAL PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  title TEXT NOT NULL,
  message TEXT,
  branch_id TEXT,
  fingerprint TEXT,
  notifications_sent JSONB DEFAULT '[]',
  resolution TEXT,
  case_id TEXT REFERENCES luca_cases(case_id),
  source TEXT,
  detector_id TEXT,
  run_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  acked_at TIMESTAMPTZ,
  acked_by TEXT,
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_luca_alerts_state ON luca_alerts(state);

CREATE INDEX IF NOT EXISTS idx_luca_alerts_severity ON luca_alerts(severity);

CREATE INDEX IF NOT EXISTS idx_luca_alerts_branch ON luca_alerts(branch_id);

CREATE INDEX IF NOT EXISTS idx_luca_alerts_fingerprint ON luca_alerts(fingerprint);

CREATE INDEX IF NOT EXISTS idx_luca_alerts_created ON luca_alerts(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ACTIONS - Acciones propuestas/ejecutadas
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_actions (
  id SERIAL PRIMARY KEY,
  action_id TEXT NOT NULL UNIQUE,
  action_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  title TEXT NOT NULL,
  description TEXT,
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  requires_approval BOOLEAN DEFAULT TRUE,
  approval_level TEXT DEFAULT 'APPROVAL',
  params JSONB DEFAULT '{}',
  expected_impact JSONB DEFAULT '{}',
  execution_result JSONB DEFAULT NULL,
  actual_impact JSONB DEFAULT NULL,
  case_id TEXT REFERENCES luca_cases(case_id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT,
  rejected_at TIMESTAMPTZ,
  rejected_by TEXT,
  rejection_reason TEXT,
  executed_at TIMESTAMPTZ,
  executed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_luca_actions_state ON luca_actions(state);

CREATE INDEX IF NOT EXISTS idx_luca_actions_case ON luca_actions(case_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- MEMORY - Memoria episódica
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_memory_episodes (
  id SERIAL PRIMARY KEY,
  episode_id TEXT NOT NULL UNIQUE,
  episode_type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  content JSONB DEFAULT '{}',
  tags TEXT[] DEFAULT '{}',
  case_id TEXT,
  branch_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_luca_memory_type ON luca_memory_episodes(episode_type);

CREATE INDEX IF NOT EXISTS idx_luca_memory_tags ON luca_memory_episodes USING GIN(tags);

CREATE INDEX IF NOT EXISTS idx_luca_memory_branch ON luca_memory_episodes(branch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- PLAYBOOKS - Reglas de acción automática
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_playbooks (
  id SERIAL PRIMARY KEY,
  playbook_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN DEFAULT TRUE,
  trigger_type TEXT NOT NULL,
  trigger_config JSONB NOT NULL,
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL,
  cooldown_minutes INT DEFAULT 60,
  max_daily_triggers INT DEFAULT 10,
  times_triggered INT DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  success_rate FLOAT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_luca_playbooks_enabled ON luca_playbooks(enabled);

CREATE INDEX IF NOT EXISTS idx_luca_playbooks_trigger ON luca_playbooks(trigger_type);

-- ═══════════════════════════════════════════════════════════════════════════
-- TOWER USERS - Usuarios del Control Tower
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tower_users (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'viewer',
  permissions JSONB DEFAULT '{}',
  notification_prefs JSONB DEFAULT '{}',
  dashboard_config JSONB DEFAULT '{}',
  watchlists JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tower_users_role ON tower_users(role);

CREATE INDEX IF NOT EXISTS idx_tower_users_active ON tower_users(active);

-- ═══════════════════════════════════════════════════════════════════════════
-- TOWER SESSIONS - Sesiones de usuario
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tower_sessions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  user_id TEXT NOT NULL REFERENCES tower_users(user_id),
  token_hash TEXT NOT NULL,
  device_info JSONB DEFAULT '{}',
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tower_sessions_user ON tower_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_tower_sessions_expires ON tower_sessions(expires_at);

-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT LOG - Log de auditoría
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_audit_log (
  id SERIAL PRIMARY KEY,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  changes JSONB DEFAULT '{}',
  context JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_luca_audit_actor ON luca_audit_log(actor_type, actor_id);

CREATE INDEX IF NOT EXISTS idx_luca_audit_target ON luca_audit_log(target_type, target_id);

CREATE INDEX IF NOT EXISTS idx_luca_audit_created ON luca_audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- SYNC TABLES - Espejo de datos de Redshift
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS sync_sales_daily (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  branch_id TEXT NOT NULL,
  venta_total NUMERIC(12,2),
  num_ordenes INT,
  ticket_promedio NUMERIC(10,2),
  venta_dine_in NUMERIC(12,2),
  venta_delivery NUMERIC(12,2),
  venta_para_llevar NUMERIC(12,2),
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fecha, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_sales_daily_fecha ON sync_sales_daily(fecha DESC);

CREATE INDEX IF NOT EXISTS idx_sync_sales_daily_branch ON sync_sales_daily(branch_id);

CREATE TABLE IF NOT EXISTS sync_sales_hourly (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  hora INT NOT NULL,
  branch_id TEXT NOT NULL,
  venta NUMERIC(12,2),
  num_ordenes INT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fecha, hora, branch_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_sales_hourly_fecha ON sync_sales_hourly(fecha DESC);

CREATE TABLE IF NOT EXISTS sync_descuentos (
  id SERIAL PRIMARY KEY,
  fecha DATE NOT NULL,
  branch_id TEXT NOT NULL,
  employee_id TEXT NOT NULL,
  employee_name TEXT,
  num_descuentos INT,
  monto_total NUMERIC(12,2),
  pct_efectivo NUMERIC(5,2),
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(fecha, branch_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_descuentos_fecha ON sync_descuentos(fecha DESC);

CREATE INDEX IF NOT EXISTS idx_sync_descuentos_employee ON sync_descuentos(employee_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- INITIAL DATA
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO tower_users (user_id, name, email, role, permissions, notification_prefs)
VALUES 
  ('jorge', 'Jorge', NULL, 'owner', '{"all": true}', '{"severity_min": "LOW", "channels": ["whatsapp", "tower"], "brief_type": "full"}'),
  ('andres', 'Andres', NULL, 'audit', '{"view_cases": true, "approve_actions": true, "view_hr": true}', '{"severity_min": "HIGH", "channels": ["tower"], "brief_type": "audit"}'),
  ('tany', 'Tany', NULL, 'ops', '{"view_cases": true, "approve_actions": true, "view_hr": false}', '{"severity_min": "MEDIUM", "channels": ["tower", "whatsapp"], "brief_type": "ops"}')
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO luca_playbooks (playbook_id, name, description, trigger_type, trigger_config, action_type, action_config)
VALUES 
  ('PB-FRAUD-001', 'Detector de Sweethearting', 'Detecta descuentos anomalos por empleado', 'METRIC_THRESHOLD', '{"metric": "discount_pct_employee", "operator": ">", "threshold": 25, "window": "1d"}', 'CREATE_CASE', '{"case_type": "FRAUD", "severity": "HIGH"}'),
  ('PB-SALES-001', 'Caida de Ventas Diaria', 'Alerta cuando ventas caen mas del 15% vs baseline', 'METRIC_THRESHOLD', '{"metric": "sales_vs_baseline_pct", "operator": "<", "threshold": -15, "window": "1d"}', 'CREATE_ALERT', '{"alert_type": "SALES_DROP", "severity": "MEDIUM"}'),
  ('PB-SALES-002', 'Caida Critica de Ventas', 'Escalacion cuando ventas caen mas del 25%', 'METRIC_THRESHOLD', '{"metric": "sales_vs_baseline_pct", "operator": "<", "threshold": -25, "window": "1d"}', 'CREATE_CASE', '{"case_type": "SALES_ANOMALY", "severity": "CRITICAL"}')
ON CONFLICT (playbook_id) DO NOTHING;
