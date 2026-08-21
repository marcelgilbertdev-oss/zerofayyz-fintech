# 6. One repository, multiple clients, same-origin API access

**Status:** Accepted · **Date:** 2026-08-21

## Context

The platform is growing additional frontends — a Vue 3 client, then Svelte —
alongside the Next.js dashboard. Two questions had to be settled together:
where the clients live, and how browser clients reach the API.

## Decision

**All clients live in this repository**, as `apps/web`, `apps/web-vue`,
`apps/web-svelte`, sharing the one API and one CI pipeline, each deployed to
its own URL.

**Every client talks only to its own origin.** The Next.js client already
renders server-side and proxies checkout. The SPA clients get the same posture:
Vite proxies `/api` in development and the hosting platform rewrites it in
production. **CORS stays closed on the API.**

## Consequences

One repo makes the point that separate repos cannot: one API, one contract,
one test strategy — several frameworks. The API boundary is demonstrably clean
because three different consumers use it unmodified. The cost is a busier CI
matrix and slightly more careful deploy configuration (one project per client,
distinct root directories).

Keeping CORS closed means no per-origin allow-list to maintain, no preflight
traffic, and no API origin in any browser bundle. The cost is that each new
client needs a proxy/rewrite rule — one line of platform config — which is the
right side of the trade for a payments API.

Runtime validation moves into the clients: each SPA validates every response
with Zod at the boundary, because a client compiled against a copy of the
contract has no build-time proof the deployed API still matches it.
