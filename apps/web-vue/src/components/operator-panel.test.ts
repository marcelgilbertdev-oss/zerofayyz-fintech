import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/vue";
import { createPinia } from "pinia";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import AuditTrail from "./AuditTrail.vue";
import OperatorPanel from "./OperatorPanel.vue";

/**
 * The panel is rendered the way the app renders it — real Pinia, fetch mocked
 * at the network boundary — and queried the way a user reaches it: by role
 * and visible text.
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

  return render(OperatorPanel, { global: { plugins: [createPinia()] } });
}

const signedOutRoutes = (path: string) =>
  path.includes("/auth/me") ? respond({ error: "Not signed in" }, 401) : undefined;

afterEach(() => {
  // Without vitest globals there is no automatic DOM cleanup, and a second
  // render would leave two panels — and two "Sign in" buttons — in the page.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("OperatorPanel", () => {
  it("offers the sign-in form once the cookie says nobody is here", async () => {
    renderPanel(signedOutRoutes);

    expect(
      await screen.findByRole("button", { name: "Sign in" }),
    ).toBeTruthy();
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
    expect(
      (screen.getByLabelText("Password") as HTMLInputElement).value,
    ).toBe("view-the-ledger");
    expect(screen.getByText("Filled in — press Sign in")).toBeTruthy();
  });

  it("the eye toggle reveals the password and reports its state", async () => {
    renderPanel(signedOutRoutes);
    await screen.findByRole("button", { name: "Sign in" });

    const input = screen.getByLabelText("Password") as HTMLInputElement;
    const toggle = screen.getByRole("button", { name: "Show password" });

    expect(input.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await fireEvent.click(toggle);

    expect(input.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("every text input declares box-sizing (layout-overflow regression)", () => {
    // A live charter run on the deployed Vue client found the password input
    // overflowing its grid column and sliding under the reviewer-access card:
    // width:100% plus 54px of horizontal padding, and this app has no global
    // box-sizing reset. jsdom neither lays out nor injects scoped SFC styles, so
    // this asserts the declaration in the source — the thing whose absence caused
    // the bug — rather than pretending to measure pixels.
    const here = path.dirname(fileURLToPath(import.meta.url));
    for (const file of ["PasswordField.vue", "OperatorPanel.vue"]) {
      const source = readFileSync(path.join(here, file), "utf8");
      expect(
        source.slice(source.indexOf("<style")),
        `${file} lost its box-sizing declaration`,
      ).toContain("box-sizing: border-box");
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

    await fireEvent.update(screen.getByLabelText("Email address"), "demo@zerofayyz.test");
    await fireEvent.update(screen.getByLabelText("Password"), "wrong");
    await fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(await screen.findByText("Incorrect email or password")).toBeTruthy();
    expect(
      screen.getByText(
        "If you believe you should have access, contact your administrator.",
      ),
    ).toBeTruthy();

    // Fixing the typo removes the stale refusal immediately.
    await fireEvent.update(screen.getByLabelText("Password"), "view-the-ledger");
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
    await fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    // findBy, because the audit fetch settles a tick after the login does.
    expect(await screen.findByText("auth.login.succeeded")).toBeTruthy();
    expect(screen.getByText("Demo Operator")).toBeTruthy();
    expect(screen.getByText("operator")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
  });
});

describe("AuditTrail", () => {
  it("shows an empty state instead of a bare table", () => {
    render(AuditTrail, { props: { audit: { data: [] } } });

    expect(screen.getByText("No audit entries yet.")).toBeTruthy();
  });

  it("renders a dash for entries whose actor is gone, not a blank cell", () => {
    render(AuditTrail, {
      props: {
        audit: {
          data: [{ ...auditEntry, actorEmail: null }],
        },
      },
    });

    expect(screen.getByText("—")).toBeTruthy();
  });
});
