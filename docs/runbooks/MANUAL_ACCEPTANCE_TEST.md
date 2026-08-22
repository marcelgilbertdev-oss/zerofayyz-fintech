# Manual Acceptance Test

**Run this before sending the platform to anyone.** Twenty to thirty minutes. No
terminal required for Part A; Part B is copy-paste commands.

Automation covers what it can. This covers what it cannot: whether the thing
*looks* right, whether a human can complete the journey, and whether the claims
in the README survive contact with a browser. Every step says what you should
see and **what it proves** — so if you are asked about it in an interview, you
are describing something you personally watched happen.

Record the date and result each time you run it. A charter nobody records is a
charter nobody ran.

---

## Part A — The reviewer's journey (browser only)

This is the exact path a recruiter or engineer takes. Do it on a phone too if
you have five spare minutes; it is responsive and they will try.

### A1 · The main dashboard loads with real data

1. Open **https://zerofayyz-fintech.vercel.app**
2. Look at the four tiles across the top.

**Expect:** Gross volume shows a real dollar amount (it grows by whatever
amount the last person tested with, so it will not match a number written here),
Successful payments a whole number, Pending settlement an amount ending in odd
cents like `.50`, and Webhook events a count.

**Proves:** every figure is computed from PostgreSQL. Hard-coded demo numbers are
round and never change — `$227.50` and a moving event count cannot be faked
cheaply.

**Red flag:** `$48,920`, `1,284`, `98.7%` or `0.18%`. Those are the retired
placeholder values. If you ever see them, the dashboard has stopped reading the
database and there is a test that should have caught it.

### A2 · System health reflects reality

3. Find the **System health** panel on the right.

**Expect:** "4 OF 4 LIVE" and four green dots — API service, PostgreSQL (showing
a latency in milliseconds — a low number when the API is warm, a few
hundred on the first request after it has been idle), Stripe sandbox, Webhook queue.

**Proves:** the API is genuinely reachable, the database answered *just now*, and
both Stripe integrations are configured. The latency number is measured per
request, not written into the page.

### A3 · Recent transactions come from the ledger

4. Scroll to **Recent transactions**.

**Expect:** the caption "Live sandbox records from PostgreSQL", several rows with
customer names and `.test` email addresses, amounts, and statuses including at
least one **Succeeded** and one **Processing**.

**Proves:** the table is the actual payment ledger, including a payment you made
yourself.

### A4 · Japanese

5. Click **日本語** in the top bar.

**Expect:** the whole interface switches — オペレーション概要, 総取引額,
システム稼働状況. Dates render Japanese-style with 年/月/日. Product names
(ZEROFAYYZ, PostgreSQL, Stripe, Next.js) correctly stay in Latin script.

6. Click **English** to switch back.

**Proves:** genuine internationalisation, not a token gesture. Worth saying in an
interview: translations are enforced by the type system, so a missing Japanese
string is a compile error naming the key — an English word cannot quietly appear
on a Japanese page.

### A5 · Keyboard only

7. Click once on an empty part of the page background — not on a button. This
   moves focus into the page instead of the browser's address bar.
8. Press **Tab** five times, slowly.

**Expect exactly five stops, in this order:**

| Tab | Focus lands on | Where |
|---|---|---|
| 1 | **Overview** | left sidebar, top nav item |
| 2 | **English** | top bar, right side |
| 3 | **日本語** | top bar, right side |
| 4 | **amount field** | top bar, shows `$ 42.00` |
| 5 | **+ Test payment** | top bar, far right |

Each stop shows a **mint-green ring** around the control — a 2px outline offset
3px from the edge, so it sits clear of the button rather than hugging it.

9. With **+ Test payment** ringed, press **Enter**. Stripe Checkout opens.
   Press the browser Back button to return.

**Why only five stops:** the other seven sidebar items — the four badged
**PLANNED**, plus System health, Audit log and Portfolio notes — are genuinely
disabled, not merely styled grey. They carry `aria-disabled="true"` and the
keyboard skips them entirely. That is the correct behaviour: a keyboard or
screen-reader user is never sent to a control that does nothing.

