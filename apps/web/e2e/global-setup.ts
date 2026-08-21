import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Seeds the staff accounts with the passwords this suite signs in with.
 *
 * The integration suite re-seeds the same accounts with its own throwaway
 * password as part of its cleanup, so on a shared local database whichever
 * suite ran last decides whether the other can sign in. Seeding here makes the
 * e2e suite self-contained instead of dependent on run order.
 */
export default function globalSetup() {
  execFileSync("npm", ["run", "seed:staff"], {
    cwd: path.resolve(__dirname, "../../api"),
    env: {
      ...process.env,
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech",
      ADMIN_PASSWORD: process.env.E2E_ADMIN_PASSWORD ?? "ci-throwaway-admin-password",
    },
    stdio: "inherit",
  });
}
