# Resilience crash course

Resilience is how a system keeps doing its job, correctly, when one of its parts fails. The usual tools are: learn
about a failure fast, fall back to a slower path that is still correct, recover by itself when the part returns, and
retry in a way that does not make things worse. Failures are part of the design, not a surprise.

## Why this repo uses it

Redis is one instance, and a flash sale is the worst time to lose it. Redis is a fast gate, not the source of truth:
Postgres holds every hold and purchase, so the gate can be rebuilt from it. The choice
([decision 003](../../explanation/decisions/003-keep-selling-without-redis.md)) is that a Redis outage makes the sale
slower and less fair, but does not stop it or break its rules.

What we did not pick:

- **Fail closed**, with `503` on the sale routes: a Redis outage would become a full outage (003).
- **A client that queues commands until Redis returns**: each payment would wait for Redis to come back
  ([scripts, not `MULTI`](redis.md#scripts-not-multi)).
- **A gate in the memory of each instance**: three instances would each count alone (003).
- **Fixed retry delays, or backoff without jitter**: clients would retry in step and hit a recovering server together
  ([decision 017](../../explanation/decisions/017-retry-backoff-jitter.md)).

What it costs: fairness while Redis is down (the queue lets shoppers through), a slower Postgres path, and the two gaps
that decision 003 names. A process that never saw a failure can keep using a Redis that is behind, and a Redis that
accepts connections but never answers is not detected. The Redis reconnect never gives up, by design.

## How it looks here

**1. Fail at once while Redis is down.** The client has no offline queue, so a command fails in milliseconds instead
of waiting, and the sale path sends single scripts, which fail at once too. The client reconnects with backoff and full
jitter and no max attempt count, so the API catches up when Redis returns. The client setup is in the
[Redis crash course](redis.md#one-client-that-fails-fast-and-never-gives-up).

**2. A failed call is remembered.** The guarded gate wraps the Redis gate. A failed call marks the sale stale, so the
next reserve rebuilds the gate from Postgres instead of trusting a Redis that may have missed writes
([`guarded-gate.ts`](../../../apps/flash-be/src/application/guarded-gate.ts)):

```ts
const marking = async <T>(
	saleId: string,
	call: () => Promise<T>,
): Promise<T> => {
	const outcome = await attemptAsync(call, Error);
	if (outcome.isErr()) {
		stale.add(saleId);
		throw outcome.error;
	}
	return outcome.value;
};
```

`marking` throws the failure on; the service's `attemptAsync` in step 3 turns it into a value.

**3. Fall back to Postgres, which is still correct.** When the gate fails, the reservation service asks the Postgres
repository to decide alone, under the sale row lock
([`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts)):

```ts
const viaRedis = await attemptAsync(() => viaGate(request), Error);
if (viaRedis.isOk() && viaRedis.value.isOk()) {
	return { answer: viaRedis.value.value, written: false };
}

gate.markStale(request.saleId);
const fallback = await repository.reserveWithoutGate(request, () =>
	gate.isReady(request.saleId),
);
```

Other paths fall back too. The queue fails open: without Redis a shopper gets a valid ticket and is admitted
([`queue-service.ts`](../../../apps/flash-be/src/application/queue-service.ts)). The rate limiter counts in a local
store when Redis fails, so an outage never switches the limit off
([`rate-limiter.ts`](../../../apps/flash-be/src/application/rate-limiter.ts)).

**4. Rebuild under a lock, and wait with a bounded retry.** A stale sale is rebuilt from Postgres by one instance,
which takes a rebuild lock in Redis. The others poll with backoff, for at most the rebuild wait (`ensureReady` in
[`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts)):

```ts
if (await gate.lockRebuild(saleId, REBUILD_LOCK_MS, owner)) {
	try {
		await repository.rebuild(saleId, clock(), (snapshot) =>
			gate.restore(saleId, snapshot),
		);
	} finally {
		await gate.unlockRebuild(saleId, owner);
	}
	return true;
}
const polled = await retryAsync(
	async (): Promise<Result<true, "not_ready">> =>
		(await gate.isReady(saleId)) ? new Ok(true) : new Err("not_ready"),
	{
		...REBUILD_POLL,
		maxAttempts: pollTries(options.rebuildWaitMs),
		sleep: options.wait,
		random: options.random,
	},
);
```

`repository.rebuild` reads the snapshot while the sale row is locked, so no hold slips in between the read and the
moment Redis is marked ready.

**5. One retry helper for the whole repository.** Every retry uses `retry`, `retryAsync` or `backoffDelayMs` from
`@flash/flash-commons`: exponential backoff, full jitter and a max attempt count. The helper has no timer of its own;
the caller passes `sleep` and `random` ([`retry.ts`](../../../libs/flash-commons/src/retry.ts)):

```ts
export function backoffDelayMs(
	attempt: number,
	policy: BackoffPolicy,
	random: () => number,
): number {
	const exponent = Math.min(Math.max(attempt, FIRST_ATTEMPT), MAX_EXPONENT);
	const bound = Math.min(
		policy.capMs,
		policy.baseMs * GROWTH_FACTOR ** exponent,
	);
	return random() * bound;
}
```

Each caller's numbers are in [retry policies](../../reference/retry-policies.md). The Redis reconnect is the one
retry with no max.

**6. Tell "alive" from "ready".** `/health` does no I/O, so a slow store never gets a healthy process restarted.
`/ready` checks Postgres and Redis and answers `503` with each result, so a balancer can prefer full instances
([`routes/health.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/health.ts)):

```ts
const database = await attemptAsync(() => deps.checkDatabase(), Error);
const redis = await attemptAsync(() => deps.checkGate(), Error);
// ...
return reply.code(ERROR_STATUS.unavailable).send({ status: "unavailable", checks });
```

## Try it here

The scenarios in [`degraded/serving.feature`](../../../specs/apps/flash/be/behaviours/degraded/serving.feature) each
have the step "And Redis is down". At the unit layer, `switchable` turns the memory gate off. Run them from `apps/flash-be`:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts --reporter=verbose src/bdd/degraded_serving_tests.ts
```

The scenarios it ran, and the trimmed summary:

```text
A shopper joining the queue gets a ticket and is admitted at once
A shopper reserves an item
Reserving again without Redis returns the same hold
Many shoppers reserving at once without Redis never hold more than the stock
A shopper pays for a hold taken before Redis went down
Paying while Redis is down is not slowed down
Requests are still limited
A hold taken while Redis was down is counted when it comes back with its old data
A hold taken while Redis was down survives when it comes back with no data
 Test Files  1 passed (1)
      Tests  75 passed (75)
```

The real test of this design is the `chaos` load profile in
[`profiles.ts`](../../../apps/flash-load/k6/profiles.ts): it stops Redis 4 seconds into the run and starts it again at
9 seconds. It needs Docker and runs the whole stack; the steps are in
[run the load test](../../how-to/run-the-load-test.md). The recorded run sold 1,000 of 1,000 with no server errors
([what the load runs found](../../explanation/load-test-findings.md)).

## Read next

- Marc Brooker, [Exponential Backoff And Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/)
  on the AWS Architecture Blog: why full jitter beats plain backoff.
- Kubernetes, [Liveness, Readiness, and Startup Probes](https://kubernetes.io/docs/concepts/configuration/liveness-readiness-startup-probes/).
- Our pages: [serving without Redis](../../explanation/serving-without-redis.md),
  [liveness and readiness](../../explanation/liveness-and-readiness.md),
  [rate limiting](../../explanation/rate-limiting.md), [failures as values](../../explanation/failures-as-values.md),
  the [typekit crash course](typekit.md) and the [concurrency control crash course](concurrency-control.md).
