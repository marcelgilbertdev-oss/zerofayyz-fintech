import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test, { after, before } from "node:test";

import { createDatabase, type Database } from "../database/database.js";
import { migrate } from "../database/migrate.js";
import { createHandlers, dayBucket, scheduleSessionCleanup, SESSION_CLEANUP } from "./handlers.js";
import { createQueue, type JobQueue } from "./queue.js";
import { startWorker } from "./worker.js";

/**
 * The worker loop and the first real job, against real PostgreSQL.
 *
 * queue.integration-test.ts proves the queue's mechanics; this file proves the
 * things built on top of them — that the loop actually drains work and stops
 * cleanly, that cleanup deletes only what retention says it may, and that the
 * recurring chain converges on one row no matter how many times it is seeded.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const RUN = randomUUID().slice(0, 8);

let database: Database;
let queue: JobQueue;

const silentLog = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  silent() {}, child() { return silentLog; }, level: "silent",
} as never;

before(async () => {
  process.env.DATABASE_URL = connectionString;
  await migrate();
  database = createDatabase(connectionString);
  queue = createQueue(database);
});

after(async () => {
  await database.query("DELETE FROM jobs WHERE kind LIKE $1 OR kind = $2", [
    `wtest_${RUN}_%`,
    SESSION_CLEANUP,
  ]);
  await database.query("DELETE FROM sessions WHERE token_hash LIKE $1", [`jobs-${RUN}-%`]);
  await database.close();
});

test("the worker loop drains a burst and stops cleanly", async () => {
  const k = `wtest_${RUN}_burst`;
  for (let i = 0; i < 5; i += 1) {
    await queue.enqueue({ kind: k, payload: { i } });
  }

  const handled: number[] = [];
  const worker = startWorker({
    queue,
    handlers: { [k]: async (job) => { handled.push(job.payload.i as number); } },
    log: silentLog,
    idleMs: 50,
    workerId: `wtest-${RUN}`,
  });

  // Wait for the burst to drain, bounded so a hang fails rather than blocks.
  const deadline = Date.now() + 10_000;
  while (handled.length < 5 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  await worker.stop();

  assert.equal(handled.length, 5, "the worker did not drain the queue");
  assert.deepEqual([...handled].sort(), [0, 1, 2, 3, 4]);
});

test("stop() resolves promptly even from an idle sleep", async () => {
  const worker = startWorker({
    queue,
    handlers: { [`wtest_${RUN}_never`]: async () => {} },
    log: silentLog,
    idleMs: 60_000, // would block a naive stop for a minute
    workerId: `wtest-${RUN}-idle`,
  });

  await new Promise((resolve) => setTimeout(resolve, 100)); // let it reach the sleep
  const started = Date.now();
  await worker.stop();
  assert.ok(Date.now() - started < 2_000, "stop() waited out the idle sleep");
});

test("an enqueue in this process wakes an idle worker at once", async () => {
  // The worker must not need to poll to discover in-process work (ADR 20):
  // with a one-minute cap it would otherwise sit on this job for a minute.
  const k = `wtest_${RUN}_wake`;
  const handled: string[] = [];
  const worker = startWorker({
    queue,
    handlers: { [k]: async (job) => { handled.push(job.id); } },
    log: silentLog,
    idleMs: 60_000,
    workerId: `wtest-${RUN}-wake`,
  });

  await new Promise((resolve) => setTimeout(resolve, 300)); // let it reach the sleep
  const started = Date.now();
  await queue.enqueue({ kind: k });

  const deadline = Date.now() + 5_000;
  while (handled.length < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await worker.stop();

  assert.equal(handled.length, 1, "the enqueue did not wake the worker");
  assert.ok(Date.now() - started < 5_000, "the worker waited out its idle cap");
});

test("an idle worker sleeps until the next job is due, not the full cap", async () => {
  // A delayed job (the hourly cleanup, a retry's backoff) must run when it
  // comes due. Enqueued before the worker starts, so no wake-up notice helps:
  // only the next-due lookup can get this right.
  const k = `wtest_${RUN}_due`;
  await queue.enqueue({ kind: k, delayMs: 800 });

  const handled: string[] = [];
  const worker = startWorker({
    queue,
    handlers: { [k]: async (job) => { handled.push(job.id); } },
    log: silentLog,
    idleMs: 60_000,
    workerId: `wtest-${RUN}-due`,
  });

  const deadline = Date.now() + 6_000;
  while (handled.length < 1 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  await worker.stop();

  assert.equal(handled.length, 1, "the worker slept past the job's due time");
});

test("session cleanup deletes long-dead sessions and keeps everything else", async () => {
  const mk = (suffix: string, sql: string) =>
    database.query(
      `INSERT INTO sessions (user_id, token_hash, created_at, expires_at, revoked_at)
       SELECT id, $1, ${sql} FROM users LIMIT 1`,
      [`jobs-${RUN}-${suffix}`],
    );

  // Ancient and expired → deleted. Recently expired → kept (retention).
  // Live → kept. Ancient but revoked only yesterday → kept (clock starts at death).
  await mk("ancient", `NOW() - INTERVAL '90 days', NOW() - INTERVAL '60 days', NULL`);
  await mk("recent", `NOW() - INTERVAL '2 days', NOW() - INTERVAL '1 day', NULL`);
  await mk("live", `NOW(), NOW() + INTERVAL '1 hour', NULL`);
  await mk("late-revoke", `NOW() - INTERVAL '90 days', NOW() - INTERVAL '60 days', NOW() - INTERVAL '1 day'`);

  const handlers = createHandlers(database, queue);
  await handlers[SESSION_CLEANUP]({} as never);

  const rows = await database.query<{ token_hash: string }>(
    "SELECT token_hash FROM sessions WHERE token_hash LIKE $1 ORDER BY token_hash",
    [`jobs-${RUN}-%`],
  );
  const kept = rows.rows.map((row) => row.token_hash.replace(`jobs-${RUN}-`, ""));
  assert.deepEqual(kept, ["late-revoke", "live", "recent"]);
});

test("the recurring chain converges on one row however many times it is seeded", async () => {
  // Three instances booting at once, or one instance restarting three times.
  await Promise.all([
    scheduleSessionCleanup(queue),
    scheduleSessionCleanup(queue),
    scheduleSessionCleanup(queue),
  ]);
  await scheduleSessionCleanup(queue);

  const rows = await database.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n FROM jobs
      WHERE kind = $1 AND idempotency_key = $2`,
    [SESSION_CLEANUP, `${SESSION_CLEANUP}:${dayBucket(new Date(Date.now() + 86_400_000))}`],
  );
  assert.equal(Number(rows.rows[0]?.n), 1, "seeding was not idempotent");
});

test("running the cleanup schedules the next run on the following day", async () => {
  const handlers = createHandlers(database, queue);
  await handlers[SESSION_CLEANUP]({} as never);
  await handlers[SESSION_CLEANUP]({} as never); // a crash-retry does not double the chain

  const rows = await database.query<{ n: string }>(
    `SELECT COUNT(*)::TEXT AS n FROM jobs
      WHERE kind = $1 AND status = 'pending' AND run_at > NOW()`,
    [SESSION_CLEANUP],
  );
  assert.equal(Number(rows.rows[0]?.n), 1, "the chain forked or dropped");
});
