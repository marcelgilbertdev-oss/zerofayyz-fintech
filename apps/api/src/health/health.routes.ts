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
        // Reported because a deploy is not a configuration change: env vars added
        // to render.yaml do not always reach an already-running service, and the
        // symptom — payers returning to the wrong client — is invisible from
        // outside until someone completes a real payment. This makes it checkable.
        clientOrigins: {
          type: "object",
          additionalProperties: false,
          required: ["status", "count"],
          properties: {
            status: { type: "string", enum: ["configured", "unconfigured"] },
            count: { type: "integer", minimum: 0 },
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
      const configuredClientOrigins = (process.env.CLIENT_ORIGINS ?? "")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);

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
          clientOrigins: {
            status: configuredClientOrigins.length > 0
              ? ("configured" as const)
              : ("unconfigured" as const),
            // The count, never the values: an allowlist is not a secret, but a
            // health endpoint should not become a directory of deployed hosts.
            count: configuredClientOrigins.length,
          },
        },
      };
    },
  );
};
