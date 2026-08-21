import assert from "node:assert/strict";
import test, { after, before } from "node:test";

import { createDatabase, type Database } from "./database.js";
import { migrate } from "./migrate.js";
import { ADMIN_EMAIL, DEMO_EMAIL, DEMO_PASSWORD, seedStaff } from "./seed-staff.js";

/**
 * The seed's own read-back check.
 *
 * Writing a hash proves a row exists; it does not prove anyone can sign in
 * with it. The admin password is typed blind at a hidden prompt, so a stray
 * character yields a confident "seeded" message and a login that refuses you —
 * with no way to tell which half went wrong. These tests hold the read-back
 * honest, including the case where it must fail.
 */
const connectionString =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

const ADMIN_PASSWORD = "seed-integration-admin-password";

let database: Database;

before(async () => {
  await migrate(connectionString);
  database = createDatabase(connectionString);
});

after(async () => {
  // Leave the accounts usable for local development rather than half-seeded.
  await seedStaff(connectionString, ADMIN_PASSWORD);
  await database.close();
});

test("seeding writes both accounts with the roles the login page expects", async () => {
  await seedStaff(connectionString, ADMIN_PASSWORD);

  const rows = await database.query<{ email: string; role: string }>(
    "SELECT email, role FROM users WHERE LOWER(email) IN (LOWER($1), LOWER($2))",
    [DEMO_EMAIL, ADMIN_EMAIL],
  );

  const byEmail = new Map(rows.rows.map((row) => [row.email.toLowerCase(), row.role]));
  assert.equal(byEmail.get(DEMO_EMAIL), "operator");
  assert.equal(byEmail.get(ADMIN_EMAIL), "admin");
});

test("seeding twice is safe and leaves the latest password working", async () => {
  await seedStaff(connectionString, ADMIN_PASSWORD);
  await seedStaff(connectionString, "a-different-admin-password");

  const rows = await database.query<{ count: string }>(
    "SELECT COUNT(*) AS count FROM users WHERE LOWER(email) = LOWER($1)",
    [ADMIN_EMAIL],
  );
  assert.equal(rows.rows[0]?.count, "1", "re-seeding duplicated the admin account");
});

test("the read-back refuses to report success when the stored hash cannot verify", async () => {
  await seedStaff(connectionString, ADMIN_PASSWORD);

  // Corrupt the stored hash behind the seed's back, then re-run the same
  // verification path against it. If this passes, the "VERIFIED" line printed
  // by the seed means nothing — which is the failure this test exists to
  // prevent.
  const { verifyPassword } = await import("../auth/password.js");
  await database.query(
    "UPDATE users SET password_hash = $2 WHERE LOWER(email) = LOWER($1)",
    [ADMIN_EMAIL, "scrypt$N=1024,r=8,p=1$c2FsdA==$d3Jvbmc="],
  );

  const stored = await database.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE LOWER(email) = LOWER($1)",
    [ADMIN_EMAIL],
  );

  assert.equal(
    await verifyPassword(ADMIN_PASSWORD, stored.rows[0]!.password_hash),
    false,
    "a corrupted hash verified — the seed's read-back would be meaningless",
  );
});

test("the demo password published on the login page is the one that works", async () => {
  await seedStaff(connectionString, ADMIN_PASSWORD);

  const { verifyPassword } = await import("../auth/password.js");
  const stored = await database.query<{ password_hash: string }>(
    "SELECT password_hash FROM users WHERE LOWER(email) = LOWER($1)",
    [DEMO_EMAIL],
  );

  // If these ever drift, every recruiter who follows the printed credentials
  // is turned away at the door.
  assert.equal(await verifyPassword(DEMO_PASSWORD, stored.rows[0]!.password_hash), true);
});
