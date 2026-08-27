# ZEROFAYYZ FINTECH — knowledge pack for Gabriel

**Purpose:** a single self-contained document Gabriel can ingest so he knows what this
platform is, how it is built, and — more usefully — the transferable engineering lessons it
produced. Written to be read by a retrieval system, so each lesson states its own context
rather than depending on the section above it.

**Status as of 2026-08-27:** live, 331 automated tests, 28/28 production smoke, 10 CI jobs
green. Repository is `~/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM`, public at
github.com/marcelgilbertdev-oss/zerofayyz-fintech. **Separate from the gabriel repo — no
shared code.**

---

## 1. What it is

A cloud payments and operations platform, built as the demonstration artifact for four
Japan-market job applications plus one global remote role. Stripe sandbox only; no real
funds move. Three frontends and one API share a single Zod-validated contract, backed by
PostgreSQL, with an independent ledger reconciler in Go.

**Architecture in one line:** Fastify/TypeScript API on PostgreSQL, consumed unmodified by
a Next.js dashboard, a Vue 3 SPA and a SvelteKit SPA, each validating every response at the
network boundary against one shared schema.

## 2. The lessons, stated so they transfer

These are the reusable part. Each is a rule plus the specific failure that produced it.

### A test suite has a shape, and defects collect where it does not reach
A webhook handler had nineteen passing unit tests and had never once worked. Every test
replaced PostgreSQL with a stand-in, so none executed the real SQL, and the SQL was
invalid (`JSONB_BUILD_OBJECT` accepts `"any"`, so an uncast bind parameter had no inferable
type — Postgres error `42P18`). The first integration test against a real database found it
immediately. **Rule:** for anything crossing a boundary — SQL, HTTP, filesystem — at least
one test must cross it for real.

### Coverage has dimensions beyond which assertions you wrote
An accessibility suite was green for months while a genuine WCAG A failure shipped, because
every test ran at desktop width. Ledger tables only become scroll containers when they
overflow; at desktop they fit, so `scrollable-region-focusable` never fired and keyboard
users could not scroll them. **Rule:** parameterise over viewport, locale, auth state and
data volume — not only over cases. A green suite is evidence about the dimensions it varied.

### The test runner's invocation is part of the suite's shape
Four new tests did not move the total. The runner's glob was unquoted, so the shell expanded
it, and in `sh` that pattern requires a directory component — every test file directly in
the source root was silently never executed. **Rule:** quote globs so the runner expands
them; when a count fails to rise after adding tests, investigate the runner before the tests.

### A caller-chosen redirect target on a public endpoint is an open redirect
Returning a payer to "where they came from" by reading the request's `Origin` header and
handing it to a payment provider hands control of the landing page to whoever calls the
endpoint. Through a real Stripe page that is a phishing primitive. **Rule:** allowlist with
exact whole-origin equality and a safe fallback. `startsWith` passes
`https://real-site.example.attacker.test`; subdomain and http-downgrade variants must be
tested too.

### Liveness and readiness are different questions — test the divergence itself
`/health` should stay 200 while degraded, because a process that can describe its own
degradation is alive and diagnosable. `/ready` must return 503 the moment a hard dependency
is unreachable, so an orchestrator drains the instance. Conflating them means a deploy
passes its check and then serves 500s; pointing a Kubernetes liveness probe at readiness
turns a database blip into a cluster-wide crashloop. **Rule:** one test should take the
dependency down and assert *both* endpoints in the same breath — the divergence is the
design.

### A checker that shares code with what it checks agrees with its bugs
Where mutable current state sits alongside an append-only log, the log is the record of
truth and state can silently diverge. The checker must be an independent implementation —
separate process, different language, reading the store directly. It must read and never
write, because something able to "fix" a discrepancy is able to destroy the evidence of it.
It must sort events by occurrence time, because a log is ordered by when facts were
*learned*. It must refuse unknown event types loudly, so a new lifecycle state breaks it
rather than passing unchecked forever.

### A report with false positives is a report nobody opens
Partial refunds emit the same event type as full ones, so "a refund event exists, therefore
refunded" flags every partially refunded payment. The naive rule does not produce a noisy
tool; it produces an ignored one. **Rule:** before shipping a checker, ask which legitimate
state it will misreport.

### Verify a new check by watching it fail for the right reason
A smoke check shipped referencing an undefined constant and failed with a `ReferenceError`
rather than a verdict — twice, in the same file. Another version of the suite stayed green
while a failed deploy left the previous build serving, because every check matched text both
builds contained. **Rule:** a check nobody has seen fail correctly is not a check; a smoke
suite that cannot distinguish the new build from the old cannot detect a failed deploy.

### A tool's input schema is a promise, and nothing checks it by default
An MCP tool advertised `limit` and `offset` for every ledger resource. One endpoint behind
it took no request argument at all and hardcoded its window, so `?limit=5` returned ten rows
— an agent paging the ledger got wrong answers that looked right. Response-shape validation
could not catch it: the shape was valid, only the row count was wrong. The contract never
promised paging; the *tool schema* did. **Rule:** every parameter a tool accepts is a claim
about the system behind it. Test the claim against the real endpoint, or do not accept the
parameter — an inert parameter is worse than an absent one, because the caller cannot tell.

