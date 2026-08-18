CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer'
    CHECK (role IN ('customer', 'admin')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique
  ON users (LOWER(email));

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  provider TEXT NOT NULL DEFAULT 'stripe'
    CHECK (provider IN ('stripe')),
  provider_payment_id TEXT UNIQUE,
  amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
  currency CHAR(3) NOT NULL CHECK (currency = UPPER(currency)),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'processing', 'succeeded', 'failed', 'canceled', 'refunded')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS payments_user_created_at_idx
  ON payments (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payments_status_idx
  ON payments (status);

CREATE TABLE IF NOT EXISTS transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id UUID NOT NULL REFERENCES payments(id) ON DELETE RESTRICT,
  provider_event_id TEXT UNIQUE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('payment_created', 'payment_processing', 'payment_succeeded', 'payment_failed', 'payment_canceled', 'payment_refunded')),
  amount_minor BIGINT NOT NULL CHECK (amount_minor >= 0),
  currency CHAR(3) NOT NULL CHECK (currency = UPPER(currency)),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transactions_payment_occurred_at_idx
  ON transactions (payment_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS audit_logs_entity_idx
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
  ON audit_logs (created_at DESC);
