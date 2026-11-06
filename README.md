# Flash sale

A flash sale for one product with a limited stock. Shoppers see the sale, join a waiting queue, hold one item for a
short time, and pay to keep it. The system never sells more than the stock and never sells a shopper more than one item,
however many people press the button at once.

## Start here

If you have five minutes, read these files in this order:

| File                                                                  | What you learn                                                                   |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `apps/flash-be/src/domain/sale.ts`                                    | the sale rules: upcoming, active, sold out or ended, from window and stock       |
| `apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts`        | the Redis script that takes one item for one shopper, atomically                 |
| `apps/flash-be/src/adapters/outbound/postgres/purchase-repository.ts` | the transaction that has the last word: `sold < stock`, one purchase per shopper |
| `libs/contract/src/routes.ts`                                         | every endpoint, written once                                                     |
| `apps/flash-be/src/adapters/inbound/http/routes.ts`                   | what each endpoint does                                                          |
| `apps/flash-web/src/sale/sale-page.tsx`                               | the page: status, name, Buy Now, feedback                                        |
| `apps/flash-load/k6/profiles.ts`, `apps/flash-load/scripts/run.ts`    | the stress profiles, and the verdict that is read from the data                  |

That is the core. The rest is support that keeps the code checked as it grows: Nx targets, the `typekit` and `contract`
libraries, the hexagon layers, the behaviour-coverage check, the docs check and the lint rules. You can ignore all of
it to understand the system; it only matters when you change the code.

### What the brief asks for, and where it is

