-- Events always belong to a session. session_condition_id is optional for
-- lifecycle/system events outside a particular condition.
CREATE TABLE IF NOT EXISTS session_events (
  id BIGSERIAL PRIMARY KEY,
  message_id UUID UNIQUE,

  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  session_condition_id UUID,

  "timestamp" TIMESTAMPTZ NOT NULL,

  event_type VARCHAR(100) NOT NULL,
  modality VARCHAR(50),

  source_type VARCHAR(50) NOT NULL,
  source_id UUID,
  source_key VARCHAR(200),

  routing_key VARCHAR(300),
  schema_version VARCHAR(50) NOT NULL DEFAULT '1.0',

  payload JSONB NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT session_events_session_condition_fk
    FOREIGN KEY (session_condition_id, session_id)
    REFERENCES session_conditions(id, session_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_events_session_ts
  ON session_events(session_id, "timestamp");

CREATE INDEX IF NOT EXISTS idx_session_events_condition_ts
  ON session_events(session_condition_id, "timestamp")
  WHERE session_condition_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_events_type
  ON session_events(event_type);

CREATE INDEX IF NOT EXISTS idx_session_events_modality
  ON session_events(modality);

CREATE INDEX IF NOT EXISTS idx_session_events_source
  ON session_events(source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_session_events_payload
  ON session_events USING GIN(payload);