**Red flag:** Tab stops on any of those seven, or a stop shows no visible ring.
Either one means focus handling has regressed.

**Proves:** the interface is fully operable without a mouse. This is WCAG 2.1 AA
territory and it is checked automatically by axe-core in CI against both
languages — introducing that check found and fixed 14 real contrast failures.

> **Say this in an interview:** "Disabled navigation is removed from the tab
> order rather than just greyed out, so keyboard users aren't sent to dead
> controls — and the whole page is scanned by axe-core in CI in both English and
> Japanese, which is how the contrast failures got found."

### A6 · A complete payment, end to end

10. Back on the dashboard, note the current **Gross volume** and **Webhook events**
   numbers. Write them down.
11. **Type an amount of your own choosing** into the `$` field — pick something
    memorable and odd, like `137.42`. Anything from `0.50` to `10000.00` works.
12. Click **+ Test payment**.
13. On Stripe's page, pay with card `4242 4242 4242 4242`, any future expiry, any
    CVC, any name, any postcode.
14. You return to the dashboard with a green success banner.
15. **Refresh the page.**

**Expect:** the new payment appears at the top of the table as **Succeeded** for
**the exact amount you typed**; Gross volume increased by that amount; Webhook
events increased by 1.

**Why an odd amount of your own choosing matters:** it is the difference between
believing the ledger and proving it. A number only you picked, appearing in the
table and moving the headline total by exactly that much, cannot be a cached
page or a seeded fixture.

**Proves — and this is the whole platform in one step:** your browser asked the
API to create a session, the API wrote a payment row and called Stripe, you paid
on Stripe's own domain, Stripe sent a cryptographically signed webhook back to
the API, the API verified that signature and wrote the result into PostgreSQL in
Singapore, and the dashboard read it back. Card details never touched this system.

### A7 · The same ledger through two other frameworks

16. Open **https://zerofayyz-fintech-vue.vercel.app**
17. Open **https://zerofayyz-fintech-svelte.vercel.app**

**Expect:** both show the *same* gross volume, the same payment you just made,
and "4 of 4 live" — including the payment you made in step 12, for the amount
you chose. All three clients now carry the same amount field, so you can run the
same test from any of them.

**Proves:** one API, one contract, three independently-built frontends (React /
Next.js, Vue 3, Svelte 5). The API boundary is clean enough that three different
consumers use it unmodified. This is the artifact for the HENNGE applications.

### A8 · The sandbox framing is visible

18. Look at the sidebar badge and the page footer.

**Expect:** "Sandbox · TEST MODE", "Simulated portfolio environment", and
"Sandbox data only · No real funds processed".

**Proves:** you are not overclaiming. Say this before anyone asks — the maturity
of admitting it is worth more than the inch you would gain by hiding it.

---

### A9 · One-time setup for the admin steps (you, once)

The production database ships with no accounts. Before A11 can work, run this
with your Neon connection string and a password only you know:

```bash
cd "/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM/apps/api" && DATABASE_URL='paste-your-neon-connection-string' ADMIN_PASSWORD='choose-your-own-password' npm run seed:staff
```

**Expect:** `seeded demo@zerofayyz.test (operator) and admin@zerofayyz.test (admin)`.

Nobody else ever sees or sets that password — the script refuses to run without
it and never records it.

### A10 · The reviewer's door: demo sign-in

19. Click **Sign in** in the dashboard header.
20. On the login page, read the **Reviewer access** box — the demo credentials
    are printed there on purpose.
21. Click **Fill these in for me**, then **Sign in**. (Typing them by hand works
    too; the button exists because the first person to run this charter pasted
    both values into the email field and was told the credentials were wrong.)

**Expect:** the sign-in takes a few seconds — that is the password hash doing
real work (memory-hard scrypt) on a free-tier CPU, not a hang. You land on the
**Admin console** as *Demo Operator* with an **OPERATOR** badge.

**Expect on the page:** the console inside the platform shell — sidebar on the
left with **Admin console** highlighted, and tabs across the top: **Refunds**
and **Audit log** only. A blue notice says session and account management are
reserved for administrators; there is **no** Active sessions tab and **no**
Accounts tab. On the Audit log tab, your own `auth.login.succeeded` is the top
row.

