/**
 * The Cucumber World: one instance per scenario, holding every piece of I/O
 * the step definitions need. Steps stay one or two lines each — the point of
 * Gherkin is that the feature file reads as the specification, and that only
 * works if the steps beneath it are boring.
 */

import { setWorldConstructor, setDefaultTimeout, World } from "@cucumber/cucumber";
import type { Browser, Page } from "@playwright/test";
import { chromium } from "@playwright/test";

export const API_URL = process.env.BDD_API_URL ?? "http://127.0.0.1:4000";
export const WEB_URL = process.env.BDD_WEB_URL ?? "http://127.0.0.1:3000";

export const OPERATOR = {
  email: "demo@zerofayyz.test",
  password: "view-the-ledger",
};

export const ADMIN = {
  email: "admin@zerofayyz.test",
  // The same seeded value the Playwright e2e suite uses; CI seeds it fresh.
  password: process.env.E2E_ADMIN_PASSWORD ?? "ci-throwaway-admin-password",
};

/**
 * The webhook secret the BDD stack starts the API with. Signature construction
 * in the steps must use the same value, so it lives here, once.
 */
export const BDD_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET ?? "whsec_bdd_local_test_secret";

export type Actor = "admin" | "operator";

export type CapturedResponse = {
  status: number;
  body: string;
  headers: Headers;
};

export class PlatformWorld extends World {
  /** Session cookies by actor, captured at sign-in. */
  cookies = new Map<Actor, string>();
  /** Responses captured by When-steps for Then-steps to assert on, in order. */
  captured: CapturedResponse[] = [];
  /** The refund request id the current scenario is talking about. */
  refundRequestId: string | null = null;
  /** Parsed bodies stashed by name ("page one", "page two", ...). */
  stash = new Map<string, unknown>();

  #browser: Browser | null = null;
  #page: Page | null = null;

  /** Raw fetch against the API, capturing the response for later Then-steps. */
  async api(
    path: string,
    init: RequestInit = {},
    actor?: Actor,
  ): Promise<CapturedResponse> {
    const headers = new Headers(init.headers);

    if (actor) {
      const cookie = this.cookies.get(actor);
      if (!cookie) {
        throw new Error(`${actor} has no session — missing a sign-in Given?`);
      }
      headers.set("cookie", cookie);
    }

    const response = await fetch(`${API_URL}${path}`, { ...init, headers });
    const captured: CapturedResponse = {
      status: response.status,
      body: await response.text(),
      headers: response.headers,
    };
    this.captured.push(captured);
    return captured;
  }

  json<T = Record<string, unknown>>(response: CapturedResponse): T {
    return JSON.parse(response.body) as T;
  }

  async signIn(actor: Actor): Promise<void> {
    const who = actor === "admin" ? ADMIN : OPERATOR;
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: who.email, password: who.password }),
    });

    if (!response.ok) {
      throw new Error(
        `Sign-in as ${actor} failed (${response.status}) — is the stack seeded? ` +
          "(run seed:demo and seed:staff in apps/api)",
      );
    }

    const cookie = response.headers.getSetCookie?.()[0] ?? response.headers.get("set-cookie");
    if (!cookie) {
      throw new Error(`Sign-in as ${actor} returned no cookie`);
    }
    this.cookies.set(actor, cookie.split(";")[0] ?? "");
  }

  /** A real browser page, launched on first use so API-only scenarios stay fast. */
  async page(): Promise<Page> {
    if (!this.#page) {
      this.#browser = await chromium.launch();
      this.#page = await this.#browser.newPage();
    }
    return this.#page;
  }

  async closeBrowser(): Promise<void> {
    await this.#page?.close();
    await this.#browser?.close();
    this.#page = null;
    this.#browser = null;
  }
}

setWorldConstructor(PlatformWorld);
// Browser scenarios boot a real page against a production build; the default
// 5s is tuned for unit-sized steps and would flake here.
setDefaultTimeout(30_000);
