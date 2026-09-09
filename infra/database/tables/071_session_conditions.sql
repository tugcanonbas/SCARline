-- Instantiates one condition within a participant session. The same condition
-- may appear more than once when the study design requires it.
CREATE TABLE IF NOT EXISTS session_conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  session_id UUID NOT NULL,
  study_id UUID NOT NULL,
  condition_id UUID NOT NULL,

  sequence INTEGER NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  -- Complete resolved condition config at execution time.
  configuration_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  runtime_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT session_conditions_session_study_fk
    FOREIGN KEY (session_id, study_id)
    REFERENCES sessions(id, study_id)
    ON DELETE CASCADE,

  CONSTRAINT session_conditions_condition_study_fk
    FOREIGN KEY (condition_id, study_id)
    REFERENCES conditions(id, study_id)
    ON DELETE RESTRICT,

  CONSTRAINT session_conditions_sequence_check
    CHECK (sequence >= 0),

  CONSTRAINT session_conditions_status_check
    CHECK (status IN ('pending', 'active', 'paused', 'completed', 'skipped', 'aborted', 'failed')),

  CONSTRAINT session_conditions_time_check
    CHECK (
      (started_at IS NULL OR completed_at IS NULL)
      OR completed_at >= started_at
    ),

  UNIQUE (session_id, sequence),
  UNIQUE (id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_conditions_session_sequence
  ON session_conditions(session_id, sequence);

CREATE INDEX IF NOT EXISTS idx_session_conditions_condition
  ON session_conditions(condition_id);

CREATE INDEX IF NOT EXISTS idx_session_conditions_study_id
  ON session_conditions(study_id);
