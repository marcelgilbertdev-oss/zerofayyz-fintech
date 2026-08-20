import { NextResponse } from "next/server";

export async function POST() {
  const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
  const timeoutMs = Number.parseInt(process.env.API_TIMEOUT_MS ?? "15000", 10);

  try {
    const response = await fetch(`${apiUrl}/api/v1/payments/checkout-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
      cache: "no-store",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = (await response.json()) as {
      url?: unknown;
      error?: unknown;
    };

    if (!response.ok || typeof payload.url !== "string") {
      return NextResponse.json(
        {
          error:
            typeof payload.error === "string"
              ? payload.error
              : "Unable to start the Stripe sandbox checkout",
        },
        { status: response.status >= 400 ? response.status : 502 },
      );
    }

    return NextResponse.json({ url: payload.url });
  } catch {
    return NextResponse.json(
      { error: "The payment API is currently unavailable" },
      { status: 503 },
    );
  }
}
