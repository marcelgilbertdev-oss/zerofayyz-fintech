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
with a live operations dashboard on top. Sandbox only — no real funds move."*

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
| Unit | 22 | Logic and branching | Anything involving real SQL |
| Integration | 7 | Real database: SQL, constraints, idempotency | Rendering, the user's path |
| End-to-end | 17 | Real browser: does a click reach a handler | Whether the deployed thing works |
| Client (Vue/Svelte) | 30 | Contract validation, state, partial failure | — |
| Production smoke | 15 | That what *shipped* actually runs | — |

**Say:** *"Roughly 76 automated tests plus 15 production checks, all gated in CI.
The layers exist because each catches a class of failure the layer beneath
structurally cannot."*

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

## 10. What it isn't — say this before they ask

- A portfolio prototype, **not a product**
- **Stripe test mode.** No real money can move
- **No users**
- **Sign-in and admin are not built** — on a published roadmap. The payment path
  was finished properly first, on the view that one complete thing beats three
  partial ones
- Free hosting tiers; the API sleeps when idle and a scheduled job keeps it warm

**Say:** *"I'd rather tell you the limits up front than have you find them."*

---

## 11. Who needs software shaped like this?

Marketplaces and platforms. Subscription businesses. **Payment gateways
themselves — which is literally what KOMOJU is.** Fintech: lending, investment,
fractional ownership, remittance. Any company with an internal finance team.

**The common thread:** *"It isn't 'accepting payments'. It's being able to prove
afterwards what happened. That's the actual product."*

---

## 12. Questions that might catch you out

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
*"No authentication yet, and no capacity model — the load test asserts a
no-regression baseline on a single shared free instance, which is the honest
claim available. Calling it a capacity plan would be theatre."*
