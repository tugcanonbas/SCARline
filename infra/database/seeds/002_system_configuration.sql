INSERT INTO system_configuration (key, value)
VALUES
  ('bootstrap_completed', 'false'::jsonb)
ON CONFLICT (key) DO NOTHING;
