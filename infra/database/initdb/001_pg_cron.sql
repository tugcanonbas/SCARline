-- Executed automatically on first DB init via /docker-entrypoint-initdb.d/
-- For existing volumes, run manually:
--   CREATE EXTENSION IF NOT EXISTS pg_cron;
--   SELECT cron.schedule('purge-session-events', '0 3 * * *',
--     'SELECT purge_old_session_events()');

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'purge-session-events',
  '0 3 * * *',
  'SELECT purge_old_session_events()'
);
