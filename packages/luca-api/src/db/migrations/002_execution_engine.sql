-- ═══════════════════════════════════════════════════════════════════════════
-- LUCA SCHEMA - Iteration 2: Execution Engine
-- "Los Músculos" - Registry tables + Detector execution tracking
-- ═══════════════════════════════════════════════════════════════════════════

-- ═══════════════════════════════════════════════════════════════════════════
-- REGISTRY TABLES - El corazón de la modularidad
-- ═══════════════════════════════════════════════════════════════════════════

-- Fuentes de datos registradas
CREATE TABLE IF NOT EXISTS registry_sources (
  id SERIAL PRIMARY KEY,
  source_id VARCHAR(50) UNIQUE NOT NULL,    -- redshift, buk, kiss, marketman
  name VARCHAR(100) NOT NULL,
  type VARCHAR(30) NOT NULL,                -- database, api, file, webhook
  connection_config JSONB DEFAULT '{}',     -- Connection details
  sync_schedule VARCHAR(50),                -- Cron expression
  owner VARCHAR(50),                        -- Quién mantiene esta fuente
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  last_sync_status VARCHAR(20),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Datasets por fuente
CREATE TABLE IF NOT EXISTS registry_datasets (
  id SERIAL PRIMARY KEY,
  dataset_id VARCHAR(100) UNIQUE NOT NULL,  -- redshift.fct_sales_daily
  source_id VARCHAR(50) REFERENCES registry_sources(source_id),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  schema_definition JSONB DEFAULT '{}',     -- Columns, types, keys
  primary_keys TEXT[],
  timestamp_column VARCHAR(50),             -- Para incremental sync
  refresh_frequency VARCHAR(50),            -- hourly, daily, realtime
  row_count BIGINT,
  last_updated_at TIMESTAMPTZ,
  quality_score DECIMAL(3,2),               -- 0-1 basado en tests
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Data Products (lo que LUCA consume)
CREATE TABLE IF NOT EXISTS registry_data_products (
  id SERIAL PRIMARY KEY,
  dp_id VARCHAR(100) UNIQUE NOT NULL,       -- dp_sales_daily
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50),                     -- sales, hr, cx, inventory
  
  -- Definición
  source_datasets TEXT[],                   -- Datasets que combina
  transformation_sql TEXT,                  -- SQL o referencia a view
  output_schema JSONB DEFAULT '{}',         -- Schema del output
  
  -- Contrato/SLA
  owner VARCHAR(50),
  refresh_frequency VARCHAR(50),
  max_latency_hours INTEGER,
  
  -- Estado
  is_active BOOLEAN DEFAULT true,
  last_materialized_at TIMESTAMPTZ,
  row_count BIGINT,
  
  -- Tests
  tests_config JSONB DEFAULT '[]',          -- [{type: "not_null", column: "x"}, ...]
  last_test_at TIMESTAMPTZ,
  last_test_passed BOOLEAN,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Métricas definidas
CREATE TABLE IF NOT EXISTS registry_metrics (
  id SERIAL PRIMARY KEY,
  metric_id VARCHAR(100) UNIQUE NOT NULL,   -- sales_total, discount_pct
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50),
  
  -- Definición
  data_product_id VARCHAR(100),             -- DP fuente
  calculation_sql TEXT,                     -- Fórmula
  unit VARCHAR(30),                         -- currency, percentage, count
  
  -- Dimensiones disponibles
  dimensions TEXT[],                        -- [branch, date, employee, product]
  
  -- Comparaciones
  comparison_type VARCHAR(30),              -- baseline, target, period
  baseline_config JSONB DEFAULT '{}',       -- Cómo calcular baseline
  
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Detectores registrados
CREATE TABLE IF NOT EXISTS registry_detectors (
  id SERIAL PRIMARY KEY,
  detector_id VARCHAR(100) UNIQUE NOT NULL, -- fraud_discounts, sales_anomaly
  name VARCHAR(100) NOT NULL,
  description TEXT,
  category VARCHAR(50),                     -- fraud, sales, hr, cx, inventory
  agent_name VARCHAR(50),                   -- "La Fiscalía", "El Forense", etc.
  
  -- Inputs/Outputs
  input_data_products TEXT[],               -- DPs que consume
  output_type VARCHAR(30),                  -- alert, case, insight
  
  -- Configuración
  schedule VARCHAR(50),                     -- Cron o "realtime"
  config JSONB DEFAULT '{}',                -- Parámetros del detector
  thresholds JSONB DEFAULT '{}',            -- Umbrales configurables
  
  -- Control
  cooldown_hours INTEGER DEFAULT 24,
  max_alerts_per_day INTEGER DEFAULT 10,
  requires_approval BOOLEAN DEFAULT false,
  autonomy_level VARCHAR(20) DEFAULT 'suggest', -- suggest, draft, auto
  
  -- Estado
  is_active BOOLEAN DEFAULT true,
  last_run_at TIMESTAMPTZ,
  last_run_status VARCHAR(20),
  
  -- Performance
  precision_score DECIMAL(3,2),             -- TP / (TP + FP)
  recall_score DECIMAL(3,2),                -- TP / (TP + FN)
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- EXECUTION TABLES - Observabilidad de algoritmos
-- ═══════════════════════════════════════════════════════════════════════════

-- Ejecuciones de detectores
CREATE TABLE IF NOT EXISTS detector_runs (
  id SERIAL PRIMARY KEY,
  run_id VARCHAR(50) UNIQUE NOT NULL,       -- RUN-2026-01-15-001
  detector_id VARCHAR(100) NOT NULL,
  
  -- Timing
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  duration_ms INTEGER,
  
  -- Scope
  scope JSONB DEFAULT '{}',                 -- {branches: [...], date_range: {...}}
  
  -- Inputs
  data_products_used TEXT[],
  input_row_count BIGINT,
  
  -- Results
  status VARCHAR(20) DEFAULT 'running',     -- running, completed, failed, timeout
  findings_count INTEGER DEFAULT 0,
  alerts_created INTEGER DEFAULT 0,
  cases_created INTEGER DEFAULT 0,
  
  -- Errors
  error_message TEXT,
  error_stack TEXT,
  
  -- Cost
  tokens_used INTEGER DEFAULT 0,
  api_calls INTEGER DEFAULT 0,
  estimated_cost_usd DECIMAL(10,4) DEFAULT 0,
  
  -- Config snapshot (para reproducibilidad)
  config_snapshot JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_detector_runs_detector ON detector_runs(detector_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_detector_runs_status ON detector_runs(status, started_at DESC);

-- Hallazgos por run
CREATE TABLE IF NOT EXISTS detector_findings (
  id SERIAL PRIMARY KEY,
  finding_id VARCHAR(50) UNIQUE NOT NULL,   -- FND-2026-01-15-001
  run_id VARCHAR(50) REFERENCES detector_runs(run_id),
  detector_id VARCHAR(100),
  
  -- Clasificación
  finding_type VARCHAR(50) NOT NULL,        -- anomaly, pattern, threshold_breach
  severity VARCHAR(20) NOT NULL,            -- low, medium, high, critical
  confidence DECIMAL(3,2),                  -- 0-1
  
  -- Contenido
  title VARCHAR(200) NOT NULL,
  description TEXT,
  evidence JSONB DEFAULT '{}',              -- Datos que soportan el hallazgo
  
  -- Scope
  branch_id VARCHAR(50),
  employee_id VARCHAR(50),
  product_id VARCHAR(50),
  date_range JSONB DEFAULT '{}',
  
  -- Métricas
  metric_id VARCHAR(100),
  metric_value DECIMAL(15,2),
  baseline_value DECIMAL(15,2),
  deviation_pct DECIMAL(10,2),
  
  -- Estado
  status VARCHAR(20) DEFAULT 'new',         -- new, acknowledged, converted, dismissed
  converted_to VARCHAR(50),                 -- alert_id o case_id si se convirtió
  
  -- Feedback
  is_true_positive BOOLEAN,                 -- NULL = no labeled
  labeled_by VARCHAR(50),
  labeled_at TIMESTAMPTZ,
  label_notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_findings_run ON detector_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_findings_status ON detector_findings(status, severity);
CREATE INDEX IF NOT EXISTS idx_findings_unlabeled ON detector_findings(is_true_positive) 
  WHERE is_true_positive IS NULL;
CREATE INDEX IF NOT EXISTS idx_findings_branch ON detector_findings(branch_id, created_at DESC);

-- Labels para feedback (separado para analytics)
CREATE TABLE IF NOT EXISTS finding_labels (
  id SERIAL PRIMARY KEY,
  finding_id VARCHAR(50) REFERENCES detector_findings(finding_id),
  label VARCHAR(30) NOT NULL,               -- true_positive, false_positive, unclear
  labeled_by VARCHAR(50) NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS - Para observabilidad
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW v_recent_runs AS
SELECT 
  r.run_id,
  r.detector_id,
  d.name as detector_name,
  d.agent_name,
  r.status,
  r.started_at,
  r.completed_at,
  r.duration_ms,
  r.findings_count,
  r.alerts_created,
  r.cases_created,
  r.error_message
FROM detector_runs r
LEFT JOIN registry_detectors d ON r.detector_id = d.detector_id
ORDER BY r.started_at DESC;

CREATE OR REPLACE VIEW v_open_findings AS
SELECT 
  f.finding_id,
  f.detector_id,
  d.name as detector_name,
  d.agent_name,
  f.finding_type,
  f.severity,
  f.confidence,
  f.title,
  f.branch_id,
  f.metric_value,
  f.baseline_value,
  f.deviation_pct,
  f.status,
  f.created_at
FROM detector_findings f
LEFT JOIN registry_detectors d ON f.detector_id = d.detector_id
WHERE f.status IN ('new', 'acknowledged')
ORDER BY 
  CASE f.severity 
    WHEN 'critical' THEN 1 
    WHEN 'high' THEN 2 
    WHEN 'medium' THEN 3 
    ELSE 4 
  END,
  f.created_at DESC;

CREATE OR REPLACE VIEW v_detector_performance AS
SELECT 
  d.detector_id,
  d.name,
  d.agent_name,
  d.is_active,
  d.last_run_at,
  d.last_run_status,
  COUNT(r.id) as total_runs_30d,
  COUNT(r.id) FILTER (WHERE r.status = 'completed') as successful_runs,
  AVG(r.duration_ms) as avg_duration_ms,
  SUM(r.findings_count) as total_findings_30d,
  SUM(r.alerts_created) as total_alerts_30d,
  SUM(r.cases_created) as total_cases_30d
FROM registry_detectors d
LEFT JOIN detector_runs r ON d.detector_id = r.detector_id 
  AND r.started_at > NOW() - INTERVAL '30 days'
GROUP BY d.detector_id, d.name, d.agent_name, d.is_active, d.last_run_at, d.last_run_status;

-- ═══════════════════════════════════════════════════════════════════════════
-- SEED DATA - Fuentes y Detectores iniciales
-- ═══════════════════════════════════════════════════════════════════════════

-- Fuentes de datos
INSERT INTO registry_sources (source_id, name, type, sync_schedule, owner, is_active)
VALUES 
  ('redshift', 'Redshift Data Warehouse', 'database', '0 * * * *', 'data-team', true),
  ('buk', 'BUK RRHH', 'api', '0 6 * * *', 'hr-team', true),
  ('kiss', 'KISS Customer Service', 'database', '*/5 * * * *', 'cx-team', true),
  ('woocommerce', 'WooCommerce eCommerce', 'api', '*/15 * * * *', 'digital-team', true),
  ('sheets', 'Google Sheets Config', 'api', '0 0 * * *', 'ops-team', true)
ON CONFLICT (source_id) DO NOTHING;

-- Data Products iniciales
INSERT INTO registry_data_products (dp_id, name, description, category, source_datasets, refresh_frequency, owner, is_active)
VALUES 
  ('dp_sales_daily', 'Ventas Diarias', 'Resumen de ventas por día y sucursal', 'sales', ARRAY['redshift.fct_sales_daily'], 'hourly', 'data-team', true),
  ('dp_sales_hourly', 'Ventas por Hora', 'Ventas desglosadas por hora', 'sales', ARRAY['redshift.fct_sales_hourly'], 'hourly', 'data-team', true),
  ('dp_discounts', 'Descuentos por Empleado', 'Descuentos aplicados por empleado', 'fraud', ARRAY['redshift.fct_discounts'], 'hourly', 'data-team', true),
  ('dp_labor_summary', 'Resumen RRHH', 'Asistencia y horas trabajadas', 'hr', ARRAY['buk.attendance'], 'daily', 'hr-team', true),
  ('dp_cx_conversations', 'Conversaciones CX', 'Métricas de servicio al cliente', 'cx', ARRAY['kiss.conversations'], 'realtime', 'cx-team', true)
ON CONFLICT (dp_id) DO NOTHING;

-- Métricas iniciales
INSERT INTO registry_metrics (metric_id, name, description, category, data_product_id, calculation_sql, unit, dimensions)
VALUES 
  ('sales_total', 'Venta Total', 'Suma de ventas', 'sales', 'dp_sales_daily', 'SUM(venta_total)', 'currency', ARRAY['branch', 'date']),
  ('sales_vs_baseline', 'Venta vs Baseline', 'Variación contra baseline', 'sales', 'dp_sales_daily', '(venta_total - baseline) / baseline * 100', 'percentage', ARRAY['branch', 'date']),
  ('discount_pct', '% Descuento', 'Porcentaje de descuento sobre venta', 'fraud', 'dp_discounts', 'monto_total / venta_total * 100', 'percentage', ARRAY['branch', 'employee', 'date']),
  ('ticket_promedio', 'Ticket Promedio', 'Venta promedio por orden', 'sales', 'dp_sales_daily', 'venta_total / num_ordenes', 'currency', ARRAY['branch', 'date'])
ON CONFLICT (metric_id) DO NOTHING;

-- Detectores iniciales
INSERT INTO registry_detectors (
  detector_id, name, description, category, agent_name,
  input_data_products, output_type, schedule, 
  thresholds, cooldown_hours, max_alerts_per_day, is_active
)
VALUES 
  (
    'sales_anomaly',
    'Detector de Anomalías en Ventas',
    'Detecta caídas o picos inusuales en ventas comparado con baseline histórico',
    'sales',
    'El Forense',
    ARRAY['dp_sales_daily', 'dp_sales_hourly'],
    'alert',
    '0 8,14,20 * * *',  -- 8am, 2pm, 8pm
    '{"drop_threshold_pct": -15, "spike_threshold_pct": 30, "critical_drop_pct": -25}',
    6,
    5,
    true
  ),
  (
    'fraud_discounts',
    'Detector de Sweethearting',
    'Detecta empleados con descuentos anómalos que podrían indicar fraude',
    'fraud',
    'La Fiscalía',
    ARRAY['dp_discounts'],
    'case',
    '0 22 * * *',  -- 10pm cada día
    '{"warning_pct": 15, "alert_pct": 25, "critical_pct": 40, "min_transactions": 5}',
    24,
    3,
    true
  ),
  (
    'sales_hourly_pattern',
    'Patrón de Ventas por Hora',
    'Detecta desviaciones del patrón típico de ventas por hora',
    'sales',
    'El Profeta',
    ARRAY['dp_sales_hourly'],
    'insight',
    '0 * * * *',  -- Cada hora
    '{"deviation_threshold": 2.0}',
    1,
    10,
    true
  ),
  (
    'no_sales_alert',
    'Alerta Sin Ventas',
    'Alerta cuando una sucursal no registra ventas en un período',
    'sales',
    'El Vigilante',
    ARRAY['dp_sales_hourly'],
    'alert',
    '*/30 * * * *',  -- Cada 30 min
    '{"max_hours_no_sales": 2, "operating_hours_start": 8, "operating_hours_end": 22}',
    4,
    10,
    true
  )
ON CONFLICT (detector_id) DO NOTHING;