**Proves:** roles are real. The operator can read history and change nothing.
And the refusal is not cosmetic — Part B shows the API refuses an operator with
403 even if they craft the request by hand.

### A11 · The owner's view: presence and remote sign-out

22. Sign out, then sign in as `admin@zerofayyz.test` with your own password.

**Expect:** two more tabs the operator never saw: **Active sessions** (with a
live count badge) and **Accounts**.

23. In Active sessions, find your own row.

**Expect:** it is marked **“This is you.”** Any recruiter using the demo login
appears here as *Demo Operator*, live, while they are looking at your work.

24. From another browser (or a private window), sign in as the demo operator,
    then refresh the console in your first browser.

**Expect:** the demo session appears in your presence list.

25. Click **Sign out this session** on that demo row, then switch to the other
    browser and refresh.

**Expect:** the other browser is signed out — bounced to the login page. Its
cookie did not change and had not expired; the session was ended in the
database, which is the only place ending it actually works.

26. Back in your console, check the audit log.

**Expect:** `admin.session.revoked` at the top, attributed to you.

**Proves:** sessions are revocable server-side (a JWT cannot do this), presence
is read from the same store that admits people, and a forced sign-out that the
history cannot record would refuse to happen at all.

### A12 · What the audit log will not do

27. Read the audit log's caption: append-only, enforced by the database.

There is nothing to click here, and that is the point — no edit button, no
delete button, and none possible: the table's trigger refuses UPDATE and DELETE
from every connection, including the application's own. Part B proves it from
the terminal.

### A13 · A refund, decided by four eyes

Requires A9's accounts, and works best in production where payments carry a
real Stripe payment intent.

**One-time setup:** the Stripe webhook destination must subscribe to
`charge.refunded` (Dashboard → Developers → Webhooks → your endpoint → add
events). The original Phase 1 setup subscribed only the four
`checkout.session.*` events, and without this one the approve half-works: the
refund goes out, the confirmation never arrives, and the payment never flips.

28. Sign in as the **demo operator**. On the **Refunds** tab, in **Payments**,
    click **Request refund**
    on a succeeded payment, give a reason you'll recognise, leave the amount
    empty (full refund), and submit.

**Expect:** the request appears in the **Refund queue** as **Pending**, with a
**Withdraw** button — a requester may always take back their own ask.

29. Sign out, sign in as **admin**, and find the request.

**Expect:** **Approve** and **Reject** buttons. Had you raised it yourself, the
page would instead say *"Yours — someone else must decide"* — the four-eyes
rule, visible rather than hidden.

30. Click **Approve**.

**Expect:** the request flips to **Approved**. Within a few seconds Stripe
processes the sandbox refund and sends `charge.refunded`; refresh and the
payment's status reads **refunded**, with `refund.requested`, `refund.approved`
and `stripe.webhook.processed` stacked in the audit log.

**Proves — and this is the strongest thing the platform demonstrates:** money
moving backwards required two different people, produced an immutable trail
naming both, went out to Stripe exactly once (the request id is the idempotency
key, so even a retried approval cannot double-refund), and the ledger changed
only when Stripe's signed webhook confirmed it — not when the button was
clicked.

### A14 · Accounts from the console

31. Still as admin, open the **Accounts** tab, create a staff account (any
    role, a 12+ character password — the eye icon shows what you typed), then
    **Disable** it. The page no longer jumps to the top after either action.

**Expect:** the row gains a **Disabled** badge. Signing in as that account now
fails with the *same* "Incorrect email or password" a wrong password gets —
whether an account exists or is disabled is nobody's business but the admin's.
Your own row shows **You** and offers no controls: self-demotion and
self-disabling are how a platform loses its last administrator.

---

### A15 · The ledger pages — no more PLANNED badges

32. In the sidebar, click **Payments**, then **Transactions**, then
    **Customers**. Every destination is real now.

**Payments:** the full ledger with filter pills. Click **Failed** — every row
shown is failed, and the count at the bottom left follows the filter. That
count is computed in the same query as the rows, so they cannot disagree.

