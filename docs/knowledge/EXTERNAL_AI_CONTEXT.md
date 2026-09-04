# ZEROFAYYZ FINTECH — context for an external AI (ChatGPT, or any fresh assistant)

**How to use this:** paste the whole file into a new chat before asking for help with this
project. It assumes the assistant has **no access to the repository, the database, or the
deployed system** — so every fact it needs is stated here rather than referenced.

Written 2026-08-23. If the numbers below disagree with the repository, the repository wins.

---

## Who is asking

Marcel Gilbert. Twenty-one years leading technical teams in safety-critical aviation
maintenance across four countries (US Air Force, Lockheed Martin, DynCorp, Zenetex, AAR),
B.S. Information Technology 2017, now a software engineer. Lives in Kuwait; wife and
children hold Japanese permanent residency, and his own residency comes through hers with
unrestricted work authorisation. Building this platform as the demonstration artifact for
five job applications.

**How he prefers to work:** direct answers, no flattery, honest gaps named rather than
papered over. He would rather be told something is missing than be told what he wants to
hear.

## What the system is

A cloud payments and operations platform. Stripe **sandbox only** — no real money moves,
ever. Live at `zerofayyz-fintech.vercel.app`; source public at
`github.com/marcelgilbertdev-oss/zerofayyz-fintech`.

**Shape:** one API, three frontends, one database, one independent checker — plus two consumers outside the repository: a Manifest V3 extension (endpoint-pulse) and a customer receipt portal built entirely on Supabase (receipt-portal, ADR 17).

| Piece | Technology | Deployed on |
| --- | --- | --- |
| API | Fastify 5 + TypeScript (ESM) | Render |
| Dashboard | Next.js 16, server-rendered | Vercel (auto-deploys) |
| Second client | Vue 3, Composition API + Pinia | Vercel (**manual** deploy) |
| Third client | SvelteKit, static adapter, runes | Vercel (**manual** deploy) |
| Database | PostgreSQL 18 | Neon |
| Ledger checker | **Go** | Run on demand / in CI |
| Shared contract | Zod schemas in `packages/api-contract` | Consumed by all three clients |

All free tier, $0/month. The API sleeps after ~15 minutes of no traffic and takes ~30–50
seconds to wake; a scheduled job pings it every 10 minutes to make that rare.

## The things that matter about how it is built

**The public/private split.** The dashboard and ledger reads are genuinely public, because a
reviewer must never meet a login wall. Writing anything requires a role
(`viewer` / `operator` / `admin`), enforced on the API rather than by hiding UI.

**The demo credentials are published on purpose** — `demo@zerofayyz.test` /
`view-the-ledger`, printed on the login page. Safe because the role is the boundary: an
operator reads everything and changes nothing.

**Idempotency is a database constraint, not application code.** Duplicate Stripe webhook
deliveries are refused by a UNIQUE index on the provider event id, so the guarantee holds
under concurrency and across restarts.

**Two tables, deliberately.** `payments` holds current state; `transactions` is an
append-only event log that a database trigger refuses to let anything UPDATE or DELETE. The
log is the record of truth.

**Refunds use a four-eyes rule.** An operator requests, an administrator approves, and the
same account can never do both — enforced by the API *and* by a CHECK constraint. Approval
claims the request in an atomic UPDATE before calling Stripe and reverts on failure. The
ledger moves only on the signed `charge.refunded` webhook.

**Two health endpoints, answering different questions.** `/api/v1/health` stays 200 while
degraded; `/api/v1/ready` returns 503 when the database is unreachable. Conflating them is
how a deploy passes its check and then serves 500s.

**An independent reconciler in Go** re-derives every payment's state from the event log and
exits non-zero when it disagrees with the payments table. Separate language on purpose: a
checker sharing code with what it checks agrees with its bugs. It reads and never writes.

