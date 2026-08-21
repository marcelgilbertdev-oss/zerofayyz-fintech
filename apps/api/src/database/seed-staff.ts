import "dotenv/config";
import { pathToFileURL } from "node:url";

import { hashPassword } from "../auth/password.js";
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
  console.log(`seeded ${DEMO_EMAIL} (operator) and ${ADMIN_EMAIL} (admin)`);
}
