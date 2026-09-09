CREATE TABLE IF NOT EXISTS widget_instances (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  layout_id UUID NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  widget_id UUID NOT NULL REFERENCES widgets(id) ON DELETE RESTRICT,

  window_mode VARCHAR(32) NOT NULL DEFAULT 'transparent_electron',
  target_display VARCHAR(100) NOT NULL DEFAULT 'primary',
  "order" INTEGER NOT NULL DEFAULT 0,

  x INTEGER NOT NULL DEFAULT 0,
  y INTEGER NOT NULL DEFAULT 0,
  width INTEGER NOT NULL DEFAULT 180,
  height INTEGER NOT NULL DEFAULT 180,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,

  configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
  bindings_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  style_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT widget_instances_order_check
    CHECK ("order" >= 0),

  CONSTRAINT widget_instances_dimensions_check
    CHECK (width > 0 AND height > 0)
);

CREATE INDEX IF NOT EXISTS idx_widget_instances_layout_id
  ON widget_instances(layout_id);

CREATE INDEX IF NOT EXISTS idx_widget_instances_widget_id
  ON widget_instances(widget_id);

CREATE INDEX IF NOT EXISTS idx_widget_instances_target_display
  ON widget_instances(layout_id, target_display);