### A compatibility shim should detect its own obsolescence
When a client works around a server-side gap, the workaround usually outlives the gap and
becomes the next bug. Given the paging defect above, the fix inferred from each *response*
whether the server had honoured the request — paged endpoints echo the effective `limit`
back in their metadata — and applied the fallback only when it had not, reporting which of
the two had happened. Deploying the server fix flipped it from `client` to `server` with no
code change and nothing to remember. **Rule:** prefer a shim that asks the system what it
did over one that hardcodes what the system was once unable to do. A per-resource exception
table is a stale document waiting to happen; a response probe is self-healing.

### An additive optional field beats a shape change when clients deploy separately
Adding `total`/`limit`/`offset` to a response meta could have been a breaking contract
change requiring three clients to recompile and redeploy in lockstep with the API. Making
them **optional**, keeping the existing field, let old clients validate the new API and new
clients validate the old one — the API shipped alone, no client redeploy. **Rule:** where
producer and consumer deploy independently, every contract addition is optional until both
sides have shipped. The precedent is worth naming in the schema so the next person extends
it the same way rather than tightening it.

### Visual regression belongs on deterministic surfaces
Full-page screenshot comparison against data-driven pages cannot be stable: row count
changes page *height*, so a baseline from a developer's database fails against a freshly
seeded one (observed: 1488px vs 1422px). Masking values does not help — the geometry is
wrong before any pixel inside the mask is compared. **Rule:** scope visual tests to chrome
and static surfaces; use a numeric assertion (`scrollWidth <= clientWidth`) for overflow
bugs; record baselines in the same renderer CI uses.

### A mobile grid collapse to bare `1fr` reintroduces the blowout `minmax(0, …)` fixes
A grid item's implied minimum is its min-content, so a bare `1fr` track cannot shrink below
its widest child — a 640px table inside an `overflow-x: auto` wrapper still propagates 640px
through the grid item. The trap: the *wide* template is usually written correctly, because
the author hit the blowout on desktop, and then the phone media query is written as plain
`1fr`. **Rule:** collapsed single-column templates are `minmax(0, 1fr)`.

### Publishing a credential can be the feature, if the role is the boundary
The demo operator password is printed on the login page on purpose, so a reviewer can walk
in without asking. That is safe because the account is an operator: it reads everything and
changes nothing. **Rule:** the boundary is authorisation, not secrecy — and authorisation is
tested by making the *refused* request, not the permitted one.

### Configuration reaching production is not implied by a deploy
Env vars added to a platform blueprint do not reliably propagate to an already-running
service, and an unset value fails silently. **Rule:** report configuration status on a health
endpoint (the count, never the values) and assert it from the wire in a smoke check.

## 3. The security posture, as a reusable checklist

| Concern | Approach |
| --- | --- |
| Passwords | scrypt from the standard library, cost parameters stored inside each hash so they can be raised without locking anyone out |
| Sessions | Opaque 32-byte tokens; only the SHA-256 reaches the database. Revocation evaluated in SQL on every request |
| Cookies | HttpOnly, Secure (unconditionally — a cookie Secure in one environment and not another is a difference found in the wrong one), SameSite=Lax so the Stripe return survives |
| Brute force | Failure-only rate limiting keyed on the *attempted account*, because `x-forwarded-for` is caller-controlled. Counting successes once locked a shared demo account out of its own demo |
| Enumeration | Missing accounts verified against a decoy hash, so wrong-password and no-such-user return byte-identical responses in comparable time |
| Audit integrity | Append-only enforced by a database trigger, not convention. No foreign keys with `ON DELETE` actions, because those are write paths into an immutable table |
| Four-eyes | Requester ≠ approver, enforced by API *and* CHECK constraint; approval claims the request in an atomic UPDATE before the external call and reverts on failure |
| Headers | Strictest set on the JSON API (`default-src 'none'`); frame-ancestors and nosniff everywhere. Asserted exactly, including on 404/401 paths |
| Logs | Credential-bearing headers redacted at the logger; request id correlates lines and is returned to the caller |

## 4. What it deliberately does not have

Named because absence is a decision: Solidity, React Native, TimescaleDB, managed
Kubernetes operations, benchmarking at scale, and a script-src CSP on the Next.js dashboard
(Next hydrates through inline scripts, and a CSP with `unsafe-inline` announces a policy
while permitting what CSP exists to stop — the nonce work is deferred honestly).

## 5. Pointers

| Subject | Path |
| --- | --- |
| Architecture | `docs/architecture/SYSTEM_OVERVIEW.md` |
| Decisions (10) | `docs/decisions/` |
| Test doctrine | `docs/QUALITY_STRATEGY.md` |
| Charter, with every defect found | `docs/runbooks/MANUAL_ACCEPTANCE_TEST.md` |
| Container | `docs/runbooks/CONTAINER.md` |
| Kubernetes + failure-mode transcript | `docs/runbooks/KUBERNETES.md` |
| Go reconciler | `services/reconciler/README.md` |
| Marcel's own explanation | `docs/portfolio/EXPLAIN_IT_IN_YOUR_OWN_WORDS.md` |
