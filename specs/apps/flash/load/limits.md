# Limits

The limits a load run must meet. They were written before the first run and are not changed to make a run pass. The
code reads them from `LIMITS` in [`apps/flash-load/k6/profiles.ts`](../../../../apps/flash-load/k6/profiles.ts).

| Measure                       | Limit        | Profiles                          |
| ----------------------------- | ------------ | --------------------------------- |
| Reserve, 95th percentile      | under 300 ms | smoke, full, burst and contention |
| Purchase, 95th percentile     | under 500 ms | smoke, full, burst and contention |
| Server errors (5xx, no reply) | 0            | smoke, full, burst and contention |

The purchase time includes the mock payment, which takes 150 ms.

## Why chaos is not judged on speed

The chaos profile stops Redis on purpose. A few requests in flight may then fail, and that is the behaviour being tested.
k6 still reports its numbers, but the verdict of a chaos run comes only from the invariants in [checks](checks.md).

## When a limit fails

Record the real numbers in `docs/explanation/load-test-findings.md` and find the cause. A slow reserve is a finding about
the system.
