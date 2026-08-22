# How This Platform Works

A complete walkthrough: what it does, what it's built from, why each piece was chosen,
and who software like this is for. Written to be readable start to finish by someone who
did not build it.

---

## 1. What the platform does

It takes a card payment and keeps an accurate, auditable record of what happened to it.

That sounds small. The payment itself is the easy part — Stripe does that. The engineering
is in everything around it: knowing with certainty whether the money moved, recording it
exactly once, never trusting an unverified message, and being able to reconstruct the
sequence of events afterwards.

Three things you can see working at the live URL:

1. **A dashboard** showing gross volume, success rate, pending settlement, recorded events,
   a twelve-day volume chart, platform health, and the most recent transactions
2. **A payment button** that opens a real Stripe checkout page
3. **A ledger** that updates itself when Stripe confirms the payment

Everything on the dashboard is computed from the database. There are no hardcoded figures.

---

## 2. The pieces, and why each one

### The application

| Piece | Technology | Why this one |
| --- | --- | --- |
| Dashboard | **Next.js 16 / React 19** | Server-rendered, so the browser never holds an API URL or key. Also the framework both target jobs name. |
| API | **Fastify 5** | Fast, and its JSON-schema response validation means the API cannot accidentally return a shape it didn't promise. |
| Language | **TypeScript** (strict) | `strict`, `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` make the compiler a gate, not a formatter. |
| Database | **PostgreSQL 18** | Financial records need constraints, transactions and exact numeric types. The idempotency guarantee is enforced *by* the database. |
| Payments | **Stripe** | The industry standard, and hosted Checkout keeps card data entirely out of this system. |
| Queries | **Hand-written SQL** (`pg`) | No ORM. The interesting logic is in the SQL, and it should be readable as SQL. |
| SPA clients | **Vue 3 + Pinia**, **Svelte 5 runes** | Two further frontends consuming the same API unmodified, sharing one Zod contract (`packages/api-contract`) that validates every response at the boundary — including the staff door: each carries an operator panel using the same session cookie, rate limiter and audit trail as the admin console. The point: the API is demonstrated by three differently-built consumers, not asserted by one. |
| Languages | **English + Japanese** | Typed dictionaries, no i18n dependency: two locales in server components did not justify one, and `Intl` already handles currency, number and date formatting per locale. |
| Accessibility | **axe-core in CI** | WCAG 2.1 AA checked on every push, against both locales. |

### The services it runs on

| Service | What it hosts | Why | Cost |
| --- | --- | --- | --- |
| **Vercel** | The dashboard | Built by the Next.js team; deploys straight from GitHub | Free |
| **Render** | The API | Deploys from a `render.yaml` file in the repo; free tier | Free |
| **Neon** | PostgreSQL | Serverless Postgres, permanent free tier, no card required | Free |
| **GitHub** | Code, CI, scheduled jobs | Actions runs the whole test suite on every push | Free |
| **Stripe** | Payments (test mode) | Sandbox behaves identically to production; no real money exists | Free |

All three hosting services sit in **Singapore**. That is deliberate: a page load travels
viewer → Vercel → Render → Neon, so if those are spread across continents every single load
pays three intercontinental round-trips. Colocated, the database answers in about 3ms.

---

## 3. What happens when someone pays

```mermaid
sequenceDiagram
    actor Customer
    participant Web as Dashboard (Vercel)
    participant API as API (Render)
    participant DB as PostgreSQL (Neon)
    participant Stripe

    Customer->>Web: Click "Test payment"
    Web->>API: POST /payments/checkout-session
    API->>DB: INSERT payment (status: created)
    API->>Stripe: Create Checkout Session
    Stripe-->>API: Session id + URL
    API->>DB: UPDATE payment (status: processing)
    API-->>Web: Session URL
    Web-->>Customer: Redirect to Stripe

    Customer->>Stripe: Enter card, pay
    Stripe-->>Customer: Redirect back to dashboard
    Stripe->>API: POST /webhooks/stripe (signed)
    API->>API: Verify signature against raw body
    API->>DB: One statement: transaction + payment + audit log
    API-->>Stripe: 200
```

Read step by step:

1. **The click** goes to the dashboard's own server, not to Stripe and not to the API
   directly. The browser never learns the API's address.
2. **A payment row is created first**, before Stripe is contacted. If Stripe then fails, we
   still have a record that an attempt happened, marked `failed`.
3. **The Stripe session is created with the payment id as an idempotency key.** If the
   request is retried, Stripe returns the same session instead of opening a second one.
4. **The customer pays on Stripe's page**, on Stripe's domain. Card details never touch this
   platform. That single choice is what keeps the compliance burden small.
