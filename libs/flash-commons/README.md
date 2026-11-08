# @flash/flash-commons

Small behaviour and constants shared by several apps. The main entry, `@flash/flash-commons`, is pure: it has no
timers, no randomness and no I/O of its own. The caller passes in the wait and the random numbers, so the same code runs
in Node, the browser and k6, and flash-be's domain may import it. The one timer helper, `sleep`, sits on its own entry,
`@flash/flash-commons/timers`, so a module that imports the main entry never starts a timer by accident.

It is a workspace package. Build it with `npx nx build flash-commons`. Its Nx targets build `typekit` first. The apps
that import it (all five) build it first too, as they do for typekit.

The library has nine modules, one per concern:

| Module                                     | What it holds                                                                                                                                                                               | Used by                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| [`retry.ts`](src/retry.ts)                 | the backoff, `retry` and `retryAsync`                                                                                                                                                       | flash-be (rebuild wait, Redis reconnect), flash-web (live streams), flash-be-e2e (`pollUntil`), flash-load (k6 join and payment) |
| [`time.ts`](src/time.ts)                   | `MS_PER_SECOND`, `MS_PER_MINUTE`, `MS_PER_HOUR`                                                                                                                                             | flash-be, flash-web, flash-be-e2e, flash-web-e2e, flash-load                                                                     |
| `http-status.ts`                           | `HTTP_STATUS`, `FIRST_ERROR_STATUS`, `FIRST_SERVER_ERROR_STATUS`                                                                                                                            | flash-be, flash-web, flash-load, flash-be-e2e, flash-web-e2e                                                                     |
| [`timers.ts`](src/timers.ts) (`/timers`)   | `sleep`, the one timer helper                                                                                                                                                               | flash-be (mock payment, rebuild wait), flash-web (live streams), flash-be-e2e, flash-load (runner)                               |
| [`decode.ts`](src/decode.ts)               | the decoder kit: `Decoder`, `DecodeError`, `text`, `nonEmptyText`, `integer`, `nonNegativeInteger`, `isoDate`, `uuid`, `literal`, `oneOf`, `optional`, `object`, `tagged`, `both`, `refine` | flash-web (every reply and stream event); flash-be (request bodies)                                                              |
| [`uuid.ts`](src/uuid.ts)                   | `isUuid`, the id rule (sales, holds, products)                                                                                                                                              | flash-be (domain), flash-web (proxy), [`decode.ts`](src/decode.ts) (`uuid`)                                                      |
| [`cookies.ts`](src/cookies.ts)             | `parseSetCookie`, `applySetCookies`, `cookieHeader`, `cookieHeaderOf`: a cookie jar with RFC 6265 path matching                                                                             | the test worlds of flash-be and flash-web, flash-be-e2e, flash-web-e2e                                                           |
| [`api-paths.ts`](src/api-paths.ts)         | `API_PREFIX` (`/api/v1`), `AUTH_BASE_PATH`, `PROBE_PATHS`, `API_PATHS`: every path of the API, named once                                                                                   | flash-be (routes, refresh cookie path), flash-web (clients, proxy list), flash-be-e2e, flash-web-e2e, flash-load                 |
| [`relative-time.ts`](src/relative-time.ts) | `relativeTime`, the time phrases of the scenarios ("in 2 hours", "1 hour ago")                                                                                                              | the test support of flash-be, flash-web and flash-be-e2e (flash-web-e2e through it)                                              |

## API paths

[`api-paths.ts`](src/api-paths.ts) names every route of the API once, so the server, the page, the proxy list and the
tests cannot call one route by two names. Every route sits under `API_PREFIX` (`/api/v1`); the probes in `PROBE_PATHS`
stay at the root. A `:saleId` part is a placeholder the caller fills in. The table holds paths only, no methods.

```ts
import { API_PATHS } from "@flash/flash-commons";

const url = API_PATHS.reservations.replace(":saleId", saleId); // "/api/v1/sales/<id>/reservations"
```

[`api-paths_tests.ts`](src/api-paths_tests.ts) writes the whole table out as literals. A renamed path must change that
test too, so the rename is a deliberate change that a reviewer sees
([decision 019](../../docs/explanation/decisions/019-api-version-prefix.md)).

## Time units

[`time.ts`](src/time.ts) gives the units every app converts with. The API counts seconds and JavaScript counts milliseconds, so every app
converts. One definition keeps the apps the same, and a reader sees `MS_PER_HOUR` rather than a long number. The units convert a length; they are not a contract, so any app may use them.

