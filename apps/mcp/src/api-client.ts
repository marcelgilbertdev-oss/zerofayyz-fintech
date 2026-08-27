/**
 * HTTP access to the platform API.
 *
 * `fetch` is injected rather than reached for globally so tests exercise the
 * real validation path against a stub transport, instead of stubbing the module
 * that does the validating and proving nothing.
 */

import type { McpConfig } from "./config.js";

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export type ApiResult = {
  path: string;
  status: number;
  ok: boolean;
  body: unknown;
  latencyMs: number;
};

export class ApiClient {
  readonly #config: McpConfig;
  readonly #fetch: FetchLike;
  /**
   * The session cookie the API issued at login. Held in memory only: writing a
   * credential to disk so a restart is cheaper is how portfolio code ends up on
   * a public repository with a live session in it.
   */
  #sessionCookie: string | null = null;

  constructor(config: McpConfig, fetchImpl: FetchLike = fetch) {
    this.#config = config;
    this.#fetch = fetchImpl;
  }

  async request(
    path: string,
    init: RequestInit = {},
    options: { authenticated?: boolean } = {},
  ): Promise<ApiResult> {
    if (options.authenticated) {
      await this.#ensureSession();
    }

    const headers = new Headers(init.headers);

    if (this.#sessionCookie && options.authenticated) {
      headers.set("cookie", this.#sessionCookie);
    }

    const startedAt = performance.now();
    const response = await this.#fetch(`${this.#config.apiUrl}${path}`, {
      ...init,
      headers,
      signal: AbortSignal.timeout(this.#config.timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - startedAt);

    // A non-JSON body is data, not a crash: the API answers 500 in text/plain
    // on purpose, and a tool that throws on it hides the very failure it exists
    // to report.
    const body = await response.json().catch(() => null);

    return {
      path,
      status: response.status,
      ok: response.ok,
      body,
      latencyMs,
    };
  }

  async #ensureSession(): Promise<void> {
    if (this.#sessionCookie) {
      return;
    }

    const { operatorEmail, operatorPassword } = this.#config;

    if (!operatorEmail || !operatorPassword) {
      throw new Error(
        "No operator credentials configured. Set MCP_OPERATOR_EMAIL and " +
          "MCP_OPERATOR_PASSWORD to use tools that read privileged endpoints.",
      );
    }

    const response = await this.#fetch(`${this.#config.apiUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: operatorEmail, password: operatorPassword }),
      signal: AbortSignal.timeout(this.#config.timeoutMs),
    });

    if (!response.ok) {
      // Deliberately does not echo the API's refusal verbatim: sign-in failures
      // are intentionally indistinguishable there (wrong password, missing
      // account and disabled account return the same thing), and relaying that
      // text would imply this tool knows which one it was.
      throw new Error(`Sign-in failed with status ${response.status}.`);
    }

    // getSetCookie() keeps multiple Set-Cookie headers separate, where
    // get("set-cookie") comma-joins them into one corrupt string. Today the
    // API issues exactly one cookie at login; this stops depending on that.
    const cookies = response.headers.getSetCookie?.() ?? [];
    const cookie = cookies[0] ?? response.headers.get("set-cookie");

    if (!cookie) {
      throw new Error("Sign-in succeeded but the API issued no session cookie.");
    }

    // Keep only the name=value pair; forwarding Path/HttpOnly/SameSite
    // attributes back as a request cookie is malformed and some proxies drop it.
    this.#sessionCookie = cookie.split(";")[0] ?? null;
  }
}
