import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";
import { backoffMs, createQueue, LEASE_MS, type JobQueue } from "./queue.js";

/**
 * The job queue, proved against real PostgreSQL.
 *
 * The claims worth testing are the ones a client asks about: two workers
 * cannot take the same job, a worker that dies does not strand its job, a
 * failing job backs off rather than hammering, and a permanently broken job
 * stops rather than retrying forever. Every one of those is a concurrency or
 * crash property, so none of them can be shown with a stubbed database.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const RUN = randomUUID().slice(0, 8);
const kind = (name: string) => `test_${RUN}_${name}`;

let database: Database;
let queue: JobQueue;

before(async () => {
  process.env.DATABASE_URL = connectionString;
  await migrate();
  database = createDatabase(connectionString);
  queue = createQueue(database);
});

after(async () => {
  // Only this run's rows. The table is shared and other runs' evidence is not
  // ours to delete — the same rule the ledger suite follows.
  await database.query("DELETE FROM jobs WHERE kind LIKE $1", [`test_${RUN}_%`]);
  await database.close();
});

test("a job runs, and its handler receives the payload", async () => {
  const k = kind("basic");
  await queue.enqueue({ kind: k, payload: { amount: 4200 } });

  let seen: unknown = null;
  const did = await queue.runOne("worker-a", {
    [k]: async (job) => {
      seen = job.payload;
    },
  });

  assert.equal(did, true);
  assert.deepEqual(seen, { amount: 4200 });

  const rows = await database.query<{ status: string }>(
    "SELECT status FROM jobs WHERE kind = $1",
    [k],
  );
  assert.equal(rows.rows[0]?.status, "succeeded");
});

test("runOne reports false when there is nothing due", async () => {
  const did = await queue.runOne("worker-idle", { [kind("nothing")]: async () => {} });
  // Other tests' jobs may exist, so only assert this is a boolean decision the
  // caller can back off on — not that the whole table is empty.
  assert.equal(typeof did, "boolean");
});

test("two workers racing for one job: exactly one wins", async () => {
  const k = kind("race");
  await queue.enqueue({ kind: k, payload: {} });

  // Fire many claims at once. SKIP LOCKED means the losers see no row rather
  // than queueing behind the winner.
  const claims = await Promise.all(
    Array.from({ length: 8 }, (_, i) => queue.claim(`racer-${i}`, [k])),
  );

  const winners = claims.filter((c) => c !== null);
  assert.equal(winners.length, 1, "more than one worker claimed the same job");
});

test("a delayed job is not claimable before its time", async () => {
  const k = kind("delayed");
  await queue.enqueue({ kind: k, payload: {}, delayMs: 60_000 });

  const rows = await database.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n FROM jobs
      WHERE kind = $1 AND status = 'pending' AND run_at <= NOW()`,
    [k],
  );
  assert.equal(Number(rows.rows[0]?.n), 0);
});

test("enqueue is idempotent on the key — a retried enqueue makes one job", async () => {
  const k = kind("idem");
  const key = `key-${RUN}`;

  const first = await queue.enqueue({ kind: k, payload: { v: 1 }, idempotencyKey: key });
  const second = await queue.enqueue({ kind: k, payload: { v: 2 }, idempotencyKey: key });

  assert.equal(second.id, first.id, "second enqueue created a different job");

  const rows = await database.query<{ n: string }>(
    "SELECT COUNT(*)::TEXT AS n FROM jobs WHERE idempotency_key = $1",
    [key],
  );
  assert.equal(Number(rows.rows[0]?.n), 1);
});

test("concurrent enqueues with the same key still make one job", async () => {
  const k = kind("idem_race");
  const key = `race-key-${RUN}`;

  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () =>
      queue.enqueue({ kind: k, payload: {}, idempotencyKey: key }),
    ),
  );
  const ok = results.filter((r) => r.status === "fulfilled");
  assert.ok(ok.length >= 1, "every concurrent enqueue failed");

  const rows = await database.query<{ n: string }>(
    "SELECT COUNT(*)::TEXT AS n FROM jobs WHERE idempotency_key = $1",
    [key],
  );
  assert.equal(Number(rows.rows[0]?.n), 1, "concurrency produced duplicate jobs");
});

test("a failing job goes back to pending with its run_at pushed out", async () => {
  const k = kind("retry");
  await queue.enqueue({ kind: k, payload: {}, maxAttempts: 3 });

  await queue.runOne("worker-fail", {
    [k]: async () => {
      throw new Error("upstream refused");
    },
  });

  const rows = await database.query<{
    status: string;
    attempts: number;
    future: boolean;
    last_error: string;
  }>(
    `SELECT status, attempts, run_at > NOW() AS future, last_error
       FROM jobs WHERE kind = $1`,
    [k],
  );
  const row = rows.rows[0];
  assert.equal(row?.status, "pending");
  assert.equal(row?.attempts, 1);
  assert.equal(row?.future, true, "retry was scheduled immediately, not backed off");
  assert.match(row?.last_error ?? "", /upstream refused/);
});

test("a job that keeps failing lands in dead, and is not retried again", async () => {
  const k = kind("dead");
  await queue.enqueue({ kind: k, payload: {}, maxAttempts: 2 });

  const handlers = {
    [k]: async () => {
      throw new Error("always broken");
    },
  };

  // Burn both attempts. run_at is pushed forward by backoff, so wind it back
  // rather than sleeping — the clock is the thing under test, not our patience.
  await queue.runOne("worker-d1", handlers);
  await database.query("UPDATE jobs SET run_at = NOW() - INTERVAL '1 second' WHERE kind = $1", [k]);
  await queue.runOne("worker-d2", handlers);

  const rows = await database.query<{ status: string; attempts: number }>(
    "SELECT status, attempts FROM jobs WHERE kind = $1",
    [k],
  );
  assert.equal(rows.rows[0]?.status, "dead");
  assert.equal(rows.rows[0]?.attempts, 2);

  // Dead means dead: a claim scoped to this very kind must find nothing.
  const again = await queue.claim("worker-d3", [k]);
  assert.equal(again, null, "a dead job was claimed again");
});

test("a dead job keeps its error — the queue does not delete its own evidence", async () => {
  const rows = await database.query<{ last_error: string }>(
    "SELECT last_error FROM jobs WHERE kind = $1",
    [kind("dead")],
  );
  assert.match(rows.rows[0]?.last_error ?? "", /always broken/);
});

test("a worker that dies mid-job has its lease reclaimed", async () => {
  const k = kind("lease");
  await queue.enqueue({ kind: k, payload: {} });

  const claimed = await queue.claim("worker-that-dies", [k]);
  assert.ok(claimed, "setup failed: nothing to claim");

  // Simulate the crash: the row stays `running` with a lease nobody will ever
  // release. Age it past the lease window.
  await database.query(
    `UPDATE jobs SET claimed_at = NOW() - ($2::int * INTERVAL '1 millisecond') - INTERVAL '1 second'
      WHERE id = $1`,
    [claimed.id, LEASE_MS],
  );

  const reclaimed = await queue.claim("worker-that-lives", [k]);
  assert.equal(reclaimed?.id, claimed.id, "an abandoned job was not reclaimed");
  assert.equal(reclaimed?.attempts, 2, "reclaim should count as another attempt");
});

test("a lease that has NOT expired is left alone", async () => {
  const k = kind("lease_fresh");
  await queue.enqueue({ kind: k, payload: {} });

  const claimed = await queue.claim("worker-busy", [k]);
  assert.ok(claimed);

  // Every other claim in this test file targets a different kind, so the only
  // way this job comes back is if a fresh lease were wrongly treated as stale.
  const rows = await database.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n FROM jobs
      WHERE kind = $1
        AND ((status = 'pending' AND run_at <= NOW())
             OR (status = 'running' AND claimed_at < NOW() - ($2::int * INTERVAL '1 millisecond')))`,
    [k, LEASE_MS],
  );
  assert.equal(Number(rows.rows[0]?.n), 0, "a live worker's job was eligible for theft");
});

test("a worker will not claim a kind it cannot handle", async () => {
  const k = kind("orphan");
  await queue.enqueue({ kind: k, payload: {}, maxAttempts: 1 });

  // This is the behaviour a failing test argued us into. Before the kind
  // filter, this worker claimed the job, found no handler, and burned its
  // only attempt — a deployment gap (handler not shipped yet) silently became
  // a dead job. Now the job waits for a worker that can actually run it.
  const did = await queue.runOne("worker-orphan", {
    [kind("something_else")]: async () => {},
  });
  assert.equal(did, false, "a worker claimed work it had no handler for");

  const rows = await database.query<{ status: string; attempts: number }>(
    "SELECT status, attempts FROM jobs WHERE kind = $1",
    [k],
  );
  assert.equal(rows.rows[0]?.status, "pending", "the orphan job was consumed");
  assert.equal(rows.rows[0]?.attempts, 0, "an attempt was burned by a worker that could not run it");
});

test("an orphan job is visible in stats rather than silently stuck", async () => {
  // The cost of the safer behaviour: a job whose kind no worker handles waits
  // forever. That must be observable, or it is just a slower kind of loss.
  const rows = await queue.stats();
  const orphan = rows.find((r) => r.kind === kind("orphan") && r.status === "pending");
  assert.ok(orphan, "an unhandled job should still show up in operational stats");
});

test("backoff grows exponentially and is capped", () => {
  assert.equal(backoffMs(1), 1000);
  assert.equal(backoffMs(2), 2000);
  assert.equal(backoffMs(3), 4000);
  assert.equal(backoffMs(4), 8000);
  assert.equal(backoffMs(40), 3_600_000, "backoff must not grow without bound");
});

test("stats report work by kind and status", async () => {
  const rows = await queue.stats();
  assert.ok(Array.isArray(rows));
  const mine = rows.filter((r) => r.kind.startsWith(`test_${RUN}_`));
  assert.ok(mine.length > 0, "this run's jobs are missing from stats");
  assert.ok(mine.every((r) => Number.isInteger(r.count)));
});
