import { randomUUID } from "node:crypto";

import Fastify, { type FastifyInstance } from "fastify";
import rawBody from "fastify-raw-body";

import {
  createDatabase,
  type Database,
} from "./database/database.js";
import { accountRoutes, adminRoutes } from "./admin/admin.routes.js";
import { refundRoutes } from "./admin/refunds.routes.js";
import { authRoutes, sessionResolver } from "./auth/auth.routes.js";
import { healthRoutes } from "./health/health.routes.js";
import { ledgerRoutes } from "./ledger/ledger.routes.js";
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
    // A request id on every line, and the same id returned to the caller.
    //
    // Pino already emits JSON, which is what a log aggregator wants. What was
    // missing is correlation: with a shared demo account and concurrent
    // reviewers, "the failing request" is not identifiable from a timestamp.
    // Fastify stamps every log line for a request with its reqId, so one id
    // ties the route log, the audit write and the error together — and the
    // id also goes back in a response header, so a user reporting a failure
    // can hand over the exact string to grep for.
    genReqId: (request) => {
      // Honour an upstream id when one exists, so a trace that began at the
      // proxy is not broken here; otherwise mint one.
      const forwarded = request.headers["x-request-id"];
      const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded;

      // Bounded and sanitised: this value is echoed in a response header and
      // written to logs, and an unbounded caller-controlled string in either
      // is how log injection and header-splitting bugs start.
      if (typeof candidate === "string" && /^[A-Za-z0-9._-]{8,128}$/.test(candidate)) {
        return candidate;
      }

      return randomUUID();
    },
    logger:
      options.logger === false
        ? false
        : {
            level: process.env.LOG_LEVEL ?? "info",
            // Structured fields rather than an interpolated sentence: a log
            // line is data for a query, not prose for a person.
            formatters: {
              level: (label) => ({ level: label }),
            },
            base: {
              service: "zerofayyz-fintech-api",
              env: process.env.NODE_ENV ?? "development",
            },
            redact: {
              // Never log what would turn the log store into a second copy of
              // the credential store.
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "req.headers['stripe-signature']",
                "res.headers['set-cookie']",
              ],
              remove: true,
            },
            serializers: {
              req: (request) => ({
                method: request.method,
                url: request.url,
              }),
              res: (reply) => ({ statusCode: reply.statusCode }),
            },
          },
  });

  // The caller gets the id too. Without this the correlation id exists only
  // where the operator can already see it, which is the half that does not
  // need help.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", String(request.id));
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
  app.register(accountRoutes, {
    prefix: "/api/v1",
    database,
  });
  app.register(refundRoutes, {
    prefix: "/api/v1",
    database,
    stripe,
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
  app.register(ledgerRoutes, {
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
