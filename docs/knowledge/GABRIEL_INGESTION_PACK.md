# ZEROFAYYZ FINTECH — knowledge pack for Gabriel

**Purpose:** a single self-contained document Gabriel can ingest so he knows what this
platform is, how it is built, and — more usefully — the transferable engineering lessons it
produced. Written to be read by a retrieval system, so each lesson states its own context
rather than depending on the section above it.

**Status as of 2026-08-29:** live, 341 automated tests, 30/30 production smoke, 10 CI jobs
green — all ten re-verified green on this date, including visual regression and end-to-end.
The two SPA clients now deploy from CI rather than by hand, after serving a stale bundle for
days (§2, the delivery lessons). Repository is `~/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM`, public at
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

### A health check reports that configuration is present, not that it is correct
A webhook signing secret that is *missing* is easy to catch: the health endpoint says
`unconfigured` and the scheduled monitor fails. A secret that is present but *stale* —
rotated at the provider, never updated on the host — is invisible to exactly the same check,
because it reports the variable's presence. Every signed delivery is then rejected, the
ledger stops moving, and every dashboard stays green. Counting non-2xx responses does not
close it either: a good smoke suite posts unsigned and forged webhooks deliberately, so
rejections are normal traffic and alerting on them produces the report nobody opens.
**Rule:** for any credential whose correctness only shows under real traffic, monitor with a
*positive* control — exercise the credential and require success. Choose a request the system
verifies but does not act on (here, a real provider event type the handler ignores, so a
verified delivery writes nothing), and make a missing credential fail the monitor rather than
silently skip the probe. A negative control proves bad input is refused; only a positive one
proves good input is still accepted.

### A deploy path that is not in the pipeline will drift, whatever the runbook says
Two of the three frontends served a bundle from before a currency fix for several days,
displaying a gross volume of ¥2,203 where the API said `220300` — yen a hundred times too
small, on the one detail this platform makes a point of, on two of the three links a reviewer
would open. The source was already correct on `main`. The clients simply never redeployed:
Vercel cannot build them, because their imports reach above the project root into
`packages/api-contract` (`TS2307`), and pointing the root at the repository makes framework
detection build the API instead. Both failures were known, documented, and correctly worked
around by building locally — and the runbook's answer was a sentence asking a human to run a
script after changing them. **Rule:** every instruction phrased as *something a person must
remember to run* is an outage that has not happened yet. Move it into CI, and make the
automated step fail loudly naming its own missing input — a step that hangs waiting on a
prompt is just a new way to be optional.

### A guard that is optional is not a guard, and the proof is the repeat commit
Installing packages on macOS prunes Linux-only optional dependencies from the lockfile, so
`npm ci` refuses the tree in CI with `Missing: @emnapi/core from lock file`. This reached CI
for the **fourth** time — despite the lesson being written down, and despite a purpose-built
checker (`npm run verify:lock`, thirty seconds inside a `node:22` container) added
specifically to stop it. It exists, it works, and it was not run. **Rule:** when a fix commit
repeats an earlier fix commit's sentence, the defect is not in the code or the documentation —
it is in the fact that the check is opt-in. The remedy is a required pipeline step, not a
more emphatic note.

### A CLI deploy resolves its target from the token, so an unscoped token lands elsewhere
Moving a manual deploy into CI swaps an interactive session for a token, and the token carries
its own default scope. The link step resolves a project *name* against that scope: for projects
owned by a team, a personally scoped token does not fail — it creates a second project of the
same name under the personal account and deploys there. The pipeline goes green while
publishing to a URL nobody is watching, which is the same silent-wrong-target failure the
automation was written to end. **Rule:** name the owning scope explicitly in the workflow
rather than inheriting the token's default; the slug is not a secret (it is public in every
deployment URL), and pinning it means a later widening of the token cannot redirect the
deploy. Read the run log once and confirm the published target, rather than trusting the exit
code.

### A test that passes only on a dirty database is asserting a precondition it never stated
A pagination scenario read the ledger with a limit of 5 and asserted exactly 5 rows came back.
Green on a developer machine, red in CI: `4 !== 5`. The local database still held rows from
earlier runs; CI seeds clean. The deeper trap sat one level down — the endpoint uses
`DISTINCT ON (payments.id)` and returns the *latest event per payment*, because it backs the
dashboard's recent-transactions table, so its depth is the seed's four **payments** and not its
growing count of transaction rows. An intermediate fix that delivered signed webhook events
until the ledger was "deep enough" therefore could never work, and its failure was the clue.
**Rule:** any assertion whose truth depends on how much data exists must either state that
precondition in the test or stay inside what a clean seed guarantees — and must be run against
a fresh database *and* a dirty one before it is believed.

