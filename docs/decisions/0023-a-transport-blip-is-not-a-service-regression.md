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

### What was missing, the same day

The decision above was shipped and then read back against the behaviour the
founder expected from it. He described it as: *"it prevents false alarms, and
then if it has a problem it'll alert us because of the retries."* The first half
was true. The second was not.

As first shipped, this record produced a better **log** and no new **alarm**.
Three cases exist, and only two of them were handled:

| | Outcome as first shipped |
|---|---|
| One blip | retried, run passes, `retries 1` printed — correct |
| A real failure (both attempts fail) | run fails, email sent — correct |
| **A path quietly degrading** — retries climbing 0 → 5 → 20 over days, each still succeeding | **run passes, nothing says so** |

The third case is the one this test now exists to catch, and it was the one left
open. A retry count printed in a *passing* job's log is a number nobody reads;
"watch the trend" is not a control, it is a hope. The same mistake the record
above diagnoses — an assertion narrower than its claim — had been made one level
up, in the claim that retries would surface a degrading path.

**Decision:** a retry *rate* above `MAX_RETRY_RATE` (5% of requests, overridable)
fails the run on its own, with a breach worded as a **path** fault rather than a
service error:

```
health: retry rate 100.0% exceeds 5.0% — requests are succeeding only on retry,
so the path to the service is degrading even though the service is answering
```

The wording is load-bearing. Every request in that breach *succeeded*; reading
"retry rate 12%" as "the service is failing" would send the next person hunting
in the wrong half of the system. Five percent of 120 requests is six — far above
the single blip that prompted this record, far below a path worth ignoring.

**Proven by isolating the third case**, which neither the happy path nor the
earlier always-404 control could demonstrate: a local server that drops the first
attempt of every request and answers the second. Serialised, it reports
`errors 0, retries 12` on every endpoint, breaches **only** the retry rate, and
exits 1 — the service fine, the path not, and the two told apart. The always-404
control is kept, but it is now understood to prove something weaker: it trips
both thresholds at once and so cannot show that the ceiling discriminates.

Consequence: one blip still cannot fail a run, and a path that needs a retry on
more than one request in twenty now fails one — loudly, and in the right words.
