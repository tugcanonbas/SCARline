CREATE TABLE IF NOT EXISTS studies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  name VARCHAR(300) NOT NULL,
  description TEXT,
  version VARCHAR(50) NOT NULL DEFAULT '1.0',

  status VARCHAR(20) NOT NULL DEFAULT 'draft',

  created_by UUID REFERENCES users(id) ON DELETE SET NULL,

  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_policy JSONB NOT NULL DEFAULT '{"persistence":{"mode":"all","sampleEveryN":1,"retentionDays":null},"realtime":{"maximumHz":null}}'::jsonb,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT studies_status_check
    CHECK (status IN ('draft', 'configured', 'ready', 'running', 'completed', 'archived'))
);

CREATE INDEX IF NOT EXISTS idx_studies_status
  ON studies(status);

CREATE INDEX IF NOT EXISTS idx_studies_created_by
  ON studies(created_by);
