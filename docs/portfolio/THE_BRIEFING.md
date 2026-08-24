# The Briefing

**Read this one.** Everything that was built, why it was built, and which of it matters to
each company you are applying to. Written 2026-08-23.

If you only have ten minutes before an interview, read §1 and then that company's row in §3.

---

## 1. The whole thing in one page

You built a **cloud payments and operations platform**. A business takes card payments; this
is the system behind that — it creates the payment, talks to Stripe, records what happened,
shows the money, and gives staff a controlled way to act on it.

It is sandbox only. No real money moves, ever.

**Four deployable pieces, one database:**

- An **API** (Fastify/TypeScript) — every rule lives here
- A **dashboard** (Next.js) — the main product, including the admin console
- A **Vue client** and a **SvelteKit client** — the same application again, twice, against
  the same unmodified API
- A **Go reconciler** — a separate program that audits the ledger and is allowed to disagree
  with it
- **PostgreSQL** underneath all of it

**The numbers:** 284 automated tests across eight suites, 28 production checks running
hourly, 8 CI jobs, all green.

**The one sentence to have ready:** *"It's a payments platform — the API, three frontends,
the database, the deployment, the tests and the operations. I built all of it, and the parts
I haven't built are named in the README rather than hidden."*

---

## 2. Everything you built, and why

Grouped by the question each part answers. The *why* matters more than the *what* — anyone
can list features, and almost nobody can explain the reasoning.

### The money path

| Built | Why |
|---|---|
| Stripe hosted Checkout | Card details never touch your system. The alternative — collecting card numbers yourself — drags you into PCI compliance for no benefit |
| Signature-verified webhooks | Stripe tells you what happened by calling your server. Anyone can call your server, so the signature is the only thing separating a real payment from a forged one |
| **Idempotency by database constraint** | Stripe may deliver the same event twice. A UNIQUE index on the event id refuses the duplicate — in the database, not in application code, so the guarantee holds under concurrency and across restarts |
| Money as integer minor units | `17.35 * 100` is `1734.9999999999998` in floating point. A ledger is the last place to round someone's money by accident |
| Two tables, not one | `payments` says where a payment stands now; `transactions` is an append-only log of everything that happened. Merge them and a late message makes the history impossible to reconstruct |

### The locked half

| Built | Why |
|---|---|
| scrypt password hashing | Deliberately slow and memory-hard, so a stolen database is not a stolen password list. Cost parameters live inside each hash, so they can be raised later without locking anyone out |
| Opaque sessions, SHA-256 stored | Only the hash of the session token reaches the database. A database dump grants nobody a session |
| Roles enforced on the API | Hiding a button is decoration. The guard is on the server, and the tests prove it by making the **refused** request |
| **Append-only audit log** | A database trigger refuses UPDATE and DELETE — even from your own application. "We only ever insert" is not an answer when the application is the thing under suspicion |
| Failure-only rate limiting | Five wrong passwords per account per fifteen minutes. Counting *successes* once locked the shared demo account out of its own demo |
| Enumeration defence | A missing account is checked against a decoy hash, so "wrong password" and "no such user" return identical responses in comparable time. Otherwise your login page is a tool for discovering who has an account |
| **Four-eyes refunds** | An operator requests, an admin approves, and the same person can never do both — enforced by the API *and* by a database constraint. Money moving backwards needs two signatures |
| Published demo password | On the login page on purpose, so a reviewer walks in without asking. Safe because the *role* is the boundary: an operator reads everything and changes nothing |

### Proving it works

| Built | Why |
|---|---|
| 284 tests in eight layers | Each layer catches what the one beneath structurally cannot |
| Integration tests against real PostgreSQL | **The story:** the webhook had nineteen passing unit tests and had never worked. Every test stubbed the database, so none ran the real SQL — and the SQL was invalid |
| Accessibility scanned at two viewports | Adding phone width found a real WCAG failure that had been shipping under a green suite |
| Visual regression on the chrome | Catches layout silently breaking. Scoped to surfaces without live data, because a suite that fails whenever the ledger moves is one people learn to ignore |
| A 28-check production smoke suite | Tests prove the code works. This proves *what actually shipped* works |
| The Go reconciler | A checker that shares code with the thing it checks agrees with its bugs |

