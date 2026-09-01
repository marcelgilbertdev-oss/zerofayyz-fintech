/**
 * The platform's job handlers — and the recurring-work pattern.
 *
 * Recurring work here is not a cron entry: each run of a recurring job
 * enqueues the next run, with an idempotency key derived from the time
 * window it belongs to. That one line is doing a lot, so, spelled out:
 *
 *   - survives restarts: the next run is a row, not a timer in memory
 *   - cannot double-fire: two instances both enqueueing "next hour" collide
 *     on the same key and the UNIQUE index keeps one
 *   - self-heals: if the platform is down across a boundary, the next claim
 *     after startup finds the overdue row and runs it — late, not lost
 *
 * The chain is seeded at startup with the same keyed enqueue, so "the server
 * booted" and "the job ran" converge on the same single row.
 */
import type { Database } from "../database/database.js";
import type { Job, JobQueue } from "./queue.js";

export const SESSION_CLEANUP = "sessions.cleanup";

/** How long an expired or revoked session row is kept before deletion. */
const SESSION_RETENTION_DAYS = 30;

/** The hour bucket a timestamp belongs to, as an idempotency key suffix. */
export function hourBucket(date = new Date()): string {
  return date.toISOString().slice(0, 13); // e.g. 2026-09-01T18
}

function nextHour(date = new Date()): { key: string; delayMs: number } {
  const next = new Date(date);
  next.setUTCHours(next.getUTCHours() + 1, 0, 30, 0); // hh:00:30, clear of the boundary
  return {
    key: `${SESSION_CLEANUP}:${hourBucket(next)}`,
    delayMs: Math.max(0, next.getTime() - date.getTime()),
  };
}

/**
 * Enqueue the next (or first) cleanup run. Safe to call from anywhere, any
 * number of times, on any number of instances — the key makes it one row.
 */
export async function scheduleSessionCleanup(queue: JobQueue): Promise<void> {
  const { key, delayMs } = nextHour();
  await queue.enqueue({
    kind: SESSION_CLEANUP,
    idempotencyKey: key,
    delayMs,
    maxAttempts: 3,
  });
}

export function createHandlers(database: Database, queue: JobQueue) {
  return {
    /**
     * Delete session rows that have been dead for longer than the retention
     * window. Expired and revoked sessions are already unusable — resolveSession
     * refuses them — so this is hygiene, not security: the table otherwise
     * grows forever with rows nothing will ever read.
     *
     * The audit log is unaffected on purpose: it records session ids as plain
     * values, not foreign keys (migration 003), precisely so history survives
     * the referenced row. An id that no longer resolves is itself a fact.
     *
     * Deleting is idempotent by nature, which is what makes it a correct
     * at-least-once job: a second run after a crash deletes nothing and
     * succeeds.
     */
    [SESSION_CLEANUP]: async (_job: Job): Promise<void> => {
      await database.query(
        `DELETE FROM sessions
          WHERE (revoked_at IS NOT NULL OR expires_at < NOW())
            AND GREATEST(COALESCE(revoked_at, 'epoch'), expires_at)
                < NOW() - ($1::int * INTERVAL '1 day')`,
        [SESSION_RETENTION_DAYS],
      );

      // The recurrence: this run schedules the next. If this line never runs
      // because the process died a moment ago, the job's own retry re-runs the
      // delete (harmless) and then reaches this line — the chain cannot be
      // dropped without the job itself being marked dead, which is visible.
      await scheduleSessionCleanup(queue);
    },
  };
}
