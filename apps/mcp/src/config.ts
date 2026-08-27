/**
 * Configuration for the QA MCP server.
 *
 * Everything is read from the environment once, at construction, so a tool
 * handler never reaches for `process.env` mid-call — a server whose behaviour
 * depends on when you asked is not one you can write tests against.
 */

export type McpConfig = {
  /** Base URL of the platform API, no trailing slash. */
  apiUrl: string;
  /** Absolute path to the repository root, used to run suites. */
  repoRoot: string;
  /** How long any single HTTP call may take. */
  timeoutMs: number;
  /**
   * Operator credentials. Read-only by design: the demo operator can read the
   * whole ledger and change nothing, so an agent driving this server cannot
   * mutate state even if it decides to try.
   */
  operatorEmail: string | null;
  operatorPassword: string | null;
  /**
   * Stripe webhook signing secret. Absent in most environments, which is why
   * the replay tool reports "unconfigured" rather than failing — a QA tool that
   * errors when a capability is simply switched off teaches people to ignore it.
   */
  webhookSecret: string | null;
};

function trimTrailingSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): McpConfig {
  const timeoutRaw = env.MCP_TIMEOUT_MS ?? "90000";
  const timeoutMs = Number.parseInt(timeoutRaw, 10);

  return {
    apiUrl: trimTrailingSlash(
      env.MCP_API_URL ?? "https://zerofayyz-fintech-api.onrender.com",
    ),
    repoRoot: env.MCP_REPO_ROOT ?? process.cwd(),
    // A NaN timeout silently disables AbortSignal.timeout, so a bad env var
    // would turn every call into an unbounded hang instead of a loud failure.
    timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 90_000,
    operatorEmail: env.MCP_OPERATOR_EMAIL ?? null,
    operatorPassword: env.MCP_OPERATOR_PASSWORD ?? null,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? null,
  };
}
