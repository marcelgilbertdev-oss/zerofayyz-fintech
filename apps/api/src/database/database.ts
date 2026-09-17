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

/**
 * ADR 20 stopped the probes that were keeping Neon's compute awake, which
 * worked: it now scales to zero after five idle minutes. Waking it takes
 * longer than opening a connection to a database that is already running, and
 * 1500ms — a figure chosen when the compute was never allowed to sleep — was
 * not enough for it. pg surfaces that wait as a connection error, so the first
 * visitor after a quiet spell was handed a failure that a retry a second later
 * would not reproduce.
 *
 * Ten seconds comfortably covers a resume; the retry is for the other shape,
 * where the socket is closed mid-wake rather than timing out, and which fails
 * fast enough that two attempts stay well inside a reasonable request.
 */
const CONNECTION_TIMEOUT_MS = 10_000;
const COLD_START_ATTEMPTS = 2;
const COLD_START_BACKOFF_MS = 250;

/**
 * Idle pooled connections are still released after ten seconds. Holding them
 * open would spare the wake-up, but it is the opposite of what ADR 20 bought:
 * the point is to let the compute go to sleep. Paying a cold connect is the
 * intended cost, and the retry above is what makes paying it invisible.
 */
const IDLE_TIMEOUT_MS = 10_000;

/**
 * True only for failures to ESTABLISH a connection. That distinction is the
 * whole safety argument for retrying: if the connection was never established,
 * the statement never reached the database, so running it again cannot repeat
 * a write. A query that failed after connecting — a constraint violation, a
 * serialisation failure — is never retried here.
 */
export function isColdStartError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;

  if (code === "ETIMEDOUT" || code === "ECONNRESET" || code === "EPIPE") {
    return true;
  }

  return (
    // pg-pool, when connectionTimeoutMillis elapses.
    error.message === "timeout exceeded when trying to connect" ||
    // pg client, same cause, reported from the other side of the seam.
    error.message === "Connection terminated due to connection timeout" ||
    // The socket closed while the compute was still resuming.
    error.message === "Connection terminated unexpectedly"
  );
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Retries `connect` while the failure looks like a compute that is still
 * waking. Exported so the retry loop can be tested without a sleeping
 * database: the cold path never runs in CI, where Postgres is local and
 * always warm, which is exactly why this defect reached production.
 */
export async function connectWithWake<T>(
  connect: () => Promise<T>,
  attempts = COLD_START_ATTEMPTS,
  backoffMs = COLD_START_BACKOFF_MS,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await connect();
    } catch (error) {
      if (attempt >= attempts || !isColdStartError(error)) {
        throw error;
      }

      await sleep(backoffMs * attempt);
    }
  }
}

export function createDatabase(
  connectionString = process.env.DATABASE_URL ?? defaultConnectionString,
): Database {
  const pool = new Pool({
    connectionString,
    max: 10,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
  });

  pool.on("error", (error) => {
    console.error("Unexpected PostgreSQL pool error", error);
  });

  /** Every checkout in this module goes through here, so nothing is left on
   * the 1500ms-era assumption that a connection is always cheap. */
  const checkout = () => connectWithWake(() => pool.connect());

  return {
    async checkHealth() {
      const startedAt = performance.now();

      try {
        // A sleeping database is not a broken one. Without the wake-aware
        // checkout the health panel would report the platform down for the
        // few seconds Neon takes to resume, which is a false alarm on the
        // one page a reviewer is most likely to be looking at.
        const client = await checkout();
        let result;

        try {
          result = await client.query<{ current_database: string }>(
            "SELECT current_database() AS current_database",
          );
        } finally {
          client.release();
        }

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
      const client = await checkout();

      try {
        return await client.query<Row, Values>(text, values);
      } finally {
        client.release();
      }
    },
    async queryAsUser(context, run) {
      if (!REQUEST_LANE_ROLES.has(context.role)) {
        throw new Error(`Unknown request-lane role: ${context.role}`);
      }

      const client = await checkout();
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
