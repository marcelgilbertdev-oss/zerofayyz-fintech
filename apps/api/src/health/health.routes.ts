import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";

type HealthRouteOptions = {
  database: Database;
  stripeConfigured: boolean;
  webhookConfigured: boolean;
};

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status", "environment", "version", "timestamp", "checks"],
  properties: {
    service: { type: "string" },
    status: { type: "string", enum: ["operational", "degraded"] },
    environment: { type: "string" },
    version: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
    checks: {
      type: "object",
      additionalProperties: false,
      required: ["database", "stripe", "webhook"],
      properties: {
        database: {
          type: "object",
          additionalProperties: false,
          required: ["status", "latencyMs", "name"],
          properties: {
            status: { type: "string", enum: ["operational", "unavailable"] },
            latencyMs: { type: ["integer", "null"], minimum: 0 },
            name: { type: ["string", "null"] },
          },
        },
        stripe: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["configured", "unconfigured"] },
          },
        },
        webhook: {
          type: "object",
          additionalProperties: false,
          required: ["status"],
          properties: {
            status: { type: "string", enum: ["configured", "unconfigured"] },
          },
        },
      },
    },
  },
} as const;

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (
  app,
  { database, stripeConfigured, webhookConfigured },
) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Report API process health",
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => {
      const databaseHealth = await database.checkHealth();

      return {
        service: "zerofayyz-fintech-api",
        status: databaseHealth.operational ? ("operational" as const) : ("degraded" as const),
        environment: process.env.NODE_ENV ?? "development",
        version: "0.1.0",
        timestamp: new Date().toISOString(),
        checks: {
          database: {
            status: databaseHealth.operational ? ("operational" as const) : ("unavailable" as const),
            latencyMs: databaseHealth.latencyMs,
            name: databaseHealth.name,
          },
          stripe: {
            status: stripeConfigured ? ("configured" as const) : ("unconfigured" as const),
          },
          webhook: {
            status: webhookConfigured ? ("configured" as const) : ("unconfigured" as const),
          },
        },
      };
    },
  );
};
