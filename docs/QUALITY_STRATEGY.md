# Quality Strategy

How this platform is tested, what each layer is responsible for, and what is deliberately
left untested.

## The principle

A green test suite is not evidence that a feature works. It is evidence that the things the
suite actually exercises still behave as they did. The distance between those two statements
is where defects live, and this project has a concrete example of it — see
[The defect that justified this strategy](#the-defect-that-justified-this-strategy) below.

Each layer therefore exists to catch a class of failure the layer beneath it structurally
cannot see.

## The layers

| Layer | Count | Runs against | Catches |
| --- | --- | --- | --- |
| Unit | 22 | Stubbed database and Stripe | Branching, mapping, status logic, guard clauses |
| Integration | 7 | Real PostgreSQL | SQL validity, constraints, idempotency, migrations |
| End-to-end | 17 | Built servers in a real browser | Rendering, hydration, both locales, WCAG AA |
| Load | 3 scenarios | The deployed API under concurrency | Latency regressions, errors under load |
| Vue client unit | 20 | jsdom, fetch mocked at the network seam | Contract validation, store state, partial failure, rendered output |
| Svelte client unit | 10 | jsdom, fetch mocked at the network seam | The same behavioural contract as the Vue suite — if they disagree, a client has drifted |

Total wall-clock for all three, locally: under fifteen seconds.

### Unit — `apps/api/src/**/*.test.ts`

Fast, hermetic, no I/O. The database and the Stripe gateway are both injected, so these
tests can drive every branch cheaply, including ones that are awkward to reach for real: an
unconfigured Stripe key, a forged signature, an event whose `client_reference_id` is not a
UUID.

The webhook's four-way status mapping is covered here — a paid `completed` event, an unpaid
one, `async_payment_failed`, `expired` — because those are pure decisions about which status
a given event implies.

**Structural blind spot:** they never execute SQL. A statement can be syntactically invalid,
reference a column that does not exist, or fail type inference, and every one of these tests
still passes.

### Integration — `apps/api/src/**/*.integration-test.ts`

Runs against a real PostgreSQL instance, seeded and truncated per run. This is where the SQL
is actually executed and where the constraints do their work.

The load-bearing test delivers the same webhook event twice and asserts the transaction and
audit-log counts do not move, then delivers a different event id and asserts they do. That
is the idempotency guarantee stated in
[ADR 0002](decisions/0002-key-webhook-idempotency-on-provider-event-id.md), tested as
behaviour rather than trusted as a code comment.

The migration runner is also tested for idempotency here: a second run must apply nothing.

### End-to-end — `apps/web/e2e/`

Playwright against compiled output — `next build && next start`, not `next dev` — because
the dev server behaves differently enough to hide real problems, and because the built
artifact is what deploys.

These cover what the other layers cannot: that the page renders, that React hydrates, that a
click reaches a handler, and that a failure is visible to a human rather than swallowed.

One test asserts a negative: the retired placeholder figures (`$48,920`, `1,284`) must never
reappear on the page. If someone reintroduces hardcoded numbers where live data belongs, the
build fails. Tests that assert an old bug stays fixed are worth more than their line count
suggests.

## The defect that justified this strategy

The webhook handler shipped with nineteen passing unit tests and had **never once worked**.

`JSONB_BUILD_OBJECT` accepts `"any"`, so an uncast bind parameter has no inferable type and
PostgreSQL rejects the entire statement with `42P18: could not determine data type of
parameter $10`. Every real webhook delivery would have returned 500. The payment flow was
broken end to end.

No unit test could have found it, because every one of them stubs the database. The first
integration test written against real PostgreSQL found it in the first run.

The lesson is not "write more tests." It is that a test suite has a shape, and defects
collect in the places the shape does not reach. The commit is `29a7128`.

## What is deliberately not tested

Stated openly, because unstated gaps read as oversights:

- **Stripe's own behaviour.** Signature verification is stubbed in unit tests and the
  gateway is faked. Verifying that Stripe signs correctly is Stripe's job.
- **The live sandbox redirect.** Completing a payment on Stripe's hosted page requires real
  test keys and is covered by the manual charter below, not by automation. Automating a
  third party's hosted UI produces tests that break when they redesign it.
- **Capacity planning.** `scripts/load-test.mjs` asserts a latency and error-rate baseline
  under modest concurrency, which is the honest claim available on a single shared free
  instance. It is not a capacity model, and calling it one would be theatre.

  Current baseline at 10 concurrent, 120 requests per endpoint: p95 of 546ms (health),
  399ms (metrics), 319ms (transactions), zero errors. The script warms the instance first —
  the free tier sleeps, and measuring a 22-second cold start as latency would misreport it.

  It runs on a schedule and on demand rather than on every push: a failure on a normal
  commit would usually mean the instance was cold, not that the commit regressed.
- **Visual regression.** No baseline screenshots. The layout is not the thing under test.

## Manual and regression charter

Run before any deployment, and after any change to the payment path. This is the part no
automation covers, and it is short on purpose so that it actually gets run.

| # | Check | Expected |
| --- | --- | --- |
| 1 | Load the dashboard with the API stopped | Tiles read "Unavailable"; page still renders |
| 2 | Start the API with no Stripe key | Health shows "Awaiting test key"; checkout button returns a visible error |
| 3 | Configure a restricted test key, click "Test payment" | Redirect to Stripe Checkout |
| 4 | Pay with `4242 4242 4242 4242` | Return to dashboard; success banner shows |
| 5 | Wait for the webhook, refresh | Payment reads Succeeded; gross volume and event count both increase |
| 6 | Replay the event with `stripe events resend <id>` | No new row; counts unchanged |
| 7 | Abandon a checkout, let it expire | Payment reads Canceled |
| 8 | `POST /api/v1/webhooks/stripe` with no signature | `400`, nothing written |

Steps 3 to 7 need Stripe test keys and `stripe listen --forward-to
localhost:4000/api/v1/webhooks/stripe`. See the
[local development runbook](runbooks/LOCAL_DEVELOPMENT.md).

## Gates

Nothing merges without the pipeline passing. `.github/workflows/ci.yml` runs three jobs:

1. **API** — typecheck, unit tests, migrations against an empty database, integration tests
2. **Web** — lint, typecheck, production build
3. **End-to-end** — migrated and seeded database, both servers built and started, Playwright

TypeScript runs in `strict` mode with `noUncheckedIndexedAccess` and
`exactOptionalPropertyTypes`, so the compiler is a gate in its own right rather than a
formatting preference.

The end-to-end job depends on the first two, so a broken build never spends time starting
browsers. Playwright reports upload as artifacts on failure, because a red pipeline with no
evidence attached is a second debugging session rather than the end of the first.
