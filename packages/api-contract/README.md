# api-contract

The single Zod description of what `apps/api` returns, shared by every browser
client.

Each SPA compiles against a *copy* of the API's types — nothing at build time
proves the deployed API still matches. These schemas turn that assumption into a
runtime check at the network boundary, so a drifted response fails loudly with a
named field instead of surfacing as `undefined` three components deep.

Kept here rather than duplicated per client so the contract cannot drift between
frontends. Imported by relative path rather than as a workspace package: the
clients deploy independently with their own lockfiles, and a workspace refactor
would complicate that for no gain at this size.

Used by `apps/web-vue` and `apps/web-svelte`. The Next.js client in `apps/web`
validates server-side against the same shapes.
