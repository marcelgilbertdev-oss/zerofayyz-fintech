-- 009: Passwordless sign-in — magic links.
--
-- The password path stays; this adds a second door with the same discipline.
-- A magic link is a short-lived, single-use credential sent to a mailbox, so
-- every rule that applies to session tokens applies harder here:
--
--   * only the SHA-256 of the token is stored — a dump of this table hands an
--     attacker nothing clickable (same reasoning as sessions.token_hash)
--   * single-use is enforced by an atomic UPDATE on used_at, not by a read
--     followed by a write — two clicks racing produce exactly one session
--   * expiry is decided in SQL, so a drifted server clock cannot honour a
--     stale link
--
-- The email leg is deliberately a QUEUE JOB (kind auth.magic_link_email), not
-- an inline send: mail providers are exactly the flaky external dependency
-- retry-with-backoff exists for, and a dead email job is visible on
-- /admin/jobs rather than being a silent failure inside a request handler.

CREATE TABLE IF NOT EXISTS login_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- SHA-256 of the link token; the token itself exists only in the email.
  token_hash TEXT NOT NULL UNIQUE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,

  -- Same privacy stance as sessions: a keyed hash of the network prefix,
  -- never an address.
  client_fingerprint TEXT,

  CONSTRAINT login_tokens_expire_after_creation CHECK (expires_at > created_at)
);

-- The consume query's index: unexpired, unused tokens by hash. The UNIQUE on
-- token_hash already serves lookup; this partial index keeps sweeping cheap.
CREATE INDEX IF NOT EXISTS login_tokens_live_idx
  ON login_tokens (expires_at)
  WHERE used_at IS NULL;

-- Operational plumbing: no request-lane grants, same default-deny as jobs.
ALTER TABLE login_tokens ENABLE ROW LEVEL SECURITY;
