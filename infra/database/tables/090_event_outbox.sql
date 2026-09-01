CREATE TABLE IF NOT EXISTS event_outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  exchange VARCHAR(200) NOT NULL,
  routing_key VARCHAR(300) NOT NULL,
  message JSONB NOT NULL,

  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,

  CONSTRAINT event_outbox_status_check
    CHECK (status IN ('pending', 'publishing', 'published', 'failed')),

  CONSTRAINT event_outbox_attempts_check
    CHECK (attempts >= 0)
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_pending
  ON event_outbox(status, available_at, created_at);

CREATE TABLE IF NOT EXISTS message_inbox (
  message_id UUID PRIMARY KEY,
  consumer VARCHAR(100) NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_message_inbox_processed
  ON message_inbox(processed_at);

CREATE TABLE IF NOT EXISTS lifecycle_commands (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  action VARCHAR(30) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'queued',
  reason TEXT,
  error_message TEXT,
  required_components TEXT[] NOT NULL DEFAULT '{}',
  acknowledged_components TEXT[] NOT NULL DEFAULT '{}',
  result_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  deadline_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT lifecycle_commands_action_check
    CHECK (action IN ('ready', 'start', 'pause', 'resume', 'advance', 'complete', 'abort', 'fail')),
  CONSTRAINT lifecycle_commands_status_check
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'timed_out'))
);

CREATE INDEX IF NOT EXISTS idx_lifecycle_commands_pending
  ON lifecycle_commands(status, deadline_at);
