# 8. Use opaque server-side sessions, not JWTs

**Status:** Accepted · **Date:** 2026-08-21

## Context

The admin console needed to answer two questions that a payments platform is always asked:

- *Sign this person out now.*
- *Who is signed in at this moment?*

The default modern answer is a JWT: self-contained, stateless, no session table. It cannot
answer either question. Once issued, a JWT is honoured by every server that trusts the
signing key until its expiry passes. Revoking one early requires a denylist of revoked
tokens, and listing who is signed in requires a record of live tokens — which together are
a session store, arrived at by a longer route and with worse properties.

## Decision

The cookie carries 32 bytes of random, meaningless data. Everything real lives in a
`sessions` row: the user, when it was created, when it was last seen, when it expires, and
whether it was revoked.

Only the **SHA-256 of the cookie value** is stored. The raw token exists in the browser and
nowhere else, so a database dump hands an attacker nothing they can present as a session —
the same reasoning as password hashing, applied to the credential that is transmitted on
every single request.

Expiry and revocation are evaluated in SQL, inside the same `UPDATE ... WHERE ...
RETURNING` that refreshes `last_seen_at`:

```sql
WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > NOW()
```

The presence panel reads that identical predicate, so the list of who is signed in and the
door itself can never disagree.

## Consequences

Every authenticated request costs one database round trip. On this deployment that is 1–3 ms
against a colocated Neon instance, and it buys immediate revocation, accurate presence, and
a session that dies the moment an administrator says so — demonstrated live in the
acceptance charter, where a revoked session's unchanged and unexpired cookie returned 401 on
the next request.

Horizontal scaling stays simple, since the session store is the database that already holds
the ledger; there is no separate cache to keep consistent. The cost would appear at a scale
this platform does not have, and the standard remedy — a short-lived cache in front of the
session lookup — is available without changing the model.

Cookies are `HttpOnly`, `Secure`, and `SameSite=Lax`. Lax rather than Strict is deliberate:
the Stripe Checkout redirect is a cross-site navigation back into the app, and Strict would
drop the session on the way home. Lax still withholds the cookie from cross-site POSTs,
which is the request shape CSRF actually needs. A unit test asserts the value is not Strict,
because tightening it looks like an improvement and silently breaks the payment return.
