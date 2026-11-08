# Retry policies

Every retry uses `retry`, `retryAsync` or `backoffDelayMs` from
[`@flash/flash-commons`](../../libs/flash-commons/README.md#retry): exponential backoff with full jitter and a max attempt
count. The formula and the rules are in that README, and why is in
[decision 017](../explanation/decisions/017-retry-backoff-jitter.md). Each caller owns its numbers, next to the code
that retries:

| Where                                                                                                                          | What is retried                            | Base      | Cap    | Max attempts                                                |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | --------- | ------ | ----------------------------------------------------------- |
| [`apps/flash-web/src/sale/sse.ts`](../../apps/flash-web/src/sale/sse.ts)                                                       | a live stream that dropped                 | 1 s       | 30 s   | 8 per outage; a stream that opens resets the count          |
| [`apps/flash-be/src/application/reservation-service.ts`](../../apps/flash-be/src/application/reservation-service.ts)           | the wait for another instance's rebuild    | 25 ms     | 500 ms | as many as fit in `rebuildWaitMs` (10 at 3 s)               |
| [`apps/flash-be/src/adapters/outbound/redis/redis-client.ts`](../../apps/flash-be/src/adapters/outbound/redis/redis-client.ts) | the reconnect to Redis                     | 50 ms     | 2 s    | none, on purpose (below)                                    |
| [`apps/flash-load/k6/shop.ts`](../../apps/flash-load/k6/shop.ts)                                                               | the join after `429`                       | 2 s       | 8 s    | `JOIN_TRIES` (4: the first and 3 retries)                   |
| [`apps/flash-load/k6/shop.ts`](../../apps/flash-load/k6/shop.ts)                                                               | the payment after `402`                    | 600 ms    | 2.4 s  | `MAX_PAYMENT_ATTEMPTS` (3)                                  |
| [`apps/flash-be-e2e/steps/support/time.ts`](../../apps/flash-be-e2e/steps/support/time.ts) (`pollUntil`)                       | a wait for the API or a stream to be ready | `everyMs` | 1 s    | as many as fit in the window at the mean wait (`checksFor`) |

The Redis reconnect has no max attempt count. The API must catch up when Redis comes back, however long it was down,
and while it is down the sale path already answers from Postgres. A count would leave an instance without its fast gate
until a restart. The wait is still capped and jittered, so many instances do not reconnect at the same moment.
