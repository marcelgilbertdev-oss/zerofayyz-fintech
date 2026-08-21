import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "./auth";

/**
 * Fetch is mocked at the network boundary, same as the dashboard store's
 * tests, so the Zod validation and the status-code branches — the parts that
 * actually guard the session — run in every test.
 */

const operator = {
  email: "demo@zerofayyz.test",
  displayName: "Demo Operator",
  role: "operator" as const,
};

const auditPage = {
  data: [
    {
      id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
      action: "auth.login.succeeded",
      entityType: "session",
      entityId: null,
      actorEmail: "demo@zerofayyz.test",
      sessionId: null,
      clientFingerprint: "prefix:abc",
      metadata: {},
      createdAt: "2026-08-21T00:00:00.000Z",
    },
  ],
};

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type Route = (path: string, init?: RequestInit) => Response | undefined;

function stubFetch(route: Route) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const handled = route(String(input), init);
    if (!handled) throw new Error(`unexpected fetch: ${String(input)}`);
    return handled;
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  setActivePinia(createPinia());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("auth store", () => {
  it("resume with no cookie lands signed out, without an error", async () => {
    stubFetch((path) =>
      path.includes("/auth/me") ? respond({ error: "Not signed in" }, 401) : undefined,
    );

    const auth = useAuthStore();
    await auth.resume();

    expect(auth.status).toBe("signedOut");
    expect(auth.error).toBeNull();
    expect(auth.notice).toBeNull();
  });

  it("resume with a live cookie signs in and loads the audit trail", async () => {
    stubFetch((path) => {
      if (path.includes("/auth/me")) return respond(operator);
      if (path.includes("/admin/audit-logs")) return respond(auditPage);
      return undefined;
    });

    const auth = useAuthStore();
    await auth.resume();

    expect(auth.status).toBe("signedIn");
    expect(auth.user?.displayName).toBe("Demo Operator");
    expect(auth.audit?.data[0]?.action).toBe("auth.login.succeeded");
  });

  it("a wrong password surfaces the API's refusal verbatim", async () => {
    stubFetch((path) =>
      path.includes("/auth/login")
        ? respond({ error: "Incorrect email or password" }, 401)
        : undefined,
    );

    const auth = useAuthStore();
    auth.status = "signedOut";
    await auth.signIn("demo@zerofayyz.test", "wrong");

    expect(auth.status).toBe("signedOut");
    expect(auth.error).toBe("Incorrect email or password");
    expect(auth.submitting).toBe(false);
  });

  it("the rate limiter's refusal comes through untouched too", async () => {
    stubFetch((path) =>
      path.includes("/auth/login")
        ? respond({ error: "Too many attempts. Try again shortly." }, 429)
        : undefined,
    );

    const auth = useAuthStore();
    await auth.signIn("demo@zerofayyz.test", "view-the-ledger");

    expect(auth.error).toBe("Too many attempts. Try again shortly.");
  });

  it("a successful sign-in stores the user and fetches the trail", async () => {
    stubFetch((path) => {
      if (path.includes("/auth/login"))
        return respond({ user: operator, expiresAt: "2026-08-22T00:00:00.000Z" });
      if (path.includes("/admin/audit-logs")) return respond(auditPage);
      return undefined;
    });

    const auth = useAuthStore();
    await auth.signIn("demo@zerofayyz.test", "view-the-ledger");

    expect(auth.status).toBe("signedIn");
    expect(auth.user?.role).toBe("operator");
    expect(auth.audit?.data).toHaveLength(1);
    expect(auth.error).toBeNull();
  });

  it("a 401 from the audit trail mid-session flips to signed out with a notice", async () => {
    stubFetch((path) =>
      path.includes("/admin/audit-logs")
        ? respond({ error: "Not signed in" }, 401)
        : undefined,
    );

    const auth = useAuthStore();
    auth.status = "signedIn";
    auth.user = operator;
    await auth.loadAudit();

    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.notice).toBe("Your session ended — sign in again.");
  });

  it("sign-out clears local state even when the network call fails", async () => {
    stubFetch((path) =>
      path.includes("/auth/logout") ? respond({ error: "boom" }, 500) : undefined,
    );

    const auth = useAuthStore();
    auth.status = "signedIn";
    auth.user = operator;
    await auth.signOut();

    expect(auth.status).toBe("signedOut");
    expect(auth.user).toBeNull();
    expect(auth.audit).toBeNull();
  });

  it("a drifted audit response fails loudly with the endpoint named", async () => {
    stubFetch((path) =>
      path.includes("/admin/audit-logs")
        ? respond({ data: [{ id: "not-a-uuid" }] })
        : undefined,
    );

    const auth = useAuthStore();
    auth.status = "signedIn";
    await auth.loadAudit();

    expect(auth.auditError).toContain("/api/v1/admin/audit-logs");
    expect(auth.status).toBe("signedIn");
  });
});
