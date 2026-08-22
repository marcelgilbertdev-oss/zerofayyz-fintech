import { randomUUID } from "node:crypto";

import type { FastifyPluginAsync } from "fastify";
import type Stripe from "stripe";

import type { Database } from "../database/database.js";
import type { StripeGateway } from "./stripe.gateway.js";

type PaymentRouteOptions = {
  database: Database;
  stripe: StripeGateway | null;
};

type UserRow = {
  id: string;
};

type CheckoutBody = {
  customerEmail?: string;
  amountMinor?: number;
};

const DEMO_AMOUNT_MINOR = 4_200;
// Stripe will not charge less than $0.50 in USD, so the floor mirrors the
// gateway's own rule rather than inventing a softer one.
//
// The ceiling is ours, and it is deliberately generous: anyone may pick any
// amount up to $10,000. It is bounded at all because this endpoint is public
// and unauthenticated — an unbounded amount lets one stranger put nine digits
// into the gross-volume tile and ruin the dashboard for everyone after them.
// A payments reviewer expects to find a bound here; its absence is the finding.
const MIN_AMOUNT_MINOR = 50;
const MAX_AMOUNT_MINOR = 1_000_000;
const DEMO_CURRENCY = "USD";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function paymentIntentId(
  paymentIntent: string | Stripe.PaymentIntent | null,
): string | null {
  if (typeof paymentIntent === "string") {
    return paymentIntent;
  }

  return paymentIntent?.id ?? null;
}

/**
 * The origins a payer may be returned to after Stripe.
 *
 * APP_URL is always allowed. CLIENT_ORIGINS carries the SPA clients as a
 * comma-separated list, so adding a client is configuration rather than a code
 * change. Localhost ports are allowed too, because the same flow has to work in
 * development without a second code path.
 */
function allowedReturnOrigins(): string[] {
  const configured = (process.env.CLIENT_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/$/, ""))
    .filter(Boolean);

  return [
    (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, ""),
    ...configured,
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:3001",
    "http://localhost:3001",
    "http://127.0.0.1:3002",
    "http://localhost:3002",
  ];
}

