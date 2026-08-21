import "dotenv/config";
import { pathToFileURL } from "node:url";

import { hashPassword, verifyPassword } from "../auth/password.js";
import { createDatabase } from "./database.js";

/**
 * Seeds the two accounts the login page needs.
 *
 * The demo account's credentials are public on purpose — they are printed on
 * the login page so a recruiter can walk into the operator view without
 * asking anyone. Publishing a password is normally the mistake; here it is
 * the feature, and the account's role is the boundary: an operator can read,
 * and can prove the audit log refuses edits, but cannot manage users or end
 * sessions.
 *
 * The admin password is different in kind, so it is different in mechanism:
 * it comes from ADMIN_PASSWORD in the environment, set by the person running
 * this script, and the script refuses to run without it. It is never written
 * down here, never logged, and never chosen by tooling.
 */
export const DEMO_EMAIL = "demo@zerofayyz.test";
export const DEMO_PASSWORD = "view-the-ledger";
export const ADMIN_EMAIL = "admin@zerofayyz.test";

export async function seedStaff(
  connectionString: string,
  adminPassword: string,
): Promise<void> {
  if (adminPassword.length < 12) {
    throw new Error("ADMIN_PASSWORD must be at least 12 characters");
  }

  const database = createDatabase(connectionString);

  try {
    const demoHash = await hashPassword(DEMO_PASSWORD);
    const adminHash = await hashPassword(adminPassword);

    await database.query(
      `
        INSERT INTO users (email, display_name, role, password_hash)
        VALUES ($1, 'Demo Operator', 'operator', $2),
               ($3, 'Platform Admin', 'admin', $4)
        ON CONFLICT (LOWER(email)) DO UPDATE
          SET password_hash = EXCLUDED.password_hash,
              role = EXCLUDED.role,
              display_name = EXCLUDED.display_name,
              updated_at = NOW()
      `,
      [DEMO_EMAIL, demoHash, ADMIN_EMAIL, adminHash],
    );

    // Read back and verify, rather than trusting the write.
    //
    // Writing a hash proves a row exists; it does not prove the password can
    // sign anyone in. The admin password is typed blind at a hidden prompt, so
    // a stray character produces a confident success message and a login that
    // refuses you — with no way to tell which of the two went wrong. This
    // re-reads what was stored and runs the real verifier against it, so
    // "seeded" means "these credentials work", not "a query returned".
    const stored = await database.query<
      { email: string; role: string; password_hash: string | null }
    >(
      `
        SELECT email, role, password_hash
          FROM users
         WHERE LOWER(email) IN (LOWER($1), LOWER($2))
      `,
      [DEMO_EMAIL, ADMIN_EMAIL],
    );

    for (const [email, password] of [
      [DEMO_EMAIL, DEMO_PASSWORD],
      [ADMIN_EMAIL, adminPassword],
    ] as const) {
      const row = stored.rows.find(
        (candidate) => candidate.email.toLowerCase() === email.toLowerCase(),
      );

      if (!row?.password_hash) {
        throw new Error(`${email} was not written to the database`);
      }

      if (!(await verifyPassword(password, row.password_hash))) {
        throw new Error(
          `${email} was written but its password does not verify — ` +
            "the stored hash does not match the password given",
        );
      }
    }
  } finally {
    await database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const connectionString = process.env.DATABASE_URL;
  const adminPassword = process.env.ADMIN_PASSWORD;

  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  if (!adminPassword) {
    console.error(
      "ADMIN_PASSWORD is required. Set it yourself when invoking:\n" +
        "  ADMIN_PASSWORD='…' npm run seed:staff",
    );
    process.exit(1);
  }

  await seedStaff(connectionString, adminPassword);
  console.log(
    `seeded and VERIFIED ${DEMO_EMAIL} (operator) and ${ADMIN_EMAIL} (admin)\n` +
      "Both passwords were read back from the database and checked against the " +
      "real verifier — these credentials will sign in.",
  );
}
