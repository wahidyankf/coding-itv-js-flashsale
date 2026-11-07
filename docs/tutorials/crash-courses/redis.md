# Redis crash course

Redis is an in-memory store of keys, where a key holds a string, a set, a sorted set or a hash. `flash-be` talks to it
with node-redis. This page explains why the sale has a Redis in front of Postgres and how the code uses it. The official
docs teach the rest.

## Why this repo uses it

**The problem.** In the first seconds of a sale, hundreds of shoppers ask for the last items at once. If every reserve
took the row lock on the one sale row in Postgres, they would all wait in line on it. The queue must give every API
instance one shared line, and the rate limits must count across instances.

**What Redis gives us here.** One Lua script counts the buyers and the live holds and adds a hold, as one step, so two
requests cannot take the last item and the rush stays off the sale row. Redis also holds the queue and its admissions,
the rate counters shared by every instance, and a short cache of logins. Postgres keeps the last word: decision
[002](../../explanation/decisions/002-redis-gate-postgres-last-word.md).

**What we did not pick.**

- A Postgres row lock only, or Redis only (002).
- Answering `503` to the sale routes while Redis is down, a gate in the memory of each instance, or a client that queues
  commands until Redis returns ([003](../../explanation/decisions/003-keep-selling-without-redis.md)).

**What it costs us.** A second store, a second write for each hold, and code to rebuild Redis from Postgres. While Redis
is down the queue is skipped, so fairness is lost. Decision 003 lists the gaps that are left.

## The ideas this repo uses

### One client that fails fast and never gives up

[`redis-client.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-client.ts) makes the one connection of the
process. Every other Redis adapter takes this client:

```ts
const client = createClient({
	url,
	disableOfflineQueue: true,
	socket: { reconnectStrategy: reconnectStrategy(Math.random) },
});
// Without a listener, a dropped socket emits an unhandled 'error' and exits the process.
client.on("error", (err) => console.error("redis:", err.message));
await client.connect();
```

`disableOfflineQueue` makes a command fail at once while the connection is down, so a request learns in milliseconds
and takes its Postgres path. The reconnect waits grow from 50 ms to 2 s with full jitter
([017](../../explanation/decisions/017-retry-backoff-jitter.md)), with no max count.

### Key names

Every key of one sale starts with `sale:<saleId>:`, built by `saleKey` in
[`redis-keys.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-keys.ts):

- the hold gate: `ready`, `buyers`, `holds`, `ids`, `rebuild-lock`;
- the queue: `queue`, `queue-seq`, `admitted`, `admit-lead`.

