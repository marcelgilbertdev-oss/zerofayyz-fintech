import "dotenv/config";

import { buildApp } from "./app.js";
import { createDatabase } from "./database/database.js";
import { createHandlers, scheduleSessionCleanup } from "./jobs/handlers.js";
import { createQueue } from "./jobs/queue.js";
import { startWorker, type Worker } from "./jobs/worker.js";

// The server owns the pool and lends it to the app and the worker, because
// two consumers now share it and whoever creates a resource should be the one
// that closes it (the same rule buildApp applies to an injected database).
const database = createDatabase();
const app = buildApp({ database });
const port = Number.parseInt(process.env.PORT ?? "4000", 10);
const host = process.env.HOST ?? "127.0.0.1";

if (Number.isNaN(port)) {
  throw new Error("PORT must be a valid number");
}

// The in-process worker. JOB_WORKER=off exists for operational headroom —
// running the API with background work disabled during an incident — not for
// tests, which drive the queue directly.
let worker: Worker | null = null;
if (process.env.JOB_WORKER !== "off") {
  const queue = createQueue(database);
  worker = startWorker({
    queue,
    handlers: createHandlers(database, queue),
    log: app.log,
  });
  // Seed the recurring chain. Idempotent across restarts and instances: the
  // hour-bucketed key means every boot converges on the same single row.
  scheduleSessionCleanup(queue).catch((error) => {
    app.log.error(error, "failed to seed the session cleanup chain");
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  app.log.info({ signal }, "Shutting down API");

  try {
    // Order matters: the worker may be mid-query, so it stops before the pool
    // it borrows goes away. An unfinished job is safe either way — its lease
    // expires and another worker (or the next boot) reclaims it.
    await worker?.stop();
    await app.close();
    await database.close();
    process.exit(0);
  } catch (error) {
    app.log.error(error, "Failed to shut down cleanly");
    process.exit(1);
  }
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error, "Failed to start API");
  process.exit(1);
}
