import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;

const defaultMigrationsDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../database/postgres/migrations",
);

export type MigrationResult = {
  applied: string[];
  skipped: string[];
};

/**
 * Applies every unapplied .sql file in filename order, each inside its own
 * transaction, and records it in schema_migrations.
 *
 * Mounting the migrations folder into docker-entrypoint-initdb.d only runs
 * them when the data directory is empty, which silently skips every migration
 * written after the container was first created — and does nothing at all for
 * a managed database in production.
 */
export async function migrate(
  connectionString = process.env.DATABASE_URL,
  migrationsDirectory = process.env.MIGRATIONS_DIR ?? defaultMigrationsDirectory,
): Promise<MigrationResult> {
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to run migrations");
  }

  const client = new Client({ connectionString });
  const applied: string[] = [];
  const skipped: string[] = [];

  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    const entries = await readdir(migrationsDirectory);
    const migrations = entries.filter((entry) => entry.endsWith(".sql")).sort();
    const recorded = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const alreadyApplied = new Set(recorded.rows.map((row) => row.filename));

    for (const filename of migrations) {
      if (alreadyApplied.has(filename)) {
        skipped.push(filename);
        continue;
      }

      const sql = await readFile(path.join(migrationsDirectory, filename), "utf8");

      await client.query("BEGIN");

      try {
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (filename) VALUES ($1)", [
          filename,
        ]);
        await client.query("COMMIT");
        applied.push(filename);
      } catch (error) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${filename} failed: ${String(error)}`);
      }
    }

    return { applied, skipped };
  } finally {
    await client.end();
  }
}

// Running this file directly is the deployment entry point.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const result = await migrate();

  for (const filename of result.applied) {
    console.log(`applied  ${filename}`);
  }

  for (const filename of result.skipped) {
    console.log(`skipped  ${filename} (already applied)`);
  }

  console.log(
    `${result.applied.length} applied, ${result.skipped.length} already present`,
  );
}
