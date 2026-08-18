import Fastify, { type FastifyInstance } from "fastify";

import {
  createDatabase,
  type Database,
} from "./database/database.js";
import { healthRoutes } from "./health/health.routes.js";
import { transactionRoutes } from "./transactions/transactions.routes.js";

type BuildAppOptions = {
  database?: Database;
  logger?: boolean;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const database = options.database ?? createDatabase();
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
          },
  });

  app.register(healthRoutes, {
    prefix: "/api/v1",
    database,
  });
  app.register(transactionRoutes, {
    prefix: "/api/v1",
    database,
  });
  app.addHook("onClose", async () => database.close());

  return app;
}
