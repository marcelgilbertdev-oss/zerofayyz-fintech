# Explain It In Your Own Words

Plain English first, then the exact phrase to use out loud. If you can say the
**bold lines** without reading, you can hold your own in any interview about
this platform.

---

## 1. What did you build?

**Plain:** A website that takes a card payment and keeps a perfect record of what
happened to it. The money part is fake — it runs in Stripe's test mode — but
everything else is real.

**Say:** *"A cloud payments and operations platform. Stripe hosted checkout,
signature-verified webhooks, and an auditable transaction ledger in PostgreSQL,
with a live operations dashboard on top. The dashboard is public; behind a login
there's an admin console with role-based access, live session presence, and an
append-only audit log. Sandbox only — no real funds move."*

---

## 2. Why is that hard? It's just a payment.

**Plain:** Taking the payment is easy — Stripe does that. The hard part is
*knowing* what happened afterwards. When someone pays, the money doesn't move
instantly and nobody tells you straight away. Stripe sends a message later. That
message can arrive late, arrive twice, arrive out of order, or come from someone
pretending to be Stripe. A payments system is mostly the discipline of handling
all four correctly, every time.

**Say:** *"The interesting engineering isn't accepting the payment, it's being
able to prove afterwards what happened. Delivery is at-least-once and
asynchronous, so the system has to be correct under duplicates, late arrivals,
and forged requests."*

---

## 3. What are the parts?

**Plain:** Three pieces, each somewhere different.

| Piece | Plain English | The word to use | Where it runs |
|---|---|---|---|
| Dashboard | The screen you look at | frontend | Vercel |
| API | The engine behind it | backend | Render |
| Database | The permanent record | PostgreSQL | Neon |

All three are in **Singapore**.

**Say:** *"All three tiers are colocated in one region. A page load goes viewer →
Vercel → Render → Neon; if those are spread across continents every load pays
three intercontinental round-trips. Colocated, the database answers in about
three milliseconds."*

---

## 4. Walk me through a payment.

**Plain, in order:**

1. You click **Test payment**
2. The site's own server asks the API to start a checkout
3. The API writes "payment started" to the database *first*
4. The API asks Stripe for a checkout page
5. You go to **Stripe's** site and type your card there
6. Stripe sends a signed message back to the API saying it succeeded
7. The API checks the signature is genuine, then records it
8. The dashboard reads the record

**The three points that show judgement:**

- **The browser never knows where the API lives.** The page is rendered on the
  server, so no API address or key is ever in the browser.
- **The payment row is written before Stripe is called.** If Stripe fails, there
  is still a record that an attempt happened, marked failed.
- **Only a signed webhook can mark a payment successful.** A user landing on the
  success page proves nothing — they could have typed that URL.

**Say:** *"The only thing I trust to mark a payment succeeded is a
signature-verified webhook, verified against the raw unparsed body."*

---

## 5. The two ideas to know cold

### Idempotency

**Plain:** Stripe might tell you the same thing twice. If you write it down
twice, your books are wrong. The obvious fix — "check if we've seen it, then
write" — breaks when two copies arrive at the same moment: both check, both find
nothing, both write. So instead the *database* is told that each Stripe message
may only ever be recorded once. It doesn't matter how many arrive; the second is
ignored.

**Say:** *"Idempotency is enforced by a unique constraint on the provider's event
id with ON CONFLICT DO NOTHING, not by application branching. It holds under
concurrent delivery, across restarts, and across any number of instances, because
it's a property of an index rather than code someone can edit. I proved it in
production by resending a live Stripe event — no duplicate row, no
double-counted revenue, no second audit entry."*

### Two tables, not one

**Plain:** One table says *where a payment stands now*. Another is an
append-only list of *everything that happened and when we learned it*. If you
merge them, a late message makes it impossible to reconstruct the truth.

**Say:** *"Mutable payment state is separated from an append-only event log. That
costs a join and it's what makes the ledger auditable."*

---

## 6. How do you know it works?

**Plain:** Four kinds of testing, each catching what the others can't.

