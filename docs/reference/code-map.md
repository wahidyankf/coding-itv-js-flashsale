# Code map

Where each kind of thing lives in this repository. Each app and library has a README next to its code. That README has
the folder tree and a table that answers "I want to add X, where does it go?".

## Apps and libraries

| Folder                                                     | What it is                                                                                                           | Its README tells you where to put                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [`apps/flash-be`](../../apps/flash-be/README.md)           | the REST API, a hexagon: domain, application and ports, adapters                                                     | a rule, a use case, a store, a route, an error code, a table      |
| [`apps/flash-web`](../../apps/flash-web/README.md)         | the page, and the web server that passes a fixed list of routes on                                                   | a rule of the buying card, a sentence, a call to a new route      |
| [`apps/flash-be-e2e`](../../apps/flash-be-e2e/README.md)   | Playwright tests of the running API                                                                                  | a step, a shared helper, a wait                                   |
| [`apps/flash-web-e2e`](../../apps/flash-web-e2e/README.md) | Playwright tests of the page in a browser                                                                            | a step, a helper only the page needs                              |
| [`apps/flash-load`](../../apps/flash-load/README.md)       | the k6 stress test and the runner that judges it from the data                                                       | a profile, a check, a step of a shopper, a command on the stack   |
| [`libs/typekit`](../../libs/typekit/README.md)             | `@flash/typekit`: `Result` and `attempt`, types only                                                                 | nothing new unless it is a type every app needs                   |
| [`libs/flash-commons`](../../libs/flash-commons/README.md) | `@flash/flash-commons`: retry, time units, statuses, decoders, `isUuid`, cookies, time phrases; `sleep` on `/timers` | a value or a pure helper used in 3 or more places across the apps |

## Outside the apps

| Path                                                             | What it holds                                                                                              |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| [`specs/apps/flash/be`](../../specs/apps/flash/be/README.md)     | the API's behaviour scenarios (Gherkin), the contract                                                      |
| [`specs/apps/flash/web`](../../specs/apps/flash/web/README.md)   | the page's behaviour scenarios                                                                             |
| [`specs/apps/flash/c4`](../../specs/apps/flash/README.md)        | the C4 model: context, containers, components                                                              |
| [`specs/apps/flash/load`](../../specs/apps/flash/load/README.md) | the load test's profiles, limits and checks                                                                |
| [`docs/`](../README.md)                                          | these docs, by Diátaxis mode; [decisions](../explanation/decisions/README.md) holds the why of each choice |
| `scripts/bdd/`                                                   | `npm run bdd:check`, the check that every scenario is bound at each level                                  |
| `scripts/lint/`                                                  | `npm run lint:rules:test`, the tests of the lint rules in `.biome/` and `biome.json`                       |
| `scripts/smoke/`                                                 | the smoke test of the production stack                                                                     |
| `api-flash-*.http`                                               | one request per route, and the demo in order (kulala.nvim format)                                          |
| `compose.dev.yaml`, `compose.prod.yaml`                          | the local Postgres and Redis; the production-like stack                                                    |
| `biome.json`, `.biome/`                                          | format and lint, with the limits on complexity and size                                                    |
| `repo-config.yml`                                                | the docs policy RHINO checks                                                                               |

## Rules for where code goes

- **A rule of the sale** goes in `apps/flash-be/src/domain`, with a unit test first. A service or a route only asks it.
- **A value used 3 or more times** gets one name in the app, in the folder that owns it. When 3 or more places across
  the apps use it, it goes in `libs/flash-commons`
  ([decision 016](../explanation/decisions/016-dry-rule-of-three.md)). The e2e and k6 tests write the API's paths,
  headers and statuses themselves, so they stay an independent check.
- **A retry** uses `retry` or `retryAsync` from `@flash/flash-commons`, with backoff, a max attempt count and jitter
  ([decision 017](../explanation/decisions/017-retry-backoff-jitter.md), [policies](flash-commons.md)).
- **A new kind of file** updates the README of its app, so this map stays true.
