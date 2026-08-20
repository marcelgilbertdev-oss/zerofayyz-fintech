import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";

import {
  createDatabase,
  type Database,
} from "./database/database.js";
import { healthRoutes } from "./health/health.routes.js";
import { paymentRoutes } from "./payments/payments.routes.js";
import {
  createStripeGateway,
  type StripeGateway,
} from "./payments/stripe.gateway.js";
import { transactionRoutes } from "./transactions/transactions.routes.js";

type BuildAppOptions = {
  database?: Database;
  logger?: boolean;
  stripe?: StripeGateway | null;
};

export function buildApp(options: BuildAppOptions = {}): FastifyInstance {
  const database = options.database ?? createDatabase();
  const stripe = options.stripe === undefined
    ? createStripeGateway()
    : options.stripe;
  const app = Fastify({
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
          },
  });

  app.register(rawBody, {
    global: false,
    field: "rawBody",
    encoding: false,
    runFirst: true,
  });
  app.register(healthRoutes, {
    prefix: "/api/v1",
    database,
    stripeConfigured: stripe !== null,
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  });
  app.register(paymentRoutes, {
    prefix: "/api/v1",
    database,
    stripe,
  });
  app.register(transactionRoutes, {
    prefix: "/api/v1",
    database,
  });
  app.addHook("onClose", async () => database.close());

  return app;
}
