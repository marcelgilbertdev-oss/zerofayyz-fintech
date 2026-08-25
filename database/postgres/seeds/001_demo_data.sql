INSERT INTO users (id, email, display_name, role)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'nadia@example.test', 'Nadia Al-Sabah', 'customer'),
  ('00000000-0000-4000-8000-000000000002', 'omar@example.test', 'Omar Rahman', 'customer'),
  ('00000000-0000-4000-8000-000000000003', 'leila@example.test', 'Leila Haddad', 'customer'),
  ('00000000-0000-4000-8000-000000000004', 'yousef@example.test', 'Yousef Karim', 'customer')
ON CONFLICT (id) DO NOTHING;

INSERT INTO payments (
  id,
  user_id,
  amount_minor,
  currency,
  status,
  description,
  created_at,
  updated_at
)
VALUES
  ('10000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000001', 42000, 'JPY', 'succeeded', 'Sandbox marketplace order', NOW() - INTERVAL '2 minutes', NOW() - INTERVAL '2 minutes'),
  ('10000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000002', 18500, 'JPY', 'processing', 'Sandbox marketplace order', NOW() - INTERVAL '18 minutes', NOW() - INTERVAL '18 minutes'),
  ('10000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000003', 76000, 'JPY', 'succeeded', 'Sandbox marketplace order', NOW() - INTERVAL '42 minutes', NOW() - INTERVAL '42 minutes'),
  ('10000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000004', 9200, 'JPY', 'failed', 'Sandbox marketplace order', NOW() - INTERVAL '1 hour', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

INSERT INTO transactions (
  id,
  payment_id,
  event_type,
  amount_minor,
  currency,
  occurred_at
)
VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'payment_succeeded', 42000, 'JPY', NOW() - INTERVAL '2 minutes'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000002', 'payment_processing', 18500, 'JPY', NOW() - INTERVAL '18 minutes'),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000003', 'payment_succeeded', 76000, 'JPY', NOW() - INTERVAL '42 minutes'),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000004', 'payment_failed', 9200, 'JPY', NOW() - INTERVAL '1 hour')
ON CONFLICT (id) DO NOTHING;

INSERT INTO audit_logs (id, action, entity_type, entity_id, metadata)
VALUES
  (
    '30000000-0000-4000-8000-000000000001',
    'sandbox.seed.completed',
    'system',
    NULL,
    '{"source":"001_demo_data.sql","containsRealCustomerData":false}'::JSONB
  )
ON CONFLICT (id) DO NOTHING;
