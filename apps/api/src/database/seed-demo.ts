import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import pg from "pg";

const { Client } = pg;

const seedPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../database/postgres/seeds/001_demo_data.sql",
);

/**
 * Applies the demo seed through Node, so environments without a psql binary
 * (or with one pointed at the wrong server) run the identical file CI runs.
 * The seed is idempotent — every INSERT carries ON CONFLICT DO NOTHING — so
 * re-running restores anything a test run deleted without duplicating what
 * survived.
 */
export async function seedDemo(
  connectionString = process.env.DATABASE_URL,
): Promise<void> {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to seed demo data");
  }

  const client = new Client({ connectionString });

  await client.connect();

  try {
    await client.query(await readFile(seedPath, "utf8"));
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedDemo();
  console.log("demo data seeded (idempotent)");
}
