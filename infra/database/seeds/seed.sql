\set ON_ERROR_STOP on

BEGIN;

\ir 001_roles.sql
\ir 002_system_configuration.sql

COMMIT;
