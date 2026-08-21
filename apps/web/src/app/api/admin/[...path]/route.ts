import { proxyToApi, relay } from "@/lib/api-session";

/**
 * One authenticated proxy for the whole admin surface.
 *
 * Every request forwards the caller's session cookie and lands on
 * /api/v1/admin/<path>; the API's role guards decide everything. The path is
 * validated to plain segments so this cannot be steered anywhere else, and
 * only JSON travels in either direction.
 */
const SEGMENT = /^[a-z0-9-]+$/i;

async function forward(
  request: Request,
  path: string[],
  method: "GET" | "POST" | "PATCH" | "DELETE",
) {
  if (path.length === 0 || path.some((segment) => !SEGMENT.test(segment))) {
    return Response.json({ error: "Malformed path" }, { status: 400 });
  }

  let body: unknown;

  if (method === "POST" || method === "PATCH") {
    try {
      const text = await request.text();
      body = text === "" ? {} : (JSON.parse(text) as unknown);
    } catch {
      return Response.json({ error: "Malformed request body" }, { status: 400 });
    }
  }

  try {
    const upstream = await proxyToApi(`/api/v1/admin/${path.join("/")}`, {
      method,
      cookie: request.headers.get("cookie"),
      ...(body === undefined ? {} : { body }),
    });

    return await relay(upstream);
  } catch {
    return Response.json(
      { error: "The payment API is currently unavailable" },
      { status: 503 },
    );
  }
}

type Context = RouteContext<"/api/admin/[...path]">;

export async function GET(request: Request, { params }: Context) {
  return forward(request, (await params).path, "GET");
}

export async function POST(request: Request, { params }: Context) {
  return forward(request, (await params).path, "POST");
}

export async function PATCH(request: Request, { params }: Context) {
  return forward(request, (await params).path, "PATCH");
}

export async function DELETE(request: Request, { params }: Context) {
  return forward(request, (await params).path, "DELETE");
}
