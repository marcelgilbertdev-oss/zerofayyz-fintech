ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS provider_checkout_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_checkout_session_id_unique
  ON payments (provider_checkout_session_id)
  WHERE provider_checkout_session_id IS NOT NULL;
