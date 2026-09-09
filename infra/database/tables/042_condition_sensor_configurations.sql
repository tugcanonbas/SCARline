-- A condition may configure individual sensor channels of an assigned device.
-- Composite FKs ensure the selected sensor belongs to that device.
CREATE TABLE IF NOT EXISTS condition_sensor_configurations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  condition_device_id UUID NOT NULL,
  device_id UUID NOT NULL,
  sensor_id UUID NOT NULL,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT condition_sensor_condition_device_fk
    FOREIGN KEY (condition_device_id, device_id)
    REFERENCES condition_devices(id, device_id)
    ON DELETE CASCADE,

  CONSTRAINT condition_sensor_device_sensor_fk
    FOREIGN KEY (sensor_id, device_id)
    REFERENCES device_sensors(id, device_id)
    ON DELETE CASCADE,

  UNIQUE (condition_device_id, sensor_id)
);

CREATE INDEX IF NOT EXISTS idx_condition_sensor_configurations_device
  ON condition_sensor_configurations(condition_device_id);

CREATE INDEX IF NOT EXISTS idx_condition_sensor_configurations_sensor
  ON condition_sensor_configurations(sensor_id);

CREATE INDEX IF NOT EXISTS idx_condition_sensor_configurations_device_id
  ON condition_sensor_configurations(device_id);
