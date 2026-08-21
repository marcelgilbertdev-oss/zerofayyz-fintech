import { cookies, headers } from "next/headers";

/**
 * Server-side seams between the dashboard and the API's auth surface.
 *
 * The session cookie lives on the dashboard's own origin: the login proxy
 * relays the API's Set-Cookie header, and every later proxy call forwards the
 * Cookie header back. The browser never talks to the Render origin directly,
 * so there is no cross-site cookie, no CORS surface, and no SameSite=None —
 * the same first-party shape the checkout proxy already uses.
 */
const API_URL = () => process.env.API_URL ?? "http://127.0.0.1:4000";
const TIMEOUT_MS = () =>
  Number.parseInt(process.env.API_TIMEOUT_MS ?? "15000", 10);

export const SESSION_COOKIE = "zf_session";

/** Forwards a request to the API, carrying the caller's session cookie. */
export async function proxyToApi(
  path: string,
  init: { method: string; body?: unknown; cookie?: string | null },
): Promise<Response> {
  const requestHeaders: Record<string, string> = {};

  if (init.body !== undefined) {
    requestHeaders["content-type"] = "application/json";
  }

  if (init.cookie) {
    requestHeaders.cookie = init.cookie;
  }

  return fetch(`${API_URL()}${path}`, {
    method: init.method,
    headers: requestHeaders,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS()),
  });
}

/** Copies status, JSON body, and any Set-Cookie header back to the browser. */
export async function relay(upstream: Response): Promise<Response> {
  const body = await upstream.text();
  const responseHeaders = new Headers({ "content-type": "application/json" });
  const setCookie = upstream.headers.get("set-cookie");

  if (setCookie) {
    responseHeaders.set("set-cookie", setCookie);
  }

  return new Response(body, { status: upstream.status, headers: responseHeaders });
}

export type SessionUser = {
  email: string;
  displayName: string;
  role: "viewer" | "operator" | "admin";
};

/**
 * Resolves the signed-in user for a server component, or null.
 *
 * Errors resolve to null rather than throwing: an unreachable API on a page
 * render should show the signed-out state, not a 500 — the public half of the
 * dashboard must never be taken down by the private half.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;

  if (!token) {
    return null;
  }

  try {
    const response = await proxyToApi("/api/v1/auth/me", {
      method: "GET",
      cookie: `${SESSION_COOKIE}=${token}`,
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as SessionUser;
  } catch {
    return null;
  }
}

/** The raw Cookie header of the current server-component request. */
export async function incomingCookieHeader(): Promise<string | null> {
  return (await headers()).get("cookie");
}
