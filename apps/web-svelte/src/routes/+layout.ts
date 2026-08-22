/**
 * No prerendering, and no server-side rendering.
 *
 * The dashboard's entire content is a live read of a payments ledger, so there
 * is nothing meaningful to render ahead of time. SSR is off because the static
 * adapter has no server at request time — the fallback document boots the app
 * and the load function below fetches through the same-origin `/api` rewrite.
 */
export const prerender = false;
export const ssr = false;
