# Running the API on Kubernetes

Production runs on Render today. These manifests exist so that is a choice
rather than a dependency — and because a readiness endpoint's whole purpose is
to be consumed by an orchestrator, so leaving that untested left the design
argument unfinished.

**Everything below was applied to a real cluster and observed.** A manifest
that has only been linted is a YAML exercise.

## Apply it

```bash
kind create cluster --name zerofayyz
```

```bash
docker build -t zerofayyz-api:local apps/api && kind load docker-image zerofayyz-api:local --name zerofayyz
```

```bash
kubectl create secret generic zerofayyz-api-secrets \
  --from-literal=DATABASE_URL="postgresql://zerofayyz_fintech:zerofayyz_fintech@postgres:5432/zerofayyz_fintech" \
  --from-literal=SESSION_SECRET="$(openssl rand -hex 32)"
```

```bash
kubectl apply -f infrastructure/kubernetes/
```

## The decision worth reading

The two probes point at **different endpoints**, and that is the entire reason
this platform has two health endpoints at all:

| Probe | Endpoint | Question | Behaviour when the database is gone |
| --- | --- | --- | --- |
| **readiness** | `/api/v1/ready` | May traffic come here? | **503** → pod leaves the Service's endpoints |
| **liveness** | `/api/v1/health` | Is this process worth keeping? | **200** → pod is left alone |

Wiring liveness to `/ready` is the tempting mistake. It converts a database
blip into a cluster-wide crashloop: every pod fails its liveness probe at once,
every pod is killed, every replacement fails too, and an outage that would have
healed becomes an incident. `/health` answers 200 while degraded on purpose —
a process that can describe its own degradation should be inspected, not shot.

## Observed, 2026-08-22

Deployed to a `kind` cluster, two replicas:

```
NAME            READY   UP-TO-DATE   AVAILABLE
postgres        1/1     1            1
zerofayyz-api   2/2     2            2
```

Then the database was deliberately removed (`kubectl scale deploy postgres
--replicas=0`) to test the claim above:

```
endpoint ready flags: false false
zerofayyz-api-...-5rfnp  ready=false  restarts=0  status=Running
zerofayyz-api-...-l2462  ready=false  restarts=0  status=Running
```

Both pods left the Service's endpoint list, so no traffic was routed to an API
that could not reach the ledger — **and neither was restarted**. That is the
readiness/liveness split doing exactly what it is for.

Restoring the database (`--replicas=1`) returned both pods to the endpoint list
with no intervention and still `restarts=0`.

## Hardening in the manifests

- `runAsNonRoot` with an explicit UID, `seccompProfile: RuntimeDefault`
- `allowPrivilegeEscalation: false`, all capabilities dropped
- `readOnlyRootFilesystem: true`, with an `emptyDir` for `/tmp` because a
  read-only root still needs somewhere to write scratch files
- `maxUnavailable: 0` on rollout — a payments API that dips below capacity
  mid-deploy is a deploy that costs transactions
- Secrets by `secretKeyRef`, non-secret config (the checkout return allowlist)
  by `configMapKeyRef`, so the reviewable part stays reviewable

## What this is not

`postgres-dev.yaml` is for a local cluster only — no persistence, no backups,
no tuning. Production uses Neon, a managed service. Running your own stateful
PostgreSQL is a decision with an operations bill attached, and this platform
has not made it.
