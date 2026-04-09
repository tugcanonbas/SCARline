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
  zone_id VARCHAR(100),
  "order" INTEGER NOT NULL DEFAULT 0,
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
    'devices'
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
  ('scarline_port', '80'::jsonb),
  ('carla_server_port', '2000'::jsonb),
  ('onboarding_completed', 'false'::jsonb),
  ('default_simulation_mode', '"synchronous"'::jsonb),
  ('platform_env', '"development"'::jsonb),
  ('data_directory', '"/data/scarline"'::jsonb),
  ('overlay_transparent_enabled', 'true'::jsonb)
ON CONFLICT (key) DO NOTHING;
