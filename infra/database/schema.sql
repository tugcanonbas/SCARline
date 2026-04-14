CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE IF NOT EXISTS researchers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  institution VARCHAR(300),
  role VARCHAR(100),
  email VARCHAR(255),
  phone VARCHAR(50),
  notes TEXT,
  custom_fields JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  researcher_id UUID REFERENCES researchers(id) ON DELETE SET NULL,
  username VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  display_name VARCHAR(200) NOT NULL,
  email VARCHAR(255) UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(50) NOT NULL UNIQUE,
  description TEXT
);

CREATE TABLE IF NOT EXISTS user_roles (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash VARCHAR(255) NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

CREATE TABLE IF NOT EXISTS system_configuration (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key VARCHAR(100) NOT NULL UNIQUE,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS studies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(300) NOT NULL,
  description TEXT,
  version VARCHAR(50) NOT NULL DEFAULT '1.0',
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES researchers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS study_researchers (
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  researcher_id UUID NOT NULL REFERENCES researchers(id) ON DELETE CASCADE,
  role VARCHAR(100),
  PRIMARY KEY (study_id, researcher_id)
);

CREATE TABLE IF NOT EXISTS conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  description TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,
  carla_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  widget_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conditions_study_order ON conditions(study_id, "order");

CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  participant_code VARCHAR(50) NOT NULL,
  demographic_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  assigned_condition_id UUID REFERENCES conditions(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (study_id, participant_code)
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE SET NULL,
  condition_id UUID REFERENCES conditions(id) ON DELETE SET NULL,
  name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'created',
  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  runtime_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_study_status ON sessions(study_id, status);

CREATE TABLE IF NOT EXISTS view_layouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  type VARCHAR(30) NOT NULL,
  target_display VARCHAR(100),
  layout_config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS widget_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  layout_id UUID NOT NULL REFERENCES view_layouts(id) ON DELETE CASCADE,
  widget_id VARCHAR(100) NOT NULL,
  window_mode VARCHAR(32) NOT NULL DEFAULT 'transparent_electron',
  "order" INTEGER NOT NULL DEFAULT 0,
  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 180,
  height INTEGER NOT NULL DEFAULT 180,
  bindings_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  trigger_rules JSONB NOT NULL DEFAULT '[]'::jsonb,
  style_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS session_events (
  id BIGSERIAL PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  "timestamp" TIMESTAMPTZ NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  modality VARCHAR(50),
  source VARCHAR(100) NOT NULL,
  routing_key VARCHAR(300),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_ts ON session_events(session_id, "timestamp");
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type);
CREATE INDEX IF NOT EXISTS idx_session_events_study_modality ON session_events(study_id, modality);
CREATE INDEX IF NOT EXISTS idx_session_events_payload ON session_events USING GIN(payload);

CREATE TABLE IF NOT EXISTS carla_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL UNIQUE REFERENCES studies(id) ON DELETE CASCADE,
  map VARCHAR(50) NOT NULL DEFAULT 'Town03',
  weather_preset VARCHAR(50),
  weather_custom JSONB NOT NULL DEFAULT '{}'::jsonb,
  ego_vehicle_blueprint VARCHAR(100) NOT NULL DEFAULT 'vehicle.lincoln.mkz_2020',
  simulation_mode VARCHAR(20) NOT NULL DEFAULT 'synchronous',
  fixed_delta_seconds DECIMAL(5, 3) NOT NULL DEFAULT 0.05,
  traffic_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  pedestrian_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sun_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  spectator_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  recording_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  sensors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_carla_configurations_parameters ON carla_configurations USING GIN(weather_custom);

CREATE TABLE IF NOT EXISTS sensor_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL UNIQUE REFERENCES studies(id) ON DELETE CASCADE,
  sensors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'disconnected',
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID REFERENCES studies(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  format VARCHAR(20) NOT NULL,
  scope VARCHAR(20) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  result_path TEXT,
  error_message TEXT,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_required BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE devices ADD COLUMN IF NOT EXISTS display_configuration JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS parameters JSONB NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS result_size_bytes BIGINT;
ALTER TABLE export_jobs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE widget_instances ADD COLUMN IF NOT EXISTS window_mode VARCHAR(32);
ALTER TABLE widget_instances ADD COLUMN IF NOT EXISTS x INTEGER;
ALTER TABLE widget_instances ADD COLUMN IF NOT EXISTS y INTEGER;
ALTER TABLE widget_instances ADD COLUMN IF NOT EXISTS width INTEGER;
ALTER TABLE widget_instances ADD COLUMN IF NOT EXISTS height INTEGER;
UPDATE widget_instances
SET window_mode = COALESCE(NULLIF(window_mode, ''), 'transparent_electron')
WHERE window_mode IS NULL OR window_mode = '';
UPDATE widget_instances SET x = COALESCE(x, 0);
UPDATE widget_instances SET y = COALESCE(y, 0);
UPDATE widget_instances SET width = COALESCE(width, 180);
UPDATE widget_instances SET height = COALESCE(height, 180);
ALTER TABLE widget_instances
ALTER COLUMN window_mode SET DEFAULT 'transparent_electron';
ALTER TABLE widget_instances
ALTER COLUMN x SET DEFAULT 0;
ALTER TABLE widget_instances
ALTER COLUMN y SET DEFAULT 0;
ALTER TABLE widget_instances
ALTER COLUMN width SET DEFAULT 180;
ALTER TABLE widget_instances
ALTER COLUMN height SET DEFAULT 180;
ALTER TABLE widget_instances
ALTER COLUMN window_mode SET NOT NULL;
ALTER TABLE widget_instances
ALTER COLUMN x SET NOT NULL;
ALTER TABLE widget_instances
ALTER COLUMN y SET NOT NULL;
ALTER TABLE widget_instances
ALTER COLUMN width SET NOT NULL;
ALTER TABLE widget_instances
ALTER COLUMN height SET NOT NULL;
ALTER TABLE widget_instances DROP COLUMN IF EXISTS zone_id;

CREATE TABLE IF NOT EXISTS study_trigger_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  condition_id UUID REFERENCES conditions(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  widget_id VARCHAR(100) NOT NULL,
  instance_id UUID,
  rule_condition TEXT NOT NULL,
  action VARCHAR(100) NOT NULL,
  binding_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100,
  cooldown_ms INTEGER NOT NULL DEFAULT 0,
  last_triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_study_trigger_rules_study ON study_trigger_rules(study_id, enabled, priority);
CREATE INDEX IF NOT EXISTS idx_study_trigger_rules_condition ON study_trigger_rules(condition_id);

CREATE TABLE IF NOT EXISTS session_summaries (
  session_id UUID PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  event_count INTEGER NOT NULL DEFAULT 0,
  modality_count INTEGER NOT NULL DEFAULT 0,
  first_event_at TIMESTAMPTZ,
  last_event_at TIMESTAMPTZ,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  action VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_entity ON activity_log(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_log_created_at ON activity_log(created_at DESC);

CREATE OR REPLACE FUNCTION refresh_session_summary(target_session_id UUID)
RETURNS VOID AS $$
BEGIN
  INSERT INTO session_summaries (
    session_id,
    study_id,
    event_count,
    modality_count,
    first_event_at,
    last_event_at,
    summary,
    updated_at
  )
  SELECT sessions.id,
         sessions.study_id,
         COUNT(session_events.id)::int,
         COUNT(DISTINCT session_events.modality)::int,
         MIN(session_events.timestamp),
         MAX(session_events.timestamp),
         jsonb_build_object(
           'status', sessions.status,
           'durationSeconds', sessions.duration_seconds,
           'startedAt', sessions.started_at,
           'completedAt', sessions.completed_at
         ),
         NOW()
  FROM sessions
  LEFT JOIN session_events ON session_events.session_id = sessions.id
  WHERE sessions.id = target_session_id
  GROUP BY sessions.id
  ON CONFLICT (session_id) DO UPDATE SET
    study_id = EXCLUDED.study_id,
    event_count = EXCLUDED.event_count,
    modality_count = EXCLUDED.modality_count,
    first_event_at = EXCLUDED.first_event_at,
    last_event_at = EXCLUDED.last_event_at,
    summary = EXCLUDED.summary,
    updated_at = NOW();
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_session_summary_from_event()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_session_summary(NEW.session_id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION refresh_session_summary_from_session()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM refresh_session_summary(NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS refresh_session_summary_after_event ON session_events;
CREATE TRIGGER refresh_session_summary_after_event
AFTER INSERT ON session_events
FOR EACH ROW EXECUTE FUNCTION refresh_session_summary_from_event();

DROP TRIGGER IF EXISTS refresh_session_summary_after_session_change ON sessions;
CREATE TRIGGER refresh_session_summary_after_session_change
AFTER INSERT OR UPDATE OF status, started_at, paused_at, completed_at, duration_seconds ON sessions
FOR EACH ROW EXECUTE FUNCTION refresh_session_summary_from_session();

DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'researchers',
    'users',
    'studies',
    'conditions',
    'participants',
    'sessions',
    'view_layouts',
    'carla_configurations',
    'sensor_configurations',
    'devices',
    'export_jobs',
    'study_trigger_rules'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS set_%1$s_updated_at ON %1$s;', target_table);
    EXECUTE format(
      'CREATE TRIGGER set_%1$s_updated_at BEFORE UPDATE ON %1$s FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      target_table
    );
  END LOOP;
END $$;

INSERT INTO roles (name, description)
VALUES
  ('admin', 'Full system access'),
  ('researcher', 'Study design and management'),
  ('operator', 'Session execution and monitoring'),
  ('viewer', 'Read-only access')
ON CONFLICT (name) DO NOTHING;

INSERT INTO system_configuration (key, value)
VALUES
  ('carla_server_path', 'null'::jsonb),
  ('scarline_port', '8088'::jsonb),
  ('carla_server_port', '2000'::jsonb),
  ('onboarding_completed', 'false'::jsonb),
  ('default_simulation_mode', '"synchronous"'::jsonb),
  ('platform_env', '"development"'::jsonb),
  ('data_directory', '"/data/scarline"'::jsonb),
  ('overlay_transparent_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
