import { proxyToApi } from "@/lib/api-session";

/**
 * The landing point of the emailed link.
 *
 * A GET, because mailboxes click GETs — but the actual consumption happens
 * server-side here, as a POST to the API, and the token never reaches any
 * page's markup. On success the API's session cookie is relayed and the
 * browser lands on the admin console, already signed in; anything else lands
 * back on the login page with a reason it can explain.
 *
 * Consuming on GET is a deliberate, bounded CSRF concession: the token in the
 * URL IS the credential, it is single-use, and it expires in minutes — there
 * is nothing for a cross-site request to ride on. The cost that IS real:
 * an overeager mail scanner that prefetches links can burn a token. If that
 * bites, the fix is an interstitial confirm button, recorded here so the
 * trade is visible before it is needed.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token") ?? "";

  const back = (reason: string) =>
    Response.redirect(new URL(`/login?magic=${reason}`, url.origin), 303);

  if (token.length < 20 || token.length > 128) {
    return back("invalid");
  }

  let upstream: Response;
  try {
    upstream = await proxyToApi("/api/v1/auth/magic/consume", {
      method: "POST",
      body: { token },
      forwardedFor: request.headers.get("x-forwarded-for"),
    });
  } catch {
    return back("unavailable");
  }

  if (!upstream.ok) {
    return back("invalid");
  }

  const setCookie = upstream.headers.get("set-cookie");
  const headers = new Headers({ location: new URL("/admin", url.origin).toString() });
  if (setCookie) {
    headers.set("set-cookie", setCookie);
  }
  return new Response(null, { status: 303, headers });
}
