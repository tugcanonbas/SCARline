-- Migration 001: session_events performance indexes
-- Adds indexes for the most frequent query patterns on session_events.
--
-- Existing indexes (from schema.sql):
--   idx_session_events_session_ts    → (session_id, timestamp)
--   idx_session_events_type          → (event_type)
--   idx_session_events_study_modality → (study_id, modality)
--   idx_session_events_payload       → GIN(payload)
--
-- New indexes added here target routing_key and created_at columns
-- which had no index coverage, plus a composite for the common
-- "all events of type X in session Y" query pattern.

-- Enable pg_stat_statements extension (requires shared_preload_libraries)
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Single-column index on routing_key for filtering by event routing
CREATE INDEX IF NOT EXISTS idx_session_events_routing_key
  ON session_events(routing_key);

-- Descending index on created_at for recent-events-first queries
CREATE INDEX IF NOT EXISTS idx_session_events_created_at
  ON session_events(created_at DESC);

-- Single-column index on session_id for simple session lookups
-- (complements the existing composite session_ts index)
CREATE INDEX IF NOT EXISTS idx_session_events_session_id
  ON session_events(session_id);

-- Composite index for "events of routing pattern X in session Y"
CREATE INDEX IF NOT EXISTS idx_session_events_session_routing
  ON session_events(session_id, routing_key);
