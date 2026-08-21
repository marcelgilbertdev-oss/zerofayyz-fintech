-- Phase 2: authentication, sessions, and an audit log that cannot be rewritten.
--
-- The public dashboard stays readable without an account. What this adds is the
-- privileged half: who may act, what they did, and who is here right now.

-- ---------------------------------------------------------------- users

-- Nullable on purpose. Most rows in this table are payment customers created by
-- a checkout, not people who log in; forcing a hash on them would mean
-- inventing credentials for someone who never asked for an account.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 'customer' was the original default and describes someone who paid, not
-- someone who signs in. The three staff roles are added alongside it.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check
  CHECK (role IN ('customer', 'viewer', 'operator', 'admin'));

-- Someone who can sign in must have a hash; someone who cannot must not have a
-- role that implies they can. Stated once here rather than trusted to every
-- code path that ever inserts a user.
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_staff_have_credentials;
ALTER TABLE users ADD CONSTRAINT users_staff_have_credentials
  CHECK (
    (role = 'customer' AND password_hash IS NULL)
    OR (role <> 'customer' AND password_hash IS NOT NULL)
  );

-- ---------------------------------------------------------------- sessions

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- The SHA-256 of the cookie value, never the value itself. A dump of this
  -- table therefore hands an attacker nothing they can present as a session:
  -- the same reason password hashes exist, applied to the credential that is
  -- actually sent on every single request.
  token_hash TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,

  -- Deliberately NOT the visitor's IP address.
  --
  -- Strangers log into this demo. An audit trail needs to tell two sessions
  -- apart and to rate-limit abuse; it does not need to identify or locate a
  -- person, and a portfolio site has no business retaining that. This is a
  -- salted hash of the network prefix only, which survives neither reversal
  -- nor correlation with any other system.
  client_fingerprint TEXT,

  CONSTRAINT sessions_expire_after_creation CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id, created_at DESC);

-- Presence queries ask "who is here now", which is every unrevoked, unexpired
-- row. A partial index keeps that lookup off the historical rows.
CREATE INDEX IF NOT EXISTS sessions_active_idx
  ON sessions (expires_at DESC)
  WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- audit log

ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS session_id UUID;
ALTER TABLE audit_logs ADD COLUMN IF NOT EXISTS client_fingerprint TEXT;

-- Deliberately NOT foreign keys.
--
-- `ON DELETE SET NULL` is a write into this table performed by the database on
-- someone else's behalf, and this table refuses writes. So the two rules
-- collide: deleting a session or a user would attempt to blank the reference,
-- the append-only trigger would refuse, and the delete would fail — meaning no
-- user and no session could ever be removed once they appeared in the history.
--
-- The deeper point is that a foreign key with any ON DELETE action is a
-- mutation path into an immutable table. An audit entry is a snapshot of what
-- was true when it was written; it is not a live join, and it must not change
-- because a row somewhere else did. The ids are recorded as plain values, and
-- an id that no longer resolves is itself a fact worth keeping.
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_actor_user_id_fkey;
ALTER TABLE audit_logs DROP CONSTRAINT IF EXISTS audit_logs_session_id_fkey;

-- Append-only, enforced by the database rather than by convention.
--
-- An audit log that the application could quietly edit is not evidence of
-- anything — the first question anyone asks of one is whether it could have
-- been changed after the fact. Revoking UPDATE and DELETE from the application
-- role would be undone by the next role change, so the rule lives in a trigger
-- that no connection can talk its way past.
--
-- TRUNCATE is deliberately left alone: the trigger is FOR EACH ROW, so it does
-- not fire on it. Integration tests need to reset the table between runs, and
-- the application never truncates anything. The rule that matters is that no
-- individual entry can be altered or made to disappear.
CREATE OR REPLACE FUNCTION audit_logs_are_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_logs_no_update ON audit_logs;
CREATE TRIGGER audit_logs_no_update
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION audit_logs_are_append_only();

CREATE INDEX IF NOT EXISTS audit_logs_actor_idx
  ON audit_logs (actor_user_id, created_at DESC);
