# Running the API in a container

The platform deploys to Render from source today. This exists so it does not
*have* to: the image is the portable definition of "the API and nothing else."

## Build and run

```bash
docker build -t zerofayyz-api apps/api
```

```bash
docker run --rm -p 4000:4000 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e SESSION_SECRET="$(openssl rand -hex 32)" \
  zerofayyz-api
```

Then `curl localhost:4000/api/v1/ready` → `{"ready":true}`.

## What the image does, and why

| Decision | Reason |
| --- | --- |
| **Multi-stage build** | The shipped image does not contain the toolchain that built it. Fewer packages in the runtime is fewer things to patch. |
| **`npm ci --omit=dev` re-resolve** | TypeScript, tsx and the test tooling never reach the runtime image. Verified: `typescript` and `tsx` are absent from the running container's `node_modules`. |
| **`USER node`** | Runs unprivileged. A container escape does not begin with root in the namespace. |
| **`HOST=0.0.0.0`** | A container that binds to loopback is unreachable from outside itself — it passes every local check and fails every real one. |
| **`HEALTHCHECK` on `/api/v1/ready`, not `/api/v1/health`** | Readiness, not liveness. `/health` deliberately answers 200 while degraded because a process that can describe its own degradation is alive; an orchestrator asking "may I send traffic here" needs the endpoint that says no when the ledger is unreachable. |
| **`.dockerignore`** | Keeps `node_modules`, `.env*` and build output out of the build context — the `.env` line is the one that matters. |

## Verified, not assumed

Built and run locally against real PostgreSQL on 2026-08-22:

- Container reached `healthy` — Docker's own healthcheck polling `/api/v1/ready` and receiving 200 on a 30-second interval
- `whoami` inside the container → `node` (not root)
- `typescript` and `tsx` absent from the runtime `node_modules`
- Image size 274MB
- Structured JSON logs emitted with `service`, `env` and a `reqId` correlating each request's start and completion lines

A Dockerfile that has never been started is decoration; this one has served
traffic.
