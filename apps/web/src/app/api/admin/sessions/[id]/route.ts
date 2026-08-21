import { proxyToApi, relay } from "@/lib/api-session";

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/admin/sessions/[id]">,
) {
  const { id } = await params;

  // The id is a path segment about to be interpolated into an upstream URL;
  // anything that is not a UUID is refused before it can travel.
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return Response.json({ error: "Malformed session id" }, { status: 400 });
  }

  try {
    const upstream = await proxyToApi(`/api/v1/admin/sessions/${id}`, {
      method: "DELETE",
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
