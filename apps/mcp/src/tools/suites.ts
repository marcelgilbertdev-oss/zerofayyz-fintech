/**
 * Running the platform's own test suites.
 *
 * Every runnable command is a fixed entry in the allowlist below. The tool
 * takes a suite *name*, never a command, so there is no argument an agent can
 * pass that turns this into arbitrary shell execution — the failure mode of a
 * "run a command for me" tool is that the model is one confused instruction
 * away from running anything at all.
 *
 * Commands are spawned without a shell for the same reason: no interpolation,
 * no quoting bugs, no `;` that means something.
 */

import { spawn } from "node:child_process";

export type SuiteName =
  | "api-unit"
  | "api-integration"
  | "web-unit"
  | "web-e2e"
  | "vue-unit"
  | "svelte-unit"
  | "production-smoke";

type SuiteDefinition = {
  description: string;
  command: string;
  args: string[];
  /** Working directory relative to the repository root. */
  cwd: string;
  /** True when the suite reaches the deployed platform rather than local code. */
  touchesProduction: boolean;
};

export const SUITES: Record<SuiteName, SuiteDefinition> = {
  "api-unit": {
    description: "API unit tests (node:test).",
    command: "npm",
    args: ["run", "test:unit"],
    cwd: "apps/api",
    touchesProduction: false,
  },
  "api-integration": {
    description: "API integration tests against a real PostgreSQL instance.",
    command: "npm",
    args: ["run", "test:integration"],
    cwd: "apps/api",
    touchesProduction: false,
  },
  "web-unit": {
    description: "Next.js dashboard unit tests.",
    command: "npm",
    args: ["test"],
    cwd: "apps/web",
    touchesProduction: false,
  },
  "web-e2e": {
    description: "Playwright end-to-end suite against a production build.",
    command: "npm",
    args: ["run", "test:e2e"],
    cwd: "apps/web",
    touchesProduction: false,
  },
  "vue-unit": {
    description: "Vue client unit tests (Vitest + Testing Library).",
    command: "npm",
    args: ["test"],
    cwd: "apps/web-vue",
    touchesProduction: false,
  },
  "svelte-unit": {
    description: "Svelte client unit tests (Vitest + Testing Library).",
    command: "npm",
    args: ["test"],
    cwd: "apps/web-svelte",
    touchesProduction: false,
  },
  "production-smoke": {
    description:
      "Outside-in smoke suite against the deployed platform. Read-only, but it " +
      "does reach production.",
    command: "node",
    args: ["scripts/production-smoke.mjs"],
    cwd: ".",
    touchesProduction: true,
  },
};

export type SuiteRun = {
  suite: SuiteName;
  exitCode: number | null;
  passed: boolean;
  durationMs: number;
  timedOut: boolean;
  /** Trailing output, capped — a full Playwright log would swamp the context. */
  output: string;
  summary: string;
};

const MAX_OUTPUT_CHARS = 4_000;

export function isSuiteName(value: string): value is SuiteName {
  return Object.hasOwn(SUITES, value);
}

/**
 * Keep the tail rather than the head: a runner prints its failures and totals
 * at the end, and truncating from the front is what throws that away.
 */
export function tail(text: string, limit = MAX_OUTPUT_CHARS): string {
  if (text.length <= limit) {
    return text;
  }

  return `…(${text.length - limit} earlier characters omitted)\n${text.slice(-limit)}`;
}

export async function runSuite(
  suite: SuiteName,
  options: { repoRoot: string; timeoutMs?: number },
): Promise<SuiteRun> {
  const definition = SUITES[suite];
  const timeoutMs = options.timeoutMs ?? 600_000;
  const startedAt = performance.now();

  return await new Promise<SuiteRun>((resolve) => {
    const child = spawn(definition.command, definition.args, {
      cwd: `${options.repoRoot}/${definition.cwd}`,
      // No shell: the allowlist is only a real boundary if nothing re-parses it.
      shell: false,
      env: process.env,
    });

    let output = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        suite,
        exitCode: null,
        passed: false,
        durationMs: Math.round(performance.now() - startedAt),
        timedOut,
        output: tail(output),
        summary: `Could not start the suite: ${error.message}`,
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const durationMs = Math.round(performance.now() - startedAt);
      const passed = code === 0 && !timedOut;

      resolve({
        suite,
        exitCode: code,
        passed,
        durationMs,
        timedOut,
        output: tail(output),
        summary: timedOut
          ? `${suite} was killed after ${timeoutMs}ms.`
          : `${suite} ${passed ? "passed" : `failed with exit code ${code}`} in ${durationMs}ms.`,
      });
    });
  });
}
