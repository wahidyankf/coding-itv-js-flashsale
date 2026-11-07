# 003: Keep selling when Redis is down

## Status

Accepted. A Redis outage makes the sale slower and less fair. It does not stop the sale or break its rules.

## Context

Redis is a fast gate, not the source of truth. A flash sale is the worst time to lose it, and Redis is one instance here.
The brief wants the stock never oversold, and says nothing about what to do when a store fails.

## Decision

- The Redis client fails at once while it is down (`disableOfflineQueue`), so a request learns in milliseconds.
- The queue fails open: the shopper gets a valid ticket and is admitted. Reserve then runs on Postgres alone, under a
  row lock on the sale. Paying already works from Postgres.
- Each failed Redis call marks the sale stale in that process. The next reservation deletes `ready`, and one instance rebuilds the gate from Postgres.
- `GET /ready` answers `503` with `redis: error`, while the process keeps serving.

## Alternatives considered

- **Fail closed (answer `503` to sale routes).** A Redis outage becomes a full outage, for a store that is not the truth.
- **Let the client queue commands until Redis returns.** The first chaos run showed it: a `MULTI` waited for the
  connection, so a payment took about two seconds. Those paths are now single scripts.
- **A gate in the memory of each instance.** Three instances would each count alone, and the holds would not add up.
- **Redis Sentinel or a managed failover only.** It shortens an outage but does not remove it. It is a next step, not a replacement.

## Consequences

- It costs fairness while Redis is down, a slower Postgres path, and one real gap: a process that never saw a failure can
  keep using a Redis that is behind. A Redis that accepts connections but never answers is not detected.
- It buys a sale that continues: the `chaos` profile stops Redis mid-run and still sold 1,000 of 1,000 with no server errors.

## Revisit when

- A black-hole Redis (open but silent) is seen: add a command timeout and a circuit breaker.
- Fairness during an outage matters: keep the queue in a store that can fail over.

## Related

- [Serving without Redis](../serving-without-redis.md) and [what the load runs found](../load-test-findings.md).
- Code: [`redis-client.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-client.ts), [`guarded-gate.ts`](../../../apps/flash-be/src/application/guarded-gate.ts), [`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts), [`reservation-repository.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/reservation-repository.ts).
