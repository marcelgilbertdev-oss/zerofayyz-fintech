import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { afterEach, describe, expect, it, vi } from "vitest";

import AuditTrail from "./AuditTrail.svelte";
import OperatorPanel from "./OperatorPanel.svelte";

/**
 * The panel is rendered the way the app renders it — fetch mocked at the
 * network boundary — and queried the way a user reaches it: by role and
 * visible text. The assertions mirror the Vue client's panel tests.
 */

const operator = {
  email: "demo@zerofayyz.test",
  displayName: "Demo Operator",
  role: "operator" as const,
};

const auditEntry = {
  id: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  action: "auth.login.succeeded",
  entityType: "session",
  entityId: null,
  actorEmail: "demo@zerofayyz.test",
  sessionId: null,
  clientFingerprint: "prefix:abc",
  metadata: {},
  createdAt: new Date().toISOString(),
};

const auditPage = { data: [auditEntry] };

function respond(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function renderPanel(route: (path: string) => Response | undefined) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const handled = route(String(input));
      if (!handled) throw new Error(`unexpected fetch: ${String(input)}`);
      return handled;
    }),
  );

  return render(OperatorPanel);
}

const signedOutRoutes = (path: string) =>
  path.includes("/auth/me") ? respond({ error: "Not signed in" }, 401) : undefined;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OperatorPanel", () => {
  it("offers the sign-in form once the cookie says nobody is here", async () => {
    renderPanel(signedOutRoutes);

    expect(await screen.findByRole("button", { name: "Sign in" })).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
  });

  it("fills the published demo credentials with one click", async () => {
    renderPanel(signedOutRoutes);
    await screen.findByRole("button", { name: "Sign in" });

    await fireEvent.click(
      screen.getByRole("button", { name: "Fill these in for me" }),
    );

    expect(
      (screen.getByLabelText("Email address") as HTMLInputElement).value,
    ).toBe("demo@zerofayyz.test");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "view-the-ledger",
    );
    expect(screen.getByText("Filled in — press Sign in")).toBeTruthy();
  });

  it("the eye toggle reveals the password and reports its state", async () => {
    renderPanel(signedOutRoutes);
    await screen.findByRole("button", { name: "Sign in" });

    const toggle = screen.getByRole("button", { name: "Show password" });

    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe(
      "password",
    );
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await fireEvent.click(toggle);

    expect((screen.getByLabelText("Password") as HTMLInputElement).type).toBe(
      "text",
    );
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

it("no mobile grid collapse uses a bare 1fr (grid-blowout regression)", () => {
    // A bare `1fr` track's implied minimum is the item's min-content, and the
    // transactions table is 640px wide inside its scroll wrapper — so on the
    // deployed client at 375px the "collapsed" single column was 682px and the
    // whole page scrolled sideways. minmax(0, 1fr) is the difference. jsdom
    // does no layout, so this pins the declaration in source, where the bug
    // lived. Mirrors the Vue suite's assertion, like everything else here.
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const file of ["../routes/+page.svelte", "OperatorPanel.svelte"]) {
      const source = readFileSync(path.join(here, file), "utf8");
      const styles = source.slice(source.indexOf("<style"));
      expect(
        /grid-template-columns:\s*1fr\s*;/.test(styles),
        `${file} collapses a grid to a bare 1fr — use minmax(0, 1fr)`,
      ).toBe(false);
    }
  });

  it("shows the API's refusal and the contact-admin line, then clears on edit", async () => {
    renderPanel((path) => {
      if (path.includes("/auth/me")) return respond({ error: "Not signed in" }, 401);
      if (path.includes("/auth/login"))
        return respond({ error: "Incorrect email or password" }, 401);
      return undefined;
    });
    await screen.findByRole("button", { name: "Sign in" });

    await fireEvent.input(screen.getByLabelText("Email address"), {
      target: { value: "demo@zerofayyz.test" },
    });
    await fireEvent.input(screen.getByLabelText("Password"), {
      target: { value: "wrong" },
    });
    await fireEvent.submit(
      screen.getByRole("button", { name: "Sign in" }).closest("form")!,
    );

    expect(await screen.findByText("Incorrect email or password")).toBeTruthy();
    expect(
      screen.getByText(
        "If you believe you should have access, contact your administrator.",
      ),
    ).toBeTruthy();

    // Fixing the typo removes the stale refusal immediately.
    await fireEvent.input(screen.getByLabelText("Password"), {
      target: { value: "view-the-ledger" },
    });
    await waitFor(() =>
      expect(screen.queryByText("Incorrect email or password")).toBeNull(),
    );
  });

  it("signs in, shows who is here, and renders the audit trail", async () => {
    renderPanel((path) => {
      if (path.includes("/auth/me")) return respond({ error: "Not signed in" }, 401);
      if (path.includes("/auth/login"))
        return respond({ user: operator, expiresAt: "2026-08-22T00:00:00.000Z" });
      if (path.includes("/admin/audit-logs")) return respond(auditPage);
      return undefined;
    });
    await screen.findByRole("button", { name: "Sign in" });

    await fireEvent.click(
      screen.getByRole("button", { name: "Fill these in for me" }),
    );
    await fireEvent.submit(
      screen.getByRole("button", { name: "Sign in" }).closest("form")!,
    );

    // findBy, because the audit fetch settles a tick after the login does.
    expect(await screen.findByText("auth.login.succeeded")).toBeTruthy();
    expect(screen.getByText("Demo Operator")).toBeTruthy();
    expect(screen.getByText("operator")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("AuditTrail", () => {
  it("shows an empty state instead of a bare table", () => {
    render(AuditTrail, { props: { audit: { data: [] }, onrefresh: () => {} } });

    expect(screen.getByText("No audit entries yet.")).toBeTruthy();
  });

  it("renders a dash for entries whose actor is gone, not a blank cell", () => {
    render(AuditTrail, {
      props: {
        audit: { data: [{ ...auditEntry, actorEmail: null }] },
        onrefresh: () => {},
      },
    });

    expect(screen.getByText("—")).toBeTruthy();
  });
});
