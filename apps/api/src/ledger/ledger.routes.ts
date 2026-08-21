import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";

type LedgerRouteOptions = {
  database: Database;
};

/**
 * The read surface behind the Payments, Transactions and Customers pages.
 *
 * Public, like every other read on the dashboard: the platform's doctrine is
 * that reading the sandbox is free and writing anything requires a role. All
 * three are plain paginated queries — the interesting property is that the
 * Transactions page exposes the raw Stripe event stream, provider event ids
 * included, which makes the idempotency story visible instead of asserted:
 * every id in that column is UNIQUE-constrained, and that constraint is the
 * entire duplicate-webhook defence.
 *
 * Pagination is limit/offset with an exact total. At sandbox scale that is
 * the right tool; the day this table holds a million rows, the fix is keyset
 * pagination, and the meta shape below (limit/offset/total) is what a client
 * needs either way.
 */

const PAYMENT_STATUSES = [
  "created",
  "processing",
  "succeeded",
  "failed",
  "canceled",
  "refunded",
] as const;

const listMeta = {
  type: "object",
  additionalProperties: false,
  required: ["total", "limit", "offset", "source"],
  properties: {
    total: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1 },
    offset: { type: "integer", minimum: 0 },
    source: { type: "string", enum: ["postgresql"] },
  },
} as const;

const paginationQuery = {
  limit: { type: "integer", minimum: 1, maximum: 100 },
  offset: { type: "integer", minimum: 0 },
} as const;

type PaymentRow = {
  id: string;
  display_name: string;
  email: string;
  amount_minor: string;
  currency: string;
  status: string;
  description: string | null;
  method_label: string;
  created_at: Date;
  total: string;
};

type EventRow = {
  id: string;
  payment_id: string;
  provider_event_id: string | null;
  event_type: string;
  amount_minor: string;
  currency: string;
  occurred_at: Date;
  customer_email: string;
  total: string;
};

type CustomerRow = {
  id: string;
  display_name: string;
  email: string;
  role: string;
  payment_count: string;
  succeeded_volume_minor: string;
  last_payment_at: Date | null;
  total: string;
};

