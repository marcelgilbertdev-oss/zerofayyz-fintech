# ZEROFAYYZ FINTECH — try it in three minutes

**A cloud payments and operations platform.** Stripe sandbox only; no real funds move and
no real customer data exists. Everything below is safe to click.

**→ [zerofayyz-fintech.vercel.app](https://zerofayyz-fintech.vercel.app)**

---

## 1. The dashboard (30 seconds)

Every figure on the page is computed from PostgreSQL on each request. Gross volume,
success rate, pending settlement, the twelve-day chart, and the transaction table are all
live reads — nothing is hard-coded.

Click **日本語** in the header. The interface is fully localised; product names correctly
stay in Latin script, and dates switch to Japanese conventions.

## 2. Make a payment (60 seconds)

Type any amount into the `¥` field in the header — pick something memorable, like
`13742` — and click **+ Test payment**. Amounts are yen, so whole numbers only.

Pay on Stripe's own page with test card `4242 4242 4242 4242`, any future expiry, any CVC.

You return to the dashboard. **Refresh**, and your payment is in the table for the exact
amount you chose, with the headline total moved by that much.

What just happened: the browser asked the API to create a session, the API wrote a payment
row and called Stripe, you paid on Stripe's domain, Stripe sent a cryptographically signed
webhook back, the API verified that signature and wrote the result to PostgreSQL in
Singapore, and the dashboard read it back. Card details never touched this system.

## 3. Sign in to the admin console (60 seconds)

Click **Sign in**, then **Fill these in for me**. The demo credentials are published on
purpose — no request required:

```
demo@zerofayyz.test  ·  view-the-ledger
```

That account is an **operator**: it can read everything and change nothing.

Inside you will find the **audit log** — an append-only history the database itself refuses
to edit or delete, enforced by a trigger rather than by convention. Your own sign-in is the
newest row.

Administrator accounts additionally see **Active sessions** — who is signed in at this
moment — and can end any session remotely. A revoked session stops working on its holder's
very next request, without their cookie changing or expiring.

## The same API through two more frameworks

The API is consumed unmodified by three independent frontends sharing one runtime-validated
contract:

- **Vue 3** (Composition API + Pinia) — [zerofayyz-fintech-vue.vercel.app](https://zerofayyz-fintech-vue.vercel.app)
- **Svelte 5** (runes) — [zerofayyz-fintech-svelte.vercel.app](https://zerofayyz-fintech-svelte.vercel.app)

Same ledger, same numbers, three idioms.

Both clients carry the staff door too: scroll to the **Operator area** at the bottom of
either page, click **Fill these in for me**, and sign in. The audit trail that appears is
the same append-only table the admin console reads — your sign-in on the Vue page is the
newest row when you open the Svelte one. Same session cookie, same rate limiter, same
refusals, spoken through Pinia on one page and runes on the other.

---

## What this demonstrates

| | |
| --- | --- |
| **Payments** | Hosted Stripe Checkout, signature-verified webhooks, an auditable ledger |
| **Idempotency** | Duplicate webhook deliveries are refused by a database constraint, not by application branching — it holds under concurrency and across restarts |
| **Authentication** | scrypt password hashing, opaque server-side sessions, role-based access enforced on the API |
| **Auditability** | Append-only history the application itself cannot rewrite |
| **Internationalisation** | English and Japanese, with translations enforced by the type system — a missing string is a compile error |
| **Accessibility** | WCAG 2.1 AA, scanned by axe-core in CI against both locales |
| **Testing** | 331 automated tests across ten suites — unit, integration against real PostgreSQL, component suites for the Vue and Svelte clients, end-to-end against a production build, and thirteen Cucumber/Gherkin scenarios stating the payment rules in plain language — plus a 29-check smoke suite that verifies the live deployment from outside |
| **Operations** | Three-tier deployment colocated in Singapore, CI gating every merge, migrations applied before traffic |

**Built by Marcel Gilbert** · [github.com/marcelgilbertdev-oss/zerofayyz-fintech](https://github.com/marcelgilbertdev-oss/zerofayyz-fintech)

For engineers: the [architecture overview](../architecture/SYSTEM_OVERVIEW.md), ten
[decision records](../decisions/), and a [manual acceptance charter](../runbooks/MANUAL_ACCEPTANCE_TEST.md)
carrying every defect found during development and how each was closed.