**Transactions:** the raw Stripe event stream. Look at the **Stripe event id**
column — every real event's id is there in full. That column carries a UNIQUE
constraint in the database, and that constraint — not application code — is why
the duplicate delivery you replayed in B4 changed nothing. This page is your
idempotency story made visible.

**Customers:** note any customer with a *processing* or *failed* payment —
count 1, settled volume $0.00. Unsettled money is not money, and the page shows
the distinction rather than explaining it.

**Also check:** the sidebar shows exactly one **Audit log** (inside the admin
console tabs), **System health** jumps to the live panel on the overview, and
**Portfolio notes** opens the reviewer doc on GitHub.

---

### A16 · The Vue client's staff door

33. Open https://zerofayyz-fintech-vue.vercel.app and scroll to the bottom.
    There is an **Operator area** card under the dashboard.

34. Type a wrong password first — any email, any nonsense password, **Sign
    in**. The refusal reads exactly **"Incorrect email or password"**, with the
    contact-your-administrator line under it. Start typing again and the error
    clears immediately.

35. Click **Fill these in for me**, then **Sign in**. You are **Signed in as
    Demo Operator**, and the **Audit trail** appears — the same append-only
    table the admin console shows. Your failed attempt from the previous step
    is one of the newest rows: the system just recorded you testing it.

36. Reload the page. Still signed in — the session is an HttpOnly cookie, not
    anything the page stored. Click the eye icon on the password field first if
    you want to see the toggle work.

37. Click **Sign out**. The form returns.

**What this proves:** the API's authentication is framework-independent. The
session, the rate limiter, the enumeration defence and the audit trail all live
on the API; Vue only mirrors what `/auth/me` admits.

### A17 · The Svelte client's staff door

38. Open https://zerofayyz-fintech-svelte.vercel.app, scroll to its
    **Operator area**, and sign in the same way (fill button, then Sign in).

39. Look at the top of the audit trail: **your sign-ins from A16 are there** —
    the Vue login, the sign-out, and now this Svelte login, in order. Two
    different clients, one ledger of what happened.

40. Sign out.

---

## Part B — Verification you can run (terminal)

Open Terminal, then:

```bash
cd "/Users/marcel/Documents/ZEROFAYYZ FINTECH CLOUD PLATFORM"
```

### B1 · The whole live system, from outside

```bash
node scripts/production-smoke.mjs
```

**Expect:** `20/20 checks passed`.

**What it checks:** every dependency reported healthy, metrics internally
consistent, transactions genuinely from PostgreSQL with unique ids, unsigned and
forged webhooks rejected, the ledger unmoved by those forgery attempts, unknown
routes 404, no placeholder figures on the page, sandbox disclosure present, and
all three clients serving their own build with working API rewrites and deep
links.

**Say this in an interview:** it needs no credentials — it verifies the deployed
system the way a stranger reaches it, using only the public URLs.

### B2 · The automated suites

```bash
cd apps/api && npm run test:unit && npm run test:integration && cd ../..
```

**Expect:** `56 pass` then `38 pass`.

Integration needs the local database running. If it fails to connect:

```bash
docker compose -f infrastructure/docker/compose.yaml up -d postgres
```

```bash
cd apps/web-vue && npx vitest run && cd ../web-svelte && npx vitest run && cd ../..
```

**Expect:** `23 passed` then `13 passed`.

**The point to make:** the integration tests run against a *real* PostgreSQL.
That distinction is not academic — it is how the defect below was found.

### B3 · Performance against the live API

```bash
node scripts/load-test.mjs
```

**Expect:** three endpoints, `0` errors, p95 latencies under the thresholds,
ending `All 3 endpoints within thresholds.`

**Note:** the first run warms the instance for up to 90 seconds. The free tier
sleeps, and measuring a cold start as latency would misreport the system.

### B4 · Idempotency, the highest-value thing you can demonstrate

1. Go to **https://dashboard.stripe.com/test/workbench/events**
2. Open the most recent `checkout.session.completed`
3. Click **Resend** on the `zerofayyz-fintech-api` destination
4. Refresh the dashboard

**Expect: nothing changes.** Same gross volume, same event count, no new row.

