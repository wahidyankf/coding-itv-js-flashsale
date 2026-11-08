# Prepare the defense

Get ready to show this repository in a coding interview and to answer questions about it. The demo itself is in
[run the demo](run-the-demo.md). This page covers what to set up beforehand, an order for the session, the questions to
expect with a short answer and where the proof is, and what to do when something fails live.

## The day before

You need the tools from the [tutorial](../tutorials/run-flash-sale-locally.md) (Volta, Docker, Git), Neovim with
[kulala.nvim](https://github.com/wahidyankf/kulala.nvim) for [`api-flash-demo.http`](../../api-flash-demo.http), and a
browser.

```bash
npm install
cp .env.example .env
npm run demo:setup   # Postgres and Redis, migrations, the operator ops, a sale of 3 items
npm run demo:load    # builds the load images once, and writes generated-reports/load/smoke.md
```

`demo:load` takes a few minutes. Running it the day before builds the images, so the live run is shorter, and it leaves a
report you can show if the live run cannot finish. Then follow [before the audience arrives](run-the-demo.md#before-the-audience-arrives)
once, all the way to the end, so the names `ana` and `ben` and the sale are in the state the demo expects. On the day,
start again from `npm run demo:reset` and `npm run demo:setup`.

Keep these open in tabs: [REQUIREMENTS.md](../../REQUIREMENTS.md), the [README](../../README.md) (the diagram), the
[decision records](../explanation/decisions/README.md), and [what the load runs found](../explanation/load-test-findings.md).

## An order for the session

1. **The problem and the two promises.** Never sell more than the stock, never sell one shopper twice. [REQUIREMENTS.md](../../REQUIREMENTS.md)
   maps each line of the task to its proof, and says what was added and what was left out.
2. **The demo.** [Run the demo](run-the-demo.md), sections 1 to 3: buy on the page, the API request by request, Redis down.
3. **How a purchase works.** [The diagram and the steps](../../README.md#how-a-purchase-works), then the three files that
   keep the promises: [`domain/sale.ts`](../../apps/flash-be/src/domain/sale.ts),
   [`redis-hold-gate.ts`](../../apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts) and
   [`purchase-repository.ts`](../../apps/flash-be/src/adapters/outbound/postgres/purchase-repository.ts).
4. **The proof.** One scenario in [`specs/apps/flash/be/behaviours/`](../../specs/apps/flash/be/behaviours/README.md),
   bound at three layers, and the load run of [run the demo](run-the-demo.md#4-proof-under-load), section 4, judged by the
   data.
5. **Trade-offs and limits.** [Design choices](../../README.md#design-choices-and-trade-offs),
   [what was left out](../../README.md#what-was-left-out-and-why) and
   [where it stops](../../README.md#how-it-scales-and-where-it-stops).

## Questions to expect

| Question                                                  | Short answer                                                                                                                                                                                                                  | Proof                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How can it never oversell?                                | Redis takes a hold in one Lua script. Postgres has the last word: `UPDATE ... WHERE sold < stock` in one transaction, and `CHECK (sold <= stock)` on the table, whatever Redis says.                                          | [002](../explanation/decisions/002-redis-gate-postgres-last-word.md), [`purchase-repository.ts`](../../apps/flash-be/src/adapters/outbound/postgres/purchase-repository.ts), the concurrency scenarios in [`reservation/`](../../specs/apps/flash/be/behaviours/reservation/README.md) |
| How is one shopper kept to one item?                      | A partial unique index on `(sale_id, user_id)` for purchases and for holds, and a Redis set of buyers in front of it. Paying twice for one hold returns the same purchase, because the reservation id is the idempotency key. | [data model](../../specs/apps/flash/c4/data-model.md#constraints), [payment and refunds](../explanation/payment-and-refunds.md#idempotency)                                                                                                                                            |
| Why three calls and not one buy endpoint?                 | A queue smooths the rush and cannot be skipped, a hold keeps a shopper from paying for an item that is gone, and an abandoned hold frees its item by itself.                                                                  | [001](../explanation/decisions/001-queue-hold-pay.md), [waiting queue](../explanation/waiting-queue.md)                                                                                                                                                                                |
| What happens when Redis dies?                             | The queue lets shoppers in, reserve runs on Postgres under a row lock, `/ready` answers `503`, and the gate is rebuilt from Postgres when Redis is back. It costs speed, not correctness.                                     | [003](../explanation/decisions/003-keep-selling-without-redis.md), [serving without Redis](../explanation/serving-without-redis.md), demo section 3, the `chaos` load profile                                                                                                          |
| What happens when Postgres dies?                          | Nothing can be sold, by design: Postgres has the last word. `/ready` answers `503`, so a balancer can take the instance out.                                                                                                  | [liveness and readiness](../explanation/liveness-and-readiness.md), [where it stops](../../README.md#how-it-scales-and-where-it-stops)                                                                                                                                                 |
| What if the payment fails, or the hold ends while paying? | A decline gives `402` and the hold stays. If the commit then finds the item gone or the shopper already served, the charge is refunded. A lost reply after a commit is found again by the reservation id.                     | [payment and refunds](../explanation/payment-and-refunds.md#when-a-step-fails)                                                                                                                                                                                                         |
| Who cleans up expired holds?                              | Nobody needs to: an expired hold stops counting by its expiry time, in Redis and in Postgres.                                                                                                                                 | [reservations and recovery](../explanation/reservations-and-recovery.md)                                                                                                                                                                                                               |
| How does it scale?                                        | Add API instances behind nginx; they are stateless. One sale is capped by one Postgres row, which is the price of never overselling.                                                                                          | [how it scales](../../README.md#how-it-scales-and-where-it-stops)                                                                                                                                                                                                                      |
| Why a password, when the task asks for a user identifier? | Without one, anyone could act as any shopper. Two `HttpOnly` cookies, only token hashes stored.                                                                                                                               | [007](../explanation/decisions/007-accounts-and-cookie-sessions.md), [authentication](../explanation/authentication.md)                                                                                                                                                                |
| Why Server-Sent Events?                                   | The page only listens, so one HTTP stream is enough, and many watchers share one read a second.                                                                                                                               | [008](../explanation/decisions/008-server-sent-events.md), [live updates](../explanation/live-updates.md)                                                                                                                                                                              |
| Why does the browser go through the web server?           | The API needs no CORS and no public address, and an allow-list keeps the operator routes away from the browser.                                                                                                               | [006](../explanation/decisions/006-browser-talks-to-web-server-only.md), [the web server in front of the API](../explanation/web-server-proxy.md)                                                                                                                                      |
| Why `/api/v1`, and one path table?                        | A breaking change gets `/api/v2` next to it. The table in `flash-commons` gives each route one name everywhere, and a literal test makes a rename visible in review.                                                          | [019](../explanation/decisions/019-api-version-prefix.md)                                                                                                                                                                                                                              |
| Why a hexagon, and `Result` instead of exceptions?        | The sale rules run in tests without Postgres or Redis, and a failure is in the type, so a caller cannot forget it.                                                                                                            | [004](../explanation/decisions/004-hexagon-in-the-api-only.md), [005](../explanation/decisions/005-failures-as-values.md)                                                                                                                                                              |
| How is it tested?                                         | Each behaviour is a Gherkin scenario bound at unit, integration and end-to-end level; `npm run bdd:check` fails on a missing binding. Unit and integration coverage has a 99% floor.                                          | [014](../explanation/decisions/014-gherkin-scenarios-at-three-layers.md), [test layers and coverage](../reference/test-layers-and-coverage.md)                                                                                                                                         |
| Why trust the load test?                                  | Its verdict is read from Postgres and Redis after the run, not from what k6 saw. The limits were fixed before the first run and are never changed to pass.                                                                    | [012](../explanation/decisions/012-load-verdict-from-the-data.md), [the checks](../../specs/apps/flash/load/checks.md), [what the runs found](../explanation/load-test-findings.md)                                                                                                    |
| Are the speed numbers real?                               | They are relative: k6 and the servers share one laptop's CPUs. The data checks are exact. A faithful speed result needs the load generator on another machine.                                                                | [what the runs found](../explanation/load-test-findings.md)                                                                                                                                                                                                                            |
| What would you add next?                                  | What the README leaves out on purpose, each with what would make it worth adding: a real payment provider, password reset, several sales at once, managed Postgres and Redis with failover.                                   | [what was left out](../../README.md#what-was-left-out-and-why)                                                                                                                                                                                                                         |

## Values to know

These come from [`.env.example`](../../.env.example) and the demo scripts in [`package.json`](../../package.json):

| Value            | Setting                                                                              |
| ---------------- | ------------------------------------------------------------------------------------ |
| the demo sale    | 3 items, open for 60 minutes, a hold of 60 seconds (`demo:sale`)                     |
| admission        | 50 shoppers a second by default (`admit_per_second`), an admission lasts 600 seconds |
| the login        | access cookie 15 minutes, refresh cookie 7 days, used once                           |
| the rate limits  | per 10 seconds: 30 writes per user, 600 per address, 20 auth calls per address       |
| the mock payment | 150 ms, declines 2% of the charges                                                   |
| the load limits  | reserve p95 under 300 ms, purchase p95 under 500 ms, no server errors                |

To show the test counts live, run `npm run bdd:check` (every scenario and its bindings) or `npx nx test:coverage flash-be`
(the coverage table; it starts the dev stack).

## When something fails live

- A step of the demo goes wrong: the table [if something goes wrong](run-the-demo.md#if-something-goes-wrong) has the
  usual causes.
- The load run cannot finish in time: open `generated-reports/load/smoke.md` from the day before, and
  [what the load runs found](../explanation/load-test-findings.md) for every profile.
- The page or the API does not start: the end-to-end tests are the same flow, with
  [the commands in the README](../../README.md#tests).
