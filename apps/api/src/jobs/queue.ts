/**
 * A durable job queue on PostgreSQL.
 *
 * The design in one line: claiming is an atomic UPDATE, so two workers waking
 * at the same instant cannot take the same row — one wins, the other sees zero
 * rows affected and moves on. That is the same trick the refund-approval route
 * uses, generalised.
 *
 * What this guarantees, and what it does not:
 *
 *   at-least-once   every enqueued job runs, eventually, even if a worker dies
 *                   holding it
 *   NOT exactly-once  a worker can finish the work, lose power before writing
 *                   "succeeded", and have its lease reclaimed. From the queue's
 *                   side a slow worker and a dead one are identical
 *
 * So handlers must be safe to run twice. The queue helps by carrying a stable
 * idempotency key, but it cannot make an unsafe handler safe, and pretending
 * otherwise is how ledgers end up double-counted.
 */
import type { Database } from "../database/database.js";

export type JobStatus = "pending" | "running" | "succeeded" | "failed" | "dead";

export type Job = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotencyKey: string | null;
  attempts: number;
  maxAttempts: number;
};

type JobRow = {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  idempotency_key: string | null;
  attempts: number;
  max_attempts: number;
};

export type EnqueueOptions = {
  kind: string;
  payload?: Record<string, unknown>;
  /** Makes enqueue idempotent: the same key returns the original job. */
  idempotencyKey?: string;
  /** Delay before the job becomes eligible. Default: immediately. */
  delayMs?: number;
  maxAttempts?: number;
};

/**
 * How long a claim is honoured before another worker may take the job.
 *
 * This is the number that decides the failure mode. Too short and a slow-but-
 * alive worker gets its job stolen and the handler runs twice concurrently;
 * too long and a crashed worker's jobs sit idle. Five minutes is chosen to be
 * comfortably longer than any handler here, and is the reason handlers must
 * stay short — a handler that can exceed the lease has to extend it, not hope.
 */
export const LEASE_MS = 5 * 60_000;

/** Exponential backoff with a ceiling. attempts=1 → 1s, 2 → 2s, 3 → 4s… */
export function backoffMs(attempts: number, baseMs = 1000, capMs = 3_600_000): number {
  const raw = baseMs * 2 ** Math.max(0, attempts - 1);
  return Math.min(raw, capMs);
}

function toJob(row: JobRow): Job {
  return {
    id: row.id,
    kind: row.kind,
    payload: row.payload,
    idempotencyKey: row.idempotency_key,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
  };
}

