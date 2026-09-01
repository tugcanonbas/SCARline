DO $$
DECLARE
  target_table TEXT;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'system_configuration',
    'users',
    'widgets',
    'devices',
    'device_sensors',
    'sensor_drivers',
    'studies',
    'participants',
    'conditions',
    'simulator_configurations',
    'condition_devices',
    'condition_sensor_configurations',
    'layouts',
    'widget_instances',
    'trigger_rules',
    'sessions',
    'session_conditions',
    'export_jobs'
  ]
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS set_%1$s_updated_at ON %1$s;',
      target_table
    );

    EXECUTE format(
      'CREATE TRIGGER set_%1$s_updated_at
       BEFORE UPDATE ON %1$s
       FOR EACH ROW
       EXECUTE FUNCTION set_updated_at();',
      target_table
    );
  END LOOP;
END $$;
