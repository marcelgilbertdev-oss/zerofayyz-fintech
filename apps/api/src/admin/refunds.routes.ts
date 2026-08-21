import type { FastifyPluginAsync } from "fastify";

import { recordAudit, recordAuditSafely } from "../auth/audit.js";
import { requireRole } from "../auth/auth.routes.js";
import type { Database } from "../database/database.js";
import type { StripeGateway } from "../payments/stripe.gateway.js";

type RefundRouteOptions = {
  database: Database;
  stripe: StripeGateway | null;
};

/**
 * Refunds, with a four-eyes rule.
 *
 * Money moving backwards is the one action here that no single person may
 * complete alone: an operator REQUESTS, an administrator APPROVES, and neither
 * the API nor the schema will let the same account do both — the API for a
 * polite error, a CHECK constraint for every path that does not exist yet.
 *
 * Every state change writes its audit entry with the strict writer. A refund
 * that history cannot record must fail, not proceed unrecorded.
 */

type RefundRow = {
  id: string;
  payment_id: string;
  amount_minor: string | null;
  reason: string;
  status: string;
  requested_by_email: string | null;
  requested_at: Date;
  decided_by_email: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  provider_refund_id: string | null;
  payment_amount_minor: string;
  payment_currency: string;
  payment_status: string;
};

const refundListQuery = `
  SELECT r.id,
         r.payment_id,
         r.amount_minor,
         r.reason,
         r.status,
         requester.email AS requested_by_email,
         r.requested_at,
         decider.email AS decided_by_email,
         r.decided_at,
         r.decision_note,
         r.provider_refund_id,
         p.amount_minor AS payment_amount_minor,
         p.currency AS payment_currency,
         p.status AS payment_status
    FROM refund_requests r
    JOIN payments p ON p.id = r.payment_id
    LEFT JOIN users requester ON requester.id = r.requested_by
    LEFT JOIN users decider ON decider.id = r.decided_by
`;

function toPublic(row: RefundRow) {
  return {
    id: row.id,
    paymentId: row.payment_id,
    amountMinor: row.amount_minor === null ? null : Number(row.amount_minor),
    reason: row.reason,
    status: row.status,
    requestedBy: row.requested_by_email,
    requestedAt: row.requested_at.toISOString(),
    decidedBy: row.decided_by_email,
    decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
    decisionNote: row.decision_note,
    providerRefundId: row.provider_refund_id,
    payment: {
      amountMinor: Number(row.payment_amount_minor),
      currency: row.payment_currency,
      status: row.payment_status,
    },
  };
}

