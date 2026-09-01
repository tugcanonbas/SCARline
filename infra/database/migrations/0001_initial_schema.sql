\set ON_ERROR_STOP on

-- Initial SCARline schema baseline. Keep the ordered includes dependency-safe.
BEGIN;

\ir ../init/001_extensions.sql
\ir ../init/002_functions.sql

\ir ../tables/001_system_configuration.sql

\ir ../tables/010_users.sql
\ir ../tables/011_roles.sql
\ir ../tables/012_user_roles.sql
\ir ../tables/013_auth_sessions.sql
\ir ../tables/014_overlay_credentials.sql
\ir ../tables/015_auth_websocket_tickets.sql

\ir ../tables/020_widgets.sql
\ir ../tables/021_devices.sql
\ir ../tables/022_device_sensors.sql
\ir ../tables/023_sensor_drivers.sql

\ir ../tables/030_studies.sql
\ir ../tables/031_study_users.sql
\ir ../tables/032_participants.sql
\ir ../tables/033_conditions.sql

\ir ../tables/040_simulator_configurations.sql
\ir ../tables/041_condition_devices.sql
\ir ../tables/042_condition_sensor_configurations.sql

\ir ../tables/050_layouts.sql
\ir ../tables/051_widget_instances.sql

\ir ../tables/060_trigger_rules.sql

\ir ../tables/070_sessions.sql
\ir ../tables/071_session_conditions.sql
\ir ../tables/072_session_events.sql
\ir ../tables/073_trigger_rule_state.sql

\ir ../tables/080_export_jobs.sql
\ir ../tables/090_event_outbox.sql
\ir ../tables/100_activity_log.sql

\ir ../triggers/001_updated_at.sql

COMMIT;
