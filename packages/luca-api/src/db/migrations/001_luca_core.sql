-- ═══════════════════════════════════════════════════════════════════════════
-- LUCA SCHEMA - Initial Migration
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Crea todas las tablas necesarias para LUCA:
-- - Cases (investigaciones)
-- - Alerts (alertas)
-- - Actions (acciones propuestas)
-- - Memory (memoria episódica)
-- - Playbooks (reglas de acción)
-- - Tower users (usuarios Control Tower)
-- 
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- HELPER FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Generar Case ID: CF-YYYY-MM-DD-NNN
CREATE OR REPLACE FUNCTION generate_case_id()
RETURNS TEXT AS $$
DECLARE
  today TEXT;
  seq INT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYY-MM-DD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(case_id FROM 'CF-\d{4}-\d{2}-\d{2}-(\d+)') AS INT)
  ), 0) + 1
  INTO seq
  FROM luca_cases
  WHERE case_id LIKE 'CF-' || today || '-%';
  
  RETURN 'CF-' || today || '-' || LPAD(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- Generar Alert ID: AL-YYYY-MM-DD-NNN
CREATE OR REPLACE FUNCTION generate_alert_id()
RETURNS TEXT AS $$
DECLARE
  today TEXT;
  seq INT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYY-MM-DD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(alert_id FROM 'AL-\d{4}-\d{2}-\d{2}-(\d+)') AS INT)
  ), 0) + 1
  INTO seq
  FROM luca_alerts
  WHERE alert_id LIKE 'AL-' || today || '-%';
  
  RETURN 'AL-' || today || '-' || LPAD(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- Generar Action ID: ACT-YYYY-MM-DD-NNN
CREATE OR REPLACE FUNCTION generate_action_id()
RETURNS TEXT AS $$
DECLARE
  today TEXT;
  seq INT;
BEGIN
  today := TO_CHAR(NOW(), 'YYYY-MM-DD');
  SELECT COALESCE(MAX(
    CAST(SUBSTRING(action_id FROM 'ACT-\d{4}-\d{2}-\d{2}-(\d+)') AS INT)
  ), 0) + 1
  INTO seq
  FROM luca_actions
  WHERE action_id LIKE 'ACT-' || today || '-%';
  
  RETURN 'ACT-' || today || '-' || LPAD(seq::TEXT, 3, '0');
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- CASES - Investigaciones
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_cases (
  id SERIAL PRIMARY KEY,
  case_id TEXT NOT NULL UNIQUE DEFAULT generate_case_id(),
  
  -- Tipo y severidad
  case_type TEXT NOT NULL, -- 'FRAUD', 'SALES_ANOMALY', 'STAFFING', 'CX', 'INVENTORY'
  severity TEXT NOT NULL DEFAULT 'MEDIUM', -- 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'
  
  -- Estado
  state TEXT NOT NULL DEFAULT 'OPEN', -- 'OPEN', 'INVESTIGATING', 'DIAGNOSED', 'ACTION_PENDING', 'CLOSED'
  
  -- Información
  title TEXT NOT NULL,
  description TEXT,
  
  -- Alcance
  scope JSONB DEFAULT '{}', -- {branch_id, employee_id, period_start, period_end, ...}
  
  -- Evidencia recolectada
  evidence JSONB DEFAULT '[]', -- [{query, result, timestamp}, ...]
  
  -- Hipótesis generadas
  hypotheses JSONB DEFAULT '[]', -- [{hypothesis, confidence, evidence_ids}, ...]
  
  -- Diagnóstico final
  diagnosis JSONB DEFAULT NULL, -- {conclusion, confidence, supporting_evidence}
  
  -- Acciones recomendadas
  recommended_actions JSONB DEFAULT '[]', -- [{action_type, params, priority}, ...]
  
  -- Resultado
  outcome JSONB DEFAULT NULL, -- {resolution, impact_measured, learnings}
  
  -- Metadatos
  source TEXT, -- 'DETECTOR', 'MANUAL', 'PLAYBOOK'
  detector_id TEXT,
  run_id TEXT,
  playbook_id TEXT,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_luca_cases_state ON luca_cases(state);
CREATE INDEX IF NOT EXISTS idx_luca_cases_type ON luca_cases(case_type);
CREATE INDEX IF NOT EXISTS idx_luca_cases_severity ON luca_cases(severity);
CREATE INDEX IF NOT EXISTS idx_luca_cases_branch ON luca_cases((scope->>'branch_id'));
CREATE INDEX IF NOT EXISTS idx_luca_cases_created ON luca_cases(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTS - Alertas
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_alerts (
  id SERIAL PRIMARY KEY,
  alert_id TEXT NOT NULL UNIQUE DEFAULT generate_alert_id(),
  
  -- Tipo y severidad
  alert_type TEXT NOT NULL, -- 'SALES_DROP', 'FRAUD_DETECTED', 'STAFFING_GAP', 'CX_ISSUE'
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  
  -- Estado
  state TEXT NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED', 'EXPIRED'
  
  -- Información
  title TEXT NOT NULL,
  message TEXT,
  
  -- Ubicación
  branch_id TEXT,
  
  -- Deduplicación
  fingerprint TEXT, -- Hash para evitar alertas duplicadas
  
  -- Notificaciones enviadas
  notifications_sent JSONB DEFAULT '[]', -- [{channel, recipient, sent_at}, ...]
  
  -- Resolución
  resolution TEXT,
  
  -- Relación con caso
  case_id TEXT REFERENCES luca_cases(case_id),
  
  -- Metadatos
  source TEXT,
  detector_id TEXT,
  run_id TEXT,
  
  -- Timestamps
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
  action_id TEXT NOT NULL UNIQUE DEFAULT generate_action_id(),
  
  -- Tipo
  action_type TEXT NOT NULL, -- 'NOTIFY_STAFF', 'CREATE_TICKET', 'DRAFT_PO', 'SEND_MESSAGE'
  
  -- Estado
  state TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED'
  
  -- Información
  title TEXT NOT NULL,
  description TEXT,
  
  -- Severidad y aprobación
  severity TEXT NOT NULL DEFAULT 'MEDIUM',
  requires_approval BOOLEAN DEFAULT TRUE,
  approval_level TEXT DEFAULT 'APPROVAL', -- 'AUTO', 'APPROVAL', 'CRITICAL'
  
  -- Parámetros de la acción
  params JSONB DEFAULT '{}', -- Específicos por action_type
  
  -- Impacto esperado
  expected_impact JSONB DEFAULT '{}', -- {metric, before, after, confidence}
  
  -- Resultado de ejecución
  execution_result JSONB DEFAULT NULL,
  actual_impact JSONB DEFAULT NULL,
  
  -- Relación con caso
  case_id TEXT REFERENCES luca_cases(case_id),
  
  -- Timestamps
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
CREATE INDEX IF NOT EXISTS idx_luca_actions_pending ON luca_actions(state, requires_approval) WHERE state = 'PENDING';

-- ═══════════════════════════════════════════════════════════════════════════
-- MEMORY - Memoria episódica
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_memory_episodes (
  id SERIAL PRIMARY KEY,
  episode_id TEXT NOT NULL UNIQUE,
  
  -- Tipo de episodio
  episode_type TEXT NOT NULL, -- 'CASE_CLOSED', 'DECISION', 'LEARNING', 'CONTEXT'
  
  -- Contenido
  title TEXT NOT NULL,
  summary TEXT,
  content JSONB DEFAULT '{}',
  
  -- Embedding para búsqueda semántica (si pgvector está disponible)
  -- embedding VECTOR(1536),
  
  -- Tags para búsqueda
  tags TEXT[] DEFAULT '{}',
  
  -- Relaciones
  case_id TEXT,
  branch_id TEXT,
  
  -- Metadatos
  created_at TIMESTAMPTZ DEFAULT NOW(),
  valid_until TIMESTAMPTZ -- NULL = permanente
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
  
  -- Información
  name TEXT NOT NULL,
  description TEXT,
  
  -- Estado
  enabled BOOLEAN DEFAULT TRUE,
  
  -- Trigger
  trigger_type TEXT NOT NULL, -- 'METRIC_THRESHOLD', 'PATTERN_MATCH', 'SCHEDULE'
  trigger_config JSONB NOT NULL,
  
  -- Acción
  action_type TEXT NOT NULL,
  action_config JSONB NOT NULL,
  
  -- Límites
  cooldown_minutes INT DEFAULT 60,
  max_daily_triggers INT DEFAULT 10,
  
  -- Estadísticas
  times_triggered INT DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  success_rate FLOAT DEFAULT 0,
  
  -- Metadatos
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
  
  -- Información
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  
  -- Rol y permisos
  role TEXT NOT NULL DEFAULT 'viewer', -- 'owner', 'audit', 'ops', 'manager', 'viewer'
  permissions JSONB DEFAULT '{}', -- Permisos específicos
  
  -- Preferencias de notificación
  notification_prefs JSONB DEFAULT '{}', -- {severity_min, channels, quiet_hours, brief_type}
  
  -- Configuración de dashboard
  dashboard_config JSONB DEFAULT '{}', -- {widgets, filters, default_branch}
  
  -- Watchlists
  watchlists JSONB DEFAULT '{}', -- {branches, employees, metrics}
  
  -- Estado
  active BOOLEAN DEFAULT TRUE,
  last_login_at TIMESTAMPTZ,
  
  -- Metadatos
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
  
  -- Token
  token_hash TEXT NOT NULL,
  
  -- Metadatos
  device_info JSONB DEFAULT '{}',
  ip_address TEXT,
  
  -- Timestamps
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
  
  -- Actor
  actor_type TEXT NOT NULL, -- 'USER', 'SYSTEM', 'DETECTOR', 'PLAYBOOK'
  actor_id TEXT,
  
  -- Acción
  action TEXT NOT NULL, -- 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'EXECUTE'
  
  -- Objeto
  target_type TEXT NOT NULL, -- 'CASE', 'ALERT', 'ACTION', 'PLAYBOOK', 'USER'
  target_id TEXT NOT NULL,
  
  -- Cambios
  changes JSONB DEFAULT '{}', -- {field: {old, new}, ...}
  
  -- Contexto
  context JSONB DEFAULT '{}', -- {ip, device, reason, ...}
  
  -- Timestamp
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_luca_audit_actor ON luca_audit_log(actor_type, actor_id);
CREATE INDEX IF NOT EXISTS idx_luca_audit_target ON luca_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_luca_audit_created ON luca_audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- SYNC TABLES - Espejo de datos de Redshift
-- ═══════════════════════════════════════════════════════════════════════════

-- Ventas diarias por sucursal
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

-- Ventas por hora
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

-- Descuentos por empleado
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
-- TRIGGERS - Auto-update updated_at
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_luca_cases_updated ON luca_cases;
CREATE TRIGGER trg_luca_cases_updated
  BEFORE UPDATE ON luca_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_luca_playbooks_updated ON luca_playbooks;
CREATE TRIGGER trg_luca_playbooks_updated
  BEFORE UPDATE ON luca_playbooks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS trg_tower_users_updated ON tower_users;
CREATE TRIGGER trg_tower_users_updated
  BEFORE UPDATE ON tower_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════════════════════════════════════
-- INITIAL DATA - Usuarios y playbooks iniciales
-- ═══════════════════════════════════════════════════════════════════════════

-- Usuarios iniciales
INSERT INTO tower_users (user_id, name, email, role, permissions, notification_prefs)
VALUES 
  ('jorge', 'Jorge', NULL, 'owner', 
   '{"all": true}',
   '{"severity_min": "LOW", "channels": ["whatsapp", "tower"], "brief_type": "full"}'),
  ('andres', 'Andrés', NULL, 'audit', 
   '{"view_cases": true, "approve_actions": true, "view_hr": true}',
   '{"severity_min": "HIGH", "channels": ["tower"], "brief_type": "audit"}'),
  ('tany', 'Tany', NULL, 'ops', 
   '{"view_cases": true, "approve_actions": true, "view_hr": false}',
   '{"severity_min": "MEDIUM", "channels": ["tower", "whatsapp"], "brief_type": "ops"}')
ON CONFLICT (user_id) DO NOTHING;

-- Playbooks iniciales
INSERT INTO luca_playbooks (playbook_id, name, description, trigger_type, trigger_config, action_type, action_config)
VALUES 
  ('PB-FRAUD-001', 'Detector de Sweethearting', 
   'Detecta descuentos anómalos por empleado',
   'METRIC_THRESHOLD',
   '{"metric": "discount_pct_employee", "operator": ">", "threshold": 25, "window": "1d"}',
   'CREATE_CASE',
   '{"case_type": "FRAUD", "severity": "HIGH"}'),
  ('PB-SALES-001', 'Caída de Ventas Diaria',
   'Alerta cuando ventas caen más del 15% vs baseline',
   'METRIC_THRESHOLD',
   '{"metric": "sales_vs_baseline_pct", "operator": "<", "threshold": -15, "window": "1d"}',
   'CREATE_ALERT',
   '{"alert_type": "SALES_DROP", "severity": "MEDIUM"}'),
  ('PB-SALES-002', 'Caída Crítica de Ventas',
   'Escalación cuando ventas caen más del 25%',
   'METRIC_THRESHOLD',
   '{"metric": "sales_vs_baseline_pct", "operator": "<", "threshold": -25, "window": "1d"}',
   'CREATE_CASE',
   '{"case_type": "SALES_ANOMALY", "severity": "CRITICAL"}')
ON CONFLICT (playbook_id) DO NOTHING;
