CREATE TABLE IF NOT EXISTS layouts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condition_id UUID NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,

  name VARCHAR(200) NOT NULL,
  type VARCHAR(30) NOT NULL,
  target_display VARCHAR(100),

  layout_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (condition_id, name)
);

CREATE INDEX IF NOT EXISTS idx_layouts_condition_id
  ON layouts(condition_id);
