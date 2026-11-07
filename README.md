# Flash sale

A flash sale for one product with a limited stock. Shoppers see the sale, join a waiting queue, hold one item for a
short time, and pay to keep it. The system never sells more than the stock and never sells a shopper more than one item,
however many people press the button at once.

## Start here

If you have five minutes, read these files in this order:

| File                                                                   | What you learn                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `apps/flash-be/src/domain/sale.ts`                                     | the sale rules: upcoming, active, sold out or ended, from window and stock                                               |
| `apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts`         | the Redis script that takes one item for one shopper, atomically                                                         |
| `apps/flash-be/src/adapters/outbound/postgres/purchase-repository.ts`  | the transaction that has the last word: `sold < stock`, one purchase per shopper                                         |
| `apps/flash-be/src/adapters/inbound/http/routes/`                      | every endpoint, one file per area, and what it does                                                                      |
| `apps/flash-web/src/sale-page.tsx`                                     | the page: status, name, Buy Now, feedback. Tailwind classes make it responsive and follow the system light or dark theme |
| `apps/flash-load/k6/profiles.ts`, `apps/flash-load/scripts/verdict.ts` | the stress profiles, and the verdict that is read from the data                                                          |

To show it running, follow [run the demo](docs/how-to/run-the-demo.md). To change it, the
[code map](docs/reference/code-map.md) and each app's `README.md` say where each kind of thing goes.

That is the core. The rest is support that keeps the code checked as it grows: Nx targets, the two
libraries, the hexagon layers, the behaviour-coverage check, the docs check and the lint rules. You can ignore all of
it to understand the system; it only matters when you change the code.

### What the brief asks for, and where it is

