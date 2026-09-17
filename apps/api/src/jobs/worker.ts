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
 * at full speed. After an empty poll it asks the queue when the next job is
 * due and sleeps until then, capped at idleMs. An enqueue made in this process
 * wakes it at once, so a quiet queue costs one query when a job comes due and
 * one safety poll every six hours — not a query every thirty seconds.
 *
 * Why the change (2026-09-13, ADR 20). The old loop slept a fixed 30 seconds.
 * Neon suspends its compute after five minutes without activity and bills the
 * hours it is awake; a query every thirty seconds meant it never slept, and the
 * free tier's monthly allowance was 81% gone by the 13th. The safety poll is
 * hourly rather than every few minutes for the same reason: each poll wakes the
 * database for at least five minutes, so a fifteen-minute poll would still keep
 * it awake a third of the day.
 *
 * Six hours, not one (2026-09-17, ADR 22). ADR 20 set the cap at an hour on the
 * grounds that the hourly cleanup job woke the database anyway. The cleanup is
 * now daily, so an hourly cap would have become the thing waking it. The cap
 * only ever matters for a job inserted by something other than this process,
 * and nothing does that; six hours keeps that failure mode measured in hours.
 */
import type { FastifyBaseLogger } from "fastify";

import type { Job, JobQueue } from "./queue.js";

export type WorkerOptions = {
  queue: JobQueue;
  handlers: Record<string, (job: Job) => Promise<void>>;
  log: FastifyBaseLogger;
  /**
   * The longest the worker sleeps after an empty poll. It usually wakes sooner:
   * when the next job is due, or when this process enqueues one. The cap is the
   * safety net for a job added some other way (a manual INSERT, another process).
   */
  idleMs?: number;
  workerId?: string;
};

export type Worker = {
  /** Resolves when the loop has fully stopped — safe to close the pool after. */
  stop: () => Promise<void>;
};

export function startWorker(options: WorkerOptions): Worker {
  const { queue, handlers, log } = options;
  const idleMs = options.idleMs ?? 6 * 60 * 60_000;
  const workerId = options.workerId ?? `api-${process.pid}`;

  let running = true;
  let wake: (() => void) | null = null;
  // Set by an enqueue that lands while the loop is busy rather than asleep, so
  // the notice is not lost between the empty poll and the start of the sleep.
  let notified = false;
  const kinds = Object.keys(handlers);
  const unsubscribe = queue.onEnqueue(() => {
    notified = true;
    wake?.();
  });

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
        if (notified) {
          notified = false;
          continue;
        }
        const sleepMs = await nextSleepMs();
        if (!running) break;
        if (notified) {
          notified = false;
          continue;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, sleepMs);
          wake = () => {
            clearTimeout(timer);
            resolve();
          };
        });
        wake = null;
        notified = false;
      }
    }

    unsubscribe();
    log.info({ workerId }, "job worker stopped");
  })();

  async function nextSleepMs(): Promise<number> {
    try {
      const due = await queue.nextDueAt(kinds);
      if (due === null) return idleMs;
      return Math.min(idleMs, Math.max(0, due.getTime() - Date.now()));
    } catch (error) {
      // Not knowing when the next job is due is not a reason to spin: fall back
      // to the cap, exactly as the old fixed-interval loop would have.
      log.error(error, "job worker could not read the next due time");
      return idleMs;
    }
  }

  return {
    async stop() {
      running = false;
      wake?.(); // cut the idle sleep short so shutdown is prompt
      await loop;
    },
  };
}
