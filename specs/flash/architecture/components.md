# Components of flash-be

C4 level 3, for the API container only. `flash-be` is a hexagon (ports and adapters) with a small domain model in the
middle. Driving adapters call the application; the application calls driven adapters only through ports. `flash-web`
is still a few routes and has no component view.

```mermaid
flowchart LR
  accTitle: flash-be components
  accDescr: The HTTP and command line adapters call the application services. The services use the domain model and call the ports. The Postgres, Redis, memory, payment and clock adapters implement the ports. The composition root chooses which adapter sits behind each port.
  http["HTTP adapter<br/>Fastify routes, SSE"]
  cli["CLI adapter<br/>seed command"]
  app["Application<br/>services and ports"]
  domain["Domain<br/>sale, hold, purchase rules"]
  driven["Driven adapters<br/>Postgres, Redis, memory,<br/>payment, clock"]
  root["Composition root<br/>main.ts, composition.ts"]
  pg[("Postgres 18<br/>data store")]
  redis[("Redis 8<br/>data store")]
  http -->|calls services| app
  cli -->|parses and seeds| app
  app -->|asks the rules| domain
  app -->|calls ports| driven
  driven -->|SQL, final guard| pg
  driven -->|gate, queue, counters| redis
  root -->|picks adapters| driven
  root -->|builds services| app
  classDef component fill:#029E73,stroke:#000000,color:#000000
  classDef store fill:#CA9161,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class http,cli,app,domain,driven,root component
  class pg,redis store
```

## Components in Prose

- **HTTP adapter** (`adapters/inbound/http/`) maps paths to the services and turns their results into status codes.
  It also turns a sale or a shopper's place into Server-Sent Events. It holds no rules.
- **CLI adapter** (`adapters/inbound/cli/`) reads the seed command's options. `seed-sale.ts` wires it to the database.
- **Application** (`application/`) has one service per use case: the sale status with its read cache, the waiting queue,
  reserving, paying and the rate limiter. A service orders the steps and calls ports. Its ports are in
  `application/ports/`: `SaleRepository`, `QueueStore`, `HoldGate`, `ReservationRepository`, `PurchaseRepository`,
  `RateLimitStore`, `Payment`, `Clock` and `SaleSeeder`.
- **Domain** (`domain/`) holds the rules and imports nothing else: when a sale is upcoming, active, sold out or
  ended, who may queue or reserve, how long a hold lives, how many shoppers one tick admits, what a user id and a
  ticket are.
- **Driven adapters** (`adapters/outbound/`) implement the ports. `postgres/` reads and writes the sales, holds and
  purchases and runs the migrations. `redis/` holds the gate script, the queue and the rate counters. `memory/` counts
  rate limits when Redis fails. `payment/` is the mock provider. `system/` reads the clock.
- **Composition root** (`main.ts`, `composition.ts`) is the only place that picks an adapter for a port.

## Constraints

- Postgres wins every disagreement with Redis. The constraints `sold <= stock` and one purchase per user and sale are
  in the schema, so no part can break them.
- Dependencies point inward. The domain imports nothing but Node built-ins. The application imports the domain and its
  own ports. An inbound adapter never imports an outbound adapter, and an outbound adapter imports only ports and the
  domain. `apps/flash-be/src/architecture_tests.ts` fails the unit tests when an import breaks this.
- The same rules run against memory in unit tests, because the ports (`QueueStore`, `HoldGate`,
  `ReservationRepository`, `PurchaseRepository`, `RateLimitStore`, `Payment`) have memory copies.
