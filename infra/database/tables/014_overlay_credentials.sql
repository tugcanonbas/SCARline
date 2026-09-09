CREATE TABLE IF NOT EXISTS overlay_credentials (
  jti UUID PRIMARY KEY,
  kind VARCHAR(32) NOT NULL CHECK (kind IN ('bootstrap', 'websocket_ticket')),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT overlay_credentials_consumed_check
    CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_overlay_credentials_expiry
  ON overlay_credentials(expires_at);
