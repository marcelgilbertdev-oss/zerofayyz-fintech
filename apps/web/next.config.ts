import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev server rejects asset requests whose origin differs from the one it
  // was started on, so a browser pointed at 127.0.0.1 gets a 403 for every
  // bundle and the page never hydrates. Both loopback spellings are the same
  // machine here.
  allowedDevOrigins: ["127.0.0.1", "localhost"],
};

export default nextConfig;