### Running it, not just building it

| Built | Why |
|---|---|
| Structured JSON logs with a request id | Returned to the caller in a header, so someone reporting a failure hands you the exact string to search for |
| `/ready` separate from `/health` | Different questions. Health stays 200 while degraded, because a process that can describe its own degradation is worth inspecting. Ready returns 503, so a load balancer stops sending payments to an instance that cannot record them |
| Hourly production monitoring | The smoke suite on a schedule. A failed run is an email — monitoring with a person on the end of it |
| A container, non-root, health-checked | Built *and started* in CI on every push, because a Dockerfile nobody has run is decoration |
| Kubernetes manifests | Applied to a real cluster and tested by removing the database: both pods left the load balancer with **zero restarts** |
| Security headers everywhere | Asserted exactly, including on error pages, and verified from the wire |
| Error tracking that cannot become a credential store | Sentry reports carry the request id, so an issue and a log line point at the same request. The scrubbing is written explicitly rather than left to the SDK: cookies, `authorization`, `stripe-signature`, `set-cookie` and the entire query string are stripped before anything leaves the process |

**The one in that table worth saying out loud.** "We added error tracking" is a sentence
everybody has. **"We added error tracking and made sure it couldn't become a credential
store"** is not.

Sentry captures request context by default, and this is a payments API: session tokens live in
cookies, and the Stripe signature header is a shared secret. An error report that shipped
either would quietly turn an incident dashboard into a place where credentials accumulate —
searchable, retained, and visible to anyone with dashboard access. So the scrubbing is
configured in `apps/api/src/observability/error-tracking.ts` rather than trusted to defaults.

The same file makes a second choice worth defending: **it initialises only when `SENTRY_DSN`
is present.** With no DSN the subsystem is inert, the API behaves identically, and `/health`
reports `unconfigured` rather than pretending. A platform should not be hostage to a third
party being wired up.

### Three frontends

The same application built three times against one unmodified API, sharing one description
of every response that is checked at runtime. **Why:** it demonstrates the API boundary is
clean, rather than asserting it — and it shows the fundamentals transfer across frameworks.

---

## 3. Which parts matter to which company

This is the section to reread before each interview.

### Tiger Data — Senior Test Tooling Engineer · *global remote*
**They care about:** release process ownership, GitHub Actions, Python, PostgreSQL,
stress testing and benchmarking.
**Show them:** the eight test layers, the 8 CI jobs, the smoke suite, the load test.
**Lead with:** the webhook that had nineteen passing tests and had never worked — it is a
*PostgreSQL* defect at a PostgreSQL company, found by changing test infrastructure rather
than by writing more assertions.
**Also strong:** the unquoted test glob that silently skipped files (the runner is part of
the suite), and the smoke suite that stayed green through a failed deploy.
**Admit:** no TimescaleDB, no production cluster operations, no benchmarking at their scale.
**Your real edge:** they ask for "end-to-end release process ownership" with no years
number. You have twenty-one years of exactly that, in work where sign-off is a person's
name against a published standard.

### KOMOJU — Platform Quality Engineer · *remote from Japan, relocation*
**They care about:** automated *and* manual testing, CI pipelines, test plans, quality
processes built from the ground up — at a payments gateway.
**Show them:** the test doctrine, the acceptance charter with every defect and its fix, and
the reconciler.
**Lead with:** the same webhook story, pointed at payments — every payment confirmation
would have returned 500 while the suite stayed green.
**Also strong:** the charter's manual walks catching what automation missed, and the
coverage-dimensions story (green suite, real accessibility failure, one viewport).
**Admit:** no AWS or Datadog in production.
**Your real edge:** they are a payments company, you built a payments platform, and your
family is already in Japan — the relocation they expect costs them nothing.