**Proves:** Stripe delivers webhooks *at least once* — duplicates are normal, not
exotic. A naive system records the payment twice and the books are wrong. Here
the rule lives in the database: a UNIQUE constraint on Stripe's event id with
`ON CONFLICT DO NOTHING`, so the second delivery updates nothing. It holds under
concurrency, across restarts, and across any number of servers, because it is a
property of an index rather than of code someone might later edit.

---

### B5 · The auth surface, attacked politely from outside

No credentials needed for any of these.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://zerofayyz-fintech-api.onrender.com/api/v1/admin/sessions
```

**Expect:** `401`. Same for `/api/v1/admin/audit-logs`, `/api/v1/admin/users`
and `/api/v1/auth/me` — the guard is on the API, not in the page.

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://zerofayyz-fintech.vercel.app/admin
```

**Expect:** `307` — the console redirects the signed-out to the login page.

```bash
for i in 1 2 3 4 5 6; do curl -s -o /dev/null -w "attempt $i: %{http_code}\n" -X POST https://zerofayyz-fintech-api.onrender.com/api/v1/auth/login -H 'content-type: application/json' -d '{"email":"charter-probe@zerofayyz.test","password":"wrong"}'; done
```

**Expect:** five `401`s, then `429` — five wrong guesses close that account's
login for fifteen minutes. Use a made-up email like the one above: the lock is
per-account, so probing with a fake name locks nothing real. (Deliberately
per-account rather than per-IP: an attacker can forge the address a request
claims to come from, but not the account they are attacking.)

**Also worth saying in an interview:** a wrong password and a nonexistent
account return byte-identical responses in near-identical time — missing
accounts are verified against a decoy hash so response timing cannot be used to
discover which emails exist.

## Part C — If you change the SPA clients

The Vue and Svelte clients **do not auto-deploy**. After changing them:

```bash
./deploy-clients.sh web-vue
```

```bash
./deploy-clients.sh web-svelte
```

Then re-run `node scripts/production-smoke.mjs`. Why it works this way, and the
two Vercel failure modes behind it, are in `DEPLOYMENT.md`.

---

## Automated pre-check log

What was verified by automation before the human run, including what failed and
how it was fixed. The failures are recorded deliberately: they are the evidence
the checks are real.

### 2026-08-21 (night) — operator panels on the Vue and Svelte clients (Claude)

**Scope:** A16/A17 exist as of tonight. Both SPA clients grew an Operator area
— sign-in form with the published demo credentials, password eye toggle,
verbatim API refusals with the contact-admin line, and the operator-gated audit
trail with refresh and sign-out. One shared Zod contract addition
(`sessionUserSchema`, `loginResponseSchema`, `auditLogsSchema`) serves both.

**All suites green before the human walk:** 56 API unit · 42 integration ·
48 Playwright E2E (1 skipped by design) · 38 Vue · 28 Svelte = **212 automated**.

**Live browser walk (local, real API + real PostgreSQL):** wrong password on
the Vue panel → byte-exact "Incorrect email or password" + contact line; demo
fill → sign-in → audit trail rendered with the failed attempt as the newest
row; reload → still signed in (HttpOnly cookie resume); sign out → form back.
Svelte panel: signed in and its audit trail showed the whole Vue walk (login,
logout) above its own login — two clients, one append-only ledger.

**Failures found by the new tests, fixed before commit:** (1) Testing Library
auto-cleanup is not active without vitest globals, so a second render left two
"Sign in" buttons in the page — explicit `cleanup()` in afterEach in both new
component suites. (2) The audit assertion raced the audit fetch (login resolves
a tick earlier) — `findByText`, not `getByText`. (3) Svelte's `autocomplete`
prop is typed `FullAutoFill`, not `string` — caught by `svelte-check`, not at
runtime.

### 2026-08-21 — full automated pass (Claude)

**All suites green:** 22 API unit · 7 integration (real PostgreSQL) · 21 Vue ·
11 Svelte · 17 Playwright E2E (both locales + accessibility) = **78 automated**,
plus **15/15 production smoke** and the load-test baseline (p95 546/399/319ms,
zero errors at 10 concurrent).

