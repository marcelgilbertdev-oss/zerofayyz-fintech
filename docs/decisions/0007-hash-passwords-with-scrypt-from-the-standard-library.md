# 7. Hash passwords with scrypt from the standard library

**Status:** Accepted · **Date:** 2026-08-21

## Context

Phase 2 introduced accounts, so passwords had to be stored. The candidates were the
usual three:

1. **Argon2id** — the current recommendation, and the better algorithm on the merits
2. **bcrypt** — mature, widely deployed, capped at 72 bytes of input
3. **scrypt** — memory-hard, on OWASP's recommended list, and already inside Node

Argon2 was the obvious first choice and was rejected for a reason specific to this
project rather than to the algorithm.

Every Argon2 binding for Node ships as a native module distributed through
platform-specific optional dependencies. That is the exact dependency shape that has
already broken this repository's pipeline twice: a lockfile generated on macOS pruned the
Linux-only binaries, and `npm ci` failed on the runner with a module that existed locally
and nowhere else (failure #2 in the acceptance-test log). A password hash is the last
component that should be able to be absent on one platform and present on another.

## Decision

`node:crypto`'s `scrypt`, with the cost parameters written into each stored hash:

```
scrypt$N=131072,r=8,p=1$<salt-base64>$<hash-base64>
```

No new dependency. The default parameters are OWASP's scrypt baseline (N = 2^17, r = 8,
p = 1), which needs roughly 134 MB per hash, so `maxmem` is raised to match rather than
the parameters quietly lowered to fit Node's 32 MB default.

`promisify(scrypt)` is deliberately **not** used: it selects the overload without the
options argument, so every cost parameter would be silently ignored at runtime while the
code still typechecked. The promise wrapper is written by hand.

## Consequences

The decision is reversible without a migration, which is the point of storing parameters
inside the hash. Raising N later — or moving to Argon2 once the deployment story is
boring — leaves every existing password verifiable, because each hash still describes how
it was made. A global constant would mean the day the cost is raised is the day every
existing user is locked out. `needsRehash()` exists to upgrade hashes opportunistically on
next sign-in.

The cost is honest: Argon2id resists GPU attack better than scrypt at equivalent settings.
For a sandbox portfolio platform with two accounts, one of whose passwords is published on
the login page, that margin is not the binding risk. A hash algorithm that cannot be
installed on the deployment target is.

Sign-in takes a visible second or two on a free-tier CPU. That is the algorithm working,
and the login page says so rather than leaving a reviewer wondering whether it hung.