| Layer | Count | What it catches | What it's blind to |
|---|---|---|---|
| Unit (API, web, MCP, Go) | 136 | Logic, branching, hashing, cookies, rate limiting, tool schemas | Anything involving real SQL |
| Integration | 42 | Real database: SQL, constraints, triggers, idempotency, auth | Rendering, the user's path |
| End-to-end + visual | 71 | Real browser: sign-in, roles, accessibility, both locales, layout | Whether the deployed thing works |
| Client (Vue/Svelte) | 79 | Contract validation, state, sign-in, partial failure | — |
| Business rules (Cucumber) | 13 | The payment rules as readable, executable specifications | — |
| Production smoke | 30 | That what *shipped* actually runs — hourly, with an email on failure | — |

*(Counts verified by running every suite on 2026-08-29 — 341 in total.)*

**Say:** *"341 automated tests plus 30 production checks, all gated in CI.
The layers exist because each catches a class of failure the layer beneath
structurally cannot — the integration suite exists because 19 green unit tests
never once executed the SQL that was broken."*

**One layer worth explaining separately:** the production smoke suite checks
things that exist **only in the newest build**. That sounds pedantic until you
know why: it once stayed green while a failed deploy left the old version
serving, because every check matched text both builds contained. A smoke suite
that can't tell the new build from the previous one can't detect a failed
deploy, which is its main job.

---

## 7. The story to lead with

**Plain:** The part that receives Stripe's messages had **nineteen passing tests
and had never once worked.** Every one of those tests swapped the real database
for a stand-in, so none ever ran the actual database instruction — and that
instruction was invalid. In production, every payment confirmation would have
failed. The first test written against a real database found it immediately.

**Say:** *"The tests weren't wrong and there weren't too few of them. A suite has
a shape, and defects collect exactly where that shape can't reach. Adding a
different kind of test — not more of the same kind — is what found it."*

**Why this lands:** it shows you can be wrong in public, diagnose precisely, and
draw a general lesson. That is more convincing than a project with no scars.

---

## 8. Why three frontends?

**Plain:** The same dashboard, built three times — React, Vue, and Svelte — all
talking to one API and sharing one description of what that API returns.

**Say:** *"One API, one contract, three independently-built clients. It
demonstrates that the API boundary is clean enough for three different consumers
to use unmodified, and that the fundamentals — state, data fetching, validation,
testing — transfer across frameworks. The Vue and Svelte test suites assert the
same behavioural contract deliberately, so if they ever disagree, one client has
drifted."*

### The staff door is on all three now

**Plain:** The Vue and Svelte pages each have an **Operator area** at the bottom.
Sign in there with the same demo account and you get the audit trail — the
protected read. Same cookie, same rate limiter, same error messages, written
once in Pinia and once in runes.

**Say:** *"Authentication isn't a React feature — it's an API feature. The Vue
and Svelte clients prove that: the session is an HttpOnly cookie the API owns,
so each client only mirrors what /auth/me admits, and the same sign-in works
identically from all three frameworks. The refusals are the API's own strings,
surfaced verbatim — the clients never invent their own security theatre."*

**If asked about Zod:** *"Each client compiles against a copy of the API's types
— nothing at build time proves the deployed API still matches. Zod turns that
assumption into a runtime check at the boundary, so a drifted response fails
loudly naming the field instead of surfacing as undefined three components deep."*

---

## 9. Languages and accessibility

**Plain:** It works in English and Japanese, and it's been checked for people
using screen readers or keyboards only.

**Say:** *"Locale is negotiated once server-side, so the page content and the
html lang attribute can't disagree — a Japanese page labelled English is an
accessibility defect, not a cosmetic one. Translations are enforced by the type
system, so a missing string is a compile error. Accessibility is checked by
axe-core in CI against both locales, gated on WCAG 2.1 AA — introducing it found
14 real contrast failures in my own design, which are fixed."*

---

## 10. The locked half: accounts, roles, and the audit log

