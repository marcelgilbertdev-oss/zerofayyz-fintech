import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";

type MetricRouteOptions = {
  database: Database;
};

type SummaryRow = {
  gross_minor: string;
  succeeded_count: string;
  settled_count: string;
  pending_minor: string;
  pending_count: string;
  event_count: string;
};

type DailyRow = {
  day: Date;
  volume_minor: string;
};

/**
 * Summing across currencies would be wrong, so every figure is scoped to a
 * single currency and the response says which one it used.
 */
const DEFAULT_CURRENCY = "USD";
const DAILY_VOLUME_DAYS = 12;

const metricsResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["currency", "grossVolumeMinor", "succeededCount", "successRate", "pending", "eventsRecorded", "dailyVolume"],
  properties: {
    currency: { type: "string", minLength: 3, maxLength: 3 },
    grossVolumeMinor: { type: "integer", minimum: 0 },
    succeededCount: { type: "integer", minimum: 0 },
    successRate: { type: ["number", "null"], minimum: 0, maximum: 100 },
    pending: {
      type: "object",
      additionalProperties: false,
      required: ["amountMinor", "count"],
      properties: {
        amountMinor: { type: "integer", minimum: 0 },
        count: { type: "integer", minimum: 0 },
      },
    },
    eventsRecorded: { type: "integer", minimum: 0 },
    dailyVolume: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "amountMinor"],
        properties: {
          date: { type: "string" },
          amountMinor: { type: "integer", minimum: 0 },
        },
      },
    },
  },
} as const;

function toInteger(value: string | null | undefined): number {
  const parsed = Number.parseInt(value ?? "0", 10);

  return Number.isNaN(parsed) ? 0 : parsed;
}

export const metricRoutes: FastifyPluginAsync<MetricRouteOptions> = async (
  app,
  { database },
) => {
  app.get(
    "/metrics",
    {
      schema: {
        tags: ["metrics"],
        summary: "Aggregate payment metrics for a single currency",
        response: {
          200: metricsResponseSchema,
        },
      },
    },
    async () => {
      const [summary, daily] = await Promise.all([
        database.query<SummaryRow, [string]>(
          `
            WITH scoped AS (
              SELECT id, amount_minor, status
              FROM payments
              WHERE currency = $1
            )
            SELECT
              COALESCE(SUM(scoped.amount_minor) FILTER (WHERE scoped.status = 'succeeded'), 0)::TEXT AS gross_minor,
              COUNT(*) FILTER (WHERE scoped.status = 'succeeded')::TEXT AS succeeded_count,
              COUNT(*) FILTER (WHERE scoped.status IN ('succeeded', 'failed', 'canceled'))::TEXT AS settled_count,
              COALESCE(SUM(scoped.amount_minor) FILTER (WHERE scoped.status IN ('created', 'processing')), 0)::TEXT AS pending_minor,
              COUNT(*) FILTER (WHERE scoped.status IN ('created', 'processing'))::TEXT AS pending_count,
              (
                SELECT COUNT(*)::TEXT
                FROM transactions
                INNER JOIN scoped ON scoped.id = transactions.payment_id
              ) AS event_count
            FROM scoped
          `,
          [DEFAULT_CURRENCY],
        ),
        database.query<DailyRow, [string, number]>(
          `
            SELECT
              calendar.day::DATE AS day,
              COALESCE(SUM(payments.amount_minor) FILTER (WHERE payments.status = 'succeeded'), 0)::TEXT AS volume_minor
            FROM GENERATE_SERIES(
              CURRENT_DATE - MAKE_INTERVAL(days => $2 - 1),
              CURRENT_DATE,
              INTERVAL '1 day'
            ) AS calendar(day)
            LEFT JOIN payments
              ON payments.currency = $1
              AND payments.created_at >= calendar.day
              AND payments.created_at < calendar.day + INTERVAL '1 day'
            GROUP BY calendar.day
            ORDER BY calendar.day
          `,
          [DEFAULT_CURRENCY, DAILY_VOLUME_DAYS],
        ),
      ]);

      const row = summary.rows[0];
      const succeededCount = toInteger(row?.succeeded_count);
      const settledCount = toInteger(row?.settled_count);

      return {
        currency: DEFAULT_CURRENCY,
        grossVolumeMinor: toInteger(row?.gross_minor),
        succeededCount,
        // A success rate over zero settled payments is undefined, not zero.
        successRate:
          settledCount === 0
            ? null
            : Math.round((succeededCount / settledCount) * 1000) / 10,
        pending: {
          amountMinor: toInteger(row?.pending_minor),
          count: toInteger(row?.pending_count),
        },
        eventsRecorded: toInteger(row?.event_count),
        dailyVolume: daily.rows.map((dailyRow) => ({
          date: dailyRow.day.toISOString().slice(0, 10),
          amountMinor: toInteger(dailyRow.volume_minor),
        })),
      };
    },
  );
};
