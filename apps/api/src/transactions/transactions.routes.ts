import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";

type TransactionRouteOptions = {
  database: Database;
};

type TransactionRow = {
  id: string;
  display_name: string;
  email: string;
  amount_minor: string;
  currency: string;
  status: string;
  method_label: string;
  created_at: Date;
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
          "customer",
          "amountMinor",
          "currency",
          "status",
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
          methodLabel: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
        },
      },
    },
    meta: {
      type: "object",
      additionalProperties: false,
      required: ["count", "source"],
      properties: {
        count: { type: "integer", minimum: 0 },
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
        response: {
          200: transactionListSchema,
        },
      },
    },
    async () => {
      const result = await database.query<TransactionRow>(`
        SELECT *
        FROM (
          SELECT DISTINCT ON (payments.id)
            transactions.id,
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
        LIMIT 10
      `);

      const data = result.rows.map((row) => ({
        id: row.id,
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
          source: "postgresql" as const,
        },
      };
    },
  );
};
