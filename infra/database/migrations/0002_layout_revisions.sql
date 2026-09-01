\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE layouts
  ADD COLUMN IF NOT EXISTS revision INTEGER NOT NULL DEFAULT 1;

ALTER TABLE layouts
  DROP CONSTRAINT IF EXISTS layouts_revision_check;

ALTER TABLE layouts
  ADD CONSTRAINT layouts_revision_check CHECK (revision > 0);

ALTER TABLE widget_instances
  ADD COLUMN IF NOT EXISTS input_mode VARCHAR(32) NOT NULL DEFAULT 'click_through';

ALTER TABLE widget_instances
  DROP CONSTRAINT IF EXISTS widget_instances_input_mode_check;

ALTER TABLE widget_instances
  ADD CONSTRAINT widget_instances_input_mode_check
    CHECK (input_mode IN ('click_through', 'interactive'));

COMMIT;
