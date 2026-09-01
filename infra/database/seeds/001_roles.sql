INSERT INTO roles (name, description)
VALUES
  ('admin', 'Full SCARline platform administration'),
  ('researcher', 'Study design, configuration and research data access'),
  ('operator', 'Study session execution and runtime monitoring'),
  ('observer', 'Read-only access to assigned study designs and historical data')
ON CONFLICT (name) DO NOTHING;
