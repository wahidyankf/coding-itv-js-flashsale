# Hexagonal architecture crash course

Hexagonal architecture (also called ports and adapters) puts the rules of a program in the middle and the tools at the
edge. The middle says what it needs as small types, called ports. The edge plugs a real tool into each port: an HTTP
server, a database, a cache. Code depends only inward, so the rules never name the tools.

## Why this repo uses it

The sale rules must hold whatever sits behind them. Redis can be empty or down, and the payment is a mock. If the rule
"never oversell" lived in a route or next to a Redis call, every test of it would need Fastify, Postgres and Redis
running, and a Redis outage would be a change to the rule's code. With a hexagon, the rule is a plain function, the
service that orders the steps calls ports, and "Redis is down" is one more state of one adapter.

What we did not pick ([decision 004](../../explanation/decisions/004-hexagon-in-the-api-only.md)): layers by feature
with no enforced direction, microservices for the queue, the hold and the purchase, a dependency-injection container,
and a hexagon in `flash-web` too, which has no store and no sale rules to isolate.

What it costs: more files, and one change to a port touches the port, its adapters and its memory copy. A port with
only one real adapter is fine here: its job is to keep Redis and Postgres out of the services.

## How it looks here

We follow one request: a shopper asks to hold an item, `POST /api/v1/sales/:saleId/reservations`. The explanation page
[draws it through the layers](../../explanation/hexagonal-architecture.md#one-request-through-the-layers); here are the
same steps in the code.

**1. The route only speaks HTTP.** It reads the sale id, the shopper and the ticket from the request, calls the
service, and turns the answer into a status. It holds no rule
([`routes/reservations.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/reservations.ts)):

```ts
handler: async (request, reply) =>
	sendResult(
		reply,
		await deps.reservations.reserve(
			request.params.saleId,
			shopperOf(request),
			ticketOf(request),
		),
		// ...
```

**2. The service orders the steps.** One service per use case lives in `src/application`. It asks the domain whether
the sale is open, asks the queue whether the shopper was admitted, builds the hold request, and lets the gate decide
([`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts)):

```ts
async reserve(saleId, user, ticket) {
	const open = actionableSale(await sales.details(saleId), clock(), reserveBlock);
	if (open.isErr()) return new Err(open.error);
	const inLine = await admitted(saleId, user, ticket);
	if (inLine.isErr()) return new Err(inLine.error);
	const request = holdRequest(open.value, user, newId(), clock());
	const { answer, written } = await decide(request);
	// ...
```

The clock, the id maker and the wait all come in as arguments. The application reads no time and no randomness of its
own, so a test can fix them.

**3. The port is a small type in the words of the sale.** Ports live in [`src/application/ports/`](../../../apps/flash-be/src/application/ports). The suffix says what
kind a port is: a **Repository** is the Postgres record of a thing, a **Store** holds keyed state, and a **Gate** is
the fast check in front of Postgres ([`ports/hold-gate.ts`](../../../apps/flash-be/src/application/ports/hold-gate.ts)):

```ts
export type HoldGate = {
	reserve(request: ReserveRequest): Promise<Result<GateAnswer, UnreadableReply>>;
	release(saleId: string, user: Username): Promise<void>;
	confirm(saleId: string, user: Username): Promise<void>;
	// ...
```

**4. An outbound adapter implements the port.** The Redis adapter runs a Lua script and reads the reply back as the
domain's `GateAnswer`. It imports the port and the domain, never a service
([`redis-hold-gate.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts)):

```ts
export function createRedisHoldGate(redis: RedisClient): HoldGate {
	return {
		async reserve(request) {
			const reply = await redis.eval(RESERVE, {
			// ...
```

**5. The rule is a pure function in the domain.** `decideReservation` is the one order of checks that every store
follows: a purchase first, then the shopper's own live hold, then the stock. No I/O, no clock read. The service does
not call it: the memory copy calls it, the Postgres fallback runs its two steps, and the Redis script repeats it in Lua
([`domain/reservation.ts`](../../../apps/flash-be/src/domain/reservation.ts)):

```ts
export function decideReservation(
	state: ReservationState,
	request: ReserveRequest,
): ReserveDecision {
	return (
		earlyReservationAnswer(state, request) ??
		roomReservationAnswer(state, request)
	);
}
```

**6. One file picks the adapters.** [`composition.ts`](../../../apps/flash-be/src/composition.ts) is the only place
(with the entry points) that sees both sides. It wraps the Redis gate, then hands it to the service with the Postgres
repository, the real clock and the real wait:

```ts
const gate = createGuardedGate(createRedisHoldGate(redis));
// ...
reservations: createReservationService({
	gate,
	repository: createReservationRepository(db),
	sales, queue, clock,
	newId: randomUUID,
	options: { rebuildWaitMs: REBUILD_WAIT_MS, wait: sleep, random: Math.random },
}),
```

**7. Scenarios plug in memory adapters.** The unit layer of the behaviour scenarios wires the same production services
over memory copies of the ports, from `src/bdd/support/memory-*.ts`. `switchable` lets a scenario say "Redis is down"
([`queue-world.ts`](../../../apps/flash-be/src/bdd/support/queue-world.ts)):

```ts
const memoryGate = memoryHoldGate(clock);
const gate = createGuardedGate(switchable(memoryGate, isDown));
// ...
const reservations = createReservationService({
	gate,
	repository,
	sales: saleService,
	queue,
	clock /* ... */,
});
```

So a scenario at unit level tests the real `ReservationService`, not a copy of it.

## Try it here

[`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts) reads the imports of every source file and
fails when one crosses a layer it must not know. Run it on its own from `apps/flash-be`:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts --reporter=verbose src/architecture_tests.ts
```

Trimmed output:

```text
 ✓ |unit| src/architecture_tests.ts > hexagonal architecture > keeps the domain free of the application, adapters and packages
 ✓ |unit| src/architecture_tests.ts > hexagonal architecture > keeps the application free of adapters and packages
 ✓ |unit| src/architecture_tests.ts > hexagonal architecture > keeps inbound adapters away from outbound adapters and the wiring
 ✓ |unit| src/architecture_tests.ts > hexagonal architecture > lets outbound adapters implement ports, not use services or inbound adapters
 ✓ |unit| src/architecture_tests.ts > the route files > writes no path of its own: each one takes its path from the table
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

Now break a rule in your head. Say [`domain/sale.ts`](../../../apps/flash-be/src/domain/sale.ts) imports `../application/sale-service.js` to read a sale. The test
"keeps the domain free of the application, adapters and packages" would fail and list the import as
`domain/sale.ts -> application/sale-service.ts`, the form `violations` prints. The same happens if
[`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts) imports the Redis client, or a route imports a Postgres adapter. The fix is never to move the
check: pass what the inner layer needs through a port or an argument, and wire it in [`composition.ts`](../../../apps/flash-be/src/composition.ts).

## Read next

- Alistair Cockburn, [The Hexagonal (Ports & Adapters) Architecture](https://alistair.cockburn.us/hexagonal-architecture/),
  the article that named the pattern.
- Our [hexagonal architecture](../../explanation/hexagonal-architecture.md) page: the layers in full, where the ports
  bend, and the two names of a shopper.
- [Domain-driven design crash course](domain-driven-design.md): what goes inside the domain layer.
