-- One session is one participant's run of a study.
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL,

  name VARCHAR(200),
  status VARCHAR(20) NOT NULL DEFAULT 'created',

  started_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  started_at TIMESTAMPTZ,
  paused_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  runtime_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sessions_participant_study_fk
    FOREIGN KEY (participant_id, study_id)
    REFERENCES participants(id, study_id)
    ON DELETE RESTRICT,

  CONSTRAINT sessions_status_check
    CHECK (status IN ('created', 'ready', 'running', 'paused', 'completed', 'aborted', 'failed')),

  CONSTRAINT sessions_time_check
    CHECK (
      (started_at IS NULL OR completed_at IS NULL)
      OR completed_at >= started_at
    ),

  UNIQUE (id, study_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_study_status
  ON sessions(study_id, status);

CREATE INDEX IF NOT EXISTS idx_sessions_participant
  ON sessions(participant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sessions_started_by
  ON sessions(started_by_user_id);
