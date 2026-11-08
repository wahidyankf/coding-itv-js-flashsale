# 012: A load verdict read from the data, not from k6 alone

## Status

Accepted. The load runner decides pass or fail from Postgres and Redis after k6 ends, and compares k6 with them.

## Context

The brief asks for stress tests. A client sees only replies, and a reply can be lost or wrong. An oversell, or a shopper who
bought twice, may never show in what k6 saw. The claim of the project is that the data stays right.

## Decision

- `flash-load` starts three API instances behind nginx with Postgres and Redis, runs k6 as a container, then reads the data.
- The checks: `sold` is at most the stock, `sold` equals the purchase rows, no shopper has two purchases, k6 and Postgres
  agree, the stock sold out, floods got `429`, and Redis and Postgres agree on the buyers (not in `chaos`).
- The limits (reserve p95 300 ms, purchase p95 500 ms, no server errors) were fixed before the first run. A failed run is a
  finding, and a limit is never changed to make it pass.
- Five profiles: `smoke`, `full`, `chaos` (Redis stopped mid-run), `burst` and `contention` (700 shoppers inside one second).

## Alternatives considered

- **k6 thresholds only.** They judge what the client saw. They cannot see an extra row in `purchases`.
- **Checks through the API after the run.** They can be wrong in the same way the API can, so they are not independent.
- **Looser limits, or a pass for speed on a laptop.** That would hide a finding. The `burst` and `contention` speed limits
  did not hold in most runs on the author's machine, and the README says so.

## Consequences

- It costs runner code, Docker, and times that are only relative: k6 and every server share one machine's CPUs, so the
  speed of `burst` and `contention` is not a result about production.
- It buys proof that the invariants held in every run. The runs also found two real faults, a payment that waited two seconds
  while Redis was down, and a wrong error for a buyer whose queue place was lost. Both are fixed with scenarios.

## Revisit when

- The load generator can run on its own machine: judge speed again with the same limits.
- The load test is wanted in CI: it needs Docker and a long run, so it would be a scheduled job, not a push hook.

## Related

- [What the load runs found](../load-test-findings.md), [load test reference](../../reference/load-test.md) and the [load specs](../../../specs/apps/flash/load/README.md).
- Code: [`run.ts`](../../../apps/flash-load/scripts/run.ts) and [`profiles.ts`](../../../apps/flash-load/k6/profiles.ts).
