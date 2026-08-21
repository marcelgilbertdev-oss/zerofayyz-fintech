import { proxyToApi, relay } from "@/lib/api-session";

export async function POST(request: Request) {
  // Only the two expected fields are forwarded, as strings, and nothing else.
  // The password passes through this process's memory and is never logged,
  // stored, or inspected here; verification happens in the API.
  let body: { email?: unknown; password?: unknown };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Malformed request" }, { status: 400 });
  }

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return Response.json({ error: "Email and password are required" }, { status: 400 });
  }

  try {
    const upstream = await proxyToApi("/api/v1/auth/login", {
      method: "POST",
      body: { email: body.email, password: body.password },
    });

    return await relay(upstream);
  } catch {
    return Response.json(
      { error: "The payment API is currently unavailable" },
      { status: 503 },
    );
  }
}
