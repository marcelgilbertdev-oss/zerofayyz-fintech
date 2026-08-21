import { proxyToApi, relay } from "@/lib/api-session";

export async function POST(request: Request) {
  try {
    const upstream = await proxyToApi("/api/v1/auth/logout", {
      method: "POST",
      cookie: request.headers.get("cookie"),
      forwardedFor: request.headers.get("x-forwarded-for"),
    });

    return await relay(upstream);
  } catch {
    // The API is unreachable, so the session cannot be revoked server-side —
    // but the person clicked "sign out" and must not stay signed in on this
    // browser. Clear the cookie anyway; the server-side session dies at its
    // 12-hour expiry. Signed out locally beats silently still signed in.
    return Response.json(
      { signedOut: true, revoked: false },
      {
        status: 200,
        headers: {
          "set-cookie":
            "zf_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        },
      },
    );
  }
}
