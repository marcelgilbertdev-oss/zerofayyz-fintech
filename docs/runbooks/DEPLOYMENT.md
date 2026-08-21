# Deployment Runbook

Taking the platform from "runs on a laptop" to "a stranger can open a link and use it."

Written for someone deploying for the first time. Every step says what to click, what to
copy, and how to tell it worked.

---

## What you are building

Three services, on three providers, each chosen because its free tier is genuinely free and
does not expire.

| Piece | Provider | Why | Cost |
| --- | --- | --- | --- |
| PostgreSQL | **Neon** | Free tier is permanent and needs no card | Free |
| Fastify API | **Render** | Free web service, deploys from GitHub | Free |
| Next.js dashboard | **Vercel** | Built by the Next.js team; free Hobby tier | Free |

All three sign in with your GitHub account. None of them need a payment card for this setup.

**One caveat, stated up front:** Render's free tier puts a service to sleep after about
fifteen minutes of no traffic, and waking it takes roughly fifty seconds. A recruiter would
see a loading page. `.github/workflows/keep-warm.yml` pings the API every ten minutes to
prevent that, and it is enough. If you would rather not rely on it, Render's Starter plan is
about $7/month and never sleeps. Deploy free first; upgrade only if you see it sleeping.

---

## How each piece deploys

| Piece | Platform | Trigger |
| --- | --- | --- |
| API | Render | Auto-deploys on push to `main` |
| Next.js dashboard | Vercel | Auto-deploys on push to `main` |
| Vue client | Vercel | **Manual** — `./deploy-clients.sh web-vue` |
| Svelte client | Vercel | **Manual** — `./deploy-clients.sh web-svelte` |

The two SPA clients deploy their prebuilt output rather than building on Vercel,
and that is a deliberate workaround worth understanding before you touch it.

Vercel scopes a build to its project's root directory. These clients import the
shared contract in `packages/api-contract`, which sits *above* that root — so the
files are never uploaded and the build fails with `TS2307`. Pointing the root at
the repository instead makes Vercel's framework detection scan the whole tree,
where it finds `apps/api` and builds the Fastify server instead of the client,
producing a deployment with no static output at all. Both failures happened on
the way to this working.

So the clients are built locally, where the whole repository is present, and the
finished `dist/` is deployed with `framework: null` and empty build and install
commands, so Vercel serves it without trying to rebuild it.

**The cost is real: these two do not auto-deploy.** A push to `main` updates the
API and the Next.js dashboard but not the SPA clients — run the script after
changing them. The principled fix is npm workspaces, which Vercel understands
natively; that is deferred rather than dismissed, because converting the
lockfiles would disturb two deployments that currently work.

---

## Step 1 — The database (Neon)

1. Go to **neon.tech** and sign in with GitHub.
2. Click **Create project**. Name it `zerofayyz-fintech`, leave Postgres 18 selected, and
   choose region **AWS Asia Pacific 1 (Singapore)**.

   All three services must sit in the same region. A page load goes viewer → Vercel →
   Render → Neon; spread those across continents and every load pays three intercontinental
   round-trips. Singapore is the closest region all three providers offer on their free
   tiers, and the reviewers for these applications are in Tokyo. `render.yaml` and
   `apps/web/vercel.json` both pin Singapore to match.
3. When it finishes, Neon shows a **connection string** that looks like:

   ```text
   postgresql://user:password@ep-something-123456.eu-central-1.aws.neon.tech/neondb?sslmode=require
   ```

4. Copy it and keep it somewhere safe for the next step. **This is a password.** Do not paste
   it into a file in the repository, into a chat, or anywhere public.

**How you know it worked:** Neon's dashboard shows the project with a green status and a
`neondb` database.

### Load the demo data

The schema is created automatically on first deploy, but the sample transactions are not.
After Step 2 finishes, come back and run this from the project root, pasting your Neon
connection string in place of the placeholder:

