# 017: Every retry uses backoff, full jitter and a max attempt count

## Status

Accepted. A retry waits with exponential backoff and full jitter, and stops after a max attempt count. One deliberate exception: the Redis reconnect.

## Context

A flash sale ends in a crowd of clients that all fail at the same moment and retry at the same moment. A fixed delay
makes them retry in step and hit a recovering server together. A retry that never stops hides a dead server.

## Decision

- The wait before a retry is `random() * min(cap, base * 2^attempt)` (the "full jitter" scheme). It stops after a max attempt count. The code is `retry`, `retryAsync` and `backoffDelayMs` in `@flash/flash-commons`; `retry` is the sync one for k6.
- **The page's reconnect** to a stream: base 1 s, cap 30 s, 8 attempts in a row, reset when a stream delivers a frame the page uses. After that the page says live updates stopped and asks the shopper to reload.
- **`flash-be` waiting for another instance's Redis rebuild** uses backoff with a max attempt count, inside its overall wait.
- **k6** retries a join on `429` and a payment on `402` with backoff and a max count. **The e2e poll-until-ready helper** uses it with each call's deadline.
- **Exception: the Redis client's reconnect** uses the same backoff and jitter (base 50 ms, cap 2 s) but has no max attempt count. It also reconnects after a socket timeout, which the node-redis default never does.

## Alternatives considered

- **Fixed delays.** Clients retry in step and hit a recovering server together.
- **Exponential backoff without jitter.** The same herd, only later.
- **Unbounded retries everywhere.** A client that never stops hides a dead server, and a test that never ends hides a failure.
- **A give-up limit on the Redis reconnect too.** The API must catch up when Redis returns (see [003](003-keep-selling-without-redis.md)). A client that gave up would need a restart to serve from Redis again.

## Consequences

- It costs a policy to choose for each caller, and a Redis reconnect that never ends. In the Redis outage the API keeps
  trying every two seconds at most, which is cheap when the connection is closed.
- It buys no synchronised retry waves, a bounded wait for every caller but one, and one tested implementation instead of copies. The retry holds no timer: the caller passes `sleep` and `random` (in Node and the browser, `sleep` from `@flash/flash-commons/timers`).

## Revisit when

- A real payment provider is added: it has its own retry and idempotency rules.
- The Redis client gains a circuit breaker: the reconnect may then stop while the circuit is open.

## Related

- [`libs/flash-commons/README.md`](../../../libs/flash-commons/README.md), [serving without Redis](../serving-without-redis.md) and [003](003-keep-selling-without-redis.md).
- Code: [`libs/flash-commons/`](../../../libs/flash-commons/), [`redis/`](../../../apps/flash-be/src/adapters/outbound/redis/).
