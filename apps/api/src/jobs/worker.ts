/**
 * The worker: a polling loop around queue.runOne().
 *
 * Polling rather than LISTEN/NOTIFY, deliberately. NOTIFY wakes workers
 * faster, but it needs a dedicated connection per worker, it delivers nothing
 * to a worker that was down when the notice fired (so a poll is still needed
 * as the safety net), and this platform's background work is measured in
 * minutes, not milliseconds. The simple mechanism whose failure mode is
 * "slightly late" beats the clever one whose failure mode is "never".
 *
 * Pace: after finding work the loop runs again immediately — a burst drains
 * at full speed. After an empty poll it sleeps idleMs, so a quiet queue costs
 * a few queries a minute, which matters on a database billed by compute time.
 */
import type { FastifyBaseLogger } from "fastify";

import type { Job, JobQueue } from "./queue.js";

export type WorkerOptions = {
  queue: JobQueue;
  handlers: Record<string, (job: Job) => Promise<void>>;
  log: FastifyBaseLogger;
  /** Sleep between polls when the queue was empty. */
  idleMs?: number;
  workerId?: string;
};

export type Worker = {
  /** Resolves when the loop has fully stopped — safe to close the pool after. */
  stop: () => Promise<void>;
};

export function startWorker(options: WorkerOptions): Worker {
  const { queue, handlers, log } = options;
  const idleMs = options.idleMs ?? 30_000;
  const workerId = options.workerId ?? `api-${process.pid}`;

  let running = true;
  let wake: (() => void) | null = null;

  const loop = (async () => {
    log.info({ workerId, kinds: Object.keys(handlers) }, "job worker started");

    while (running) {
      let didWork = false;
      try {
        didWork = await queue.runOne(workerId, handlers);
      } catch (error) {
        // The loop must survive anything — a worker that dies on a transient
        // database error turns "retry in a second" into "nothing ever runs
        // again". The job itself is safe either way: an unfinished claim is
        // reclaimed after the lease.
        log.error(error, "job worker poll failed");
      }

      if (!running) break;
      if (!didWork) {
        await new Promise<void>((resolve) => {
          wake = resolve;
          setTimeout(resolve, idleMs);
        });
        wake = null;
      }
    }

    log.info({ workerId }, "job worker stopped");
  })();

  return {
    async stop() {
      running = false;
      wake?.(); // cut the idle sleep short so shutdown is prompt
      await loop;
    },
  };
}
