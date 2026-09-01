\set ON_ERROR_STOP on

-- SCARline database bootstrap entry point.
-- Run from any directory with: psql -f infra/database/schema.sql

\ir migrations/0001_initial_schema.sql
\ir migrations/0002_layout_revisions.sql
\ir seeds/seed.sql
