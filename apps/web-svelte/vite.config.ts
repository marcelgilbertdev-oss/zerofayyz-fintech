/// <reference types="vitest/config" />
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte({ hot: false })],
  server: {
    port: 3002,
    // The shared API contract lives above this package's root.
    fs: { allow: [".."] },
    // Same posture as the other clients: the browser only talks to its own
    // origin, so no API origin ships in the bundle and CORS stays closed.
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  // Testing Library needs the browser-condition build of Svelte; in Vitest 3
  // this belongs on the top-level resolve, not inside `test`.
  resolve: { conditions: ["browser"] },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
