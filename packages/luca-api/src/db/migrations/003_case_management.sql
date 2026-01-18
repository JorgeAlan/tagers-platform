-- ═══════════════════════════════════════════════════════════════════════════
-- LUCA Migration 003: Case Management
-- Iteración 3: "El Sistema Nervioso"
-- ═══════════════════════════════════════════════════════════════════════════
-- Tablas para Cases, Alerts, Actions y Audit Log

-- ═══════════════════════════════════════════════════════════════════════════
-- ENUMS
-- ═══════════════════════════════════════════════════════════════════════════

-- Case States
DO $$ BEGIN
  CREATE TYPE case_state AS ENUM (
    'OPEN',
    'INVESTIGATING',
    'DIAGNOSED',
    'RECOMMENDED',
    'APPROVED',
    'EXECUTING',
    'EXECUTED',
    'MEASURING',
    'MEASURED',
    'CLOSED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Alert States
DO $$ BEGIN
  CREATE TYPE alert_state AS ENUM (
    'ACTIVE',
    'ACKNOWLEDGED',
    'RESOLVED',
    'ESCALATED',
    'EXPIRED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Action States
DO $$ BEGIN
  CREATE TYPE action_state AS ENUM (
    'PENDING',
    'APPROVED',
    'REJECTED',
    'EXECUTING',
    'EXECUTED',
    'FAILED',
    'CANCELLED'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Approval Levels
DO $$ BEGIN
  CREATE TYPE approval_level AS ENUM (
    'AUTO',       -- Ejecutar automáticamente
    'DRAFT',      -- Crear borrador
    'APPROVAL',   -- Requiere aprobación
    'CRITICAL'    -- Requiere owner
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ═══════════════════════════════════════════════════════════════════════════
-- CASES TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_cases (
  id SERIAL PRIMARY KEY,
  case_id VARCHAR(50) UNIQUE NOT NULL,              -- CASE-20260117-XXXX
  
  -- Classification
  case_type VARCHAR(100) NOT NULL,                   -- FRAUD, SALES_ANOMALY, etc.
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',    -- LOW, MEDIUM, HIGH, CRITICAL
  state VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  
  -- Content
  title VARCHAR(500) NOT NULL,
  description TEXT,
  scope JSONB DEFAULT '{}',                          -- { branch_id, date_range, etc }
  
  -- Investigation
  evidence JSONB DEFAULT '[]',                       -- Array of evidence items
  hypotheses JSONB DEFAULT '[]',                     -- Array of hypotheses
  diagnosis JSONB,                                   -- Final diagnosis
  
  -- Actions
  recommended_actions JSONB DEFAULT '[]',            -- Array of recommended actions
  
  -- Outcome
  outcome JSONB,                                     -- Result after closing
  
  -- Source
  source VARCHAR(100),                               -- detector, manual, escalated
  detector_id VARCHAR(100),
  run_id VARCHAR(100),
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  closed_by VARCHAR(100),
  
  -- Indexes will be created below
  CONSTRAINT valid_case_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

-- Indexes for cases
CREATE INDEX IF NOT EXISTS idx_cases_state ON luca_cases(state);
CREATE INDEX IF NOT EXISTS idx_cases_severity ON luca_cases(severity);
CREATE INDEX IF NOT EXISTS idx_cases_type ON luca_cases(case_type);
CREATE INDEX IF NOT EXISTS idx_cases_detector ON luca_cases(detector_id);
CREATE INDEX IF NOT EXISTS idx_cases_created ON luca_cases(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cases_scope_branch ON luca_cases((scope->>'branch_id'));

-- ═══════════════════════════════════════════════════════════════════════════
-- ALERTS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_alerts (
  id SERIAL PRIMARY KEY,
  alert_id VARCHAR(50) UNIQUE NOT NULL,              -- ALT-20260117-XXXX
  
  -- Classification
  alert_type VARCHAR(100) NOT NULL,
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  state VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  
  -- Content
  title VARCHAR(500) NOT NULL,
  message TEXT,
  
  -- Context
  branch_id VARCHAR(50),
  fingerprint VARCHAR(255),                          -- For deduplication
  
  -- Source
  source VARCHAR(100),
  detector_id VARCHAR(100),
  run_id VARCHAR(100),
  
  -- Related case (if escalated)
  case_id VARCHAR(50) REFERENCES luca_cases(case_id),
  
  -- Expiration
  expires_at TIMESTAMPTZ,
  
  -- Resolution
  acked_at TIMESTAMPTZ,
  acked_by VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  resolved_by VARCHAR(100),
  resolution TEXT,
  
  -- Notifications sent
  notifications_sent JSONB DEFAULT '[]',
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_alert_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL'))
);

-- Indexes for alerts
CREATE INDEX IF NOT EXISTS idx_alerts_state ON luca_alerts(state);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON luca_alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_type ON luca_alerts(alert_type);
CREATE INDEX IF NOT EXISTS idx_alerts_branch ON luca_alerts(branch_id);
CREATE INDEX IF NOT EXISTS idx_alerts_fingerprint ON luca_alerts(fingerprint);
CREATE INDEX IF NOT EXISTS idx_alerts_detector ON luca_alerts(detector_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON luca_alerts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_expires ON luca_alerts(expires_at) WHERE expires_at IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- ACTIONS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_actions (
  id SERIAL PRIMARY KEY,
  action_id VARCHAR(50) UNIQUE NOT NULL,             -- ACT-20260117-XXXX
  
  -- Classification
  action_type VARCHAR(100) NOT NULL,                 -- NOTIFY_MANAGER, CREATE_REPORT, etc.
  state VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  
  -- Content
  title VARCHAR(500) NOT NULL,
  description TEXT,
  severity VARCHAR(20) NOT NULL DEFAULT 'MEDIUM',
  
  -- Approval
  requires_approval BOOLEAN DEFAULT true,
  approval_level VARCHAR(20) DEFAULT 'APPROVAL',
  
  -- Parameters
  params JSONB DEFAULT '{}',                         -- Action-specific parameters
  expected_impact JSONB DEFAULT '{}',                -- Expected outcome
  actual_impact JSONB,                               -- Actual outcome after execution
  
  -- Related case
  case_id VARCHAR(50) REFERENCES luca_cases(case_id),
  
  -- Approval workflow
  approved_at TIMESTAMPTZ,
  approved_by VARCHAR(100),
  rejected_at TIMESTAMPTZ,
  rejected_by VARCHAR(100),
  rejection_reason TEXT,
  
  -- Execution
  executed_at TIMESTAMPTZ,
  executed_by VARCHAR(100),
  execution_result JSONB,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  CONSTRAINT valid_action_severity CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  CONSTRAINT valid_approval_level CHECK (approval_level IN ('AUTO', 'DRAFT', 'APPROVAL', 'CRITICAL'))
);

-- Indexes for actions
CREATE INDEX IF NOT EXISTS idx_actions_state ON luca_actions(state);
CREATE INDEX IF NOT EXISTS idx_actions_type ON luca_actions(action_type);
CREATE INDEX IF NOT EXISTS idx_actions_case ON luca_actions(case_id);
CREATE INDEX IF NOT EXISTS idx_actions_pending ON luca_actions(state) WHERE state = 'PENDING';
CREATE INDEX IF NOT EXISTS idx_actions_created ON luca_actions(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- AUDIT LOG TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_audit_log (
  id SERIAL PRIMARY KEY,
  
  -- Actor
  actor_type VARCHAR(50) NOT NULL,                   -- user, system, detector, scheduler
  actor_id VARCHAR(100) NOT NULL,
  
  -- Action
  action VARCHAR(100) NOT NULL,                      -- CASE_CREATED, ALERT_ACKNOWLEDGED, etc.
  
  -- Target
  target_type VARCHAR(50) NOT NULL,                  -- case, alert, action, finding, detector
  target_id VARCHAR(100) NOT NULL,
  
  -- Details
  changes JSONB DEFAULT '{}',                        -- What changed
  context JSONB DEFAULT '{}',                        -- Additional context
  
  -- Timestamp
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for audit log
CREATE INDEX IF NOT EXISTS idx_audit_actor ON luca_audit_log(actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_action ON luca_audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_target ON luca_audit_log(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON luca_audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- TOWER USERS TABLE (for routing preferences)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tower_users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(100) UNIQUE NOT NULL,
  
  -- Profile
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  role VARCHAR(50) DEFAULT 'viewer',                 -- owner, ops, audit, viewer
  
  -- Notification preferences
  notification_prefs JSONB DEFAULT '{
    "severity_min": "MEDIUM",
    "channels": ["tower"],
    "quiet_hours": {"start": 22, "end": 7}
  }',
  
  -- Push subscription (Web Push API)
  push_subscription JSONB,
  
  -- Watchlists
  watchlists JSONB DEFAULT '{}',                     -- { branches: [], detectors: [] }
  
  -- Status
  active BOOLEAN DEFAULT true,
  
  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed tower users
INSERT INTO tower_users (user_id, name, email, role, notification_prefs, watchlists)
VALUES 
  ('jorge', 'Jorge', 'jorge@tagers.mx', 'owner', 
   '{"severity_min": "LOW", "channels": ["tower", "whatsapp"], "quiet_hours": {"start": 23, "end": 7}}',
   '{"branches": ["SUC01", "SUC02", "SUC03", "SUC04", "SUC05", "SUC06"]}'),
  ('socio_1', 'Socio 1', 'socio1@tagers.mx', 'ops',
   '{"severity_min": "MEDIUM", "channels": ["tower"], "quiet_hours": {"start": 22, "end": 8}}',
   '{"branches": ["SUC01", "SUC02"]}'),
  ('socio_2', 'Socio 2', 'socio2@tagers.mx', 'ops',
   '{"severity_min": "MEDIUM", "channels": ["tower"], "quiet_hours": {"start": 22, "end": 8}}',
   '{"branches": ["SUC03", "SUC04"]}')
ON CONFLICT (user_id) DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS
-- ═══════════════════════════════════════════════════════════════════════════

-- Active cases view
CREATE OR REPLACE VIEW v_active_cases AS
SELECT 
  c.*,
  (SELECT COUNT(*) FROM luca_actions a WHERE a.case_id = c.case_id) as action_count,
  (SELECT COUNT(*) FROM luca_alerts al WHERE al.case_id = c.case_id) as alert_count,
  EXTRACT(EPOCH FROM (NOW() - c.created_at)) / 3600 as hours_open
FROM luca_cases c
WHERE c.state != 'CLOSED'
ORDER BY 
  CASE c.severity 
    WHEN 'CRITICAL' THEN 1 
    WHEN 'HIGH' THEN 2 
    WHEN 'MEDIUM' THEN 3 
    ELSE 4 
  END,
  c.created_at DESC;

-- Active alerts view
CREATE OR REPLACE VIEW v_active_alerts AS
SELECT 
  a.*,
  c.title as case_title,
  c.state as case_state
FROM luca_alerts a
LEFT JOIN luca_cases c ON a.case_id = c.case_id
WHERE a.state IN ('ACTIVE', 'ACKNOWLEDGED')
  AND (a.expires_at IS NULL OR a.expires_at > NOW())
ORDER BY 
  CASE a.severity 
    WHEN 'CRITICAL' THEN 1 
    WHEN 'HIGH' THEN 2 
    WHEN 'MEDIUM' THEN 3 
    ELSE 4 
  END,
  a.created_at DESC;

-- Pending approvals view
CREATE OR REPLACE VIEW v_pending_approvals AS
SELECT 
  a.*,
  c.title as case_title,
  c.severity as case_severity,
  c.case_type
FROM luca_actions a
JOIN luca_cases c ON a.case_id = c.case_id
WHERE a.state = 'PENDING'
  AND a.requires_approval = true
ORDER BY 
  CASE a.severity 
    WHEN 'CRITICAL' THEN 1 
    WHEN 'HIGH' THEN 2 
    WHEN 'MEDIUM' THEN 3 
    ELSE 4 
  END,
  a.created_at ASC;

-- Recent audit view
CREATE OR REPLACE VIEW v_recent_audit AS
SELECT *
FROM luca_audit_log
WHERE created_at > NOW() - INTERVAL '7 days'
ORDER BY created_at DESC
LIMIT 1000;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCTIONS
-- ═══════════════════════════════════════════════════════════════════════════

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_cases_updated_at ON luca_cases;
CREATE TRIGGER update_cases_updated_at
  BEFORE UPDATE ON luca_cases
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_alerts_updated_at ON luca_alerts;
CREATE TRIGGER update_alerts_updated_at
  BEFORE UPDATE ON luca_alerts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_actions_updated_at ON luca_actions;
CREATE TRIGGER update_actions_updated_at
  BEFORE UPDATE ON luca_actions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_tower_users_updated_at ON tower_users;
CREATE TRIGGER update_tower_users_updated_at
  BEFORE UPDATE ON tower_users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- MIGRATION COMPLETE
-- ═══════════════════════════════════════════════════════════════════════════
