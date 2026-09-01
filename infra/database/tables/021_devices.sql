-- Devices are physical/logical resources known globally by SCARline.
CREATE TABLE IF NOT EXISTS devices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  name VARCHAR(200) NOT NULL,
  type VARCHAR(50) NOT NULL,
  source_key VARCHAR(200) UNIQUE,

  status VARCHAR(20) NOT NULL DEFAULT 'disconnected',
  status_message TEXT,

  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  last_seen_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT devices_status_check
    CHECK (status IN ('disconnected', 'connecting', 'connected', 'error', 'disabled'))
);

CREATE INDEX IF NOT EXISTS idx_devices_type
  ON devices(type);

CREATE INDEX IF NOT EXISTS idx_devices_status
  ON devices(status);
