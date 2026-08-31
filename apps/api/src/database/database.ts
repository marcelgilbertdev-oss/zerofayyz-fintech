import pg, {
  type QueryConfigValues,
  type QueryResult,
  type QueryResultRow,
} from "pg";

const { Pool } = pg;

export type DatabaseHealth = {
  operational: boolean;
  latencyMs: number | null;
  name: string | null;
};

/** The person a request-lane transaction is serving. */
export type RequestContext = {
  userId: string;
  role: "customer" | "viewer" | "operator" | "admin";
};

/** Same shape as Database.query, scoped to one checked-out connection. */
export type ScopedQuery = <
  Row extends QueryResultRow,
  Values extends unknown[] = unknown[],
>(
  text: string,
  values?: QueryConfigValues<Values>,
) => Promise<QueryResult<Row>>;

export type Database = {
  checkHealth: () => Promise<DatabaseHealth>;
  query: <
    Row extends QueryResultRow,
    Values extends unknown[] = unknown[],
  >(
    text: string,
    values?: QueryConfigValues<Values>,
  ) => Promise<QueryResult<Row>>;
  /**
   * Run queries as the row-level-security request lane, on behalf of one
   * authenticated person. See migration 007: inside the callback the
   * connection has adopted the zerofayyz_request role, so the database —
   * not a route guard — decides which rows exist.
   */
  queryAsUser: <T>(
    context: RequestContext,
    run: (query: ScopedQuery) => Promise<T>,
  ) => Promise<T>;
  close: () => Promise<void>;
};

/**
 * SET ROLE cannot be parameterised, so the role name below is a literal and
 * the context values travel through set_config's ordinary parameters. The
 * whitelist is defence in depth on top of the type.
 */
const REQUEST_LANE_ROLES: ReadonlySet<string> = new Set([
  "customer",
  "viewer",
  "operator",
  "admin",
]);

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
    async query<
      Row extends QueryResultRow,
      Values extends unknown[] = unknown[],
    >(
      text: string,
      values?: QueryConfigValues<Values>,
    ) {
      return pool.query<Row, Values>(text, values);
    },
    async queryAsUser(context, run) {
      if (!REQUEST_LANE_ROLES.has(context.role)) {
        throw new Error(`Unknown request-lane role: ${context.role}`);
      }

      const client = await pool.connect();
      let destroyed = false;

      try {
        // Everything below is transaction-local by construction: set_config
        // with is_local=true and SET LOCAL ROLE both evaporate at COMMIT or
        // ROLLBACK, so the connection returns to the pool as the service
        // role with no context attached. Nothing can leak between requests.
        await client.query("BEGIN");
        await client.query(
          "SELECT set_config('app.user_id', $1, true), set_config('app.role', $2, true)",
          [context.userId, context.role],
        );
        await client.query("SET LOCAL ROLE zerofayyz_request");

        const result = await run((text, values) =>
          client.query(text, values),
        );

        await client.query("COMMIT");
        return result;
      } catch (error) {
        try {
          await client.query("ROLLBACK");
        } catch {
          // The rollback itself failed, so the connection's state is
          // unknown — a connection that might still be wearing the request
          // role must never rejoin the pool. Destroy it.
          destroyed = true;
          client.release(true);
        }
        throw error;
      } finally {
        if (!destroyed) {
          client.release();
        }
      }
    },
    async close() {
      await pool.end();
    },
  };
}
