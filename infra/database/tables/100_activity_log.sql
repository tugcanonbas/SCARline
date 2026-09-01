CREATE TABLE IF NOT EXISTS activity_log (
  id BIGSERIAL PRIMARY KEY,

  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  study_id UUID REFERENCES studies(id) ON DELETE CASCADE,

  entity_type VARCHAR(100) NOT NULL,
  entity_id UUID,
  action VARCHAR(100) NOT NULL,

  payload JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_study
  ON activity_log(study_id, created_at DESC)
  WHERE study_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_activity_log_entity
  ON activity_log(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS idx_activity_log_actor
  ON activity_log(actor_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_log_created_at
  ON activity_log(created_at DESC);