### Piece — Full Stack Developer · *from anywhere in the world*
**They care about:** Node.js backend focus, owning the whole lifecycle including
**monitoring, alerting and support**, and shipping products from scratch.
**Show them:** that you own the lifecycle — architecture through deployment through
monitoring — and that the operations half is running rather than planned.
**Lead with:** the four-eyes refund with claim-act-revert, and idempotency as a database
constraint. Fintech reasoning, at a fintech.
**Also strong:** the Go reconciler (they list Golang), and the open redirect you found in
your own checkout return path.
**Admit:** no Solidity, no React Native — both are on the published roadmap.
**Your real edge:** it is the only one of the five you can hold from Kuwait without moving.

### HENNGE — Frontend/Vue, Email DLP · *Tokyo, hybrid*
**They care about:** Vue 3, Pinia, Vite, Vitest with Testing Library, Playwright, Zod —
plus accessibility and internationalisation as named responsibilities.
**Show them:** the Vue client. Their stack list is matched item for item by something they
can open in a browser.
**Lead with:** runtime contract validation with Zod, and the same application written in
three frameworks from one specification.
**Also strong:** the mobile drawer (focus management, inert background, scroll lock) and the
WCAG failure found by testing at phone width — accessibility as a tested property, not a claim.
**Admit:** Vue is months old, not years.
**Your real edge:** spouse visa — unrestricted work authorisation, no sponsorship, no cost
to them.

### HENNGE — Senior Frontend, Svelte/Tadrill · *Tokyo, hybrid*
**They care about:** SvelteKit, TypeScript, Playwright, Chromatic, Sentry, Go — on a
phishing-simulation security product.
**Show them:** the SvelteKit client with its real `load` function.
**Lead with:** the security posture the frontend does *not* invent — enumeration defence,
the audit trail, refusals surfaced verbatim rather than softened.
**Also strong:** Sentry is not just wired — the scrubbing is written explicitly so cookies,
`authorization` and `stripe-signature` never reach the error dashboard. On a *security*
product that detail is the one they will recognise. Go is in the repository doing real work,
and your visual regression covers Chromatic's job with an honest explanation of the scoping.
**Admit:** the posting says senior and your software career is short. The line that works:
*"My career leading technical teams is twenty-one years. What I have one year of is the
syntax."* Also: no Gmail/Outlook extension work.
**Your real edge:** their posting accepts Svelte "in personal projects or strong interest" —
you took them at their word and shipped one.

---

## 4. The stories that work anywhere

1. **The webhook that never worked.** Nineteen green tests over invalid SQL. *A test suite
   has a shape, and defects collect where that shape does not reach.*
2. **The accessibility suite that was green while a real failure shipped**, because every
   test ran at one screen width. *Coverage has dimensions beyond which assertions you wrote.*
3. **The open redirect you nearly shipped.** Fixing "return the payer where they came from"
   by trusting a request header hands the landing page to the caller. *The naive fix passes
   every test and is a phishing tool.*
4. **The reconciler, and why it had to be another language.** *A checker that shares code
   with the thing it checks agrees with its bugs.*
5. **Four defects found by hand that no test caught** — all written into the charter with
   their fixes. *A defect log that lists only successes is marketing.*

---

## 5. When you do not know something

Say so, then say what you would do. It is the strongest move you have, and it is the one
most candidates cannot make because they have oversold something earlier.

> *"I haven't used that. Here's the nearest thing I have done, and here's how I'd start."*

Three of these five companies use a take-home exercise or a public coding challenge. A
claim that does not survive contact does not merely fail — it discredits everything true
you said before it. Everything in this document is real and inspectable, which is exactly
what makes the admissions safe.

---

## 6. If they ask what you would build next

- Rate limiting the public checkout endpoint
- A nonce-based CSP for the dashboard (Next.js hydrates through inline scripts; a policy
  with `unsafe-inline` announces a CSP while permitting what CSP exists to stop)
- `sslmode=verify-full` on the database connection
- Keyset pagination when the ledger outgrows limit/offset

Naming these tells an interviewer you know where the edges are.
