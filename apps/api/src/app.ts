import Fastify, { type FastifyInstance } from "fastify";

import { healthRoutes } from "./health/health.routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  app.register(healthRoutes, { prefix: "/api/v1" });

  return app;
}
