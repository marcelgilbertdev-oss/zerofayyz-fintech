import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const apiUrl = process.env.API_URL ?? "http://127.0.0.1:4000";
  const timeoutMs = Number.parseInt(process.env.API_TIMEOUT_MS ?? "15000", 10);

  // Forward only the amount, and only when it is an integer. The API validates
  // it again against its own bounds; this proxy is a courier, not a gatekeeper.
  let forwarded: Record<string, number> = {};
  try {
    const body = (await request.json()) as { amountMinor?: unknown };
    if (typeof body.amountMinor === "number" && Number.isInteger(body.amountMinor)) {
      forwarded = { amountMinor: body.amountMinor };
    }
  } catch {
    forwarded = {};
  }

  try {
    const response = await fetch(`${apiUrl}/api/v1/payments/checkout-session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(forwarded),
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
