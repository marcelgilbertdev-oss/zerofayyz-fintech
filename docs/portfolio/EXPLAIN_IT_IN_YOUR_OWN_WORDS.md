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
| Unit | 56 | Logic, branching, hashing, cookies, rate limiting | Anything involving real SQL |
| Integration | 29 | Real database: SQL, constraints, triggers, idempotency, auth | Rendering, the user's path |
| End-to-end | 34 | Real browser: sign-in, roles, accessibility, both locales | Whether the deployed thing works |
| Client (Vue/Svelte) | 36 | Contract validation, state, partial failure | — |
| Production smoke | 20 | That what *shipped* actually runs | — |

**Say:** *"Around 104 automated tests plus 20 production checks, all gated in CI.
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
capacity plan would be theatre. The admin console also reads more than it
writes: refunds and account management are the next things I'd build, because
that's where an operator actually spends their day."*

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
