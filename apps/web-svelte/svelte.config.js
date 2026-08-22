import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/**
 * SvelteKit in single-page mode.
 *
 * `adapter-static` with a fallback document, rather than a server adapter,
 * because this client deploys the same way its siblings do: built locally and
 * uploaded prebuilt. The shared API contract lives above this package's root,
 * so a platform that builds from the package directory never sees it — the
 * reasoning is in docs/runbooks/DEPLOYMENT.md, and it is the same constraint
 * that shapes the Vue client.
 *
 * Prerendering is off because every figure on the page is a live read from
 * PostgreSQL; a prerendered snapshot of a payments dashboard would be a
 * screenshot pretending to be an application.
 */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
      strict: false,
    }),
  },
};