**Row visibility is decided by the database, in a request lane.** User-serving reads adopt a
NOLOGIN role for the length of one transaction, and PostgreSQL policies — not WHERE clauses —
decide which rows exist. The proof is a test that SELECTs with no per-user filter and finds
the other user's rows absent. A second lane deliberately bypasses RLS for system work
(webhooks, aggregates, migrations), recorded as a decision rather than hidden (ADR 14).

**The job queue is PostgreSQL, not a second piece of infrastructure.** Claims are atomic over
`FOR UPDATE SKIP LOCKED`, a lease reclaims work from a crashed worker, retries back off to a
cap and then dead-letter, and enqueue is idempotent through a UNIQUE key. The guarantee is
at-least-once and is stated that way, because exactly-once does not survive a worker dying
between the work and the acknowledgement. Operator surface: `/admin/jobs`. First consumer: an
hourly session-retention cleanup that re-chains itself (ADR 15).

**Passwordless sign-in by magic link.** The database stores only a SHA-256 of the token;
single use is one atomic UPDATE (`used_at IS NULL` in the WHERE), so two clicks racing produce
exactly one session. The fifteen-minute expiry and the disabled-account check are decided in
SQL. The request path always answers 202 whether or not the account exists, and is rate
limited per mailbox counting every request. The email leg is the queue's second consumer, so
an unconfigured mailer surfaces as a visible dead job rather than a silent failure — and the
link is never written to a log (ADR 16).

## Current numbers (2026-09-02)

- **384 automated tests** across ten suites: 82 API unit · 80 integration against real
  PostgreSQL · 11 web unit · 70 Playwright end-to-end · 45 Vue · 34 Svelte · 12 Go ·
  6 visual regression · 31 MCP · 13 Cucumber/BDD scenarios
- **30/30** production smoke checks, run hourly against the live system — including a signed-webhook probe that catches a stale signing secret, which `/health` cannot see because it reports the variable's presence rather than its correctness
- **10 CI jobs**, all green
- Load test: p95 ≤ 405ms, zero errors at 10 concurrent
- English and Japanese; WCAG 2.1 AA scanned by axe-core in CI at desktop **and** phone width

## What it does not have — do not suggest claiming otherwise

Solidity, React Native, TimescaleDB, managed Kubernetes operations, benchmarking at scale,
Gmail/Outlook extension development, and a `script-src` CSP on the dashboard (Next.js
hydrates through inline scripts; a CSP with `unsafe-inline` announces a policy while
permitting exactly what CSP exists to stop, so the nonce work is deferred rather than faked).

## Rules for helping with this project

1. **Never invent capability.** Three of the five target companies use take-home exercises
   or public coding challenges. A fabricated claim does not merely fail — it discredits the
   true material, which is strong.
2. **Never handle credentials.** Marcel pastes API keys, connection strings and passwords
   himself. Do not ask for them, do not echo them, do not put them in a file. If a secret
   appears somewhere visible, the order is: rotate first, investigate second.
3. **The admin password exists only in his head or a password manager.** The *demo*
   password is public by design; the admin one never appears in chat, a repo, or a script.
4. **Pushing to `main` does not update the Vue and Svelte clients.** They deploy manually
   via `./deploy-clients.sh web-vue` and `./deploy-clients.sh web-svelte`. Forgetting this
   has already overwritten a verified deployment once.
5. **Verify before asserting.** This project's recurring lesson is that green tests are
   evidence about what was tested, never about what wasn't.

## The stories worth telling in an interview

- **The webhook that never worked**: nineteen passing unit tests, all stubbing the database,
  over SQL that was invalid. Found by the first integration test against real PostgreSQL.
- **The accessibility suite that was green while a real WCAG failure shipped**, because
  every test ran at one screen width.
- **The open redirect he nearly shipped** while fixing a checkout-return bug — the naive fix
  reads the request's Origin header, which hands the landing page to the caller.
- **The reconciler**, and why it had to be a different language.
- **Four defects found by hand that no test caught**, all recorded in the acceptance charter
  along with their fixes — because a defect log listing only successes is marketing.