The login cache uses `session:<access hash>`
([`redis-session-cache.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-session-cache.ts)), and the rate
counters use `ratelimit:` plus a name such as `address:<saleId>:<ip>` or `user:<saleId>:<user>`
([`rate-limiter.ts`](../../../apps/flash-be/src/application/rate-limiter.ts)).

### Lua scripts with `eval`

A script runs inside Redis, and no other command runs until it ends. That makes "read, decide, write" one step. The
keys go in `keys` and the values in `arguments`, and the script reads them as `KEYS[n]` and `ARGV[n]`. The reserve script
in [`redis-hold-gate.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts), trimmed:

```lua
if redis.call('EXISTS', KEYS[1]) == 0 then return {4} end
if redis.call('SISMEMBER', KEYS[2], ARGV[1]) == 1 then return {2} end
local now = tonumber(ARGV[2])
-- ... the shopper's own live hold answers {3, id, expiresAt} ...
local used = redis.call('SCARD', KEYS[2]) + redis.call('ZCOUNT', KEYS[3], now, '+inf')
if used >= tonumber(ARGV[4]) then return {0} end
redis.call('ZADD', KEYS[3], ARGV[3], ARGV[1])
redis.call('HSET', KEYS[4], ARGV[1], ARGV[5])
return {1, ARGV[5], ARGV[3]}
```

The reply is a list of numbers and text. `gateAnswerOf` reads it into the domain's answer, and a reply the script does
not write is a failure value, never a guess. The queue has `JOIN`, `PLACE` and `ADMIT` in
[`redis-queue-store.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-queue-store.ts), and the rate limit has
`HIT` in [`redis-rate-limit-store.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-rate-limit-store.ts).

### Scripts, not `MULTI`

Even writes that need no decision, such as `CONFIRM` and `RELEASE`, are scripts. node-redis holds a `MULTI` until the
connection is back, so a payment inside one would wait for Redis (about 1.8 s at the 95th percentile in a load run). A
script fails at once, like every other gate call
([what the load runs found](../../explanation/load-test-findings.md#paying-during-a-redis-outage-was-slow)).

### Sorted sets as time and order

A sorted set keeps each member with a number, its score. The code uses the score in three ways:

- `holds`: the score is when the hold ends. `ZCOUNT holds now +inf` counts the live ones, so an expired hold stops
  counting with no sweep job.
- `queue`: the score is an arrival number from `INCR queue-seq`, so two shoppers in the same millisecond keep their
  order. `ZRANK` gives the place.
- `admitted`: the score is when the admission ends. `ADMIT` first drops the ended ones with `ZREMRANGEBYSCORE`.

### Keys that expire by themselves

A lock or a counter must not outlive the instance that made it:

- `SET ... NX PX` takes the `rebuild-lock` and the `admit-lead`, so a crashed instance does not hold them.
- `HIT` calls `PEXPIRE` on the first hit, so the rate window starts there and the key goes away with it.
- The login cache writes with `{ EX: ttl }`, 60 seconds at most.

### A fast gate that Postgres rebuilds

Redis can come back empty. The `ready` key says the gate of a sale is complete; without it the script answers `{4}`, and
one instance takes the rebuild lock, reads Postgres under the sale's row lock and runs `RESTORE`, which writes the
buyers, the holds and `ready` in one call. The rules are in
[reservations and recovery](../../explanation/reservations-and-recovery.md#when-redis-loses-its-state). A Redis that
comes back with old data is caught too: the [resilience crash course](resilience.md#how-it-looks-here) shows how a
failed call marks the sale stale.

## Try it here

With the dev stack up (`npx nx db:up flash-be`), list the keys of the sales on your machine. Your ids will differ:

```bash
docker compose -f compose.dev.yaml exec redis redis-cli --scan --pattern 'sale:*'
```

```text
sale:ed225112-64e6-40d8-8cf3-30c4fe023bdb:queue-seq
sale:ed225112-64e6-40d8-8cf3-30c4fe023bdb:ready
sale:ed225112-64e6-40d8-8cf3-30c4fe023bdb:buyers
sale:ed225112-64e6-40d8-8cf3-30c4fe023bdb:admitted
```

Read one sorted set with its scores, which are times in milliseconds:

```bash
docker compose -f compose.dev.yaml exec redis redis-cli type sale:ed225112-64e6-40d8-8cf3-30c4fe023bdb:admitted
docker compose -f compose.dev.yaml exec redis redis-cli zrange sale:ed225112-64e6-40d8-8cf3-30c4fe023bdb:admitted 0 -1 withscores
```

```text
zset
ana
1793895067559
cai
1793895145629
```

Then run the rebuild tests against the real Redis. They use database index 15, never your data in index 0:

```bash
cd apps/flash-be
npx vitest run --config vitest.integration.config.ts src/adapters/outbound/redis/redis-hold-gate_integration_tests.ts --reporter=verbose
```

```text
 ✓ |integration| ... > the rebuild of the Redis gate > writes the buyers, the holds and the ready mark, and drops what the snapshot does not hold 6ms
 ✓ |integration| ... > the rebuild lock > is taken by one owner, and a stale owner cannot release it 2ms
      Tests  2 passed (2)
```

## Traps to avoid

- **The default reconnect gives up.** After a socket timeout the node-redis default strategy answers `false` and never
  reconnects, so the API would stay without Redis until a restart. `reconnectStrategy` answers a wait for every cause.
- **A lost queue must not hide a purchase.** A Redis restart can empty the queue, so a shopper who just bought has no
  place in line. The reservation service then asks Postgres, and `reserveRefusalOf` in
  [`domain/queue.ts`](../../../apps/flash-be/src/domain/queue.ts) answers `409 already_purchased`, not
  `403 not_admitted`.
- **Redis and Postgres differ by one millisecond.** The script counts a hold that ends exactly now as live (`>=`), and
  Postgres does not (`>`). The gap errs on the safe side: Redis may refuse, but never oversells.

## Read next

- [The node-redis guide](https://redis.io/docs/latest/develop/clients/nodejs/) and its
  [client options](https://github.com/redis/node-redis/blob/master/docs/client-configuration.md). This repo has
  `redis` 6.3.
- Redis docs: [scripting with Lua](https://redis.io/docs/latest/develop/programmability/eval-intro/) and
  [sorted sets](https://redis.io/docs/latest/develop/data-types/sorted-sets/).
- [Serving without Redis](../../explanation/serving-without-redis.md), [the waiting queue](../../explanation/waiting-queue.md)
  and [rate limiting](../../explanation/rate-limiting.md).
- [Retry policies](../../reference/retry-policies.md) for the reconnect wait, and
  [`libs/flash-commons/README.md`](../../../libs/flash-commons/README.md) for `backoffDelayMs`.
