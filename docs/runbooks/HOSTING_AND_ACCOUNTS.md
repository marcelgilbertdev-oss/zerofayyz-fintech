# Hosting, accounts, and what they cost

Where this platform actually runs, what is paid for and why, and which accounts exist.
Written to be readable months from now, when the reasoning has been forgotten.

---

## Nothing runs on the laptop

This matters more than it sounds. Everything a reviewer touches is hosted:

| What they open | Where it runs | Cost |
| --- | --- | --- |
| Next.js dashboard | Vercel | Free (Hobby) |
| Vue client | Vercel | Free (Hobby) |
| Svelte client | Vercel | Free (Hobby) |
| Fastify API | Render | **$7/month (Starter)** |
| PostgreSQL | Neon | Free |
| Payments | Stripe **test mode** | Free |
| Source | GitHub, public | Free |

**A recruiter needs no account, no login, and nothing installed.** They click a link. The
development machine could be switched off or sold and every link in an application would keep
working.

Total: **about $7/month**, all of it Render.

---

## Why the API is paid

Render's free tier "spins down a Free web service that goes 15 minutes without receiving any
inbound traffic." Waking it measured **27–38 seconds**.

There was a `keep-warm` GitHub Action intended to prevent exactly that, and a line in
`DEPLOYMENT.md` asserting it was "enough." Measuring sixty consecutive runs showed it was not:

```
scheduled interval                  : 10 min
actual gap, median                  : 27 min
actual gap, worst                   : 92 min
gaps exceeding the 15-min threshold : 59/59  (100%)
pings arriving to a cold service    : 41/60  (68%)
```

GitHub's `schedule` trigger is best-effort and drifts under load. Every gap exceeded the sleep
threshold, so the workflow was never keeping anything warm — it was periodically waking a
service that then fell asleep again. A reviewer arriving at a random moment had roughly a
two-in-three chance of waiting half a minute on a blank-looking dashboard.

**Two lessons, both worth repeating out loud:** a scheduled job is not evidence that the job
ran on schedule, and a mitigation nobody measured is a belief rather than a control.

The workflow still exists as `API liveness canary`, renamed to what it can honestly do, with
the measurement preserved in its header comment.

---

## What the $7 covers

**Render Starter · 0.5 CPU · 512 MB RAM · billed per service, not per account.**

### What it fixed

- **No spin-down.** The service is always awake.
- **No 750-hour cap.** That quota counts *Free* instance hours only; a paid instance sits
  outside the accounting entirely. Nothing to monitor, and no suspension is possible.

The quota deserves a note, because it is the trap in the road not taken. Keeping a *free*
instance awake around the clock costs 744 hours against a 750-hour monthly workspace budget,
and exhausting it "suspends all of your Free web services until the start of the next month."
A pinger that finally worked would therefore have been a pinger that could take the site down.

### What it also unlocked

Free instances cannot do any of these:

- **Shell access** over SSH or the dashboard — a terminal on the running production service
- **One-off jobs** — run a task against production as a tracked job
- **Persistent disks**
- **Scaling beyond a single instance**
- **Edge caching**
- **Private network traffic** between services
- **Outbound SMTP** on ports 25, 465 and 587 — the free tier blocks them, which would have
  silently broken emailed receipts for a reason that is very hard to guess

### What it did *not* change

- **Zero-downtime deploys.** Every tier already has these — "All service types redeploy with
  zero downtime, unless they attach a persistent disk." Do not claim this as a paid feature.
- Neon, Vercel and Stripe are unaffected and still free.

### What is deliberately *not* built on top of it

Nothing. The unlocked capabilities are real but none of them improves the demo enough to
justify delaying applications, and a half-built feature reads worse than an absent one.
Emailed receipts are the natural next one and belong in a later phase with their own provider.

Worth knowing rather than doing: **the API is genuinely stateless.** Sessions are opaque
tokens with only their SHA-256 stored in PostgreSQL, so a second instance would need no
sticky sessions and no shared memory. Horizontal scaling is a claim that can now be made
truthfully and demonstrated in one click, without spending anything to prove it.

---

## The instance type lives in the Blueprint, not the dashboard

`render.yaml` declares `plan: starter`. **Do not change the instance type only in the Render
dashboard.** This service is Blueprint-managed, and Render's documentation is explicit: manual
dashboard changes "are overwritten the next time you sync your Blueprint."

This nearly bit once. The upgrade was made in the dashboard while `render.yaml` still said
`plan: free`, which left the paid instance one sync away from silently reverting — with the
30-second wait reappearing weeks later and nothing in the history to explain it.

Infrastructure held in two places has a truth and a copy. **`render.yaml` is the truth.**

**Workspace plan stays Hobby (free).** Upgrading the *workspace* costs $19/month and has no
effect on instance sleeping — "Upgrading your workspace plan does *not* remove limitations on
Free instances." It is a different thing that sounds like the same thing.

---

## Accounts

All accounts, cards, keys and passwords belong to the owner. **Claude never signs into any of
them**, and never handles a key, token or password; it works through the repository and public
URLs only.

| Service | What it holds | Plan |
| --- | --- | --- |
| GitHub | `marcelgilbertdev-oss/zerofayyz-fintech` — source and CI | Free |
| Render | The API service | $7/mo Starter |
| Vercel | Three projects: `-fintech`, `-vue`, `-svelte` | Free Hobby |
| Neon | PostgreSQL | Free |
| Stripe | **Test mode only** — no real charge is possible | Free |
| Sentry | Error tracking for the API; `SENTRY_DSN` set in Render only | Free |

### Sign-ins inside the application

- **Operator:** `demo@zerofayyz.test` / `view-the-ledger` — **public by design**, printed on
  the login page so a reviewer never has to ask for credentials.
- **Admin:** `admin@zerofayyz.test` — password supplied only as an environment variable typed
  by the owner. It is never written down here, in the repository, or in a chat transcript.

---

## Cancelling when the job hunt ends

Two places, because the Blueprint wins:

1. `render.yaml` → change `plan: starter` back to `plan: free`, commit, push
2. Render → Projects → `zerofayyz-fintech-api` → Settings → Instance Type → Free

Doing only the second one is temporary; the next sync restores whatever the file says.

---

## Related

- `DEPLOYMENT.md` — standing the whole stack up from nothing
- `LOCAL_DEVELOPMENT.md` — running it on a laptop, and the lockfile trap
- `MOBILE_AND_BROWSER_TESTING.md` — verifying on a phone, and what desktop browsers cannot see
- `../portfolio/THE_BRIEFING.md` — what was built, why, and how it maps to each company
