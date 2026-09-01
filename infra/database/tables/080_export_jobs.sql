CREATE TABLE IF NOT EXISTS export_jobs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  study_id UUID REFERENCES studies(id) ON DELETE CASCADE,
  participant_id UUID REFERENCES participants(id) ON DELETE CASCADE,
  session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
  session_condition_id UUID REFERENCES session_conditions(id) ON DELETE CASCADE,

  format VARCHAR(20) NOT NULL,
  scope VARCHAR(30) NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,

  parameters JSONB NOT NULL DEFAULT '{}'::jsonb,

  result_path TEXT,
  result_size_bytes BIGINT,
  error_message TEXT,

  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,

  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT export_jobs_scope_check
    CHECK (scope IN ('study', 'participant', 'session', 'session_condition')),

  CONSTRAINT export_jobs_status_check
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),

  CONSTRAINT export_jobs_progress_check
    CHECK (progress BETWEEN 0 AND 100),

  CONSTRAINT export_jobs_target_check
    CHECK (
      (scope = 'study' AND study_id IS NOT NULL)
      OR (scope = 'participant' AND participant_id IS NOT NULL)
      OR (scope = 'session' AND session_id IS NOT NULL)
      OR (scope = 'session_condition' AND session_condition_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_status
  ON export_jobs(status, created_at);

CREATE INDEX IF NOT EXISTS idx_export_jobs_study
  ON export_jobs(study_id)
  WHERE study_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_participant
  ON export_jobs(participant_id)
  WHERE participant_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_session
  ON export_jobs(session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_session_condition
  ON export_jobs(session_condition_id)
  WHERE session_condition_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_export_jobs_requested_by
  ON export_jobs(requested_by);
