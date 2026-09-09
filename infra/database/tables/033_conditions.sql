-- A condition is the main experiment-configuration boundary.
CREATE TABLE IF NOT EXISTS conditions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  study_id UUID NOT NULL REFERENCES studies(id) ON DELETE CASCADE,

  name VARCHAR(200) NOT NULL,
  description TEXT,
  "order" INTEGER NOT NULL DEFAULT 0,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  archived_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (id, study_id),
  UNIQUE (study_id, name),

  CONSTRAINT conditions_order_check
    CHECK ("order" >= 0)
);

CREATE INDEX IF NOT EXISTS idx_conditions_study_order
  ON conditions(study_id, "order");

CREATE INDEX IF NOT EXISTS idx_conditions_active
  ON conditions(study_id, "order")
  WHERE archived_at IS NULL;
