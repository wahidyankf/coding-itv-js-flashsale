# flash-be-e2e

Playwright tests of the running API. Each scenario of [specs/apps/flash/be](../../specs/apps/flash/be/README.md) that
is not `@e2e-exempt` runs here against the built `flash-be`, with its own scratch database and, where the scenario
needs one, a Redis proxy that can cut the connection.

## Where things are

```text
steps/
  <area>.steps.ts    the step definitions, one file per area of the feature files (named in each file's header)
  world.steps.ts     the After hook
  support/           everything steps share; a step never imports another step file
    world.ts           the state of the running scenario, and currentSaleId() for the sale it made
    processes.ts       the API process, a second API process over the same stores (startSecondApi), and the Redis proxy
    database.ts        the scratch database, migrations, seed and queries, and setSold/sellOut
    cleanup.ts         the teardown of a scenario
    api.ts, views.ts   the routes and request builder; the reply bodies as the steps read them
    auth.ts            the accounts and their login cookies
    shoppers.ts        a shopper's calls on the way to a purchase: ticketOf, shopperNames, pollUntilAdmitted
    sale.ts            saleNow, the current sale as the API shows it
    operator.ts        the operator's calls
    stream.ts          reading a Server-Sent Events stream
    time.ts            pollUntil, and the "in 2 hours" phrases (from @flash/flash-commons)
    response.ts        the reply to the last request
    relay.ts           the TCP relay used by the proxies
```

`flash-web-e2e` imports these helpers too, so a helper lives here once.

## To add something

| To add …                         | Put it in …                                                               | Also update …                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| a step                           | the `<area>.steps.ts` of its feature file                                 | `npm run bdd:check`                                                                                  |
| a helper two step files need     | [`steps/support/`](steps/support)                                         | its doc comment                                                                                      |
| a wait for something to be ready | `pollUntil` in [`support/time.ts`](steps/support/time.ts)                 | nothing: it already backs off with jitter and a max attempt count                                    |
| a wait for a shopper's admission | `pollUntilAdmitted` in [`support/shoppers.ts`](steps/support/shoppers.ts) | name its wait (`ADMISSION_WAIT_MS` in web-e2e's [`shop.ts`](../flash-web-e2e/steps/support/shop.ts)) |

The steps write the API's headers, error codes and expected statuses themselves. They do not import them from
`flash-be`, so a renamed header or code fails here before a real client sees it
([decision 016](../../docs/explanation/decisions/016-dry-rule-of-three.md)). The paths are the one exception: they come
from `API_PATHS` in `@flash/flash-commons`, whose literal test makes a rename a change a reviewer sees
([decision 019](../../docs/explanation/decisions/019-api-version-prefix.md)).

## Commands

```bash
npx nx test:quick flash-be-e2e    # typecheck and lint
npx nx test:e2e flash-be-e2e      # builds flash-be, needs Docker for Postgres and Redis
```

Each scenario runs the built API in `apps/flash-be/dist`. Playwright builds it only when nothing answers on `:8080`. If
the dev API runs there (for example from `npm run demo:dev`), Playwright uses it as is and does not build, so the
scenarios run the last build, which may be old. Stop the dev servers first.
