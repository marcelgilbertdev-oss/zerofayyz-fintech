import { NextResponse, type NextRequest } from "next/server";

import { DEFAULT_LOCALE, isLocale, resolveLocale, type Locale } from "@/i18n/locale";

export const LOCALE_HEADER = "x-locale";
export const LOCALE_COOKIE = "locale";

/**
 * Locale negotiation happens once, here, and the result is attached to the
 * request so the layout and the page cannot disagree.
 *
 * A root layout never receives searchParams, so without this the <html lang>
 * attribute would keep saying "en" while the page rendered Japanese — which is
 * an accessibility defect, not a cosmetic one.
 *
 * Precedence: explicit ?lang= → remembered cookie → Accept-Language → default.
 */
export function proxy(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get("lang");
  const remembered = request.cookies.get(LOCALE_COOKIE)?.value;

  const locale: Locale = isLocale(requested)
    ? requested
    : isLocale(remembered)
      ? remembered
      : resolveLocale(undefined, request.headers.get("accept-language"));

  const headers = new Headers(request.headers);
  headers.set(LOCALE_HEADER, locale);

  const response = NextResponse.next({ request: { headers } });

  // Only an explicit choice is remembered. Inferring from Accept-Language and
  // then persisting it would quietly override the browser on every later visit.
  if (isLocale(requested) && requested !== remembered) {
    response.cookies.set(LOCALE_COOKIE, requested, {
      path: "/",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
    });
  }

  return response;
}

export const config = {
  // Skip static assets and API routes; only page requests need a locale.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

export { DEFAULT_LOCALE };
