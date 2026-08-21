/// <reference types="vitest/config" />
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3001,
    // The browser only ever talks to its own origin. Locally Vite proxies /api
    // to the Fastify server; in production the hosting platform rewrites the
    // same path. Same trust posture as the Next.js client: no API origin in
    // the browser, and no CORS opened on the API.
    proxy: {
      "/api": {
        target: process.env.API_URL ?? "http://127.0.0.1:4000",
        changeOrigin: true,
      },
    },
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