5. **Stripe sends a webhook** — a signed message saying what happened. This is the only thing
   we trust to mark a payment successful. A user returning to the success page proves
   nothing; they could have typed that URL.
6. **The signature is verified** against the raw, unparsed request body. Parsing first would
   change the bytes and break verification, which is why the webhook route opts into raw-body
   handling and no other route does.
7. **One SQL statement** records the event, updates the payment, and writes an audit entry —
   all or nothing.

---

## 4. The two ideas worth understanding

If you remember nothing else from this document, remember these.

### Idempotency lives in the database

Stripe delivers webhooks **at least once**. Retries follow any non-2xx response, and
duplicates happen anyway. A duplicated delivery must never produce a duplicated financial
record.

The obvious approach — check whether we've seen this event, then write — is wrong. Under
concurrent delivery both copies check, both find nothing, both write.

So the rule lives in the schema instead. `transactions.provider_event_id` carries a `UNIQUE`
constraint, and the insert says `ON CONFLICT DO NOTHING`. The payment update and audit write
are chained to that insert's result, so a duplicate event updates nothing at all.

This holds under concurrency, across restarts, and across any number of running servers —
because it is a property of a unique index, not of application logic that someone might
later edit.

### Payments and transactions are different things

- **`payments`** is mutable state: *where does this stand right now?*
- **`transactions`** is an append-only log: *what happened, and when did we learn it?*

Collapsing them into one table would make it impossible to reconstruct the current status
after a late or out-of-order delivery. Keeping them apart is what makes the ledger auditable.

---

## 5. How it's tested

Three layers, each catching what the layer beneath structurally cannot. Full detail in
[QUALITY_STRATEGY.md](QUALITY_STRATEGY.md).

| Layer | Count | Runs against | Catches |
| --- | --- | --- | --- |
| Unit | 77 | Stubbed database and Stripe | Branching, status mapping, guard clauses, hashing, cookies, rate limiting |
| Client unit | 66 | jsdom, fetch mocked at the network seam | Contract validation, state and sign-in logic in the Vue and Svelte clients — both suites assert the same behavioural contract, so a drifted port fails |
| Integration | 42 | Real PostgreSQL | SQL validity, constraints, triggers, idempotency, auth refusals |
| End-to-end | 61 | Built servers in a real browser | Rendering, hydration, both locales, accessibility, the reviewer's whole path |
| Production smoke | 26 | The live deployment | That what shipped actually works |

**The story worth telling:** the webhook handler once had nineteen passing unit tests and had
never worked. `JSONB_BUILD_OBJECT` accepts `"any"`, so an uncast bind parameter had no
inferable type and PostgreSQL rejected the whole statement with `42P18`. Every real webhook
would have returned 500. No unit test could see it, because all of them stub the database.
The first integration test written against real PostgreSQL found it immediately.

The lesson is not "write more tests." A test suite has a *shape*, and defects collect where
that shape does not reach.

---

## 5a. Languages and accessibility

The dashboard renders in English and Japanese. Two decisions in there are worth knowing.

**Locale is negotiated once, in `proxy.ts`, and attached to the request.** A root layout in
Next.js never receives `searchParams`, so if the page resolved the locale independently the
`<html lang>` attribute would keep saying `en` while the page rendered Japanese. That is not
cosmetic: screen readers choose pronunciation from that attribute, and browsers choose
line-breaking from it. Precedence is explicit choice → remembered cookie → `Accept-Language`.
Only an explicit choice is remembered, because persisting an inferred one would quietly
override the browser on every later visit.

**Translations are enforced by the type system.** The English dictionary defines the shape,
so a missing Japanese string is a compile error naming the key rather than an English word
appearing unannounced in a Japanese page.

The language switcher uses plain anchors rather than `next/link`, because a client-side
navigation does not re-render the root layout — the content would switch while the `lang`
attribute did not. Changing the document's language is a document-level change, so it gets a
document-level navigation. It also works with JavaScript disabled.

On accessibility, `axe-core` runs in CI against both locales, gated on WCAG 2.1 A and AA.
Introducing it found **14 real contrast failures in the existing design** — muted text sitting
between 2.2:1 and 4.1:1 where AA requires 4.5:1. Those are fixed. Automation catches roughly a
third of real accessibility problems; it cannot judge whether a label is *meaningful*, so it
is a floor rather than a certificate.

---

## 5b. The locked half

The dashboard is public. Signing in opens a second half of the platform, and the boundary
between them is enforced on the API rather than in the page — hiding a panel is
presentation, and the integration suite proves the refusals by making the requests a
viewer, an operator, and an anonymous caller are not allowed to make.