export const refundRoutes: FastifyPluginAsync<RefundRouteOptions> = async (
  app,
  { database, stripe },
) => {
  /** Operator and up: raise a refund request against a succeeded payment. */
  app.post<{
    Params: { id: string };
    Body: { reason: string; amountMinor?: number };
  }>(
    "/admin/payments/:id/refund-requests",
    {
      preHandler: requireRole("operator"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["reason"],
          properties: {
            reason: { type: "string", minLength: 5, maxLength: 500 },
            amountMinor: { type: "integer", minimum: 1 },
          },
        },
      },
    },
    async (request, reply) => {
      const payment = await database.query<
        { id: string; amount_minor: string; status: string },
        [string]
      >(
        "SELECT id, amount_minor, status FROM payments WHERE id = $1",
        [request.params.id],
      );
      const row = payment.rows[0];

      if (!row) {
        return reply.code(404).send({ error: "No payment with that id" });
      }

      if (row.status !== "succeeded") {
        return reply.code(409).send({
          error: `Only a succeeded payment can be refunded; this one is ${row.status}`,
        });
      }

      const amountMinor = request.body.amountMinor ?? null;

      if (amountMinor !== null && amountMinor > Number(row.amount_minor)) {
        return reply.code(400).send({
          error: "A refund cannot exceed the payment it refunds",
        });
      }

      let created;

      try {
        created = await database.query<{ id: string }>(
          `
            INSERT INTO refund_requests (payment_id, amount_minor, reason, requested_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `,
          [row.id, amountMinor, request.body.reason.trim(), request.session?.userId ?? null],
        );
      } catch (error) {
        // The partial unique index: one pending request per payment. A second
        // request is not an error worth a stack trace — it is a queue-jump.
        if ((error as { code?: string }).code === "23505") {
          return reply.code(409).send({
            error: "A refund request for this payment is already awaiting a decision",
          });
        }

        throw error;
      }

      const requestId = created.rows[0]?.id ?? null;

      await recordAudit(database, {
        action: "refund.requested",
        entityType: "refund_request",
        entityId: requestId,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: {
          paymentId: row.id,
          amountMinor,
          reason: request.body.reason.trim(),
        },
      });

      return reply.code(201).send({ id: requestId, status: "pending" });
    },
  );

  /** Operator and up: the queue, newest first. */
  app.get(
    "/admin/refund-requests",
    { preHandler: requireRole("operator") },
    async () => {
      const result = await database.query<RefundRow>(
        `${refundListQuery} ORDER BY r.requested_at DESC LIMIT 100`,
      );

      return { data: result.rows.map(toPublic) };
    },
  );

  /**
   * Admin only: approve. This is the step that actually moves money, so it is
   * the step with every guard: not the requester, request still pending,
   * payment still succeeded, Stripe configured — and the Stripe call is issued
   * with the request id as its idempotency key, so a retried approval cannot
   * refund twice.
   */
  app.post<{ Params: { id: string }; Body: { note?: string } }>(
    "/admin/refund-requests/:id/approve",
    {
      preHandler: requireRole("admin"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: { note: { type: "string", maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      if (!stripe) {
        return reply.code(503).send({ error: "Stripe sandbox is not configured" });
      }

      // Claim first, call Stripe second, revert on failure.
      //
      // The first version checked the request was pending, called Stripe, and
      // then wrote the approval with no status guard — so a rejection landing
      // in that gap was silently overwritten by an approval whose refund had
      // already gone out the door. The claim is one atomic UPDATE: whoever
      // moves the row out of 'pending' wins, and everyone else gets told the
      // request was already decided. Stripe is only ever called by the winner.
      const claimed = await database.query<
        {
          id: string;
          payment_id: string;
          amount_minor: string | null;
          provider_payment_id: string | null;
          payment_amount_minor: string;
        },
        [string, string | null, string | null]
      >(
        `
          UPDATE refund_requests r
             SET status = 'approved',
                 decided_by = $2,
                 decided_at = NOW(),
                 decision_note = $3
            FROM payments p
           WHERE r.id = $1
             AND r.status = 'pending'
             AND r.requested_by <> $2
             AND p.id = r.payment_id
          RETURNING r.id,
                    r.payment_id,
                    r.amount_minor,
                    p.provider_payment_id,
                    p.amount_minor AS payment_amount_minor
        `,
        [request.params.id, request.session?.userId ?? null, request.body.note ?? null],
      );
      const row = claimed.rows[0];

      if (!row) {
        // Refused, but why? Own-request gets the honest explanation; anything
        // else — decided already, never existed — is a 404.
        const own = await database.query<{ id: string }>(
          "SELECT id FROM refund_requests WHERE id = $1 AND status = 'pending' AND requested_by = $2",
          [request.params.id, request.session?.userId ?? null],
        );

        if (own.rows[0]) {
          return reply.code(403).send({
            error: "A refund cannot be approved by the person who requested it",
          });
        }

        return reply.code(404).send({ error: "No pending refund request with that id" });
      }

      const revert = () =>
        database.query(
          `
            UPDATE refund_requests
               SET status = 'pending',
                   decided_by = NULL,
                   decided_at = NULL,
                   decision_note = NULL
             WHERE id = $1
               AND status = 'approved'
               AND provider_refund_id IS NULL
          `,
          [row.id],
        );

      if (!row.provider_payment_id) {
        await revert();
        return reply.code(409).send({
          error: "This payment has no Stripe payment intent to refund against",
        });
      }

      const amountMinor =
        row.amount_minor === null ? null : Number(row.amount_minor);

      let refund;

      try {
        refund = await stripe.refunds.create(
          {
            payment_intent: row.provider_payment_id,
            ...(amountMinor === null ? {} : { amount: amountMinor }),
            metadata: {
              refund_request_id: row.id,
              environment: "portfolio_sandbox",
            },
          },
          // Stripe deduplicates on this key, so an approval retried after a
          // network failure cannot issue a second refund for the same request.
          { idempotencyKey: `refund-request-${row.id}` },
        );
      } catch (error) {
        // The claim is released so the request can be decided again; the
        // failed attempt still goes into the history, tolerantly — a logging
        // failure must not leave the row claimed forever.
        await revert();
        await recordAuditSafely(
          database,
          {
            action: "refund.approve_failed",
            entityType: "refund_request",
            entityId: row.id,
            actorUserId: request.session?.userId ?? null,
            sessionId: request.session?.sessionId ?? null,
            metadata: { paymentId: row.payment_id },
          },
          (auditError) => request.log.error({ auditError }, "audit write failed"),
        );
        request.log.error({ error, requestId: row.id }, "Stripe refund failed");

        return reply.code(502).send({ error: "Stripe refused the refund; the request is pending again" });
      }

      await database.query(
        "UPDATE refund_requests SET provider_refund_id = $2 WHERE id = $1",
        [row.id, refund.id],
      );

      await recordAudit(database, {
        action: "refund.approved",
        entityType: "refund_request",
        entityId: row.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: {
          paymentId: row.payment_id,
          providerRefundId: refund.id,
          amountMinor: amountMinor ?? Number(row.payment_amount_minor),
        },
      });

      // The ledger is NOT updated here. Stripe's charge.refunded webhook is the
      // confirmation that money actually moved, and it updates the payment the
      // same signed, idempotent way every other event does. This route records
      // the decision; the webhook records the fact.
      return reply.send({ approved: true, providerRefundId: refund.id });
    },
  );

  /**
   * The requester withdraws their own pending request. The one decision a
   * requester makes about their own ask — without it, a request nobody else
   * has decided occupies the payment's single pending slot forever.
   */
  app.post<{ Params: { id: string } }>(
    "/admin/refund-requests/:id/withdraw",
    {
      preHandler: requireRole("operator"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (request, reply) => {
      const result = await database.query<{ payment_id: string }>(
        `
          UPDATE refund_requests
             SET status = 'withdrawn',
                 decided_by = $2,
                 decided_at = NOW()
           WHERE id = $1
             AND status = 'pending'
             AND requested_by = $2
          RETURNING payment_id
        `,
        [request.params.id, request.session?.userId ?? null],
      );

      if ((result.rowCount ?? 0) === 0) {
        // Pending-but-not-yours and simply-not-there answer identically: which
        // of the two it was is not this caller's business.
        return reply.code(404).send({ error: "No pending refund request of yours with that id" });
      }

      await recordAudit(database, {
        action: "refund.withdrawn",
        entityType: "refund_request",
        entityId: request.params.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: { paymentId: result.rows[0]?.payment_id },
      });

      return reply.send({ withdrawn: true });
    },
  );

  /** Admin only: reject, with a note the requester will read. */
  app.post<{ Params: { id: string }; Body: { note: string } }>(
    "/admin/refund-requests/:id/reject",
    {
      preHandler: requireRole("admin"),
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["note"],
          properties: { note: { type: "string", minLength: 3, maxLength: 500 } },
        },
      },
    },
    async (request, reply) => {
      const result = await database.query<{ requested_by: string; payment_id: string }>(
        `
          UPDATE refund_requests
             SET status = 'rejected',
                 decided_by = $2,
                 decided_at = NOW(),
                 decision_note = $3
           WHERE id = $1
             AND status = 'pending'
             AND requested_by <> $2
          RETURNING requested_by, payment_id
        `,
        [request.params.id, request.session?.userId ?? null, request.body.note],
      );

      if ((result.rowCount ?? 0) === 0) {
        const own = await database.query<{ id: string }>(
          "SELECT id FROM refund_requests WHERE id = $1 AND status = 'pending' AND requested_by = $2",
          [request.params.id, request.session?.userId ?? null],
        );

        if (own.rows[0]) {
          return reply.code(403).send({
            error: "A refund cannot be rejected by the person who requested it",
          });
        }

        return reply.code(404).send({ error: "No pending refund request with that id" });
      }

      await recordAudit(database, {
        action: "refund.rejected",
        entityType: "refund_request",
        entityId: request.params.id,
        actorUserId: request.session?.userId ?? null,
        sessionId: request.session?.sessionId ?? null,
        metadata: {
          paymentId: result.rows[0]?.payment_id,
          note: request.body.note,
        },
      });

      return reply.send({ rejected: true });
    },
  );
};