```bash
psql "PASTE_YOUR_NEON_CONNECTION_STRING_HERE" -f database/postgres/seeds/001_demo_data.sql
```

If you do not have `psql` installed, use Neon's **SQL Editor** in the browser instead: open
`database/postgres/seeds/001_demo_data.sql`, copy the whole file, paste it in, and run it.

---

## Step 2 — The API (Render)

1. Go to **render.com** and sign in with GitHub.
2. Click **New → Blueprint**.
3. Choose the `zerofayyz-fintech` repository. Render finds `render.yaml` on its own and
   proposes a service called `zerofayyz-fintech-api`.
4. It will ask for the four values the blueprint deliberately left blank:

   | Variable | What to put |
   | --- | --- |
   | `DATABASE_URL` | The Neon connection string from Step 1 |
   | `STRIPE_API_KEY` | Leave blank for now — Step 4 |
   | `STRIPE_WEBHOOK_SECRET` | Leave blank for now — Step 5 |
   | `APP_URL` | Leave blank for now — Step 3 gives you this |

5. Click **Apply**. The first build takes three to five minutes.

**How you know it worked:** Render shows the service as **Live**, and opening
`https://<your-service>.onrender.com/api/v1/health` returns JSON with
`"status": "operational"` and a `database` block reporting a latency number.

If the database block says `unavailable`, the connection string is wrong or is missing
`?sslmode=require`.

Copy your API's URL. You need it in the next step.

### Turn on the keep-warm ping

From the project root, once you have the URL:

```bash
gh variable set API_HEALTH_URL --body "https://YOUR-SERVICE.onrender.com/api/v1/health"
```

---

## Step 3 — The dashboard (Vercel)

1. Go to **vercel.com** and sign in with GitHub.
2. Click **Add New → Project** and import `zerofayyz-fintech`.
3. Vercel will detect Next.js. Change one setting: set **Root Directory** to `apps/web`.
   Leave the build and output settings alone.
4. Open **Environment Variables** and add:

   | Name | Value |
   | --- | --- |
   | `API_URL` | Your Render URL, e.g. `https://zerofayyz-fintech-api.onrender.com` |
   | `API_TIMEOUT_MS` | `15000` |

   No trailing slash on `API_URL`.

5. Click **Deploy**.

**How you know it worked:** the deployment finishes and your dashboard loads at
`https://<project>.vercel.app` showing API service and PostgreSQL as **Operational**, with
the transactions table populated from the seed data.

### Close the loop

Go back to Render → your service → **Environment**, and set `APP_URL` to your Vercel URL.
This is where Stripe returns the customer after payment. Save; Render redeploys itself.

---

## Step 4 — The Stripe key

You need a key that lets the API create a Checkout Session, and **only** that. The reasoning
is in [ADR 0003](../decisions/0003-restrict-the-stripe-key-and-keep-it-server-side.md).

1. Go to **dashboard.stripe.com** and create an account if you do not have one. You do not
   need to submit business details to use test mode.
2. Make sure the **Test mode** toggle at the top right is **on**. Everything below assumes
   test mode. In test mode no real money can move, ever.
3. Go to **Developers → API keys**.
4. Under **Restricted keys**, click **Create restricted key**.
5. Name it `zerofayyz-fintech-demo`.
6. Find **Checkout Sessions** in the permissions list and set it to **Write**. Leave every
   other permission on **None**. That is the whole point — this key cannot read a customer or
   issue a refund.
7. Click **Create key**, then reveal and copy it. It starts with `rk_test_`.
8. In Render → your service → **Environment**, set `STRIPE_API_KEY` to that value. Save.

**How you know it worked:** after Render redeploys, your dashboard's "Stripe sandbox" tile
changes from "Awaiting test key" to **Configured**.

> Stripe shows a restricted key once. If you lose it, delete it and make another — that costs
> nothing.

---

## Step 5 — The webhook