**Three roles.** A `viewer` reads the dashboard. An `operator` additionally reads the audit
log — the published demo account is an operator, so a reviewer sees the showpiece and can
change nothing. An `admin` sees live sessions and accounts, and can end anyone's session.

**Passwords** use scrypt from Node's standard library, with the cost parameters stored
inside each hash so they can be raised later without invalidating existing ones. Argon2 is
the better algorithm and was rejected because it ships as platform-specific native binaries
— the dependency shape that had already broken this project's CI twice.

**Sessions are opaque and server-side.** The cookie holds 32 random bytes; the database
holds only its SHA-256. A JWT would have been simpler and cannot be revoked before it
expires, which makes both "sign this person out now" and "who is signed in right now"
impossible — and those are the two questions an operations console exists to answer.

**The audit log is append-only, enforced by a database trigger** rather than by convention.
Making it genuinely immutable forced the foreign keys out of that table: `ON DELETE SET
NULL` is a write into the audit log performed by the database on another table's behalf, so
the trigger refused it and nothing could be deleted anywhere. An audit entry is a snapshot,
not a live join.

**Client identity is a keyed hash of the network prefix, never an IP address.** Strangers
sign into this demo; distinguishing two sessions and rate-limiting abuse needs no ability to
locate a person.

---

## 6. How code reaches production

1. Commit to a branch, open a pull request
2. **GitHub Actions** runs three jobs: API typecheck + unit + integration against a real
   PostgreSQL service; web lint + typecheck + build; end-to-end against migrated, seeded data
3. Merge to `main`
4. **Vercel** rebuilds the dashboard automatically; **Render** rebuilds the API automatically
5. Render runs database migrations **before** the new server accepts traffic
6. `node scripts/production-smoke.mjs` confirms the live system from outside

A change reaches the live site in well under a minute after merge.

---

## 7. Who uses software like this

This is a prototype, but the shape is the real shape. Businesses that need exactly this:

**Marketplaces and platforms** — anywhere money moves between a buyer and a seller and the
platform must keep its own record rather than relying on the processor's dashboard.

**Subscription and SaaS businesses** — the same lifecycle, with recurring events. The
payments/transactions split matters even more when a subscription changes state repeatedly.

**Payment gateways and processors** themselves — companies like KOMOJU exist to give
merchants this infrastructure. Their engineers spend their days on webhook reliability,
idempotency, and reconciliation.

**Fintech products** — lending, investment, fractional ownership, remittance. Anything where
a regulator or an auditor may later ask "what happened, and how do you know?"

**Any business with an internal finance team** — the operations dashboard here is the
recognisable shape of an internal admin tool: what came in, what's pending, what failed,
is the system healthy.

The common thread is not "accepting payments." It's **being able to prove afterwards what
happened**. That is the actual product.

---

## 8. Honest limits

- It runs in **Stripe test mode**. No real money can move, by design.
- It has **no users** and is not a commercial product.
- The **dashboard is deliberately public**. Anyone can read it and start a test payment.
  That is a decision, not an oversight: a reviewer must never meet a login wall. The
  privileged half — admin console, audit log, live sessions — is behind a sign-in.
- **Refunds and account management are not built yet.** The console reads far more than it
  writes; that is the next phase.
- The login rate limiter is **in memory, and therefore per-instance**. One instance runs
  today. Documented in the code rather than left to be discovered, because a limiter that
  silently stops working at two instances is worse than none.
- The free hosting tier **sleeps when idle**; a scheduled job pings it every ten minutes to
  keep the demo responsive.
- Metrics are scoped to a **single currency**, because summing across currencies is
  meaningless and pretending otherwise would be worse than the limitation.

Being precise about what it does not do is part of what makes the rest credible.

---

## 9. Where to look in the code

| To understand | Read |
| --- | --- |
| The payment and webhook logic | `apps/api/src/payments/payments.routes.ts` |
| The metric aggregation SQL | `apps/api/src/metrics/metrics.routes.ts` |
| The schema and its constraints | `database/postgres/migrations/001_initial_schema.sql` |
| The idempotency proof | `apps/api/src/database/ledger.integration-test.ts` |
| The reviewer's path | `apps/web/e2e/dashboard.spec.ts` |
| Password hashing, and why scrypt | `apps/api/src/auth/password.ts` |
| Sessions, revocation, and the privacy hash | `apps/api/src/auth/sessions.ts` |
| Role guards, rate limiting, enumeration defence | `apps/api/src/auth/auth.routes.ts` |
| The proof that guards refuse the wrong role | `apps/api/src/admin/admin.integration-test.ts` |
| The append-only trigger | `database/postgres/migrations/003_authentication_and_sessions.sql` |
| The deployment definition | `render.yaml` and `.github/workflows/ci.yml` |
| Why each decision was made | `docs/decisions/` |
