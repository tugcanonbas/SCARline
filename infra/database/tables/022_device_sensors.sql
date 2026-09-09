-- Sensors/data channels exposed by a global device.
CREATE TABLE IF NOT EXISTS device_sensors (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  device_id UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,

  key VARCHAR(100) NOT NULL,
  name VARCHAR(200) NOT NULL,
  modality VARCHAR(50),
  unit VARCHAR(50),

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (device_id, key),
  UNIQUE (id, device_id)
);

CREATE INDEX IF NOT EXISTS idx_device_sensors_device_id
  ON device_sensors(device_id);
