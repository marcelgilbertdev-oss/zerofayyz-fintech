import type { FastifyPluginAsync } from "fastify";

import type { Database } from "../database/database.js";
import { errorTrackingStatus } from "../observability/error-tracking.js";

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
        // Reported for the same reason as clientOrigins: an integration that
        // silently is not wired looks identical, from outside, to one that is.
        errorTracking: {
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
          errorTracking: { status: errorTrackingStatus() },
        },
      };
    },
  );

  /**
   * Readiness, as distinct from liveness.
   *
   * /health answers "is the process up and what does it know about its
   * dependencies" — it returns 200 even when the database is down, because a
   * process that can describe its own degradation is alive. A load balancer
   * asking "may I send traffic here" needs the opposite bias: this endpoint
   * returns 503 the moment the database is unreachable, so an orchestrator
   * drains the instance instead of routing payments into a dead ledger.
   * Conflating the two is how a deploy passes its health check and then
   * serves 500s.
   */
  app.get(
    "/ready",
    {
      schema: {
        tags: ["health"],
        summary: "Report whether this instance should receive traffic",
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["ready"],
            properties: { ready: { type: "boolean", enum: [true] } },
          },
          503: {
            type: "object",
            additionalProperties: false,
            required: ["ready", "reason"],
            properties: {
              ready: { type: "boolean", enum: [false] },
              reason: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const databaseHealth = await database.checkHealth();

      if (!databaseHealth.operational) {
        return reply.code(503).send({
          ready: false,
          reason: "database unreachable",
        });
      }

      return reply.send({ ready: true });
    },
  );
};
