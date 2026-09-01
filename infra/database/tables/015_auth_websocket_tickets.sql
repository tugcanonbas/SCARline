CREATE TABLE IF NOT EXISTS auth_websocket_tickets (
  jti UUID PRIMARY KEY,
  auth_session_id UUID NOT NULL REFERENCES auth_sessions(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT auth_websocket_tickets_consumed_check
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_auth_websocket_tickets_session
  ON auth_websocket_tickets(auth_session_id);

CREATE INDEX IF NOT EXISTS idx_auth_websocket_tickets_expiry
  ON auth_websocket_tickets(expires_at);
