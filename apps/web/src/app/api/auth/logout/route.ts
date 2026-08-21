import { proxyToApi, relay } from "@/lib/api-session";

export async function POST(request: Request) {
  try {
    const upstream = await proxyToApi("/api/v1/auth/logout", {
      method: "POST",
      cookie: request.headers.get("cookie"),
    });

    return await relay(upstream);
  } catch {
    return Response.json(
      { error: "The payment API is currently unavailable" },
      { status: 503 },
    );
  }
}