Stripe needs to tell your API when a payment completes. Locally the Stripe CLI did that; in
production it needs a public address.

1. In Stripe (still in test mode), go to **Developers → Webhooks**.
2. Click **Add endpoint**.
3. **Endpoint URL:** `https://YOUR-SERVICE.onrender.com/api/v1/webhooks/stripe`
4. Under **Select events**, choose these four and nothing else:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded` — added in Phase 4. Without it, approving a refund calls
     Stripe and succeeds, but the confirmation never arrives and the payment
     sits at "succeeded" forever: the ledger only moves on the signed event.
5. Click **Add endpoint**.
6. On the endpoint's page, find **Signing secret** and click reveal. It starts with `whsec_`.
7. In Render → **Environment**, set `STRIPE_WEBHOOK_SECRET` to that value. Save.

**How you know it worked:** the "Webhook queue" tile on your dashboard reads **Configured**,
and the health endpoint reports `"webhook": {"status": "configured"}`.

---

## Step 6 — Prove the whole path

This is the part that matters. Until you have watched it happen, the feature is written but
not proven.

1. Open your Vercel dashboard URL.
2. Confirm all four health tiles read as live: **4 of 4 live**.
3. Click **+ Test payment**. You should land on a Stripe-hosted checkout page.
4. Pay with test card `4242 4242 4242 4242`, any future expiry date, any CVC, any postcode.
5. You are returned to the dashboard with a green success banner.
6. Refresh the page. The payment should now read **Succeeded**, and both **Gross volume** and
   **Webhook events** should have increased.
7. In Stripe → Developers → Webhooks → your endpoint, the event list shows a `200` response.

Then prove idempotency, which is the interesting part:

8. Click into that `checkout.session.completed` event and press **Resend**.
9. Refresh the dashboard. **Nothing should change.** Same totals, same event count, no
   duplicate row. That is the unique constraint doing its job.

---

## Step 7 — Put the link in the README

Edit the top of `README.md`, replacing `_not yet deployed_` with your Vercel URL, and push.
That link is the single most important thing in the repository for a reviewer.

---

## What it costs

| Provider | Plan | Cost | Limit that matters |
| --- | --- | --- | --- |
| Neon | Free | $0 | 0.5 GB storage — this project uses a fraction of it |
| Render | Free | $0 | Sleeps after ~15 min idle; keep-warm handles it |
| Vercel | Hobby | $0 | Non-commercial use; a portfolio qualifies |
| Stripe | Test mode | $0 | No real charges are possible |

Total: nothing. The only optional spend is Render Starter at about $7/month to remove sleeping
entirely.

---

## Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Dashboard tiles all say "Unavailable" | `API_URL` wrong on Vercel, or has a trailing slash |
| Health shows database `unavailable` | `DATABASE_URL` wrong, or missing `?sslmode=require` |
| First load takes ~50 seconds | Render free tier woke from sleep; check the keep-warm variable is set |
| Checkout button says "not configured" | `STRIPE_API_KEY` not set on Render, or the service has not finished redeploying |
| Webhook events show 400 in Stripe | `STRIPE_WEBHOOK_SECRET` does not match this endpoint's signing secret |
| Webhook events show 503 | `STRIPE_WEBHOOK_SECRET` is not set at all |
| Payment stays "Processing" forever | The webhook never arrived — check the endpoint URL has no typo |
| Transactions table is empty | The seed was never loaded into Neon; see Step 1 |

---

## Security notes

- The Stripe key lives only in Render's environment settings. It is never in the repository,
  never in the browser, and never in a build artifact.
- `.env` is gitignored and must stay that way. Only `.env.example` belongs in git.
- If a key is ever exposed, delete it in the Stripe dashboard first and create a replacement
  second. A deleted key stops working immediately.
- Everything here is test mode. There is no path from this deployment to real money, which is
  a deliberate property of the demo and worth saying out loud to anyone reviewing it.