### An unused function with a passing test is armed, not dead
A Vue store exposed a `grossVolume` getter dividing minor units by 100 — the exact error the
rendering path carries a comment warning against, since JPY has no minor unit. Nothing
rendered it; the component read the value through the correct formatter. But a unit test
asserted the getter returned `1222`, pinning the wrong behaviour in place and making it look
deliberate to whoever wired it up next. **Rule:** delete dead code with its test. Coverage over
an unused path is not reassurance, it is a loaded default waiting for a caller.

### A generated directory under version control churns without ever being read
Sixty files of SvelteKit's `.svelte-kit` output were tracked, dirtying the working tree after
every build and putting hashed chunk diffs into reviews of unrelated changes. Every script the
client has — `build`, `typecheck`, `test` — runs `svelte-kit sync` first, so the committed copy
was never read by any of them. It had been committed by omission: the ignore file already
excluded `.next`, `dist`, `build` and `coverage`. **Rule:** before trusting a generated
directory in git, delete it and run the suite. If it comes back, it belongs in `.gitignore`.

### A metric that punishes you for being browsed is measuring the wrong thing
The dashboard's success-rate tile divided succeeded payments by succeeded plus failed plus
**cancelled**, so every reviewer who opened Stripe's page and backed out counted against the
platform. It read 44.7%, then 75.3% — a number that got worse the more people tried the demo,
which is precisely backwards for a portfolio piece. A cancelled checkout is a person changing
their mind before entering a card; it is not a failure of the system. Removing `canceled` from
the denominator made it an authorisation success rate and it read 98.6% — not because the
number was massaged, but because it finally measured what its label claimed. **Rule:** when a
metric moves in the wrong direction as usage grows, suspect the definition before the system.

### A demo nobody can complete is not a demo
The live checkout required Stripe's sandbox test card, and that number appeared nowhere in the
interface — only in a code comment and in test files. A reviewer clicked "Test payment",
landed on a page asking for card details, and had nothing to type. The fix had to reach them
*after* the redirect, because a hint on our own page is out of sight by then: Stripe Checkout
accepts `custom_text.submit.message`, which renders above the pay button on Stripe's own
domain. **Rule:** the reviewer's path is part of the product; walk it as a stranger with no
context, and fix wherever they would stop.

### A configuration flag cannot govern what is not a configuration item
`payment_method_types: ["card"]` was set deliberately to keep wallet buttons off the checkout
page, and Amazon Pay duly disappeared. Apple Pay, Google Pay and Link stayed. Reading Stripe's
own tables explains it: Apple Pay and Google Pay have **no API enum** — they are presentations
of `card`, so any card integration carries them — and Link is governed by the account's wallet
settings rather than by the session. The fix was three toggles in a dashboard, in test mode,
not a line of code. **Rule:** when a setting visibly fails, check whether the thing you are
trying to control is addressable by that setting at all before assuming the setting is broken.

### Pinning a string in a test makes the string the requirement
Naming the test card in the amount hint broke an end-to-end test that matched the entire
sentence, and turned CI red on a public repository twice. What that test actually guards is
that the permitted range is *visible to everyone* rather than screen-reader-only — the exact
wording was never the requirement. Matching on the range alone restored the guard and let the
sentence keep changing. **Rule:** assert the property the test exists to protect, not the
prose that currently expresses it.

### A recording driven by the test harness stays true; a screen capture rots
The platform's walkthrough video is produced by a Playwright script that drives the real
deployment and records itself, rather than by a screen recorder and an editor. It regenerates
in a minute whenever the figures on screen change, which they do every time someone tries the
demo. The first cut was too short for its narration; because the footage is code, the fix was
to lengthen a wait rather than re-shoot. **Rule:** if an artefact carries live numbers,
generate it from the system rather than capturing it by hand, or it becomes a stale claim
nobody remembers to refresh.

### Row-level security over a pool: the context must die with the transaction

Enforcing per-user row visibility in PostgreSQL while connecting through a
connection pool has one classic hazard: session state that outlives the
request. The safe shape is a request lane — a NOLOGIN role adopted with `SET
LOCAL ROLE`, identity carried in `set_config(..., true)` settings — because
all of it is transaction-local by construction and evaporates at COMMIT. Two
design points travel to any project: missing context must resolve to *zero*
rows, never all rows (NULLIF makes an absent setting fail every policy); and
the proof of the guarantee is a test that SELECTs **with no per-user WHERE
clause** and shows the other user's rows absent. A second lane that bypasses
RLS for system work (webhooks, aggregates, migrations) is not a weakness to
hide but a decision to record — forcing RLS through plumbing that has no user
adds risk and nothing observable.

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
| Row-level security | `database/postgres/migrations/007_row_level_security.sql`, `apps/api/src/database/rls.integration-test.ts`, ADR 14 |
| SPA client deploy (CI) | `.github/workflows/deploy-clients.yml`, `deploy-clients.sh` |
| Demo recorder (Playwright) | `apps/web/scripts/record-demo.mjs` |
| Walkthrough video | `docs/portfolio/demo/platform-demo-leda-final.mp4` |
