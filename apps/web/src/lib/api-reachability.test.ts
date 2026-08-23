import { afterEach, describe, expect, it, vi } from "vitest";

import { apiTimeoutMs, probe, worstOf, DEFAULT_API_TIMEOUT_MS } from "./api-reachability";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

/**
 * The defect these tests exist for:
 *
 * the dashboard used to catch any fetch failure and render "PostgreSQL —
 * Unavailable". A cold start is a fetch failure. So for the ~30 seconds the API
 * took to wake, a reviewer was shown a confident claim that the database was
 * down, about a database nobody had managed to ask.
 *
 * The distinction being pinned here is: did the server answer at all?
 */
describe("probe", () => {
  it("reports a successful answer as reachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    const result = await probe("https://api.test/health");

    expect(result.reachability).toBe("reachable");
    expect(result.response).not.toBeNull();
  });

  it("treats an error status as down, because the server did answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));

    const result = await probe("https://api.test/health");

    // A 503 is information. The service told us it is unwell, and that is a
    // fault worth reporting as one.
    expect(result.reachability).toBe("down");
    expect(result.response?.status).toBe(503);
  });

  it("treats a timeout as waking, not as down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }),
    );

    const result = await probe("https://api.test/health");

    expect(result.reachability).toBe("waking");
    expect(result.response).toBeNull();
  });

  it("treats a refused connection as waking, not as down", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await probe("https://api.test/health");

    // Nothing came back, so we have learned nothing about the service's
    // internals. Claiming a fault here is the bug we are preventing.
    expect(result.reachability).toBe("waking");
  });

  it("never throws, whatever fetch does", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("something entirely unexpected");
      }),
    );

    await expect(probe("https://api.test/health")).resolves.toMatchObject({
      reachability: "waking",
    });
  });
});

describe("worstOf", () => {
  it("is reachable only when every probe is", () => {
    expect(worstOf(["reachable", "reachable"])).toBe("reachable");
  });

  it("reports waking when something did not answer", () => {
    expect(worstOf(["reachable", "waking"])).toBe("waking");
  });

  it("lets a reported fault outrank a silence", () => {
    // A fault is a fact; a silence is the absence of one. If any component
    // actually said it was broken, that is the more informative verdict.
    expect(worstOf(["waking", "down", "reachable"])).toBe("down");
  });
});

describe("apiTimeoutMs", () => {
  it("stays below a cold start on purpose", () => {
    // The page must render fast and let WakeWatcher recover it, rather than
    // holding the whole response open until the platform's function ceiling
    // turns a slow page into an error page.
    expect(DEFAULT_API_TIMEOUT_MS).toBeLessThan(15_000);
  });

  it("honours a configured override", () => {
    vi.stubEnv("API_TIMEOUT_MS", "2500");

    expect(apiTimeoutMs()).toBe(2500);
  });

  it("falls back when the override is not a usable number", () => {
    vi.stubEnv("API_TIMEOUT_MS", "not-a-number");

    expect(apiTimeoutMs()).toBe(DEFAULT_API_TIMEOUT_MS);
  });
});
