import pg from "pg";

const { Pool } = pg;

export type DatabaseHealth = {
  operational: boolean;
  latencyMs: number | null;
  name: string | null;
};

export type Database = {
  checkHealth: () => Promise<DatabaseHealth>;
  close: () => Promise<void>;
};

const defaultConnectionString =
  "postgresql://zerofayyz_fintech:zerofayyz_fintech@127.0.0.1:5432/zerofayyz_fintech";

export function createDatabase(
  connectionString = process.env.DATABASE_URL ?? defaultConnectionString,
): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: 1500,
    idleTimeoutMillis: 10_000,
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });

  return {
    async checkHealth() {
      const startedAt = performance.now();

      try {
        const result = await pool.query<{ current_database: string }>(
          "SELECT current_database() AS current_database",
        );

        return {
          operational: true,
          latencyMs: Math.max(0, Math.round(performance.now() - startedAt)),
          name: result.rows[0]?.current_database ?? null,
        };
      } catch {
        return {
          operational: false,
          latencyMs: null,
          name: null,
        };
      }
    },
    async close() {
      await pool.end();
    },
  };
}
