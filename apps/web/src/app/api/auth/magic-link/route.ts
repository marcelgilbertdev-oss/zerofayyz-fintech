import { proxyToApi, relay } from "@/lib/api-session";

/**
 * Requests a sign-in link. Same proxy shape as login: only the expected field
 * is forwarded, and the API's always-202 answer is relayed untouched — this
 * route must not become the enumeration oracle the API refuses to be.
 */
export async function POST(request: Request) {
  let body: { email?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request" }, { status: 400 });
  }

  if (typeof body.email !== "string") {
    return Response.json({ error: "Email is required" }, { status: 400 });
  }

  try {
    const upstream = await proxyToApi("/api/v1/auth/magic-link", {
      method: "POST",
      body: { email: body.email },
      forwardedFor: request.headers.get("x-forwarded-for"),
    });

    return await relay(upstream);
  } catch {
    return Response.json(
      { error: "The payment API is currently unavailable" },
      { status: 503 },
    );
  }
}