export function createQueue(database: Database) {
  return {
    /**
     * Add a job. With an idempotencyKey, a repeated enqueue returns the job
     * that already exists rather than creating a second one — refused by the
     * UNIQUE index, not by a read-then-write that loses under concurrency.
     */
    async enqueue(options: EnqueueOptions): Promise<Job> {
      const {
        kind,
        payload = {},
        idempotencyKey = null,
        delayMs = 0,
        maxAttempts = 5,
      } = options;

      const inserted = await database.query<JobRow>(
        `INSERT INTO jobs (kind, payload, idempotency_key, run_at, max_attempts)
         VALUES ($1, $2::jsonb, $3, NOW() + ($4::int * INTERVAL '1 millisecond'), $5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id, kind, payload, idempotency_key, attempts, max_attempts`,
        [kind, JSON.stringify(payload), idempotencyKey, delayMs, maxAttempts],
      );

      const row = inserted.rows[0];
      if (row) return toJob(row);

      // DO NOTHING fired: the key already exists. Return the original.
      const existing = await database.query<JobRow>(
        `SELECT id, kind, payload, idempotency_key, attempts, max_attempts
           FROM jobs WHERE idempotency_key = $1`,
        [idempotencyKey],
      );
      const found = existing.rows[0];
      if (!found) {
        // Only reachable if the row was deleted between the two statements.
        throw new Error(`enqueue conflicted on ${idempotencyKey} but no job exists`);
      }
      return toJob(found);
    },

    /**
     * Take one job, atomically.
     *
     * FOR UPDATE SKIP LOCKED is what makes this safe under concurrency without
     * serialising every worker behind one lock: a worker skips rows another
     * worker is already claiming instead of waiting for them. The whole thing
     * is one statement, so there is no window between choosing a row and
     * marking it taken.
     *
     * The WHERE also reclaims abandoned leases — a job stuck in `running` whose
     * worker died is eligible again once the lease expires. That is what makes
     * the queue survive a restart, and precisely why the guarantee is
     * at-least-once rather than exactly-once.
     */
    async claim(workerId: string, kinds?: readonly string[]): Promise<Job | null> {
      // A worker claims only kinds it can actually run. Without this filter a
      // worker takes a job it has no handler for and burns its attempts — the
      // queue turns a deployment gap into data loss. Found by a test that was
      // written to check something else entirely.
      const result = await database.query<JobRow>(
        `UPDATE jobs SET
           status = 'running',
           claimed_at = NOW(),
           claimed_by = $1,
           attempts = attempts + 1,
           updated_at = NOW()
         WHERE id = (
           SELECT id FROM jobs
            WHERE ($3::text[] IS NULL OR kind = ANY($3::text[]))
              AND ((status = 'pending' AND run_at <= NOW())
                   OR (status = 'running' AND claimed_at < NOW() - ($2::int * INTERVAL '1 millisecond')))
            ORDER BY run_at
            FOR UPDATE SKIP LOCKED
            LIMIT 1
         )
         RETURNING id, kind, payload, idempotency_key, attempts, max_attempts`,
        [workerId, LEASE_MS, kinds && kinds.length > 0 ? kinds : null],
      );

      const row = result.rows[0];
      return row ? toJob(row) : null;
    },

    /** Mark a claimed job done. Releases the lease. */
    async succeed(jobId: string): Promise<void> {
      await database.query(
        `UPDATE jobs SET status = 'succeeded', claimed_at = NULL, claimed_by = NULL,
                         last_error = NULL, updated_at = NOW()
          WHERE id = $1`,
        [jobId],
      );
    },

    /**
     * Record a failure.
     *
     * Under max_attempts the job goes back to pending with run_at pushed out by
     * the backoff — a retry and a delayed enqueue are deliberately the same
     * mechanism. At or past max_attempts it becomes `dead`: never retried,
     * still present. A queue that deletes what it cannot process destroys the
     * evidence you need to find out why.
     */
    async fail(jobId: string, error: string): Promise<JobStatus> {
      const result = await database.query<{ status: JobStatus }>(
        `UPDATE jobs SET
           status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'pending' END,
           run_at = CASE WHEN attempts >= max_attempts
                         THEN run_at
                         ELSE NOW() + (LEAST(1000 * POWER(2, GREATEST(attempts - 1, 0)), 3600000)::int
                                       * INTERVAL '1 millisecond') END,
           claimed_at = NULL,
           claimed_by = NULL,
           last_error = $2,
           updated_at = NOW()
         WHERE id = $1
         RETURNING status`,
        [jobId, error.slice(0, 2000)],
      );
      return result.rows[0]?.status ?? "pending";
    },

    /**
     * Claim one job and run it. Returns false when there was nothing to do, so
     * a caller can back off rather than spin.
     */
    async runOne(
      workerId: string,
      handlers: Record<string, (job: Job) => Promise<void>>,
    ): Promise<boolean> {
      const job = await this.claim(workerId, Object.keys(handlers));
      if (!job) return false;

      const handler = handlers[job.kind];
      if (!handler) {
        // Unreachable via the filter above, kept for a caller that claims
        // directly or whose handler map changed mid-flight.
        await this.fail(job.id, `no handler registered for kind "${job.kind}"`);
        return true;
      }

      try {
        await handler(job);
        await this.succeed(job.id);
      } catch (error) {
        await this.fail(job.id, error instanceof Error ? error.message : String(error));
      }
      return true;
    },

    /** Operational read: how much work is in each state, by kind. */
    async stats(): Promise<Array<{ kind: string; status: JobStatus; count: number }>> {
      const result = await database.query<{ kind: string; status: JobStatus; count: string }>(
        `SELECT kind, status, COUNT(*)::TEXT AS count
           FROM jobs GROUP BY kind, status ORDER BY kind, status`,
      );
      return result.rows.map((row) => ({
        kind: row.kind,
        status: row.status,
        count: Number(row.count),
      }));
    },
  };
}

export type JobQueue = ReturnType<typeof createQueue>;