/** An exact allowlist match, or APP_URL. Never the caller's raw header. */
export function returnOriginFor(origin: string | undefined): string {
  const fallback = (process.env.APP_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");

  if (!origin) {
    return fallback;
  }

  const candidate = origin.trim().replace(/\/$/, "");

  // Exact string equality on the whole origin — not startsWith, not includes.
  // "https://zerofayyz-fintech.vercel.app.attacker.test" passes a prefix check
  // and is a different site.
  return allowedReturnOrigins().includes(candidate) ? candidate : fallback;
}

export const paymentRoutes: FastifyPluginAsync<PaymentRouteOptions> = async (
  app,
  { database, stripe },
) => {
  app.post<{ Body: CheckoutBody }>(
    "/payments/checkout-session",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            customerEmail: { type: "string", format: "email", maxLength: 254 },
            amountMinor: {
              type: "integer",
              minimum: MIN_AMOUNT_MINOR,
              maximum: MAX_AMOUNT_MINOR,
            },
          },
        },
        response: {
          201: {
            type: "object",
            additionalProperties: false,
            required: ["checkoutSessionId", "url"],
            properties: {
              checkoutSessionId: { type: "string" },
              url: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!stripe) {
        return reply.code(503).send({
          error: "Stripe sandbox is not configured",
        });
      }

      const customerEmail =
        request.body?.customerEmail?.trim().toLowerCase() ??
        "portfolio.customer@zerofayyz.test";
      const amountMinor = request.body?.amountMinor ?? DEMO_AMOUNT_MINOR;
      const paymentId = randomUUID();
      // Return the payer to the client they started from.
      //
      // A single APP_URL sent every checkout back to the Next.js dashboard, so a
      // reviewer testing the Vue client paid and landed in a different app —
      // found in a live charter run. The origin has to come from the request.
      //
      // But an origin taken from a request header and handed to Stripe as a
      // redirect target is an open redirect: whoever calls this endpoint chooses
      // where the payer lands, and this endpoint is deliberately public. So the
      // header is matched against an allowlist and anything unrecognised falls
      // back to APP_URL. Never the raw header.
      const appUrl = returnOriginFor(request.headers.origin);

      const userResult = await database.query<UserRow, [string, string]>(
        `
          INSERT INTO users (email, display_name)
          VALUES ($1, $2)
          ON CONFLICT (LOWER(email))
          DO UPDATE SET updated_at = NOW()
          RETURNING id
        `,
        [customerEmail, "Portfolio Recruiter"],
      );
      const userId = userResult.rows[0]?.id;

      if (!userId) {
        throw new Error("Unable to create the sandbox customer");
      }

      await database.query(
        `
          INSERT INTO payments (
            id,
            user_id,
            amount_minor,
            currency,
            status,
            description
          )
          VALUES ($1, $2, $3, $4, 'created', $5)
        `,
        [
          paymentId,
          userId,
          amountMinor,
          DEMO_CURRENCY,
          "ZEROFAYYZ FINTECH sandbox checkout",
        ],
      );

      try {
        const session = await stripe.checkout.sessions.create(
          {
            mode: "payment",
            // Card only, deliberately. Left unset, Stripe's hosted page offers
            // every wallet enabled in test mode — and Amazon Pay's sandbox
            // demands an Amazon sandbox login no reviewer has, a guaranteed
            // dead-end discovered in a live charter run. The demo's story is
            // the documented 4242 path; a wallet button that errors teaches a
            // reviewer nothing except distrust.
            payment_method_types: ["card"],
            integration_identifier: "zerofayyz_fintech_demo_qjvmpxaz",
            client_reference_id: paymentId,
            customer_email: customerEmail,
            success_url: `${appUrl}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${appUrl}/?checkout=canceled`,
            line_items: [
              {
                quantity: 1,
                price_data: {
                  currency: DEMO_CURRENCY.toLowerCase(),
                  unit_amount: amountMinor,
                  product_data: {
                    name: "ZEROFAYYZ FINTECH Sandbox Payment",
                    description: "Portfolio prototype transaction—no real funds move.",
                  },
                },
              },
            ],
            metadata: {
              payment_id: paymentId,
              environment: "portfolio_sandbox",
            },
          },
          { idempotencyKey: paymentId },
        );

        if (!session.url) {
          throw new Error("Stripe did not return a Checkout URL");
        }

        await database.query(
          `
            UPDATE payments
            SET
              provider_checkout_session_id = $2,
              status = 'processing',
              updated_at = NOW()
            WHERE id = $1
          `,
          [paymentId, session.id],
        );

        return reply.code(201).send({
          checkoutSessionId: session.id,
          url: session.url,
        });
      } catch (error) {
        await database.query(
          `
            UPDATE payments
            SET status = 'failed', updated_at = NOW()
            WHERE id = $1
          `,
          [paymentId],
        );
        request.log.error({ error, paymentId }, "Unable to create Stripe Checkout Session");

        return reply.code(502).send({
          error: "Unable to start the Stripe sandbox checkout",
        });
      }
    },
  );

  app.post(
    "/webhooks/stripe",
    {
      config: {
        rawBody: true,
      },
      schema: {},
    },
    async (request, reply) => {
      const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
      const signature = request.headers["stripe-signature"];

      if (!stripe || !webhookSecret) {
        return reply.code(503).send({
          error: "Stripe webhook verification is not configured",
        });
      }

      if (!request.rawBody || typeof signature !== "string") {
        return reply.code(400).send({
          error: "Missing Stripe webhook payload or signature",
        });
      }

      let event: Stripe.Event;

      try {
        event = stripe.webhooks.constructEvent(
          request.rawBody,
          signature,
          webhookSecret,
        );
      } catch {
        return reply.code(400).send({
          error: "Invalid Stripe webhook signature",
        });
      }

      // Refunds confirm through their own event, carrying a Charge rather
      // than a Checkout Session. The approval route deliberately does not
      // touch the ledger — this signed event is the fact that money moved,
      // and it is recorded with the same idempotency shape as every payment
      // event: the transaction insert keyed on the event id, everything else
      // chained to it.
      if (event.type === "charge.refunded") {
        const charge = event.data.object;
        const intentId = paymentIntentId(charge.payment_intent);

        if (!intentId) {
          request.log.warn({ eventId: event.id }, "Refund event carries no payment intent");
          return { received: true, processed: false };
        }

        // Stripe fires charge.refunded for partial refunds too, with
        // charge.refunded=true only once the full amount has gone back. A
        // partially refunded payment keeps its succeeded status — the money
        // that remains is still settled money — while the refund itself is a
        // ledger fact either way.
        const fullyRefunded = charge.refunded === true;
        const refundedMinor = charge.amount_refunded ?? 0;

        const result = await database.query(
          `
            WITH target_payment AS (
              SELECT id FROM payments WHERE provider_payment_id = $1
            ),
            recorded_event AS (
              INSERT INTO transactions (
                payment_id,
                provider_event_id,
                event_type,
                amount_minor,
                currency,
                occurred_at
              )
              SELECT id, $2, 'payment_refunded', $3, $4, TO_TIMESTAMP($5)
                FROM target_payment
              ON CONFLICT (provider_event_id) DO NOTHING
              RETURNING payment_id
            ),
            updated_payment AS (
              UPDATE payments
              SET status = CASE WHEN $6 THEN 'refunded' ELSE payments.status END,
                  updated_at = NOW()
              FROM recorded_event
              WHERE payments.id = recorded_event.payment_id
              RETURNING payments.id
            )
            INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
            SELECT
              'stripe.webhook.processed',
              'payment',
              id,
              JSONB_BUILD_OBJECT(
                'event_id', $2::TEXT,
                'event_type', $7::TEXT,
                'fully_refunded', $6::BOOLEAN
              )
            FROM updated_payment
          `,
          [
            intentId,
            event.id,
            refundedMinor,
            (charge.currency ?? "usd").toUpperCase(),
            event.created,
            fullyRefunded,
            event.type,
          ],
        );

        return { received: true, processed: (result.rowCount ?? 0) > 0 };
      }

      if (
        event.type !== "checkout.session.completed" &&
        event.type !== "checkout.session.async_payment_succeeded" &&
        event.type !== "checkout.session.async_payment_failed" &&
        event.type !== "checkout.session.expired"
      ) {
        return { received: true, processed: false };
      }

      const session = event.data.object;
      const paymentId = session.client_reference_id ?? session.metadata?.payment_id;

      if (!paymentId || !UUID_PATTERN.test(paymentId)) {
        request.log.warn({ eventId: event.id }, "Stripe event has no valid local payment ID");
        return { received: true, processed: false };
      }

      const succeeded =
        event.type === "checkout.session.async_payment_succeeded" ||
        (event.type === "checkout.session.completed" && session.payment_status === "paid");
      const failed = event.type === "checkout.session.async_payment_failed";
      const canceled = event.type === "checkout.session.expired";
      const status = succeeded
        ? "succeeded"
        : failed
          ? "failed"
          : canceled
            ? "canceled"
            : "processing";
      const transactionType = succeeded
        ? "payment_succeeded"
        : failed
          ? "payment_failed"
          : canceled
            ? "payment_canceled"
            : "payment_processing";

      // The closing INSERT selects from updated_payment, so it writes one row for
      // a genuinely new event and none for a redelivery. rowCount therefore
      // reports whether this delivery actually changed anything.
      let written: number;

      try {
        const result = await database.query(
        `
          WITH recorded_event AS (
            INSERT INTO transactions (
              payment_id,
              provider_event_id,
              event_type,
              amount_minor,
              currency,
              occurred_at
            )
            VALUES ($1, $2, $3, $4, $5, TO_TIMESTAMP($6))
            ON CONFLICT (provider_event_id) DO NOTHING
            RETURNING payment_id
          ),
          updated_payment AS (
            UPDATE payments
            SET
              provider_payment_id = COALESCE($7, provider_payment_id),
              provider_checkout_session_id = $8,
              status = $9,
              updated_at = NOW()
            FROM recorded_event
            WHERE payments.id = recorded_event.payment_id
            RETURNING payments.id
          )
          INSERT INTO audit_logs (action, entity_type, entity_id, metadata)
          SELECT
            'stripe.webhook.processed',
            'payment',
            id,
            -- JSONB_BUILD_OBJECT accepts "any", so an uncast bind parameter has
            -- no inferable type and PostgreSQL rejects the statement with 42P18.
            JSONB_BUILD_OBJECT('event_id', $2::TEXT, 'event_type', $10::TEXT)
          FROM updated_payment
        `,
          [
            paymentId,
            event.id,
            transactionType,
            session.amount_total ?? DEMO_AMOUNT_MINOR,
            (session.currency ?? DEMO_CURRENCY).toUpperCase(),
            event.created,
            paymentIntentId(session.payment_intent),
            session.id,
            status,
            event.type,
          ],
        );

        written = result.rowCount ?? 0;
      } catch (error) {
        // 23503 is a foreign-key violation: the event names a payment this
        // system has never issued. Acknowledge it so Stripe stops retrying
        // forever, but record nothing — an unknown reference is not our event.
        if ((error as { code?: string }).code === "23503") {
          request.log.warn(
            { eventId: event.id, paymentId },
            "Stripe event references an unknown payment",
          );

          return { received: true, processed: false };
        }

        throw error;
      }

      if (written === 0) {
        request.log.info(
          { eventId: event.id },
          "Stripe event was already recorded; nothing changed",
        );
      }

      // Report what actually happened. A redelivery is acknowledged, not
      // claimed as processed.
      return { received: true, processed: written > 0 };
    },
  );
};
