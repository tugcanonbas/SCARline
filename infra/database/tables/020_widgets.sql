-- Widgets are installed/available SCARline capabilities. Their placement and
-- experiment configuration live in widget_instances.
CREATE TABLE IF NOT EXISTS widgets (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  key VARCHAR(100) NOT NULL,
  version VARCHAR(50) NOT NULL DEFAULT '1.0',
  name VARCHAR(200) NOT NULL,
  description TEXT,

  default_configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  configuration_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (key, version)
);
