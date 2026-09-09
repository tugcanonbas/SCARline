CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,

  participant_code VARCHAR(50) NOT NULL,
  demographic_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  notes TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (study_id, participant_code),
  UNIQUE (id, study_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_study_id
  ON participants(study_id);
