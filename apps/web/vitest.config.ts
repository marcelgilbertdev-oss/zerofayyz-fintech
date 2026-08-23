import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Globs are quoted here for the same reason they are quoted in the API's
    // test script: an unquoted glob is expanded by the shell against the
    // current directory, and a pattern that matches nothing silently passes.
    include: ["src/**/*.test.ts"],
  },
});
