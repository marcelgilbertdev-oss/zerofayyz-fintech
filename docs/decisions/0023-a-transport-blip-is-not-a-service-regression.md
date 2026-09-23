# 23. A transport blip is not a service regression

Date: 2026-09-23

## Status

Accepted. The failure it responds to is in the run log quoted below; the fix is
proven by a negative control rather than by the happy path going green.

## Context

On 2026-09-23 the daily load test failed and emailed "Load test: All jobs have
failed" — GitHub's phrasing for a workflow whose single job failed. The run log:

```
endpoint       reqs  errors    p50    p95    p99    max
health         120       1    247    927   1115   2705
metrics        120       0    249    380   1076   1115
transactions   120       0    249    381    883   1134

THRESHOLD BREACHES:
  - health: error rate 0.8% exceeds 0.0%
```

**One request in 360.** Every latency threshold was met with room to spare —
health's p95 of 927ms against a 1500ms budget. The only breach was that
`maxErrorRate` is exactly `0`, so a single failure fails the run.

Three things place that failure outside the application:

* **Sentry recorded nothing** — no event in the period at all. `/health` returns
  200 even with the database unreachable (ADR 18), so a non-OK answer from it
  means the request never arrived.
* **14 of the last 15 daily runs passed.** This was the first failure in the
  visible history.
* **Re-run against production the same morning:** clean, p95 364 / 270 / 258.

So the assertion `maxErrorRate: 0` was claiming something neither Render's
shared instance nor the public internet between GitHub's runner and it can
promise: that 360 consecutive requests will all complete. It is a true
statement about the service and a false statement about the path to it, and a
gate cannot tell those apart by counting.

The cost of leaving it is not the false alarm itself. It is that a daily job
which cries wolf trains its owner to skim past its emails — and the next one
might be real. The ingestion pack already carries that lesson from a different
direction: *a report with false positives is a report nobody opens.*

## Decision

**A request is retried once before it counts as an error.**

- `attempt()` issues the request; on a non-OK response or a thrown fetch it
  waits `RETRY_DELAY_MS` (250ms) and issues it once more. Only a second failure
  counts. The retry is safe because every scenario here is a `GET`: re-issuing
  one cannot change server state.
- **Retries are counted and printed in their own column**, and a run that needed
  any says so in a closing note. The point is not to hide the blip — it is to
  stop one blip failing the run while keeping a *rising* retry count visible.
  A retry column that climbs run over run is a real signal, and it is one this
  test could not previously produce at all.
- `maxErrorRate` stays at **0**. The threshold was never the wrong number; what
  was wrong was counting a transport failure as a service error. Loosening it to
  1% would have bought the same quiet at the price of silently passing a run
  with a genuine error in it.
- Latency still measures the **first** attempt's wall time, so a retry cannot
  flatter the percentiles.

## Consequences

A single dropped connection no longer fails the daily run. Two consecutive
failures of the same request still do, and so does any sustained error.

What was given up: a run with exactly one transport blip is now
indistinguishable, in its exit code, from a run with none. The retry column and
the closing note are what keep it distinguishable to a reader, which is the
honest trade — the gate stops firing on noise, and the evidence is still on the
page rather than thrown away.

Proven by a **negative control** rather than by the suite going green: pointed
at a path that always 404s, the test reports `errors 10, retries 10` on every
endpoint and exits 1. That demonstrates the retry fires, that retries are
counted, and that a genuine persistent failure is still a failure. A change to
a gate that is only ever tested by watching it pass is a change that has not
been tested.

This is the second time on this platform that a check has been wrong about the
thing it was watching rather than about the code — after ADR 19, where a
keep-alive made a request the provider refused and counted it as activity. Both
are the same shape: **the check's claim was narrower than its assertion.**
