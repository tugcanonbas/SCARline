CREATE TABLE IF NOT EXISTS condition_devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condition_id UUID NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE RESTRICT,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (condition_id, device_id),
  UNIQUE (id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_condition_devices_condition_id
  ON condition_devices(condition_id);

CREATE INDEX IF NOT EXISTS idx_condition_devices_device_id
  ON condition_devices(device_id);
