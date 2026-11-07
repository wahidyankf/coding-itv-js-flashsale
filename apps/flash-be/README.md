# flash-be

The REST API of the flash sale (Fastify, Postgres through Kysely, Redis). It holds every rule of the sale: the window,
the stock, one item per shopper, the queue, the hold and the payment. It is a hexagon: the rules know nothing of HTTP,
Postgres or Redis ([how](../../docs/explanation/hexagonal-architecture.md),
[why](../../docs/explanation/decisions/004-hexagon-in-the-api-only.md)). `architecture_tests.ts` fails on an import that
crosses a layer it must not know.

## Where things are

```text
src/
  domain/                rules and values, no I/O, no clock read: sale.ts (status, reserve and confirm rules),
                         sale-window.ts (a new sale and a change), reservation.ts (holds), purchase.ts, queue.ts,
                         ticket.ts, auth.ts (password and token rules), user.ts (Username, UserId), rate-limit.ts, time.ts
  application/           one service per use case (sale, queue, reservation, purchase, auth, rate limit, admin, seed),
                         and the steps they share (admission, guarded-gate, sale-cache)
    ports/               the stores and services a use case needs, named in the words of the sale
  adapters/
    inbound/http/        app.ts (Fastify), errors.ts (error codes, statuses, sentences), headers.ts, cookies.ts,
                         sale-view.ts (the sale as a reply shows it), event-stream.ts
      routes/            one file per area: auth, health, sales, queue, reservations, purchases, admin;
                         guards.ts, reply.ts and bodies.ts are shared by them
    inbound/cli/         the options of the seed-sale and create-operator commands
    outbound/postgres/   the repositories, the shared queries, health.ts (the /ready check), and migrations/
                         (hand-written; the SQL of one that has run never changes)
    outbound/redis/      the hold gate, the queue, the rate limit counters and the session cache, as single scripts;
                         redis-health.ts (the /ready check)
    outbound/crypto/     scrypt password hashes and random tokens
    outbound/payment/    the in-process mock payment
    outbound/memory/     the rate limit store used when Redis is down
    outbound/system/     the clock
  composition.ts         the one place that picks an adapter for each port
  config.ts              the config, read once from process.env; local-defaults.ts holds the local addresses
  main.ts, migrate.ts, seed-sale.ts, create-operator.ts   the entry points; with-db.ts opens and closes the database
                         for one command
  bdd/                   the Gherkin bindings of specs/apps/flash/be; bdd/support holds the worlds and the memory copies
                         of the ports that let a scenario run at unit level
```

Port names follow one rule: a **Repository** is the Postgres record of a thing, a **Store** holds keyed state, and a
**Gate** is the fast check in front of Postgres. `SaleAdmin` has no suffix: it writes sale rows, but `SaleRepository`
already names the reads. Each port file starts with a `Kind:` line that says which one it is.

## To add something

| To add …                     | Put it in …                                                                        | Also update …                                                                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| a rule                       | `domain/<topic>.ts`, with a test in `<topic>_tests.ts`, first                      | the service that asks it; the scenario if a shopper or an operator can see it                                                              |
| a use case                   | `application/<name>-service.ts`; it orders steps and asks the domain               | `application/dependencies.ts` and `composition.ts`                                                                                         |
| a store or outside service   | a port in `application/ports/`, an adapter in `adapters/outbound/`                 | a memory copy in `bdd/support/memory-*.ts`, the wiring in `composition.ts`                                                                 |
| a route                      | `adapters/inbound/http/routes/<area>.ts`                                           | [HTTP endpoints](../../docs/reference/http-endpoints.md), the `.http` files, every caller ([how](../../docs/how-to/change-an-endpoint.md)) |
| an error code                | `ERROR_STATUS` and `ERROR_MESSAGE` in `adapters/inbound/http/errors.ts`            | the error type of the service that answers it; its text in `flash-web`                                                                     |
| a table or a column          | a new file in `adapters/outbound/postgres/migrations/`                             | the `Database` type in `database.ts`; the six audit columns on a new table                                                                 |
| a setting                    | `config.ts`                                                                        | `.env.example`                                                                                                                             |
| a retry                      | `retryAsync` from `@flash/flash-commons`, with a max attempt count                 | [decision 017](../../docs/explanation/decisions/017-retry-backoff-jitter.md)                                                               |
| a value used 3 or more times | one named constant or function in the layer that owns it                           | `libs/flash-commons` when other apps use it in 3+ places too ([rule](../../docs/explanation/decisions/016-dry-rule-of-three.md))           |
| a behaviour                  | a scenario in `specs/apps/flash/be/behaviours/` first, then bindings in `src/bdd/` | `npm run bdd:check` ([how](../../docs/how-to/add-a-behaviour.md))                                                                          |

Postgres has the last word on the stock and on one item per shopper (`WHERE sold < stock`, the partial unique index on
`(sale_id, user_id)`, `CHECK (sold <= stock)`). Those stay whatever Redis says.

## Commands

```bash
npx nx db:up flash-be            # Postgres and Redis in Docker
npx nx db:migrate flash-be
npx nx dev flash-be              # the API on :8080
npx nx test:quick flash-be       # typecheck, lint, unit tests (the architecture test among them)
npx nx test:integration flash-be # needs db:up
npx nx test:coverage flash-be    # unit and integration, 99% floor
```
