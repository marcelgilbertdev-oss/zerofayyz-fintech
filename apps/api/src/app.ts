import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";

import {
  createDatabase,
  type Database,
} from "./database/database.js";
import { adminRoutes } from "./admin/admin.routes.js";
import { authRoutes, sessionResolver } from "./auth/auth.routes.js";
import { healthRoutes } from "./health/health.routes.js";
import { metricRoutes } from "./metrics/metrics.routes.js";
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
  // Only close what this function created. An injected database belongs to
  // the caller, and closing it here would end a pool still in use elsewhere.
  const ownsDatabase = options.database === undefined;
  const database = options.database ?? createDatabase();
  const stripe = options.stripe === undefined
    ? createStripeGateway()
    : options.stripe;
  const app = Fastify({
    // Behind Render's load balancer, and logins arrive via the dashboard's
    // Vercel proxy. Without this, request.ip is the balancer's address — the
    // same value for every human on earth — so every session fingerprint
    // collapses to one and "tell two sessions apart" becomes a lie. With it,
    // Fastify reads x-forwarded-for, whose leftmost entry is ultimately
    // caller-controlled: fine for identification (presence, audit), which is
    // why nothing security-critical keys on it — the login limiter keys on
    // the attempted account instead.
    trustProxy: true,
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
  // On the root instance, so every route in every plugin sees request.session.
  // Registering it inside the auth plugin would scope it to the auth routes
  // alone and silently leave every other guard looking at undefined.
  app.addHook("onRequest", sessionResolver(database));
  app.register(authRoutes, {
    prefix: "/api/v1",
    database,
  });
  app.register(adminRoutes, {
    prefix: "/api/v1",
    database,
  });
  app.register(healthRoutes, {
    prefix: "/api/v1",
    database,
    stripeConfigured: stripe !== null,
    webhookConfigured: Boolean(process.env.STRIPE_WEBHOOK_SECRET),
  });
  app.register(metricRoutes, {
    prefix: "/api/v1",
    database,
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
  app.addHook("onClose", async () => {
    if (ownsDatabase) {
      await database.close();
    }
  });

  return app;
}
