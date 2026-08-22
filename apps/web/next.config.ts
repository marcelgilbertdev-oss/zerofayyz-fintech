import type { NextConfig } from "next";

/**
 * Security headers for the dashboard.
 *
 * What is deliberately absent is a script-src policy. Next.js hydrates through
 * inline scripts, so an honest CSP here requires either 'unsafe-inline' —
 * which announces a policy while permitting exactly what CSP exists to stop —
 * or per-request nonces threaded through the app. The nonce work is real and
 * worth doing when the app next grows; a decorative CSP is not. frame-ancestors
 * is the directive with no such caveat, so it is the one that ships.
 */
const securityHeaders = [
  // A response served with a sniffable type can be reinterpreted; close the class.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Nobody may embed the dashboard — the admin console is behind the same
  // origin, and framing an authenticated console is the clickjacking setup.
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  // Checkout returns arrive with ?session_id=…; paths and queries stay out of
  // outbound referrers.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // The dashboard uses none of these; saying so removes them from every
  // embedded context's negotiation.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // The dev server rejects asset requests whose origin differs from the one it
  // was started on, so a browser pointed at 127.0.0.1 gets a 403 for every
  // bundle and the page never hydrates. Both loopback spellings are the same
  // machine here.
  allowedDevOrigins: ["127.0.0.1", "localhost"],

  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