**End-to-end payment through the Vue client (new coverage):** browser checkout
started from the Vue SPA — POST through Vercel's `/api` rewrite → Render →
Stripe hosted page → test card `4242…` → signed webhook → PostgreSQL. Ledger
moved $1,222.00 → $1,264.00, 3 → 4 succeeded, 5 → 6 events, and all three
client origins report identical figures. The success redirect lands on the
Next.js dashboard by design (`APP_URL`).

**Japanese on production:** `?lang=ja` renders 総取引額 / オペレーション概要 with
zero English interface copy leaked.

**Keyboard focus order measured on production (A5):** the live page exposes 11
focusable elements, of which exactly **4 are tabbable** — Overview, English,
日本語, + Test payment, in that DOM order. The other seven sidebar items carry
`aria-disabled="true"` and are correctly skipped. Focus landing on
**+ Test payment** matches `:focus-visible` and paints a `2px solid rgb(110,231,183)`
outline at `3px` offset. A5 in this charter was rewritten from those measured
values, so the step now states the exact number of Tab presses rather than
"press Tab repeatedly".

### 2026-08-21 (evening) — Phase 2 automated pass (Claude)

**All suites green after two review passes:** 54 API unit · 24 integration
(real PostgreSQL) · 23 Vue · 13 Svelte · 32 Playwright E2E = **146 automated**,
plus **20/20 production smoke** (5 new checks that assert content existing only
in the Phase 2 build — see failure #12 for why that wording matters).

**Verified live on production, not assumed:** /login 200 in both languages with
the demo credentials visible; /admin 307 for the signed-out; all four
privileged API routes 401 anonymous; the per-account rate limit proven in both
directions against the deployed build — six wrong passwords across six
different accounts all verified (401, no shared bucket), six against one
account refused on the sixth (429). The second probe is also how the deploy
itself was confirmed: the old build would have 429'd the six-distinct-emails
case, so the probe distinguishes the builds by behaviour.

**Verified in a real browser:** demo login → operator console with live audit
rows; admin login → presence with “This is you”; one live remote sign-out
watched removing a session from the list.

**Awaiting the human pass:** A9 (your seed), A10–A12, B5.

### 2026-08-21 (night) — Phase 4 automated pass (Claude)

**All suites green:** 56 API unit · 36 integration · 37 Playwright (the refund
story runs serial — parallel workers would collide on exactly the
one-pending-per-payment constraint the feature enforces) · 36 client = **165
automated**, plus 20/20 smoke.

**Proven by making the refused request:** self-approval answers 403 and the raw
SQL is refused by the schema's CHECK; a viewer cannot read the queue; a
withdrawn request cannot be approved afterwards; a second request while one is
pending answers 409; the charge.refunded webhook applied twice writes once.

**Found by the e2e suite, fixed as product:** an admin-raised request that no
second admin existed to decide sat pending forever, blocking the payment's
single pending slot — withdrawal now exists because the suite proved its
absence. Also: a label-wrapped <select> announces its options as part of its
own name ("Role viewer operator admin") to tests and screen readers alike.

**Awaiting the human pass:** A13–A14 — the production approve is the one step
automation deliberately leaves to a person, because it moves real sandbox money
back through Stripe.

### 2026-08-21 (late night) — console redesign pass (Claude)

**Marcel's A13/A14 walk passed on production** — the live refund (request →
approve → Stripe's charge.refunded flipping the ledger), including a real
Stripe refusal along the way (the restricted key lacked Refunds: Write) that
exercised the claim-release recovery path in production and got the error
message upgraded to carry Stripe's own reason.

**His walk also produced four design findings, all shipped:** the console now
renders inside the application shell (sidebar section + tabs for
Refunds/Sessions/Accounts/Audit, each a URL); actions soft-refresh in place
instead of dumping the operator at the top of the page; both password fields
gained a visibility toggle; and the login refusal gained "contact your
administrator" while still refusing identically for wrong, missing, and
disabled accounts.

**Automated:** 39 e2e (+2: the toggle clicked on the rendered page, the
refusal wording) · API and client suites unchanged and green. One process
lesson recorded: the toggle's first landing silently failed in one form while
its import landed — which is why the e2e clicks the actual button.

### 2026-08-21 (Phase 5) — ledger pages pass (Claude)

**All suites green three times over:** 56 unit · 42 integration · 48 e2e
(axe-scanned all three new pages, English and Japanese) · 36 client = **182
automated**, smoke 20→22.

**The review question — "did we break anything?" — was answered honestly: yes,
twice, and both were caught.** CI went red on two lint errors (a
setState-in-effect and a raw anchor where a Link belongs), fixed at the source
rather than suppressed. And two test-side defects surfaced: the metrics suite's
absolute assertions had silently assumed its rows were the only USD rows in the
database (now delta-based against a captured baseline), and a brand-new smoke
check failed against healthy production because it read .data off its own
helper's wrapper — logged here because a check that cries wolf gets ignored the
day the wolf comes.

**Awaiting the human pass:** A15.

### Failures found and fixed along the way (keep these — they are the story)

| # | Failure | Root cause | Fix | Guard now |
| --- | --- | --- | --- | --- |
| 1 | Webhook returned 500 on every real delivery despite 19 green unit tests | `JSONB_BUILD_OBJECT` rejects uncast parameters (42P18); every unit test stubbed the DB | Cast the parameters | Integration suite vs real PostgreSQL |
| 2 | `npm ci` failed on Linux CI, twice | macOS lockfile pruned Linux-only optional deps | Full fresh relock; `npm run relock` | Error string documented in runbook |
| 3 | Duplicate webhook reported `processed: true` while writing nothing | Response didn't consult `rowCount` | Report honestly; ack unknown refs with 200 | Unit + integration tests |
| 4 | Vue/Svelte Vercel build: `TS2307` on zod | Client-scoped root dir never uploads `packages/api-contract` | — superseded by #5 | — |
| 5 | Repo-scoped Vercel build compiled the **API** instead of the client | Framework auto-detection scanned the tree | Deploy prebuilt `dist/` with `framework: null` (`deploy-clients.sh`) | Smoke checks each alias serves its own artifact |
| 6 | Verified Svelte deploy overwritten with a 500 minutes later | `vercel link` silently git-connected the project; a docs push rebuilt it wrong | `vercel git disconnect` on both SPA projects; re-ran the trigger | 6 per-client smoke checks |
| 7 | CI red: nothing installed the shared contract | Two individually-safe cleanups composed (removed "redundant" CI installs, then removed the postinstall they were redundant with) | Restored installs with a comment naming why | Comment in ci.yml |
| 8 | Vue client dead on arrival: "API unreachable · signal timed out ×3", no recovery path | 15s client timeout < ~22s free-tier cold start; keep-warm cron observed drifting to 33–43 min | 45s timeouts, honest wake-from-sleep message, **Try again** button, retry-recovery tests in both clients | Retry tests; redeployed and re-verified |
| 9 | Amount limits announced to screen readers, invisible to sighted users | Hint lived in an `sr-only` element — axe passed while the UX was backwards | Visible microcopy on focus, red when out of range | E2E asserts the hint is genuinely visible |
| 10 | Old API silently charged $42 whatever amount the client sent | Fastify's validator strips unknown body fields instead of rejecting them — deploy-order hazard with every status green | Deploy verification asserts the field is *enforced* (400 out of range), not merely accepted | Bounds probed live on every deploy |
| 11 | `promisify(scrypt)` silently dropped the cost options — password hashing would have run at defaults while types said otherwise | promisify picks the overload without options; a cast would have hidden it | Hand-written promise wrapper | Typecheck; parameter string asserted in unit tests |
| 12 | Two Vercel deploys failed in 13s while CI and smoke stayed green; production served a stale dashboard unnoticed | Build typecheck followed a Playwright spec's import across the package boundary; smoke greps matched text present in the old build too | tsconfig split (build excludes e2e; CI typechecks it where deps exist); smoke gained checks unique to the new build | 5 build-unique smoke checks |
| 13 | Every session fingerprint identical in production; login limiter was one global bucket — 5 failed attempts by anyone locked everyone out | No `trustProxy` behind Render's balancer, and `::ffff:` IPv4-mapped addresses all sliced to one prefix | trustProxy + forwarded client address; limiter re-keyed per attempted account; mapped addresses unwrapped | Unit + integration tests; both limiter directions probed live |
| 14 | Reviewer pasted the whole credentials block into the email field and was told "Incorrect email or password" | The demo box printed two values in a way that invites one copy | **Fill these in for me** button; credentials still printed for anyone who prefers to read them | E2E fills, submits, and lands on /admin |
| 15 | The login error stayed on screen while the typo it complained about was being corrected | The form cleared its error on submit, not on edit | Clears the moment either field is edited | E2E types a correction and asserts the message disappears |
| 16 | Accessibility checks failed only in parallel runs — read as flake, was a real defect | The login limiter counted **every** attempt, so concurrent successful demo logins exhausted its budget. In production the sixth reviewer in a busy 15 minutes would have been locked out of the public demo account, looking identical to an outage | Limiter counts failures only: `status()` is read-only, `recordFailure()` spends budget, success clears the slate | Unit test for 10 consecutive successes; integration test for 10 real sign-ins |

## Human result log

### 2026-08-22 — A16 / A17 walked by Marcel · PASSED, two defects found

Both operator panels walked on the deployed clients. **Two real defects found by the
founder that every automated suite had missed**, both fixed and verified the same session:

1. **The password field overflowed its column and slid under the reviewer-access card.**
   `width:100%` plus 54px of horizontal padding, and the app has no global `box-sizing`
   reset. Invisible to jsdom, which does not lay out. Fixed in both clients
   (`box-sizing: border-box`), verified live by measuring the rendered geometry — the field
   now ends 20px before the card begins — and pinned by a source-level regression test.

2. **A payment started on a client returned the payer to a different app.** `success_url`
   was built from a single `APP_URL`, so every checkout landed on the Next.js dashboard
   regardless of origin. Fixed by deriving the return origin from the request's `Origin`
   header **matched against an allowlist** — a caller-chosen redirect target on a public
   endpoint is an open redirect, so exact whole-origin equality with a fallback to
   `APP_URL`, never the raw header. Tests cover the look-alike (`…vercel.app.attacker.test`),
   the subdomain, and the http-downgrade cases. `CLIENT_ORIGINS` added to `render.yaml`, and
   health now reports whether it actually reached production because a blueprint entry is
   not a guarantee on an already-running service.

**Founder verification, live production:** payment of $115.00 started on the Svelte client
returned to `zerofayyz-fintech-svelte.vercel.app/?checkout=success`, recorded Succeeded
within the minute, `stripe.webhook.processed` in the audit trail, 4 of 4 integrations live.
Sign-in, audit trail, reload-persistence and sign-out all confirmed on both clients; the
Svelte trail showed the Vue session's rows above its own, which is the append-only story
demonstrating itself across two origins.

**A third lesson, logged because it repeated:** the new smoke check shipped referencing an
undefined constant and failed with a `ReferenceError` rather than a verdict — the second
time that exact mistake has landed in that file. A new check must be watched failing for
the *right* reason before it counts as coverage.

Charter status after this walk: **Part A complete through A17.**

### Earlier entries


Fill this in yourself — the automated log above is not a substitute for a person
walking the journey.

| Date | Part A (steps passed / issues) | Part B | B4 idempotency seen? | Notes |
| --- | --- | --- | --- | --- |
| 2026-08-21 | **A9–A12 passed** (Marcel, with Claude). A9 seeded on the second run — see note. A10 demo operator: audit log present, no privileged panels, operator notice shown. A11 admin: presence panel with "This is you", revoked a session and watched the row disappear; `admin.session.revoked` logged and attributed. Live two-browser revoke done — Claude's session was killed mid-use and the same unchanged, unexpired cookie then returned 401. A12 read. | **B5 passed**: 4× 401 on the privileged routes, 307 on `/admin`, five 401s then 429 on the sixth login attempt. | not re-run this session | Three defects found by this walk — rows 14–16 above. Also: the first seed reported success without proving the password worked; the seed now reads both accounts back and verifies them before printing VERIFIED. |
| | | | | |
