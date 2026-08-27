import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";

type TransactionRouteOptions = {
  database: Database;
};

type TransactionRow = {
  id: string;
  payment_id: string;
  display_name: string;
  email: string;
  amount_minor: string;
  currency: string;
  status: string;
  method_label: string;
  created_at: Date;
  total: string;
};

const transactionListSchema = {
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
          "customer",
          "amountMinor",
          "currency",
          "status",
          "methodLabel",
          "createdAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          // The payment the event belongs to. The admin console's refund
          // request is raised against the payment, not the event.
          paymentId: { type: "string", format: "uuid" },
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
          methodLabel: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["count", "total", "limit", "offset", "source"],
      properties: {
        // count stays: it is what the deployed clients were compiled against.
        // total/limit/offset are the same paged meta the ledger routes emit,
        // added when this endpoint learned to page (it shipped with LIMIT 10
        // hardcoded and silently ignored its query string).
        count: { type: "integer", minimum: 0 },
        total: { type: "integer", minimum: 0 },
        limit: { type: "integer", minimum: 1 },
        offset: { type: "integer", minimum: 0 },
        source: { type: "string", enum: ["postgresql"] },
      },
    },
  },
} as const;

export const transactionRoutes: FastifyPluginAsync<TransactionRouteOptions> = async (
  app,
  { database },
) => {
  app.get(
    "/transactions",
    {
      schema: {
        tags: ["transactions"],
        summary: "List recent sandbox transactions",
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            limit: { type: "integer", minimum: 1, maximum: 100 },
            offset: { type: "integer", minimum: 0 },
          },
        },
        response: {
          200: transactionListSchema,
        },
      },
    },
    async (request) => {
      // Validated and coerced by the querystring schema above; typed here
      // because the untyped route shorthand keeps the swagger tags compiling.
      const query = request.query as { limit?: number; offset?: number };
      // 10 was this endpoint's hardcoded window before it paged; keeping it as
      // the default keeps the dashboard's "recent transactions" unchanged.
      const limit = query.limit ?? 10;
      const offset = query.offset ?? 0;

      const result = await database.query<TransactionRow, [number, number]>(
        `
        SELECT *, COUNT(*) OVER ()::TEXT AS total
        FROM (
          SELECT DISTINCT ON (payments.id)
            transactions.id,
            payments.id AS payment_id,
            users.display_name,
            users.email,
            payments.amount_minor::TEXT AS amount_minor,
            payments.currency,
            payments.status,
            CASE
              WHEN payments.provider_checkout_session_id IS NOT NULL THEN 'Stripe Checkout'
              ELSE 'Sandbox card'
            END AS method_label,
            payments.created_at
          FROM transactions
          INNER JOIN payments ON payments.id = transactions.payment_id
          INNER JOIN users ON users.id = payments.user_id
          ORDER BY payments.id, transactions.occurred_at DESC
        ) AS latest_payment_events
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2
      `,
        [limit, offset],
      );

      const data = result.rows.map((row) => ({
        id: row.id,
        paymentId: row.payment_id,
        customer: {
          displayName: row.display_name,
          email: row.email,
        },
        amountMinor: Number.parseInt(row.amount_minor, 10),
        currency: row.currency,
        status: row.status,
        methodLabel: row.method_label,
        createdAt: row.created_at.toISOString(),
      }));

      return {
        data,
        meta: {
          count: data.length,
          total: Number.parseInt(result.rows[0]?.total ?? "0", 10),
          limit,
          offset,
          source: "postgresql" as const,
        },
      };
    },
  );
};
