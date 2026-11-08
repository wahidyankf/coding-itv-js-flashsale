# 004: A hexagon in flash-be only

## Status

Accepted. The API is split into domain, application and adapters. The web app is a plain React app.

## Context

The sale rules must hold whatever sits behind them: Redis can be empty or down, and the payment is a mock. `flash-be` has two
stores and many rules. `flash-web` has no store and no sale rules. It shows the sale and passes calls on to the API.

## Decision

- `flash-be` has `domain` (no I/O), `application` (use cases and `ports/`), and `adapters` (inbound HTTP and CLI,
  outbound Postgres, Redis, memory, crypto, payment, clock). Only [`composition.ts`](../../../apps/flash-be/src/composition.ts) and the entry points pick an adapter for a port.
- [`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts) reads every import and fails on a wrong one, so the pre-push hook keeps the split.
- `flash-web` keeps routes, components and hooks, with one client for the API. It has no ports layer.

## Alternatives considered

- **Layers by feature with no enforced direction.** Rules drift into routes, and a rule can only be tested with the stores running.
- **A hexagon in `flash-web` too.** It would add ports for one API with one implementation, with nothing to isolate.
- **Microservices (queue, reservation, payment).** They add network hops to the hot path and a distributed step between hold
  and purchase. The API instances are already identical and stateless, so there is no load reason to split them.
- **A dependency-injection container.** [`composition.ts`](../../../apps/flash-be/src/composition.ts) wires by hand in one short file, which a reader can follow.

## Consequences

- It costs more files and one place of wiring. A change to a port touches the port, its adapters and its memory copy.
  Most ports have one real implementation, on purpose: they keep a service from naming Redis or Postgres.
- It buys rules that are unit-tested without stores, and scenarios that run the production services against memory ports.
- `flash-web` copies a few small rules of the API that only the two of them use (the user name rule, the password limits, the
  ticket header and the proxy's `not_found` reply). [`same_as_be_tests.ts`](../../../apps/flash-web/src/same_as_be_tests.ts) fails if a copy drifts. Time units, HTTP status numbers and the id rule
  (`isUuid`) are not copied:
  they come from `@flash/flash-commons` (see [016](016-dry-rule-of-three.md)).

## Revisit when

- `flash-web` gets rules of its own, or a second client appears.
- A port gets a real second implementation, such as a payment provider.
- One part (for example payment) needs to scale or deploy apart from the rest.

## Related

- [Hexagonal architecture](../hexagonal-architecture.md) and the C4 [components view](../../../specs/apps/flash/c4/components.md).
- Code: [`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts), [`composition.ts`](../../../apps/flash-be/src/composition.ts), [`same_as_be_tests.ts`](../../../apps/flash-web/src/same_as_be_tests.ts).
