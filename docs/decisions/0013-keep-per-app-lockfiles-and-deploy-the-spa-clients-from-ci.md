# 13. Keep per-app lockfiles, and deploy the SPA clients from CI

Date: 2026-08-28

## Status

Accepted.

## Context

The Vue and Svelte clients cannot be built by Vercel's Git integration. Their
imports reach above the project root into `packages/api-contract`, so a
root-scoped build never uploads those files and fails with `TS2307`; pointing
the root at the repository instead makes framework detection find `apps/api`
and build the Fastify server, producing a deployment with no static output.
Both failures happened on the way to the current arrangement, which is to build
each client locally — where the whole repository exists — and upload the
finished directory with framework detection off.

The deployment runbook named npm workspaces as the principled fix, because
Vercel understands them natively, and deferred it. That deferral had a cost the
runbook stated plainly: the two clients do not auto-deploy, so the instruction
was to run `deploy-clients.sh` after changing them.

On 2026-08-28 that instruction turned out to have been skipped since the commit
that made yen a zero-decimal currency. Both live clients had been serving a
pre-fix bundle showing a gross volume of ¥2,203 where the API said `220300` — a
hundredfold error, on the one currency detail this platform makes a point of,
on two of the three links a reviewer would open. The source on `main` was
correct the whole time.

So the question was reopened: convert to workspaces now, or close the gap
another way.

## Decision

Keep per-app `package.json` and `package-lock.json` files. Close the deploy gap
with a GitHub Actions job — `deploy-clients.yml` — that runs `deploy-clients.sh`
for both clients on every push to `main` touching either client, the shared
contract, or the script itself.

Workspaces is not rejected on its merits. It is rejected as *this* week's
change, because the reason to do it has already been obtained by cheaper means:

- **The payoff was auto-deploy, and CI now provides it.** What conversion would
  add beyond that is tidiness — one lockfile instead of six, seven "install the
  shared contract" steps removed, and `deploy-clients.sh` deleted.
- **The blast radius is the whole delivery path at once.** Six lockfiles, 24
  `npm ci` and cache-path touchpoints across ten CI jobs, Render's
  `buildCommand`, the API's Dockerfile, and both Vercel projects — every one of
  them load-bearing, changed in a single commit, on a platform that is currently
  green and deployed with job applications live against it.
- **One lockfile is not strictly safer.** Installing on macOS prunes Linux-only
  optional dependencies from a lockfile, and that has broken CI four times.
  Today it breaks one app. Consolidated, it would break all of them together.

The counter-argument, recorded honestly: six lockfiles is six things to keep
current, and `deploy-clients.sh` is a script that exists only because of a
layout choice. That is real, and it is why this is deferred rather than closed.

## Consequences

The clients deploy themselves. The failure that prompted this cannot recur
silently: a push that changes either client ships it.

Two properties had to be preserved deliberately in the CI job. The Vercel scope
is named explicitly rather than inherited from the token's default, because a
personally scoped token does not fail against team-owned projects — it creates a
second project of the same name and deploys there, going green while publishing
somewhere nobody is looking. And the matrix does not fail fast, because a
half-updated pair of clients is the exact state the job exists to prevent.

`deploy-clients.sh` now serves two callers from one path: a local `vercel login`
session, or `VERCEL_TOKEN` in CI. The empty-array guard in it is for macOS's
bash 3.2, where `"${auth[@]}"` on an empty array is an unbound variable under
`set -u` — the obvious spelling breaks the script on the machine it is usually
run from.

Revisit workspaces when there is a session to spend on it with a rollback plan,
or when a new client or package makes six lockfiles the larger cost. Until then
the deferral is a decision rather than an outstanding chore.