**Plain:** Anyone can look at the dashboard. To *do* anything — see who's signed
in, kick someone out, read the history — you need an account, and what you're
allowed to do depends on which kind of account you have.

**Why it's split that way:** a recruiter must never hit a login wall, so the
dashboard stays open. But a payments platform with no access control isn't
finished. Showing both halves proves you made a *decision* about where the
boundary goes, rather than putting one padlock on the front door.

### Passwords

**Plain:** Passwords aren't stored. A scrambled version is stored, and the
scrambling only goes one way.

**Say:** *"scrypt, from Node's standard library. I chose it over Argon2 — which
is the better algorithm — because Argon2 ships as platform-specific native
binaries, and that exact dependency shape had already broken my CI twice. A
password hash is the last thing that should be missing on one platform. The cost
parameters are stored inside each hash, so I can raise them later without
locking out every existing user."*

**If they push on scrypt vs Argon2, agree with them.** Argon2id resists GPU
attack better. Say so, then say why the deployment risk mattered more here.

### Sessions

**Plain:** When you sign in, you get a random meaningless number in a cookie. The
real record lives in the database, so it can be switched off.

**Say:** *"Opaque server-side sessions, not JWTs. A JWT can't be revoked before
it expires — every server honours it until the clock runs out. I needed two
things a JWT can't do: sign someone out immediately, and show who's signed in
right now. Only the SHA-256 of the cookie is stored, so a database dump hands an
attacker nothing they can present as a session."*

**The demo that lands:** an admin ends a session; the holder's cookie hasn't
changed and hasn't expired; their very next request fails. That's in the
acceptance charter, verified live.

### The audit log

**Plain:** A history of what happened that even the app itself can't edit.

**Say:** *"Append-only, enforced by a database trigger rather than by convention
— the application is the thing under suspicion, so 'we only ever insert' isn't
an answer. Making it truly immutable forced out the foreign keys: `ON DELETE SET
NULL` is a write into the audit table performed by the database on another
table's behalf, so the trigger refused it and nothing could be deleted at all.
Any foreign key with an ON DELETE action is a mutation path into an immutable
table."*

That last sentence is worth memorising. It's the kind of thing that sounds like
experience because it is — it came from a real collision, not a book.

### Two details worth volunteering

**Enumeration:** *"A wrong password and a nonexistent account return identical
responses in comparable time — missing accounts are verified against a decoy
hash, so response timing can't be used to discover which emails exist."*

**Rate limiting, and the bug in it:** *"Five failed attempts per account per
fifteen minutes. It originally counted every attempt, and my own test suite
caught the problem: the shared demo account is the one guaranteed to see bursts
of concurrent *successful* logins, so the sixth reviewer in a busy window would
have been locked out of the demo — and a lockout looks exactly like an outage.
It counts failures only now. What's being limited is guessing, and a correct
password isn't a guess."*

That story is strong because it's a **denial-of-service against your own demo,
found by a test that looked like a flake.** Most candidates don't have one.

### Privacy — say this at HENNGE especially

**Plain:** The system can tell two visitors apart without knowing who or where
they are.

**Say:** *"Audit logs usually capture IP addresses. Strangers log into this demo,
so I store a keyed hash of the network prefix instead — enough to distinguish
sessions and rate-limit abuse, not enough to identify or locate anyone. The
schema comments say so, and a test asserts that what leaves the API isn't shaped
like an IP address."*

**Why it matters at HENNGE:** they build data-loss prevention. A candidate who
minimised what they collected *on purpose*, and can explain the reasoning, is
speaking directly to what they do.

---

## 10b. Running it in production (the operations half)

**Plain:** Building it is half. The other half is knowing when it breaks and
being able to find out why.

**Say:** *"Every log line is JSON with a request id, and the same id comes back
to the caller in a header — so if someone tells me a request failed, they hand
me the exact string to search for instead of a rough time. Authorization,
cookie and signature headers are redacted at the logger, because a log store
that quietly becomes a second copy of your credentials is a breach waiting for
an audience."*

