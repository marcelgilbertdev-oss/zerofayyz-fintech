-- 007: Row-level security — the database enforces who sees whose rows.
--
-- Until now, "a customer only sees their own payments" was a promise kept by
-- route guards: requireRole() in the API. Those guards are real, but they are
-- application code — anyone who reaches the database another way (a leaked
-- connection string, a future service, a bug in a new route) inherits none of
-- them. This migration moves the rule into the database itself, where every
-- path has to pass it.
--
-- The architecture is two lanes, which is the standard shape for this
-- (Supabase's service_role/authenticated split is the well-known example):
--
--   * The SERVICE lane: the owning role the API connects as. Webhooks,
--     metrics aggregation, seeding and migrations run here. As table owner it
--     bypasses RLS — deliberately. The public dashboard aggregates every
--     payment, and a webhook must be able to write regardless of who is
--     browsing. RLS is not FORCEd for exactly this reason: forcing it would
--     require threading a user context through system paths that have no user.
--
--   * The REQUEST lane: a NOLOGIN role, zerofayyz_request, adopted for the
--     span of one transaction while serving one authenticated person. It
--     cannot bypass RLS, it can read only what the policies below admit for
--     the user recorded in the transaction's context, and it cannot write the
--     ledger at all — its only write anywhere is filing a refund request as
--     itself.
--
-- The request context travels as two transaction-local settings,
-- app.user_id and app.role, set with set_config(..., true) so they die with
-- the transaction and can never leak across a pooled connection.

DO $$
BEGIN
  CREATE ROLE zerofayyz_request NOLOGIN;
EXCEPTION
  WHEN duplicate_object THEN NULL; -- roles are cluster-wide; re-running is fine
END
$$;

-- The pool's login user must be allowed to SET ROLE into the request lane.
-- current_user here is whoever runs migrations — locally zerofayyz_fintech,
-- in production the Neon owner — which is the same user the pool connects as.
DO $$
BEGIN
  EXECUTE format('GRANT zerofayyz_request TO %I', current_user);
END
$$;

GRANT USAGE ON SCHEMA public TO zerofayyz_request;
GRANT SELECT ON users, payments, transactions, sessions, refund_requests, audit_logs
  TO zerofayyz_request;
-- The one write the request lane may perform. Note: future tables get no
-- automatic grants — a new migration must decide, table by table, whether the
-- request lane can see it. Default-deny for what does not exist yet.
GRANT INSERT ON refund_requests TO zerofayyz_request;

-- ---------------------------------------------------------------- context

-- NULLIF turns "setting missing" and "setting empty" into NULL, and NULL
-- makes every policy below false. A request-lane transaction that forgot to
-- establish who it serves sees nothing — the failure mode is an empty result,
-- not somebody else's rows.
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.role', true), '')
$$;

-- ---------------------------------------------------------------- policies

ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments        ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions    ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs      ENABLE ROW LEVEL SECURITY;

-- Staff (viewer, operator, admin) read the operational surface; a customer
-- reads only rows that are about them. There is no branch that lets one
-- customer see another: the WHERE is the policy, and the policy is the row's
-- own user_id against the transaction's context.

DROP POLICY IF EXISTS users_read ON users;
CREATE POLICY users_read ON users FOR SELECT TO zerofayyz_request
  USING (app_role() IN ('viewer', 'operator', 'admin') OR id = app_user_id());

DROP POLICY IF EXISTS payments_read ON payments;
CREATE POLICY payments_read ON payments FOR SELECT TO zerofayyz_request
  USING (app_role() IN ('viewer', 'operator', 'admin') OR user_id = app_user_id());

-- A transaction is visible when its payment is: the EXISTS runs under the
-- same policies, so a customer's probe into another customer's payment finds
-- no row to anchor on.
DROP POLICY IF EXISTS transactions_read ON transactions;
CREATE POLICY transactions_read ON transactions FOR SELECT TO zerofayyz_request
  USING (
    app_role() IN ('viewer', 'operator', 'admin')
    OR EXISTS (
      SELECT 1 FROM payments p
       WHERE p.id = transactions.payment_id
         AND p.user_id = app_user_id()
    )
  );

-- Presence ("who is signed in right now") is an admin read in the API, and
-- the database agrees: only admins see other people's sessions. Everyone
-- sees their own — that is how "this is you" can be labelled.
DROP POLICY IF EXISTS sessions_read ON sessions;
CREATE POLICY sessions_read ON sessions FOR SELECT TO zerofayyz_request
  USING (app_role() = 'admin' OR user_id = app_user_id());

DROP POLICY IF EXISTS refund_requests_read ON refund_requests;
CREATE POLICY refund_requests_read ON refund_requests FOR SELECT TO zerofayyz_request
  USING (
    app_role() IN ('operator', 'admin')
    OR requested_by = app_user_id()
  );

-- Filing a refund request as somebody else is refused by the database, not
-- by a route guard. WITH CHECK is evaluated against the row being written.
DROP POLICY IF EXISTS refund_requests_file_as_self ON refund_requests;
CREATE POLICY refund_requests_file_as_self ON refund_requests FOR INSERT TO zerofayyz_request
  WITH CHECK (requested_by = app_user_id());

-- The history is a staff read. Customers act; they do not audit.
DROP POLICY IF EXISTS audit_logs_read ON audit_logs;
CREATE POLICY audit_logs_read ON audit_logs FOR SELECT TO zerofayyz_request
  USING (app_role() IN ('viewer', 'operator', 'admin'));
