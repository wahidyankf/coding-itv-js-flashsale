# Hexagonal architecture

`flash-be` is split by the direction of its dependencies, not by feature. The reason is the sale path: its rules must
hold whatever sits behind them. Redis can be empty or down, and the payment provider is a mock. A rule that does not
know about Redis or Fastify cannot break when they change.

```text
src/
  domain/          rules and values; imports only Node built-ins and @flash/typekit
  application/     services (use cases) and ports/
  adapters/
    inbound/       http (Fastify routes, SSE), cli (seed options)
    outbound/      postgres, redis, memory, payment, system (clock)
  composition.ts   the one place that picks an adapter for a port
  main.ts          entry points: main, migrate, seed-sale
```

## The three layers

- **Domain.** Plain types and functions: the status of a sale, who may queue or reserve, how long a hold lives, whether
  a hold is still live, how many shoppers one tick admits, a user id and a ticket. They take values and return values.
  There is no I/O and no clock read, so a unit test needs no fake.
- **Application.** One service per use case (sale status, queue, reserve, pay, rate limit). A service orders the steps
  and calls ports. It decides nothing that a domain function can decide. Ports are small types in
  `application/ports/`, named in the language of the sale: `HoldGate`, `QueueStore`, `PurchaseRepository`.
- **Adapters.** Inbound adapters drive the application (HTTP, the seed command). Outbound adapters implement ports
  (Postgres through Kysely, Redis scripts, an in-process rate counter, the mock payment, the system clock).

## The rule and how it is kept

Dependencies point inward: adapters know the application and the domain, the application knows the domain, and the
domain knows nothing. The only package the inner layers may import is [`@flash/typekit`](../reference/typekit.md),
which has no dependency and no I/O (see [failures as values](failures-as-values.md)). The HTTP words (error codes, statuses,
sentences) live in the inbound HTTP adapter, and the rules the domain needs, such as the user id rule, live in the domain.
Inbound adapters never import outbound adapters, and outbound adapters import only ports and the
domain. Only `composition.ts` and the entry points see both sides.

`apps/flash-be/src/architecture_tests.ts` reads the imports of every source file and fails when one crosses a layer
it must not know. It runs with the unit tests, so the pre-push hook enforces it.

## What it buys, and what it costs

- A rule moves to the domain and gets a test without Redis or Postgres. The memory copies of the ports let the
  behaviour scenarios run at unit level against the same services that run in production.
- A store can change behind its port. Redis down is one more adapter state: the guarded gate and the Postgres fallback
  sit behind the same ports.
- It costs more files and one place of wiring. A change to a port touches the port, its adapters and its memory copy.

## Where the ports bend

Two ports carry a callback because the store must run the caller's code inside a lock: `ReservationRepository.rebuild`
hands the snapshot to a function while the sale row is locked, and `reserveWithoutRedis` asks whether Redis is ready
again under the same lock. The lock is a Postgres detail, but the order of steps is a rule, so the callback is the
smallest port that keeps both.