| The brief asks for                | Where it is                                                                                                                                                                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A configurable start and end time | `sales.starts_at` and `ends_at`. Set them with `POST /admin/sales` (absolute times, needs `ADMIN_TOKEN`) or with the seed command (minutes from now)                                                                                                     |
| One product, limited stock        | `sales.stock`, with `UPDATE ... WHERE sold < stock` and `CHECK (sold <= stock)` in Postgres                                                                                                                                                              |
| One item per user                 | `UNIQUE(sale_id, user_id)` on purchases and on reservations; a Redis set of buyers in front of it                                                                                                                                                        |
| An endpoint for the sale status   | `GET /sales/current` and `GET /sales/:saleId`, plus a live stream at `.../events`                                                                                                                                                                        |
| An endpoint to attempt a purchase | Three calls, because a rush needs a queue: `POST /sales/:saleId/queue` (join, get a ticket), `POST .../reservations` (hold one item), `POST .../purchases` (pay). **Buy Now** makes the first two; **Confirm purchase** makes the third |
| An endpoint to check the outcome  | `GET /sales/:saleId/purchases/:userId`: a purchase, a live hold, or nothing                                                                                                                                                                              |
| A simple React frontend           | `apps/flash-web`                                                                                                                                                                                                                                         |
| A system diagram                  | below; the C4 views are in [specs/apps/flash/c4](specs/apps/flash/c4/README.md)                                                                                                                                                                |
| Unit and integration tests        | next to the code; the apps add Gherkin scenarios bound at unit, integration and end-to-end level (see [Tests](#tests))                                                                                                                                           |
| Stress tests                      | `apps/flash-load` (see [Load test](#load-test))                                                                                                                                                                                                          |

## What is in the repository

It is an npm workspace with five apps in `apps/` and two libraries in `libs/`:

| App             | What it is                                                                          |
| --------------- | ----------------------------------------------------------------------------------- |
| `flash-be`      | REST API (Fastify) with the sale logic, on Postgres (Kysely, no ORM) and Redis      |
| `flash-web`     | React client (TanStack Start). The browser only talks to its own web server         |
| `flash-be-e2e`  | Playwright tests against the running API                                            |
| `flash-web-e2e` | Playwright tests in a browser                                                       |
| `flash-load`    | k6 load test against three API instances behind nginx, with a verdict from the data |

`libs/typekit` (`@flash/typekit`) is a TypeScript port of [py-typekit](https://github.com/wahidyankf/py-typekit). It has
`Result` and `attempt`. `flash-be` and `flash-web` use it, so a failure is a value and product code has no `catch`. The
linter enforces that; see [failures as values](docs/explanation/failures-as-values.md).

`libs/contract` (`@flash/contract`) is the HTTP contract of the API, written once with Zod: the route table, the schemas, the
error codes, a small client and the Server-Sent Events codec. `flash-be` registers its routes from it, and `flash-web`, the
e2e tests and the k6 script build their requests and read the replies through it, so no app writes a path or a reply type
by hand. [docs/reference/openapi.json](docs/reference/openapi.json) is generated from it. See
[the API contract](docs/explanation/api-contract.md).

Nx runs the commands only. It has no plugins, and every target is in the project's `project.json`. The apps' targets build
the library first.

`flash-be` is a hexagon: the rules sit in `src/domain`, the use cases in `src/application`, and Postgres, Redis, the
payment mock and HTTP are adapters behind ports. A unit test fails when a layer imports one it must not know. See
[hexagonal architecture](docs/explanation/hexagonal-architecture.md).

## How a purchase works

```mermaid
flowchart LR
  accTitle: Flash sale system
  accDescr: A shopper's browser talks only to the web app. The web app renders the sale page and passes sale requests on to the API. The API reads and writes Postgres, which holds the truth, and uses Redis as a fast gate for the queue, the holds and the rate counters.
  browser["Shopper's browser"]
  web["flash-web<br/>TanStack Start"]
  be["flash-be<br/>Fastify API"]
  pg[("Postgres 18<br/>source of truth")]
  redis[("Redis 8<br/>fast gate")]
  browser -->|page, /api/sales| web
  web -->|sale routes| be
  be -->|SQL, final guard| pg
  be -->|queue, gate, counters| redis
  classDef person fill:#CC78BC,stroke:#000000,color:#000000
  classDef container fill:#029E73,stroke:#000000,color:#000000
  classDef store fill:#CA9161,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class browser person
  class web,be container
  class pg,redis store
```

1. **Join the queue.** The shopper enters a name and presses Buy Now. The API puts them in a waiting queue and returns
   a signed ticket. A set number of shoppers is let in each second, so a rush becomes a steady flow.
2. **Hold an item.** An admitted shopper reserves. A Redis script counts the stock, the holds and the buyers in one
   step and takes one item for a limited time. The hold is also written to Postgres.
3. **Pay.** The shopper confirms. The payment is charged once, however often the request is repeated. A short Postgres
   transaction raises `sold` only while `sold < stock` and inserts the purchase, which is unique per shopper.
4. **Ask "did I get it".** One call returns the purchase, a live hold, or nothing.

An expired hold stops counting by itself, because its expiry time has passed. There is no sweep job and no counter that
can drift.

### Under load

This is the production stack (`compose.prod.yaml`) and the shape the load test runs against.

```mermaid
flowchart LR
  accTitle: Flash sale under load
  accDescr: Shoppers reach the web app, which passes sale requests to nginx. An operator creates sales through nginx too. Nginx spreads requests over three identical API instances. The instances share one Postgres, which holds the truth, and one Redis, which holds the queue, the holds, the rate counters and the lease that lets one instance admit shoppers each second. If Redis is down the instances keep selling from Postgres under a row lock, and the readiness check reports it.
  browser["Shoppers' browsers"]
  operator["Operator"]
  web["flash-web<br/>page + /api pass-through"]
  lb["nginx<br/>least connections"]
  be["flash-be x3<br/>identical, stateless"]
  pg[("Postgres 18<br/>UPDATE sold < stock<br/>UNIQUE per user")]
  redis[("Redis 8<br/>Lua gate, queue,<br/>admit lease, counters")]
  browser -->|page, events, /api/sales| web
  web -->|sale routes| lb
  operator -->|POST /admin/sales| lb
  lb -->|one instance per request| be
  be -->|SQL, last word| pg
  be -->|one script per hold| redis
  redis -.->|if down: row lock| pg
  classDef person fill:#CC78BC,stroke:#000000,color:#000000
  classDef container fill:#029E73,stroke:#000000,color:#000000
  classDef store fill:#CA9161,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class browser,operator person
  class web,lb,be container
  class pg,redis store
```

An instance keeps nothing in memory that another needs: a queue ticket is signed with a shared secret, the state is in
Postgres and Redis, and each second one instance wins the lease that admits the next shoppers. Any instance can serve
any request, so adding capacity is adding instances.

## Design choices and trade-offs

| Choice                                  | Why                                                                                                                                                        | What it costs                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Redis Lua script as the hot path        | One script counts and takes an item atomically, so thousands of requests per second do not touch the database row                                          | A second store to run, and a rebuild when it is lost               |
| Postgres as the source of truth         | `UPDATE ... WHERE sold < stock`, `UNIQUE(sale_id, user_id)` and `CHECK (sold <= stock)` still refuse an oversell if Redis is wrong or empty                | Every purchase pays one short transaction                          |
| Reserve, then confirm                   | A shopper is not charged for an item that is gone, and an abandoned hold frees the item                                                                    | A hold takes stock from others until it ends                       |
| Waiting queue with a ticket             | Smooths a rush and cannot be skipped by posting to the reserve route                                                                                       | Shoppers wait; the queue needs an admitter that runs once per sale |
| Serving without Redis                   | Redis down means the queue fails open, reserve runs on Postgres under a row lock, and `/ready` reports 503. Redis is rebuilt from Postgres when it returns | The Postgres path is slower under load                             |
| Sale read cache of one second, with SSE | Many readers cost one database read a second. Writes never use the cache                                                                                   | The page can be a second old                                       |
| Rate limit per user and per address     | A flood gets `429` with `Retry-After`, not a slow server                                                                                                   | Shoppers behind one address share a limit                          |
| In-process mock payment                 | The flow, the refund and the retry rules are real; no provider is needed                                                                                   | It proves nothing about a real provider                            |
| Names, not accounts                     | A queue ticket binds a name to a request. No sign-up is needed                                                                                             | A name can be taken by anyone; this is not authentication          |

Longer explanations are in [docs/explanation](docs/explanation/README.md), and the architecture diagrams are in
[specs/apps/flash/c4](specs/apps/flash/c4/README.md). One sale runs at a time. `POST /admin/sales` refuses a
window that overlaps another sale; the seed command does not check. There is no admin page.

## How it scales, and where it stops

**What scales.** The API tier. Instances are identical and stateless, so capacity grows by adding one. In
`compose.prod.yaml` that means one more service next to `flash-be-1..3`, one more `server` line in `nginx.prod.conf`,
and a higher Postgres `max_connections`, since each instance opens a pool of ten. The hot path is one Redis script per
hold, so a rush reaches Postgres only for the hold's write-through and the payment step. Reads of the sale are cached
for a second, and watchers share one read through the event stream.

**What does not.** Postgres and Redis are each one instance here.

- Postgres has the last word, so when it is down nothing can be sold. Every purchase raises `sold` on one row, so one
  sale is capped by what that row can take. That is the price of never overselling.
- Redis is only a fast gate. If it is down the API keeps selling from Postgres alone, slower, and `/ready` answers `503`
  (see [serving without Redis](docs/explanation/serving-without-redis.md)).
- Beyond one laptop, the next steps are managed Postgres with a standby (and a read replica), and Redis behind Sentinel
  or a managed failover. Redis Cluster spreads many sales over shards, but one sale's keys stay together, so it does not
  speed up a single sale.

**Other limits to know.**

- The per-address rate limit counts the address nginx sees. Behind `flash-web` that is the web server for every shopper,
  so shoppers who buy through the page share one address limit (`RATE_LIMIT_PER_IP`, 600 writes per 10 seconds); the
  per-user limit still applies to each of them. A real deployment would put the browser's address in front of that.
- The payment is a mock, and a name is not an account (see the table above).
- The load numbers below come from one laptop where k6 and every server share the CPUs, so they show how the system
  behaves, not how fast production would be.

## Run it

You need [Volta](https://volta.sh/), Docker and Git. Volta pins Node and npm.

```bash
npm install                    # also installs the Git hooks
[ -f .env ] || cp .env.example .env
```

The values in `.env.example` are for local use only. Do not use the example passwords or the ticket secret anywhere else.

### Apps on the host, data in Docker

```bash
npm run docker:dev:up          # Postgres + Redis
npx nx db:migrate flash-be     # apply the migrations
npx nx db:seed-sale flash-be --stock=3 --starts-in-minutes=0 --duration-minutes=60 --hold-seconds=60
npx nx dev flash-be            # API on http://localhost:8080
npx nx dev flash-web           # web on http://localhost:3000
npm run docker:dev:down        # stop Postgres + Redis
```

To create the sale through the API instead of the seed command, set `ADMIN_TOKEN` in `.env` (16 characters or more) and
restart the API. Send an absolute window. A window that overlaps another sale gets `409`:

```bash
curl -s -X POST http://localhost:8080/admin/sales \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"stock":3,"startsAt":"2030-01-01T12:00:00Z","endsAt":"2030-01-01T13:00:00Z"}'
```

Open <http://localhost:3000>, type a name and press **Buy Now**, then **Confirm purchase**. The step-by-step version is
[the tutorial](docs/tutorials/run-flash-sale-locally.md).

### Everything in containers

```bash
npm run docker:prod:up         # build the images, migrate, start the stack
docker compose -f compose.prod.yaml exec flash-be-1 node dist/seed-sale.js --stock=5 --duration-minutes=60
curl localhost:8080/ready      # Postgres and Redis ok
open localhost:3000            # the sale page
npm run docker:prod:down       # stop the stack (volumes are kept)
```

Production compose reads `POSTGRES_*`, `TICKET_SECRET` and the ports from `.env`, and fails when one is missing.
Three `flash-be` instances run behind nginx, which is the API port on the host. Postgres, Redis and the instances are not
published. `npm run smoke:prod` builds the stack under its own name and walks one shopper through it
(see [the smoke test](docs/how-to/smoke-test-the-production-stack.md)).

## Tests

Every app has `typecheck`, `lint`, `test:quick` (those two plus unit tests) and `test:quick:watch`.

```bash
npx nx test:quick <app>        # typecheck + lint + unit tests
npx nx test:integration <app>  # needs the dev stack (flash-be, flash-web)
npx nx test:e2e <app>          # Playwright (flash-be-e2e, flash-web-e2e)
npx nx test:coverage <app>     # unit + integration, 99% floor; starts the dev stack
npx nx test:quick typekit      # a library: typecheck + lint + unit tests (no Docker)
npx nx test:quick contract     # the same for the contract
npm run openapi:check          # docs/reference/openapi.json matches the routes
npm run contract:guard:test    # no API path or ticket header written by hand in product code
npm run lint:rules:test        # the lint rules: no catch, exhaustive switches
npm run bdd:check              # every scenario is bound at the layers it needs
npm run docs:install           # once: fetch the docs checker
npm run docs:check             # links, structure and diagrams in the docs
```

The apps' behaviour is written as Gherkin scenarios in [specs/apps/flash/](specs/apps/flash/README.md) first. Each scenario is bound at unit,
integration and end-to-end level, except where a real boundary makes that impossible. Those few exceptions sit next to
the scenario, with the test that proves it. A detail that only a developer would notice is a plain test next to the code,
not a scenario (see [scenario or plain test](docs/explanation/scenario-or-plain-test.md)). Playwright needs Chromium once:
`npx playwright install chromium`. See [test layers and coverage](docs/reference/test-layers-and-coverage.md).

`git push` runs the docs check, the behaviour coverage check, the lint rule tests, the OpenAPI check and the contract guard.
It also runs typecheck, lint, unit tests and the coverage floor for the projects the change touches. Commits are checked
with commitlint (Conventional Commits).

## Load test

`flash-load` starts three API instances behind nginx with Postgres and Redis, sends shoppers at them with k6 (run as a
container, so nothing else is installed), and then checks the data itself. Docker must run.

```bash
npx nx load:smoke flash-load   # 500 shoppers for 20 items, a few minutes
npx nx load:full flash-load    # 5,000 shoppers for 100 items
npx nx load:chaos flash-load   # 2,000 shoppers for 1,000 items, Redis is stopped mid-run
npx nx load:burst flash-load   # 700 shoppers join in one second, for 100 items
npx nx load:contention flash-load  # 700 shoppers reserve in the same moment, for 50 items
```

**The limits were fixed before the first run**: reserve p95 under 300 ms, purchase p95 under 500 ms (it includes the
150 ms of the mock payment), and no server errors. A failed run is a finding about the system; a limit is not changed
to make a run pass.

**Expected outcome.** `smoke`, `full` and `chaos` exit `0` and print a table where every check passes. The checks are: no
oversell (`sold` is at most the stock), `sold` equals the purchase rows, no shopper bought twice, k6 and Postgres agree,
the stock sells out, the shopper who floods the queue gets `429`, and Redis and Postgres agree on the buyers. These are
the numbers from the last runs on a laptop where the client and the servers share the same CPUs, so read the times as
relative:

| Profile | Sold      | Reserve p95 | Purchase p95 | Server errors |
| ------- | --------- | ----------- | ------------ | ------------- |
| smoke   | 20/20     | 2.1 ms      | 156 ms       | 0             |
| full    | 100/100   | 1.6 ms      | 156 ms       | 0             |
| chaos   | 1000/1000 | 3.0 ms      | 155 ms       | 0             |

**The two herd runs.** `burst` and `contention` put 700 shoppers into the system within one second, which the other runs
never do. In all four runs every invariant held: no oversell (100/100 and 50/50 sold), no shopper bought twice, k6,
Postgres and Redis agreed, and there were no server errors. The speed limits **did not hold** as k6 measures them on
this machine:

| Profile    | Sold    | Reserve p95 (k6) | Purchase p95 (k6) | Reserve p95 in the API | Verdict                              |
| ---------- | ------- | ---------------- | ----------------- | ---------------------- | ------------------------------------ |
| burst      | 100/100 | 701 and 2,379 ms | 724 and 1,949 ms  | 5.3 ms                 | invariants pass, speed fails         |
| contention | 50/50   | 349 and 551 ms   | 213 and 194 ms    | 5.5 ms                 | invariants pass, reserve speed fails |

The API logged a reserve at about 5 ms (95th percentile), and Postgres never had a session waiting for a lock, so the
handlers and the database are not where the time goes. What k6 measures also includes 770 virtual users sharing six CPUs
with nginx and three API instances, and the numbers swing a lot from run to run. So these runs show that the sale stays
correct under a herd. They do not show how fast production would answer, and a faithful speed test needs the load
generator on its own machine. The limits were not changed. See
[what the load runs found](docs/explanation/load-test-findings.md).

The chaos run found that paying while Redis was down took about two seconds, because of how the Redis client queues a
transaction. That is fixed, with a scenario that holds the outage and requires an answer in under 500 ms. The story is
in [what the load runs found](docs/explanation/load-test-findings.md). The profiles and checks are in
[docs/reference/load-test.md](docs/reference/load-test.md), and the steps in
[how to run the load test](docs/how-to/run-the-load-test.md).

## Documentation

- [docs/](docs/README.md): a tutorial, how-to guides, reference and explanations.
- [specs/](specs/README.md): the apps' Gherkin behaviour scenarios and the C4 architecture. Specs win when they disagree with the docs.
- [api-flash-be.http](api-flash-be.http) and [api-flash-web.http](api-flash-web.http): manual requests for the API and the web server.
- [AGENTS.md](AGENTS.md): rules for people and tools that change the code.
