CREATE TABLE IF NOT EXISTS trigger_rule_state (
  trigger_rule_id UUID NOT NULL REFERENCES trigger_rules(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  last_fired_at TIMESTAMPTZ NOT NULL,
  fire_count BIGINT NOT NULL DEFAULT 1,
  PRIMARY KEY (trigger_rule_id, session_id)
);
