INSERT INTO devices (name, type, status, configuration)
VALUES
  ('Primary Simulator Display', 'display', 'connected', '{"displayIndex": 0, "role": "participant"}'::jsonb),
  ('Operator Laptop', 'display', 'connected', '{"role": "operator"}'::jsonb)
ON CONFLICT DO NOTHING;
