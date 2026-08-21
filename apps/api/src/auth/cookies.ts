/**
 * Cookie reading and writing, by hand.
 *
 * @fastify/cookie would do this too, and it is a good plugin. It is also
 * another dependency in a lockfile that has already broken this project's CI
 * twice over platform-specific packages. Parsing one header and formatting one
 * Set-Cookie is about thirty lines, and thirty lines that cannot go missing on
 * a Linux runner are worth more here than the convenience.
 */

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(";")) {
    const separator = part.indexOf("=");

    if (separator === -1) {
      continue;
    }

    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim());
    }
  }

  return undefined;
}

type CookieOptions = {
  maxAgeSeconds?: number;
  expires?: Date;
};

export function serializeSessionCookie(
  name: string,
  value: string,
  { maxAgeSeconds, expires }: CookieOptions = {},
): string {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    // Unreadable to JavaScript, so a cross-site scripting bug cannot walk off
    // with the session even if one exists.
    "HttpOnly",
    // Sent only over TLS. Set unconditionally rather than only in production:
    // a cookie that is Secure in one environment and not another is a
    // difference that gets discovered in the wrong one.
    "Secure",
    // Lax, not Strict: the Stripe checkout redirect is a cross-site navigation
    // back into this app, and Strict would drop the session on the way home.
    // Lax still withholds the cookie from cross-site POSTs, which is the
    // request shape that CSRF actually needs.
    "SameSite=Lax",
  ];

  if (maxAgeSeconds !== undefined) {
    attributes.push(`Max-Age=${maxAgeSeconds}`);
  }

  if (expires) {
    attributes.push(`Expires=${expires.toUTCString()}`);
  }

  return attributes.join("; ");
}

/** A cookie already in the past — the only reliable way to delete one. */
export function expiredSessionCookie(name: string): string {
  return serializeSessionCookie(name, "", {
    maxAgeSeconds: 0,
    expires: new Date(0),
  });
}
