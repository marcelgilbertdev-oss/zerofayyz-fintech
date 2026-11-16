# 24. A dormant repository silently disables its own watchers

Date: 2026-11-16

## Status

Accepted. The warning that prompted it is quoted below; the fix is one commit,
and the part that matters is what makes the next one visible.

## Context

On 15 and 16 November GitHub sent three emails, one per scheduled workflow:

> Scheduled workflows are disabled automatically after 60 days of repository
> inactivity.

— for **API liveness canary**, **Production watch**, and **Load test**.

The last commit here was `c25ea2d` on 23 September. Nothing had touched the
repository in 54 days, because the work had moved elsewhere and the founder was
away from 22 October to 15 November. The schedules were due to stop on
**22 November**.

Nothing was broken. All three workflows ran that morning and passed. This was a
six-day fuse, not a fire — which is exactly what made it dangerous, because the
thing it would have burned is not obvious from the workflow's name.

`production-watch.yml` carries two jobs:

| Job | What it does |
|---|---|
| Smoke the live deployment | 30 checks against production |
| **Keep the receipt portal's Supabase project awake** | **calls `keepalive()` as `anon` — ADR 19** |

A free Supabase project is paused after a week of nothing the provider counts.
So the real chain is:

**the repository goes quiet → GitHub disables the schedules → the keep-alive
stops → Supabase pauses → the receipt portal, a live consumer linked from the
dashboard and the README, goes dark.**

Four steps, each invisible, spread over roughly three weeks, ending in a dead
link on a portfolio piece. Nobody would have been told. The only signal GitHub
gives arrives 45 days into a 60-day clock and looks like routine mail about a
test job.

The shape is familiar. ADR 19 was a keep-alive the provider did not count.
ADR 20 was a probe that cost what it watched. This is a **watcher with an expiry
date nobody was watching** — and it is the first one whose failure is caused by
*not* working on the repository, which is the normal state of a finished thing.

## Decision

**Reset the clock, and make the clock visible.**

- This record is the commit that resets it. A no-op commit would have done the
  same for GitHub and taught nobody anything.
- **The Platform Watch tab now reads days since the last commit** from the same
  public API it already uses for workflow runs, and goes amber at **45 days**.
  Sixty is the deadline; forty-five leaves a fortnight of warning, which
  survives a holiday and a weekly glance. The number is on the screen beside
  the workflow results rather than in an email about a test job.

What was rejected: a scheduled job that commits to its own repository to keep
itself alive. It would work, and it would make every future "is this repo
active?" question unanswerable — the commit log would say yes forever while the
project was dead. A watcher that lies to keep itself running is worse than one
that stops.

## Consequences

The schedules run for another 60 days from this commit, and the countdown is
now a number anyone can look at instead of a date nobody holds.

What was given up: the warning is still a threshold on a human-read screen, not
an alarm. If nobody opens Platform Watch for two months, the fuse burns the
same way. That is an honest limit of a pull-based tab (see its operator guide),
and the mitigation is that the number sits beside the ones already checked
regularly rather than in a separate place.

Worth stating plainly for whoever reads this next: **a finished project is the
exact condition that triggers this.** The platform is not abandoned; it is done
and working, which is why nobody commits to it. Every provider rule that
punishes inactivity — this one, Supabase's pause, Neon's old free-tier
suspension — fires precisely when a thing has stopped needing attention. The
quiet is not evidence that nothing is wrong.