**On the two health endpoints — this one lands well:** *"`/health` and `/ready`
answer different questions. `/health` stays 200 even when the database is down,
because a process that can describe its own degradation is alive and worth
inspecting. `/ready` returns 503 the moment the database is unreachable,
because a load balancer asking 'may I send traffic here' needs the answer no.
Conflating them is how a deploy passes its health check and then serves 500s.
The test I'm proudest of takes the database down and asserts both at once —
503 from one, 200 from the other — because the divergence is the whole design."*

**On alerting:** *"The smoke suite already interrogated the live deployment
from outside, so I scheduled it hourly. A failed scheduled run is an email to
me. That's monitoring with a person on the end of it, and it needed no new
infrastructure to operate or pay for."*

**On error tracking — this is the one they don't expect:** *"Logs answer 'what
happened to this one request'. They don't answer 'is this error new, how often
is it happening, and did the last deploy cause it' — that's what an error
tracker is for, and it's the difference between logs somebody could read and
errors somebody actually sees. Reports carry the request id, so a Sentry issue
and a log line point at the same request."*

*"The part I'd want you to look at is the scrubbing. Sentry captures request
context by default, and this is a payments API — session tokens live in
cookies and the Stripe signature header is a shared secret. So cookies,
authorization, stripe-signature, set-cookie and the entire query string are
stripped before anything leaves the process, configured explicitly rather than
trusted to the SDK's defaults. Otherwise you've turned an incident dashboard
into a place credentials accumulate: searchable, retained, and visible to
everyone with dashboard access. 'We added error tracking' is common. 'We added
error tracking and made sure it couldn't become a credential store' is the
version that matters on a payments system."*

**And on it being optional:** *"It initialises only when a DSN is present. With
no DSN the subsystem is inert, the API behaves identically, and /health reports
'unconfigured' rather than pretending. I didn't want the platform hostage to a
third party being wired up — and I didn't want a health page that lies about
it either."*

**On the container:** *"Multi-stage, so the toolchain that built it doesn't
ship. Production dependencies re-resolved, so TypeScript and the test tooling
aren't in the runtime. Runs as a non-root user. Health-checked against /ready,
not /health, for the reason above. And CI starts it on every push and waits for
the container's own healthcheck — a Dockerfile nobody has run is decoration."*

---

## 10c. The bug that taught me about coverage dimensions

**Plain:** My accessibility tests passed for months while a real accessibility
failure shipped, because every test ran at one screen size.

**Say:** *"The tables scroll sideways when they don't fit. A scroll container
that isn't focusable strands keyboard users — that's a WCAG A failure. But at
desktop width the tables fit, so they never scrolled, so the rule never fired.
Adding a phone viewport to the suite found it in the first run. The lesson
isn't 'test more'. It's that coverage has dimensions beyond which assertions
you wrote — viewport was one I'd assumed instead of tested, and the same pass
found the app had no navigation at all below the desktop breakpoint."*

**Why this is a good story to tell:** it's the same shape as the webhook
defect. Green tests are evidence about what was tested, never about what wasn't.

---

## 10d. The rules are executable: Cucumber

**Plain:** The platform's most important behaviours are business rules, not code
shapes: money moves only on the provider's signed event; the same webhook
delivered twice records once; one minor unit of yen is one yen; nobody approves
their own refund. Each is stated in a `.feature` file in plain language and
executed by the real Cucumber runner — five features, thirteen scenarios.

**Say:** *"A compliance reviewer can read `four-eyes-refunds.feature` in ninety
seconds, dispute it, and then watch it execute. The test IS the specification —
there's no translation step where the document and the behaviour drift apart."*

**If they dig:** the pagination feature is regression coverage for a real
defect, and its first version only passed on a database that earlier runs had
left dirty — it asserted five rows against a seed that holds four payments. The
lesson worth saying out loud: *"a test that passes only on a dirty database is
asserting a precondition it never stated."*

---

## 10e. An AI agent can drive the QA surface (MCP)

