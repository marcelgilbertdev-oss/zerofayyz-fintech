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

**Expect:** Gross volume shows a real dollar amount (currently around $1,222.00),
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
a latency like `3 ms`), Stripe sandbox, Webhook queue.

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

7. Click once on empty page background, then press **Tab** repeatedly.

**Expect:** a visible focus ring moves through the controls and reaches the
**+ Test payment** button. Press **Enter** on it — checkout opens.

**Proves:** the interface works without a mouse. This is WCAG 2.1 AA territory
and it is checked automatically by axe-core in CI against both languages —
introducing that check found and fixed 14 real contrast failures.

### A6 · A complete payment, end to end

8. Back on the dashboard, note the current **Gross volume** and **Webhook events**
   numbers. Write them down.
9. Click **+ Test payment**.
10. On Stripe's page, pay with card `4242 4242 4242 4242`, any future expiry, any
    CVC, any name, any postcode.
11. You return to the dashboard with a green success banner.
12. **Refresh the page.**

**Expect:** the new payment appears at the top of the table as **Succeeded**;
Gross volume increased by $42.00; Webhook events increased by 1.

**Proves — and this is the whole platform in one step:** your browser asked the
API to create a session, the API wrote a payment row and called Stripe, you paid
on Stripe's own domain, Stripe sent a cryptographically signed webhook back to
the API, the API verified that signature and wrote the result into PostgreSQL in
Singapore, and the dashboard read it back. Card details never touched this system.

### A7 · The same ledger through two other frameworks

13. Open **https://zerofayyz-fintech-vue.vercel.app**
14. Open **https://zerofayyz-fintech-svelte.vercel.app**

**Expect:** both show the *same* gross volume, the same payment you just made,
and "4 of 4 live" — including the $42.00 from step 10.

**Proves:** one API, one contract, three independently-built frontends (React /
Next.js, Vue 3, Svelte 5). The API boundary is clean enough that three different
consumers use it unmodified. This is the artifact for the HENNGE applications.

### A8 · The sandbox framing is visible

15. Look at the sidebar badge and the page footer.

**Expect:** "Sandbox · TEST MODE", "Simulated portfolio environment", and
"Sandbox data only · No real funds processed".

**Proves:** you are not overclaiming. Say this before anyone asks — the maturity
of admitting it is worth more than the inch you would gain by hiding it.

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

**Expect:** `15/15 checks passed`.

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

**Expect:** `22 pass` then `7 pass`.

Integration needs the local database running. If it fails to connect:

```bash
docker compose -f infrastructure/docker/compose.yaml up -d postgres
```

```bash
cd apps/web-vue && npx vitest run && cd ../web-svelte && npx vitest run && cd ../..
```

**Expect:** `20 passed` then `10 passed`.

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

15. Go to **https://dashboard.stripe.com/test/workbench/events**
16. Open the most recent `checkout.session.completed`
17. Click **Resend** on the `zerofayyz-fintech-api` destination
18. Refresh the dashboard

**Expect: nothing changes.** Same gross volume, same event count, no new row.

**Proves:** Stripe delivers webhooks *at least once* — duplicates are normal, not
exotic. A naive system records the payment twice and the books are wrong. Here
the rule lives in the database: a UNIQUE constraint on Stripe's event id with
`ON CONFLICT DO NOTHING`, so the second delivery updates nothing. It holds under
concurrency, across restarts, and across any number of servers, because it is a
property of an index rather than of code someone might later edit.

---

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

## Result log

| Date | Part A | Part B | Notes |
| --- | --- | --- | --- |
| 2026-08-21 | | | first run |
