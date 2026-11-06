# Containers

C4 level 2. It shows the deployable units of the flash sale product and the data stores they use. The API has its own
component view in [components.md](components.md). The web app is a page and a pass-through route, and has none.

```mermaid
flowchart LR
  accTitle: Flash sale containers
  accDescr: A shopper's browser talks only to the web app. The web app renders the sale page and passes the sale requests on to the API over HTTP. The API reads and writes Postgres and uses Redis for the queue, the reservation gate and the rate counters. A migration job runs once before the API starts and prepares the Postgres schema.
  web["flash-web<br/>container, TanStack Start"]
  be["flash-be<br/>container, Fastify API"]
  migrate["flash-be-migrate<br/>container, one-off job"]
  pg[("Postgres 18<br/>data store")]
  redis[("Redis 8<br/>data store")]
  web -->|sale routes, /health| be
  be -->|SQL queries over TCP| pg
  be -->|queue, gate, counters| redis
  migrate -->|runs migrations| pg
  classDef container fill:#029E73,stroke:#000000,color:#000000
  classDef store fill:#CA9161,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class web,be,migrate container
  class pg,redis store
```

## Relationships in Prose

- `flash-web` renders the sale page from `GET /sales/current` and shows the backend status from `GET /health`. It passes
  the browser's requests under `/api/sales` on to `flash-be`, streams included. The address comes from `FLASH_BE_URL`,
  read only on the server.
- `flash-be` runs SQL queries against Postgres over TCP through its Kysely query builder.
- `flash-be` uses Redis over the RESP protocol for the waiting queue, the reservation gate and the rate limit counters,
  and pings it to answer its readiness check. Redis holds nothing that Postgres cannot rebuild.
- `flash-be-migrate` applies the hand-written migrations to Postgres over TCP. It runs once, before `flash-be` starts.

## Constraints

- Both containers read one HTTP contract, the library `@flash/contract`. `flash-be` registers its routes from it, and `flash-web`
  calls the API and builds its pass-through allowlist from it.
- The browser never receives `FLASH_BE_URL`: only the server reads it, and the pass-through route allows only the sale
  paths.
- `GET /health` on `flash-be` does no I/O. Only `GET /ready` touches Postgres and Redis.
- In production, `flash-be` refuses to start when `DATABASE_URL`, `REDIS_URL` or `TICKET_SECRET` is missing.
- When Redis is down, `flash-be` keeps selling from Postgres alone (see [sequences.md](sequences.md)).
- Compose in production does not publish Postgres or Redis to the host. Only the web and API ports are published.
