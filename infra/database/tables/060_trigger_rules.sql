-- Trigger expressions and actions are structured JSON because they are
-- extensible experiment logic. Firings are stored as session_events.
CREATE TABLE IF NOT EXISTS trigger_rules (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  condition_id UUID NOT NULL REFERENCES conditions(id) ON DELETE CASCADE,

  name VARCHAR(200) NOT NULL,
  description TEXT,

  expression JSONB NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  action_config JSONB NOT NULL DEFAULT '{}'::jsonb,

  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  priority INTEGER NOT NULL DEFAULT 100,
  cooldown_ms INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trigger_rules_priority_check
    CHECK (priority >= 0),

  CONSTRAINT trigger_rules_cooldown_check
    CHECK (cooldown_ms >= 0),

  UNIQUE (condition_id, name)
);

CREATE INDEX IF NOT EXISTS idx_trigger_rules_condition
  ON trigger_rules(condition_id, enabled, priority);

CREATE INDEX IF NOT EXISTS idx_trigger_rules_expression
  ON trigger_rules USING GIN(expression);
