-- ═══════════════════════════════════════════════════════════════════════════
-- LUCA ACTION BUS - Schema SQL
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Tablas para "Las Manos" - Sistema de ejecución de acciones con autonomía

-- Extensiones necesarias
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: luca_action_bus
-- Registro de todas las acciones propuestas, aprobadas y ejecutadas
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_action_bus (
  action_id TEXT PRIMARY KEY,
  action_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  context JSONB NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL,
  reason TEXT,
  autonomy_level TEXT NOT NULL,  -- AUTO, DRAFT, APPROVAL, CRITICAL
  handler TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PROPOSED',
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Índices para búsqueda rápida
CREATE INDEX IF NOT EXISTS idx_action_bus_state ON luca_action_bus(state);
CREATE INDEX IF NOT EXISTS idx_action_bus_type ON luca_action_bus(action_type);
CREATE INDEX IF NOT EXISTS idx_action_bus_level ON luca_action_bus(autonomy_level);
CREATE INDEX IF NOT EXISTS idx_action_bus_created ON luca_action_bus(created_at DESC);

-- Índice para acciones pendientes
CREATE INDEX IF NOT EXISTS idx_action_bus_pending ON luca_action_bus(state, created_at)
  WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA');

-- Trigger para actualizar updated_at
CREATE OR REPLACE FUNCTION update_action_bus_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS action_bus_updated ON luca_action_bus;
CREATE TRIGGER action_bus_updated
  BEFORE UPDATE ON luca_action_bus
  FOR EACH ROW
  EXECUTE FUNCTION update_action_bus_timestamp();

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: luca_employee_flags
-- Empleados marcados para auditoría/seguimiento
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_employee_flags (
  flag_id TEXT PRIMARY KEY,
  employee_id TEXT NOT NULL,
  branch_id TEXT,
  flag_type TEXT NOT NULL DEFAULT 'AUDIT',  -- AUDIT, WATCH, INVESTIGATION
  reason TEXT NOT NULL,
  related_case_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',     -- ACTIVE, RESOLVED, CANCELLED
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by TEXT,
  cancelled_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_employee_flags_employee ON luca_employee_flags(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_flags_status ON luca_employee_flags(status);
CREATE INDEX IF NOT EXISTS idx_employee_flags_branch ON luca_employee_flags(branch_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: luca_action_audit
-- Log de auditoría de todas las acciones
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_action_audit (
  audit_id SERIAL PRIMARY KEY,
  action_id TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- PROPOSED, APPROVED, REJECTED, EXECUTED, FAILED, etc.
  actor TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_action_audit_action ON luca_action_audit(action_id);
CREATE INDEX IF NOT EXISTS idx_action_audit_created ON luca_action_audit(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- TABLA: luca_action_limits
-- Tracking de límites de acciones (rate limiting)
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS luca_action_limits (
  limit_id SERIAL PRIMARY KEY,
  action_type TEXT NOT NULL,
  scope TEXT NOT NULL,           -- 'global', 'user:xxx', 'branch:xxx'
  window_start TIMESTAMPTZ NOT NULL,
  window_type TEXT NOT NULL,     -- 'hour', 'day', 'week'
  count INT NOT NULL DEFAULT 0,
  UNIQUE(action_type, scope, window_start, window_type)
);

CREATE INDEX IF NOT EXISTS idx_action_limits_lookup 
  ON luca_action_limits(action_type, scope, window_start);

-- ═══════════════════════════════════════════════════════════════════════════
-- VISTA: pending_approvals
-- Acciones pendientes de aprobación con información enriquecida
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW pending_approvals AS
SELECT 
  action_id,
  action_type,
  payload,
  context,
  requested_by,
  reason,
  autonomy_level,
  state,
  metadata->>'expires_at' as expires_at,
  metadata->>'requires_2fa' as requires_2fa,
  created_at,
  CASE 
    WHEN state = 'PENDING_2FA' THEN 1
    WHEN autonomy_level = 'CRITICAL' THEN 2
    WHEN autonomy_level = 'APPROVAL' THEN 3
    WHEN autonomy_level = 'DRAFT' THEN 4
    ELSE 5
  END as priority_order
FROM luca_action_bus
WHERE state IN ('DRAFT', 'PENDING_APPROVAL', 'PENDING_2FA')
ORDER BY priority_order, created_at ASC;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIÓN: check_action_limit
-- Verifica si una acción está dentro de sus límites
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION check_action_limit(
  p_action_type TEXT,
  p_scope TEXT,
  p_window_type TEXT,
  p_max_count INT
) RETURNS BOOLEAN AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
  v_current_count INT;
BEGIN
  -- Calcular inicio de ventana
  CASE p_window_type
    WHEN 'hour' THEN v_window_start := date_trunc('hour', NOW());
    WHEN 'day' THEN v_window_start := date_trunc('day', NOW());
    WHEN 'week' THEN v_window_start := date_trunc('week', NOW());
    ELSE v_window_start := date_trunc('hour', NOW());
  END CASE;

  -- Obtener conteo actual
  SELECT count INTO v_current_count
  FROM luca_action_limits
  WHERE action_type = p_action_type
    AND scope = p_scope
    AND window_start = v_window_start
    AND window_type = p_window_type;

  IF v_current_count IS NULL THEN
    v_current_count := 0;
  END IF;

  RETURN v_current_count < p_max_count;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- FUNCIÓN: increment_action_limit
-- Incrementa el contador de una acción
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION increment_action_limit(
  p_action_type TEXT,
  p_scope TEXT,
  p_window_type TEXT
) RETURNS VOID AS $$
DECLARE
  v_window_start TIMESTAMPTZ;
BEGIN
  CASE p_window_type
    WHEN 'hour' THEN v_window_start := date_trunc('hour', NOW());
    WHEN 'day' THEN v_window_start := date_trunc('day', NOW());
    WHEN 'week' THEN v_window_start := date_trunc('week', NOW());
    ELSE v_window_start := date_trunc('hour', NOW());
  END CASE;

  INSERT INTO luca_action_limits (action_type, scope, window_start, window_type, count)
  VALUES (p_action_type, p_scope, v_window_start, p_window_type, 1)
  ON CONFLICT (action_type, scope, window_start, window_type)
  DO UPDATE SET count = luca_action_limits.count + 1;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════
-- COMENTARIOS
-- ═══════════════════════════════════════════════════════════════════════════

COMMENT ON TABLE luca_action_bus IS 'Registro central de todas las acciones de LUCA';
COMMENT ON TABLE luca_employee_flags IS 'Empleados marcados para auditoría o seguimiento';
COMMENT ON TABLE luca_action_audit IS 'Log de auditoría de acciones';
COMMENT ON TABLE luca_action_limits IS 'Tracking de rate limiting por acción';
COMMENT ON VIEW pending_approvals IS 'Vista de acciones pendientes de aprobación';
