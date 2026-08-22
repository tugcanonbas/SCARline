-- Migration 002: session_events cleanup policy
-- Retention: 90 days. Events older than 90 days are deleted.
--
-- pg_cron is NOT available in the standard postgres:15 Docker image.
-- This migration creates the purge function only. Scheduling must be
-- done externally via one of these methods:
--
--   Option A — Host crontab (recommended for development):
--     0 3 * * * docker exec scarline-postgres-1 psql -U scarline -d scarline \
--       -c "SELECT purge_old_session_events();"
--
--   Option B — Compose service with sleep loop (production):
--     Add a lightweight sidecar service in docker-compose.yml that
--     runs the purge daily via psql.
--
--   Option C — Application-level (CoreAPI):
--     Call purge_old_session_events() from a scheduled Fastify task.
--
-- The function is idempotent and safe to call at any frequency.

-- Purge function: deletes session_events older than 90 days
-- Uses the idx_session_events_created_at index (from migration 001)
-- for efficient range scans.
CREATE OR REPLACE FUNCTION purge_old_session_events()
RETURNS void AS $$
  DELETE FROM session_events
  WHERE created_at < NOW() - INTERVAL '90 days';
$$ LANGUAGE sql;

-- Optional: verify the function exists after creation
-- SELECT proname FROM pg_proc WHERE proname = 'purge_old_session_events';