| The brief asks for                 | Where it is                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A configurable start and end time  | `sales.starts_at` and `ends_at`. Set them with `POST /admin/sales` (absolute times, needs an operator login) or with the seed command (minutes from now). `PATCH` and `DELETE /admin/sales/:saleId` change and remove a sale                                                                                                                           |
| One product, limited stock         | `sales.stock`, with `UPDATE ... WHERE sold < stock` and `CHECK (sold <= stock)` in Postgres                                                                                                                                                                                                                                                            |
| One item per user                  | `UNIQUE(sale_id, user_id)` on purchases and on reservations; a Redis set of buyers in front of it                                                                                                                                                                                                                                                      |
| An endpoint for the sale status    | `GET /sales/current` and `GET /sales/:saleId`, plus a live stream at `.../events`                                                                                                                                                                                                                                                                      |
| An endpoint to attempt a purchase  | Three calls, because a rush needs a queue: `POST /sales/:saleId/queue` (join, get a ticket), `POST .../reservations` (hold one item), `POST .../purchases` (pay). **Buy Now** makes the first two; **Confirm purchase** makes the third                                                                                                                |
| An endpoint to check the outcome   | `GET /sales/:saleId/purchases/me`: a purchase, a live hold, or nothing (for the shopper who is logged in)                                                                                                                                                                                                                                              |
| A simple React frontend            | `apps/flash-web`                                                                                                                                                                                                                                                                                                                                       |
| The frontend shows the sale status | the status badge, a sentence for what the shopper can do now, the window and the items left; it follows the sale live ([`specs/apps/flash/web/behaviours/sale/status.feature`](specs/apps/flash/web/behaviours/sale/status.feature))                                                                                                                   |
| A way to enter a user identifier   | log in or sign up with a user name. A password is added so one shopper cannot buy as another ([decision 007](docs/explanation/decisions/007-accounts-and-cookie-sessions.md), [`account/login.feature`](specs/apps/flash/web/behaviours/account/login.feature))                                                                                        |
| A Buy Now button, and feedback     | **Buy Now** and **Confirm purchase**; the page says "You got it! Your purchase is confirmed.", "You already bought an item.", "The sale has ended." or "Sold out. No items are left." ([`sale/buying.feature`](specs/apps/flash/web/behaviours/sale/buying.feature), [`sale/checking.feature`](specs/apps/flash/web/behaviours/sale/checking.feature)) |
| A system diagram                   | below; the C4 views are in [specs/apps/flash/c4](specs/apps/flash/c4/README.md)                                                                                                                                                                                                                                                                        |
| Unit and integration tests         | next to the code; the apps add Gherkin scenarios bound at unit, integration and end-to-end level (see [Tests](#tests))                                                                                                                                                                                                                                 |
| Stress tests                       | `apps/flash-load` (see [Load test](#load-test))                                                                                                                                                                                                                                                                                                        |

## What is in the repository

It is an npm workspace with five apps in `apps/` and two libraries in `libs/`. Each app has a `README.md` with its folder
tree and where to add each kind of thing; the [code map](docs/reference/code-map.md) is the index.

| App                                             | What it is                                                                                |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| [`flash-be`](apps/flash-be/README.md)           | REST API (Fastify) with the sale logic, on Postgres (Kysely, no ORM) and Redis            |
| [`flash-web`](apps/flash-web/README.md)         | React client (TanStack Start, Tailwind CSS). The browser only talks to its own web server |
| [`flash-be-e2e`](apps/flash-be-e2e/README.md)   | Playwright tests against the running API                                                  |
| [`flash-web-e2e`](apps/flash-web-e2e/README.md) | Playwright tests in a browser                                                             |
| [`flash-load`](apps/flash-load/README.md)       | k6 load test against three API instances behind nginx, with a verdict from the data       |

`libs/typekit` (`@flash/typekit`) is a TypeScript port of [py-typekit](https://github.com/wahidyankf/py-typekit). It has
`Result` and `attempt`. `flash-be` and `flash-web` use it, so a failure is a value and product code has no `catch`. The
linter enforces that; see [failures as values](docs/explanation/failures-as-values.md). It holds types only.

`libs/flash-commons` (`@flash/flash-commons`) holds the behaviour and values that 3 or more places across the apps
share: retry with exponential backoff, a max attempt count and jitter, the time units, the HTTP status numbers and a
`sleep` (on its own entry, `/timers`, so the main entry stays pure). Every
retry in the repository goes through it ([decision 017](docs/explanation/decisions/017-retry-backoff-jitter.md),
[policies](docs/reference/flash-commons.md)). A value repeated a third time gets one name
([decision 016](docs/explanation/decisions/016-dry-rule-of-three.md)).

The HTTP API is plain code: `flash-be` registers its routes in `adapters/inbound/http/routes/`, one file per area, and every route, request and reply is listed in
[docs/reference/http-endpoints.md](docs/reference/http-endpoints.md). The callers (`flash-web`, the e2e tests and the k6
script) write the paths they use.

Nx runs the commands only. It has no plugins, and every target is in the project's `project.json`. The apps' targets build
the libraries first.

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

0. **Sign up or log in.** The shopper gets two cookies (a short access token and a longer refresh token); every call below is made as that account, so no call names a user.
1. **Join the queue.** The shopper presses Buy Now. The API puts them in a waiting queue and returns
   a signed ticket. A set number of shoppers is let in each second, so a rush becomes a steady flow.
2. **Hold an item.** An admitted shopper reserves. A Redis script counts the stock, the holds and the buyers in one
   step and takes one item for a limited time. The hold is also written to Postgres.
3. **Pay.** The shopper confirms. The payment is charged once, however often the request is repeated. A short Postgres
   transaction raises `sold` only while `sold < stock` and inserts the purchase, which is unique per shopper.
4. **Ask "did I get it".** One call returns the purchase, a live hold, or nothing.

A shopper moves through these states. Buy Now makes the first two moves; Confirm purchase makes the last.

```mermaid
flowchart LR
  accTitle: A shopper's path
  accDescr: A shopper joins the queue. If nobody is ahead they are admitted at once, otherwise they wait for their place and are then admitted. An admitted shopper reserves and holds one item. Confirming turns the hold into a purchase. If the time runs out the hold ends, and Buy Now takes the shopper back to admitted. A join after the sale ended or sold out is refused.
  join["Join the queue"]
  wait["Waiting<br/>place in line"]
  admit["Admitted"]
  hold["Holding one item"]
  paid["Purchased"]
  lapse["Hold ended"]
  out["Sold out or ended"]
  join -->|nobody ahead| admit
  join -->|others ahead| wait
  wait -->|admitted| admit
  admit -->|reserve| hold
  hold -->|confirm| paid
  hold -->|time runs out| lapse
  lapse -->|Buy Now again| admit
  join -->|sale is over| out
  classDef step fill:#0173B2,stroke:#000000,color:#FFFFFF
  classDef good fill:#029E73,stroke:#000000,color:#000000
  classDef warn fill:#DE8F05,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class wait,admit,hold step
  class paid good
  class lapse,out warn
```

An expired hold stops counting by itself, because its expiry time has passed. There is no sweep job and no counter that
can drift.

### Under load

This is the production stack (`compose.prod.yaml`) and the shape the load test runs against.

```mermaid
flowchart LR
  accTitle: Flash sale under load
  accDescr: Shoppers reach the web app, which passes sale requests to nginx. An operator manages sales through nginx too. Nginx spreads requests over three identical API instances. The instances share one Postgres, which holds the truth, and one Redis, which holds the queue, the holds, the rate counters and the lease that lets one instance admit shoppers each second. If Redis is down the instances keep selling from Postgres under a row lock, and the readiness check reports it.
  browser["Shoppers' browsers"]
  operator["Operator"]
  web["flash-web<br/>page + /api pass-through"]
  lb["nginx<br/>least connections"]
  be["flash-be x3<br/>identical, stateless"]
  pg[("Postgres 18<br/>UPDATE sold < stock<br/>UNIQUE per user")]
  redis[("Redis 8<br/>Lua gate, queue,<br/>admit lease, counters")]
  browser -->|page, events, /api/sales| web
  web -->|sale routes| lb
  operator -->|/admin/sales| lb
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

| Choice                                                                                                               | Why                                                                                                                                                                    | What it costs                                                      |
| -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Redis Lua script as the hot path ([002](docs/explanation/decisions/002-redis-gate-postgres-last-word.md))            | One script counts and takes an item atomically, so thousands of requests per second do not touch the database row                                                      | A second store to run, and a rebuild when it is lost               |
| Postgres as the source of truth ([002](docs/explanation/decisions/002-redis-gate-postgres-last-word.md))             | `UPDATE ... WHERE sold < stock`, `UNIQUE(sale_id, user_id)` and `CHECK (sold <= stock)` still refuse an oversell if Redis is wrong or empty                            | Every purchase pays one short transaction                          |
| Reserve, then confirm ([001](docs/explanation/decisions/001-queue-hold-pay.md))                                      | A shopper is not charged for an item that is gone, and an abandoned hold frees the item                                                                                | A hold takes stock from others until it ends                       |
| Waiting queue with a ticket ([001](docs/explanation/decisions/001-queue-hold-pay.md))                                | Smooths a rush and cannot be skipped by posting to the reserve route                                                                                                   | Shoppers wait; the queue needs an admitter that runs once per sale |
| Serving without Redis ([003](docs/explanation/decisions/003-keep-selling-without-redis.md))                          | Redis down means the queue fails open, reserve runs on Postgres under a row lock, and `/ready` reports 503. Redis is rebuilt from Postgres when it returns             | The Postgres path is slower under load                             |
| Sale read cache of one second, with SSE ([008](docs/explanation/decisions/008-server-sent-events.md))                | Many readers cost one database read a second. Writes never use the cache                                                                                               | The page can be a second old                                       |
| Rate limit per user and per address                                                                                  | A flood gets `429` with `Retry-After`, not a slow server                                                                                                               | Shoppers behind one address share a limit                          |
| In-process mock payment ([009](docs/explanation/decisions/009-in-process-mock-payment.md))                           | The flow, the refund and the retry rules are real; no provider is needed                                                                                               | It proves nothing about a real provider                            |
| Accounts and cookie sessions ([007](docs/explanation/decisions/007-accounts-and-cookie-sessions.md))                 | Sign-up with a password (scrypt), an access and a refresh cookie, only token hashes stored, roles `shopper` and `operator` ([how](docs/explanation/authentication.md)) | No password reset, e-mail check or two-factor step                 |
| The browser talks to the web server only ([006](docs/explanation/decisions/006-browser-talks-to-web-server-only.md)) | The API needs no CORS and no public address, and an allow-list keeps the operator routes away from the browser                                                         | One more hop for every sale call                                   |
| A hexagon in the API only ([004](docs/explanation/decisions/004-hexagon-in-the-api-only.md))                         | The sale rules are tested without Postgres or Redis, and a unit test fails on a wrong import                                                                           | More files than a flat API; the page stays plain React             |
| Failures as values ([005](docs/explanation/decisions/005-failures-as-values.md))                                     | A failure is in the type, so a caller cannot forget it; no `catch` in product code                                                                                     | Every call that may throw is wrapped in `attempt`                  |
| Soft delete ([011](docs/explanation/decisions/011-soft-delete-everywhere.md))                                        | Nothing is lost, and a removal says who did it                                                                                                                         | Every read and every unique index filters `deleted_at`             |
| Retry with backoff and jitter ([017](docs/explanation/decisions/017-retry-backoff-jitter.md))                        | A retry storm cannot hit a server that is coming back, and every retry ends                                                                                            | A shopper may wait a little longer before a retry                  |

Longer explanations are in [docs/explanation](docs/explanation/README.md), and the architecture diagrams are in
[specs/apps/flash/c4](specs/apps/flash/c4/README.md). One sale runs at a time, and each sale is one type of product with a stock of units. `GET /sales/current` is the sale that
is running, or else the next one to open. The admin routes refuse a window that overlaps another sale; the seed command
does not check. There is no admin page: an operator logs in through the API and uses it with the cookies.

Every choice has a decision record in [docs/explanation/decisions](docs/explanation/decisions/README.md), with the
other options that were weighed and when to look at it again.

### What was left out, and why

| Left out                                 | Why                                                                                                                                                        | What would make it worth adding                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| A message broker                         | The Redis queue and one admitter per second smooth the rush already, and a purchase needs an answer now, not later                                         | Work that may finish after the reply, such as e-mail or fulfilment  |
| Microservices                            | One API holds every rule of one sale; a split would add network calls and a distributed transaction on the hot path                                        | Teams that ship separately, or parts that scale very differently    |
| An ORM                                   | The guards are a few exact SQL statements (`WHERE sold < stock`, the unique indexes); Kysely keeps them visible and typed                                  | Many more tables with plain CRUD                                    |
| An admin page                            | An operator needs only a few calls, and they are in the API with tests and in `api-flash-be.http`                                                          | Operators who are not developers                                    |
| A real payment                           | The brief does not ask for one; the mock keeps the hard parts real: charge once, refund on a lost race, retry on a decline                                 | Real money; then the provider's idempotency keys replace the mock's |
| Password reset, e-mail check, two-factor | The brief asks only for a user identifier; the password is there so one shopper cannot buy as another                                                      | Real shoppers' accounts                                             |
| Several sales at once                    | The brief has one product and one sale; one current sale keeps the queue and the page simple ([010](docs/explanation/decisions/010-one-sale-at-a-time.md)) | A shop with many products on sale at the same time                  |

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
- The payment is a mock, and there is no password reset or e-mail check (see the table above).
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

To create the sale through the API instead of the seed command, make an operator account on the server and log in (an
operator cannot sign up through the API). Send an absolute window. A window that overlaps another sale gets `409`. The
same login lists (`GET /admin/sales`), changes (`PATCH /admin/sales/:saleId`) and removes (`DELETE /admin/sales/:saleId`)
sales; the rules are in [seed a sale](docs/how-to/seed-a-sale.md#change-list-or-remove-a-sale):

```bash
npx nx db:create-operator flash-be --username=ops --password=correct-horse-battery
curl -s -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" -d '{"username":"ops","password":"correct-horse-battery"}'
curl -s -b cookies.txt -X POST http://localhost:8080/admin/sales \
  -H "Content-Type: application/json" \
  -d '{"stock":3,"startsAt":"2030-01-01T12:00:00Z","endsAt":"2030-01-01T13:00:00Z"}'
```

Open <http://localhost:3000>, sign up (**I am new**), press **Buy Now**, then **Confirm purchase**. The step-by-step
version is [the tutorial](docs/tutorials/run-flash-sale-locally.md).

### The demo

The same setup in three commands, and a ten-minute walk through the page, the API, Redis going down and a load run, is
in [run the demo](docs/how-to/run-the-demo.md):

```bash
npm run demo:reset             # wipes the local data (skip it to keep yours)
npm run demo:setup             # Postgres + Redis, migrations, the operator ops, a sale of 3 items
npm run demo:dev               # API on :8080 and web on :3000
```

The requests of the demo are in [api-flash-demo.http](api-flash-demo.http). `demo:redis:stop`, `demo:redis:start` and
`demo:load` are the other steps.

### Everything in containers

```bash
npm run docker:prod:up         # build the images, migrate, start the stack
docker compose -f compose.prod.yaml exec flash-be-1 node dist/seed-sale.js --stock=5 --duration-minutes=60
docker compose -f compose.prod.yaml exec flash-be-1 node dist/create-operator.js --username ops --password "..."
curl localhost:8080/ready      # Postgres and Redis ok
open localhost:3000            # the sale page
npm run docker:prod:down       # stop the stack (volumes are kept)
```

Production compose reads `POSTGRES_*`, `TICKET_SECRET` and the ports from `.env`, and fails when one is missing. The login cookies are `Secure`
there (`COOKIE_SECURE`, default `true`), so put a TLS terminator in front, or set `COOKIE_SECURE=false` in `.env` to try the stack over plain HTTP.
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
npx nx test:quick flash-commons # the other library, the same way
npm run lint:rules:test        # the lint rules: no catch, exhaustive switches
npm run bdd:check              # every scenario is bound at the layers it needs
npm run lint                   # Biome check of the whole repo: format, lint, imports
npm run docs:install           # once: fetch the docs checker
npm run docs:check             # links, structure and diagrams in the docs
```

The apps' behaviour is written as Gherkin scenarios in [specs/apps/flash/](specs/apps/flash/README.md) first. Each scenario is bound at unit,
integration and end-to-end level, except where a real boundary makes that impossible. Those few exceptions sit next to
the scenario, with the test that proves it. A detail that only a developer would notice is a plain test next to the code,
not a scenario (see [scenario or plain test](docs/explanation/scenario-or-plain-test.md)). Playwright needs Chromium once:
`npx playwright install chromium`. See [test layers and coverage](docs/reference/test-layers-and-coverage.md).

`git push` runs the Biome check, the docs check, the behaviour coverage check and the lint rule tests.
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
in [what the load runs found](docs/explanation/load-test-findings.md). The profiles are in [docs/reference/load-test.md](docs/reference/load-test.md), the limits and checks in
[specs/apps/flash/load](specs/apps/flash/load/README.md), and the steps in
[how to run the load test](docs/how-to/run-the-load-test.md).

## Documentation

- [docs/](docs/README.md): a tutorial, how-to guides, reference and explanations.
- [specs/](specs/README.md): the apps' Gherkin behaviour scenarios and the C4 architecture. Specs win when they disagree with the docs.
- [api-flash-be.http](api-flash-be.http) and [api-flash-web.http](api-flash-web.http): every route of the API and of the web server, one request each. [api-flash-demo.http](api-flash-demo.http): the demo, in order. All three are in the [kulala.nvim](https://github.com/wahidyankf/kulala.nvim) format.
- [docs/reference/code-map.md](docs/reference/code-map.md) and the `README.md` of each app and library: where each kind of thing lives, and where to add one.
- [AGENTS.md](AGENTS.md): rules for people and tools that change the code.