**Plain:** The platform exposes its QA surface over the Model Context Protocol —
six tools an AI agent can call: run the suites, replay signed webhooks, check
ledger invariants, diff live responses against the contract. It's a protocol
server with its own handshake check in CI, because a protocol server whose
handshake is broken has a green unit suite and zero working tools.

**Say:** *"I didn't bolt AI onto the demo — I gave the platform a QA surface an
agent can operate. On its first human-driven run it found a live defect: the
transactions endpoint advertised limit and offset, accepted both, ignored both,
and returned the full window while reporting success. Response validation
couldn't catch it because the shape was valid — only the row count was wrong.
The fix taught me that every parameter a tool accepts is a claim about the
system behind it, and the claim needs a test."*

**Why this matters where you're applying:** PayPay's posting names MCP servers,
OpenAI-key handling and LLM-workflow validation as requirements. This is a
running artifact, not a coursework claim.

---

## 10f. Monitoring that proves the credential, not the config

**Plain:** `/health` reports that the webhook signing secret is *present*. It
cannot know the secret is *right*. Rotate it in Stripe and forget the host, and
every delivery is rejected while every dashboard stays green — the ledger
silently stops. Counting error responses can't catch it either, because the
smoke suite posts deliberately-forged webhooks, so rejections are normal here.

**Say:** *"The hourly monitor signs a real Stripe event type the handler
deliberately ignores and requires the API to accept it. Verified delivery,
nothing written. A negative control proves bad input is refused; only a positive
control proves good input is still accepted — and it's the second one that goes
silently wrong. I watched the check fail against a deliberately mismatched
secret before I trusted it, because an alert nobody has seen fire isn't
monitoring."*

---

## 11. What it isn't — say this before they ask

- A portfolio prototype, **not a product**
- **Stripe test mode.** No real money can move
- **No users**
- **Sign-in and admin are not built** — on a published roadmap. The payment path
  was finished properly first, on the view that one complete thing beats three
  partial ones
- Free hosting tiers; the API sleeps when idle and a scheduled job keeps it warm

**Say:** *"I'd rather tell you the limits up front than have you find them."*

---

## 12. Who needs software shaped like this?

Marketplaces and platforms. Subscription businesses. **Payment gateways
themselves — which is literally what KOMOJU is.** Fintech: lending, investment,
fractional ownership, remittance. Any company with an internal finance team.

**The common thread:** *"It isn't 'accepting payments'. It's being able to prove
afterwards what happened. That's the actual product."*

---

## 13. Questions that might catch you out

**"Did you build this alone?"**
*"Yes, and I used AI tooling heavily and deliberately — I'll talk about where it
helped and where it had to be verified. The webhook defect is a good example:
the code looked right and passed its tests. What caught it was insisting on a
test against a real database."*

**"How long did it take?"**
Be honest and specific. Days, not months, for the payments core — and say what
that included.

**"What would you do differently?"**
*"The webhook does its work synchronously inside the request. At volume I'd
acknowledge fast and process from a queue, so a slow database can't cause Stripe
to time out and retry."*

**"What's the weakest part?"**
*"No capacity model. The load test asserts a no-regression baseline on a single
shared free instance, which is the honest claim available — calling it a
capacity plan would be theatre. And the repo keeps six per-app lockfiles instead
of npm workspaces — that's a recorded decision (ADR 13), taken because CI now
deploys the clients and converting every install path at once on a live
platform wasn't worth the tidiness, but it is a cost I'm carrying knowingly."*

**"Your rate limiter is in memory — what happens with two instances?"**
*"It stops working, and I documented that in the code rather than leaving it to
be discovered. One instance today; the rule lives in one class so moving it to
Redis is a change of storage, not a change of policy. A limiter that silently
degrades when you scale is worse than none, because everyone assumes it's still
there."*

**"Why is the demo password published?"**
*"So a reviewer can walk in without asking anyone. It's safe because the role is
the boundary, not the secret — that account reads everything and changes
nothing. Administration is a separate role with a password I set myself and
nobody else has seen."*