export const ledgerRoutes: FastifyPluginAsync<LedgerRouteOptions> = async (
  app,
  { database },
) => {
  app.get<{ Querystring: { status?: string; limit?: number; offset?: number } }>(
    "/payments",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            ...paginationQuery,
            status: { type: "string", enum: [...PAYMENT_STATUSES] },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data", "meta"],
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "customer",
                    "amountMinor",
                    "currency",
                    "status",
                    "description",
                    "methodLabel",
                    "createdAt",
                  ],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    customer: {
                      type: "object",
                      additionalProperties: false,
                      required: ["displayName", "email"],
                      properties: {
                        displayName: { type: "string" },
                        email: { type: "string" },
                      },
                    },
                    amountMinor: { type: "integer", minimum: 1 },
                    currency: { type: "string", minLength: 3, maxLength: 3 },
                    status: { type: "string" },
                    description: { type: ["string", "null"] },
                    methodLabel: { type: "string" },
                    createdAt: { type: "string", format: "date-time" },
                  },
                },
              },
              meta: listMeta,
            },
          },
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;
      const status = request.query.status ?? null;

      // COUNT(*) OVER () rides along on every row, so the exact total for the
      // current filter costs one query instead of two that could disagree.
      const result = await database.query<PaymentRow, [string | null, number, number]>(
        `
          SELECT payments.id,
                 users.display_name,
                 users.email,
                 payments.amount_minor::TEXT AS amount_minor,
                 payments.currency,
                 payments.status,
                 payments.description,
                 CASE
                   WHEN payments.provider_checkout_session_id IS NOT NULL THEN 'Stripe Checkout'
                   ELSE 'Sandbox card'
                 END AS method_label,
                 payments.created_at,
                 COUNT(*) OVER ()::TEXT AS total
            FROM payments
            INNER JOIN users ON users.id = payments.user_id
           WHERE ($1::TEXT IS NULL OR payments.status = $1)
           ORDER BY payments.created_at DESC, payments.id
           LIMIT $2 OFFSET $3
        `,
        [status, limit, offset],
      );

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          customer: { displayName: row.display_name, email: row.email },
          amountMinor: Number.parseInt(row.amount_minor, 10),
          currency: row.currency,
          status: row.status,
          description: row.description,
          methodLabel: row.method_label,
          createdAt: row.created_at.toISOString(),
        })),
        meta: {
          total: Number.parseInt(result.rows[0]?.total ?? "0", 10),
          limit,
          offset,
          source: "postgresql" as const,
        },
      };
    },
  );

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/events",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: paginationQuery,
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data", "meta"],
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "paymentId",
                    "providerEventId",
                    "eventType",
                    "amountMinor",
                    "currency",
                    "occurredAt",
                    "customerEmail",
                  ],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    paymentId: { type: "string", format: "uuid" },
                    // Nullable: seeded demo events predate real Stripe ids.
                    providerEventId: { type: ["string", "null"] },
                    eventType: { type: "string" },
                    amountMinor: { type: "integer", minimum: 0 },
                    currency: { type: "string", minLength: 3, maxLength: 3 },
                    occurredAt: { type: "string", format: "date-time" },
                    customerEmail: { type: "string" },
                  },
                },
              },
              meta: listMeta,
            },
          },
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;

      const result = await database.query<EventRow, [number, number]>(
        `
          SELECT transactions.id,
                 transactions.payment_id,
                 transactions.provider_event_id,
                 transactions.event_type,
                 transactions.amount_minor::TEXT AS amount_minor,
                 transactions.currency,
                 transactions.occurred_at,
                 users.email AS customer_email,
                 COUNT(*) OVER ()::TEXT AS total
            FROM transactions
            INNER JOIN payments ON payments.id = transactions.payment_id
            INNER JOIN users ON users.id = payments.user_id
           ORDER BY transactions.occurred_at DESC, transactions.id
           LIMIT $1 OFFSET $2
        `,
        [limit, offset],
      );

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          paymentId: row.payment_id,
          providerEventId: row.provider_event_id,
          eventType: row.event_type,
          amountMinor: Number.parseInt(row.amount_minor, 10),
          currency: row.currency,
          occurredAt: row.occurred_at.toISOString(),
          customerEmail: row.customer_email,
        })),
        meta: {
          total: Number.parseInt(result.rows[0]?.total ?? "0", 10),
          limit,
          offset,
          source: "postgresql" as const,
        },
      };
    },
  );

  app.get<{ Querystring: { limit?: number; offset?: number } }>(
    "/customers",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: paginationQuery,
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["data", "meta"],
            properties: {
              data: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: [
                    "id",
                    "displayName",
                    "email",
                    "paymentCount",
                    "succeededVolumeMinor",
                    "lastPaymentAt",
                  ],
                  properties: {
                    id: { type: "string", format: "uuid" },
                    displayName: { type: "string" },
                    email: { type: "string" },
                    paymentCount: { type: "integer", minimum: 0 },
                    // USD-scoped, like /metrics: summing across currencies
                    // produces a number that means nothing.
                    succeededVolumeMinor: { type: "integer", minimum: 0 },
                    lastPaymentAt: { type: ["string", "null"], format: "date-time" },
                  },
                },
              },
              meta: listMeta,
            },
          },
        },
      },
    },
    async (request) => {
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;

      const result = await database.query<CustomerRow, [number, number]>(
        `
          SELECT users.id,
                 users.display_name,
                 users.email,
                 users.role,
                 COUNT(payments.id)::TEXT AS payment_count,
                 COALESCE(SUM(payments.amount_minor)
                   FILTER (WHERE payments.status = 'succeeded'
                             AND payments.currency = 'USD'), 0)::TEXT
                   AS succeeded_volume_minor,
                 MAX(payments.created_at) AS last_payment_at,
                 COUNT(*) OVER ()::TEXT AS total
            FROM users
            INNER JOIN payments ON payments.user_id = users.id
           WHERE users.role = 'customer'
           GROUP BY users.id
           ORDER BY MAX(payments.created_at) DESC
           LIMIT $1 OFFSET $2
        `,
        [limit, offset],
      );

      return {
        data: result.rows.map((row) => ({
          id: row.id,
          displayName: row.display_name,
          email: row.email,
          paymentCount: Number.parseInt(row.payment_count, 10),
          succeededVolumeMinor: Number.parseInt(row.succeeded_volume_minor, 10),
          lastPaymentAt: row.last_payment_at ? row.last_payment_at.toISOString() : null,
        })),
        meta: {
          total: Number.parseInt(result.rows[0]?.total ?? "0", 10),
          limit,
          offset,
          source: "postgresql" as const,
        },
      };
    },
  );
};
