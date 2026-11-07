# flash-commons

`@flash/flash-commons` in `libs/flash-commons` holds the small behaviour and values that several apps share. It is
pure: no timers, no randomness and no I/O of its own, so the same code runs in Node, the browser and k6. Its API, with
examples, is in [its README](../../libs/flash-commons/README.md). This page lists what it exports and where each retry
policy is set. Why every retry backs off with jitter is in
[decision 017](../explanation/decisions/017-retry-backoff-jitter.md).

```ts
import { HTTP_STATUS, MS_PER_SECOND, retryAsync } from "@flash/flash-commons";
```

## Exports

| Module           | Exports                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `retry.ts`       | `backoffDelayMs`, `retry`, `retryAsync`, `BackoffPolicy`, `RetryPolicy`, `RetryOptions`, `RetryAsyncOptions` |
| `time.ts`        | `MS_PER_SECOND`, `MS_PER_MINUTE`, `MS_PER_HOUR`                                                              |
| `http-status.ts` | `HTTP_STATUS`, `FIRST_ERROR_STATUS`, `FIRST_SERVER_ERROR_STATUS`                                             |

The wait before try `n` (from 0) is `random() * min(capMs, baseMs * 2 ** n)`, the "full jitter" scheme. A `maxAttempts`
that is not a finite number of at least 1 means one try.

## Retry policies

Each caller owns its numbers, next to the code that retries.

| Where                                                       | What is retried                            | Base      | Cap    | Max attempts                                       |
| ----------------------------------------------------------- | ------------------------------------------ | --------- | ------ | -------------------------------------------------- |
| `apps/flash-web/src/sale/sse.ts`                            | a live stream that dropped                 | 1 s       | 30 s   | 8 per outage; a stream that opens resets the count |
| `apps/flash-be/src/application/reservation-service.ts`      | the wait for another instance's rebuild    | 25 ms     | 500 ms | as many as fit in `rebuildWaitMs` (10 at 3 s)      |
| `apps/flash-be/src/adapters/outbound/redis/redis-client.ts` | the reconnect to Redis                     | 50 ms     | 2 s    | none, on purpose (below)                           |
| `apps/flash-load/k6/shop.ts`                                | the join after `429`                       | 2 s       | 8 s    | `JOIN_TRIES` (4: the first and 3 retries)          |
| `apps/flash-load/k6/shop.ts`                                | the payment after `402`                    | 600 ms    | 2.4 s  | `MAX_PAYMENT_ATTEMPTS` (3)                         |
| `apps/flash-be-e2e/steps/support/time.ts` (`pollUntil`)     | a wait for the API or a stream to be ready | `everyMs` | 1 s    | the window divided by `everyMs`                    |

The Redis reconnect has no max attempt count. The API must catch up when Redis comes back, however long it was down,
and while it is down the sale path already answers from Postgres. A count would leave an instance without its fast gate
until a restart. The wait is still capped and jittered, so many instances do not reconnect at the same moment.

After its last attempt, the page says "Live updates stopped. Reload the page to see the latest sale."
