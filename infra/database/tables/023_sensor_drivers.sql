-- Driver catalogue discovered from IO Client manifests. Physical/logical device
-- instances remain in devices and their channels remain in device_sensors.
CREATE TABLE IF NOT EXISTS sensor_drivers (
  key VARCHAR(100) PRIMARY KEY,
  name VARCHAR(200) NOT NULL,
  version VARCHAR(50) NOT NULL,
  device_type VARCHAR(50) NOT NULL,
  manifest JSONB NOT NULL,
  source_hash VARCHAR(64) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sensor_drivers_active ON sensor_drivers(is_active);
