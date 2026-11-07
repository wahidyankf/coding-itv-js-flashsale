# @flash/flash-commons

Small behaviour shared by several apps. The library is pure: it has no timers, no randomness and no I/O of its own. The
caller passes in the wait and the random numbers, so the same code runs in Node, the browser and k6.
`@flash/typekit` stays types and `Result` only; behaviour goes here.

It is a workspace package. Build it with `npx nx build flash-commons`. Its Nx targets build `typekit` first.

## Retry

Every retry in this repository uses exponential backoff, a max attempt count and full jitter. One tested
implementation keeps that rule in one place, so the apps, the e2e tests and the k6 script do not each copy it and drift.

The wait before try `n` is `random() * min(capMs, baseMs * 2 ** n)`, where `n` counts from 0 for the wait after the
first failure. That is the "full jitter" scheme. The library holds no timer: `sleep` and `random` come from the caller.

### API

| Name                   | What it is                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------- |
| `backoffDelayMs`       | `(attempt, { baseMs, capMs }, random) => ms`: the jittered wait before the next try                     |
| `retry`                | sync. Runs a task that returns a `Result` until it is `Ok`, the tries run out, or `shouldRetry` refuses |
| `retryAsync`           | the same for a task that returns a `Promise<Result>`, with an optional `AbortSignal`                    |
| `BackoffPolicy`        | `{ baseMs, capMs }`, in milliseconds                                                                    |
| `RetryPolicy`          | `BackoffPolicy` plus `maxAttempts`, the total tries including the first                                 |
| `RetryOptions<E>`      | the options of `retry`: a `RetryPolicy`, `sleep: (ms) => void`, `random`, and `shouldRetry`             |
| `RetryAsyncOptions<E>` | the options of `retryAsync`: as above, with `sleep: (ms) => Promise<void>` and `signal`                 |

The rules, which the tests pin down:

- The task gets its 0-based attempt number. The first try always runs.
- `retry` returns the first `Ok`, or the last `Err` after the tries run out. It never throws and catches nothing.
- No wait follows the last failed try, and no wait follows an `Err` that `shouldRetry` refuses.
- `maxAttempts` that is not a finite number of at least 1 (for example `0`, `NaN` or `Infinity`) means one try and no
  wait. A fraction is rounded down. An unbounded retry is refused, so `retry` always ends.
- An aborted `signal` stops further tries. It is checked before each wait and again after it, and the last `Result`
  is returned.

### Example

```ts
import { retryAsync } from "@flash/flash-commons";

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

const result = await retryAsync((attempt) => readSale(attempt), {
	baseMs: 100,
	capMs: 2_000,
	maxAttempts: 5,
	shouldRetry: (error) => error === "unavailable",
	sleep,
	random: Math.random,
});

result.match({
	ok: (sale) => showSale(sale),
	err: (error) => showFailure(error),
});
```

The `setTimeout` lives in the caller's `sleep`, not in the library. In k6, the caller passes a `sleep` that calls k6's
own sleep, and `random` can be `Math.random` as well.

## Commands

```bash
npx nx build flash-commons           # tsc to dist/
npx nx test:quick flash-commons      # typecheck + lint + unit tests
npx nx test:coverage flash-commons   # unit tests with the 99% floor
```

Its tests are plain Vitest tests next to the source (`src/retry_tests.ts`, `src/index_tests.ts`). They have no Gherkin
scenario, because a retry rule is a developer's concern, not a shopper's.
