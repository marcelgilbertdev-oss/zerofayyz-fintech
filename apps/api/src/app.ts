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
import { magicLinkRoutes } from "./auth/magic.js";
import { createQueue } from "./jobs/queue.js";
import { healthRoutes } from "./health/health.routes.js";
import {
  initialiseErrorTracking,
  reportError,
} from "./observability/error-tracking.js";
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

  // Wired at boot, inert without a DSN. Called here rather than in server.ts so
  // that any process building an app — including a test — exercises the same
  // path, and so the no-DSN branch is the one every suite runs.
  initialiseErrorTracking();

  // Unhandled route errors reach the tracker tagged with the request id, so a
  // Sentry issue and a log line are the same incident rather than two.
  // Fastify's default reply behaviour is preserved: this observes, it does not
  // change what the caller receives.
  app.addHook("onError", async (request, _reply, error) => {
    reportError(error, { requestId: String(request.id) });
  });

  // The caller gets the id too. Without this the correlation id exists only
  // where the operator can already see it, which is the half that does not
  // need help.
  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", String(request.id));
  });

  // Security headers, by hand — same reasoning as cookies.ts: a handful of
  // static headers is a dependency-free thirty lines, and thirty lines that
  // cannot go missing on a Linux runner are worth more than a plugin.
  //
  // This service returns JSON to programs. That makes the right policy
  // unusually strict and unusually cheap: nothing here is ever a document a
  // browser should render, script, style, or frame.
  app.addHook("onRequest", async (_request, reply) => {
    // A JSON body served with a sniffable type can be reinterpreted by an
    // old browser as HTML; nosniff closes the whole class.
    reply.header("x-content-type-options", "nosniff");
    // default-src 'none' is the entire policy a pure-JSON origin needs, and
    // frame-ancestors 'none' means no page anywhere may embed an API response.
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    // Belt for browsers that predate frame-ancestors.
    reply.header("x-frame-options", "DENY");
    // API URLs can carry query strings; no referrer ever needs to leak them.
    reply.header("referrer-policy", "no-referrer");
    // Sent unconditionally, like the Secure cookie attribute and for the same
    // reason: a header that exists in one environment and not another is a
    // difference discovered in the wrong one. Browsers ignore HSTS over http,
    // so local development is unaffected.
    reply.header("strict-transport-security", "max-age=63072000; includeSubDomains");
    // Responses are for the requester, not for embedding by other origins.
    // Browser traffic arrives same-origin through the platform rewrites, and
    // webhook/server callers are not subject to CORP at all.
    reply.header("cross-origin-resource-policy", "same-origin");
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
  app.register(magicLinkRoutes, {
    prefix: "/api/v1",
    database,
    queue: createQueue(database),
  });

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