```ts
import { MS_PER_HOUR, MS_PER_SECOND } from "@flash/flash-commons";

const holdMs = holdSeconds * MS_PER_SECOND; // a hold of `holdSeconds` from the API
const startsAt = new Date(now.getTime() + MS_PER_HOUR); // "in 1 hour"
```

## HTTP status numbers

`http-status.ts` names the standard status numbers the apps act on: `HTTP_STATUS.notFound` is `404`, and so on. It holds
HTTP's numbers only. Which error code answers with which status is the contract of flash-be, so it stays in flash-be, and
the e2e and k6 oracles write the codes they expect themselves. `FIRST_ERROR_STATUS` (400) and
`FIRST_SERVER_ERROR_STATUS` (500) are the lowest statuses of an error and of a server error, for range checks.

```ts
import { FIRST_ERROR_STATUS, HTTP_STATUS } from "@flash/flash-commons";

const refused = reply.status >= FIRST_ERROR_STATUS;
const unauthorized = reply.status === HTTP_STATUS.unauthorized;
```

## Retry

Every retry in this repository uses exponential backoff, a max attempt count and full jitter. One tested
implementation keeps that rule in one place, so the apps, the e2e tests and the k6 script do not each copy it and drift.

The wait before try `n` is `random() * min(capMs, baseMs * 2 ** n)`, where `n` counts from 0 for the wait after the
first failure. That is the "full jitter" scheme. The retry holds no timer: `sleep` and `random` come from the caller, so a test can pin every wait.

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
import { sleep } from "@flash/flash-commons/timers";

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

The caller picks the `sleep`. In Node and the browser it is `sleep` from `@flash/flash-commons/timers`; in a test it is a
fake that records the waits. k6 passes a `sleep` that calls k6's own sleep, and never imports `/timers`.

## Decoding

[`decode.ts`](src/decode.ts) turns a payload of unknown shape into a typed value at the edge, so a corrupted reply, stream event or
request body never enters the app ([decision 018](../../docs/explanation/decisions/018-decode-payloads-at-the-edge.md)).
A `Decoder<T>` takes `unknown` and returns `Ok(value)` or `Err({ path, expected })`, where `path` is dotted
(`sale.stock`) and `expected` is a short phrase ("an integer"). `object` ignores keys it does not name, so a reply that
gains a field breaks no reader; an `optional` field that is absent is left out of the result. `tagged` reads a union
told apart by one field, such as a place by its `state`.

```ts
import { integer, isoDate, object, oneOf, uuid } from "@flash/flash-commons";

const decodeSale = object({
	id: uuid,
	status: oneOf(["upcoming", "active", "sold_out", "ended"]),
	remaining: integer,
	startsAt: isoDate,
});

decodeSale(JSON.parse(text)).match({
	ok: (sale) => showSale(sale),
	err: (error) => refuse(`${error.path}: ${error.expected}`),
});
```

## Test helpers

[`cookies.ts`](src/cookies.ts) and [`relative-time.ts`](src/relative-time.ts) serve the tests of several apps. The cookie jar keeps the cookies a reply sets and
sends each one only to the paths RFC 6265 allows, so a cookie for `/auth` reaches `/auth/refresh` but not `/authx`, the way a browser does, and every test
layer sends the same cookies. `relativeTime` reads a scenario's "in 2 hours" against the moment the layer picks, and
throws on a phrase it does not know, because that is a mistake in the scenario, not a failure to handle. The cookie
names and paths a test expects stay written in the test: they are the API's contract.

## Waiting

[`timers.ts`](src/timers.ts), imported as `@flash/flash-commons/timers`, has `sleep(ms, signal?)`: a promise that resolves after `ms`
milliseconds. When `signal` aborts, it resolves at once and clears its timer, so nothing is left running. It never
rejects; a caller that needs to know whether the wait was cut short checks `signal.aborted`. flash-be's architecture test
refuses it in the domain and the application, which take their waits as arguments.

## Commands

```bash
npx nx build flash-commons           # empties dist/, then tsc into it
npx nx test:quick flash-commons      # typecheck + lint + unit tests
npx nx test:coverage flash-commons   # unit tests with the 99% floor
```

Its tests are plain Vitest tests next to the source (`src/*_tests.ts`). They have no Gherkin scenario, because a retry rule or a constant is a
developer's concern, not a shopper's.
