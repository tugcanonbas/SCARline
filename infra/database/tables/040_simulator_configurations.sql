-- Generic by design: CARLA is currently a simulator type, but SCARline's core
-- schema does not require simulator-specific relational columns.
CREATE TABLE IF NOT EXISTS simulator_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condition_id UUID NOT NULL UNIQUE REFERENCES conditions(id) ON DELETE CASCADE,

  simulator_type VARCHAR(50) NOT NULL DEFAULT 'carla',
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_simulator_configurations_type
  ON simulator_configurations(simulator_type);

CREATE INDEX IF NOT EXISTS idx_simulator_configurations_json
  ON simulator_configurations USING GIN(configuration);
