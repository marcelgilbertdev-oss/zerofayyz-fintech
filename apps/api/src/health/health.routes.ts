import type { FastifyPluginAsync } from "fastify";

const healthResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["service", "status", "environment", "version", "timestamp"],
  properties: {
    service: { type: "string" },
    status: { type: "string", enum: ["operational"] },
    environment: { type: "string" },
    version: { type: "string" },
    timestamp: { type: "string", format: "date-time" },
  },
} as const;

export const healthRoutes: FastifyPluginAsync = async (app) => {
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
    async () => ({
      service: "zerofayyz-fintech-api",
      status: "operational" as const,
      environment: process.env.NODE_ENV ?? "development",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
    }),
  );
};
