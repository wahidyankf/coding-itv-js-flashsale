# Domain-driven design crash course

Domain-driven design (DDD) shapes the code after the business it serves. The people who know the business and the code
use one shared set of words, the rules live in one place in those words, and the data that must stay consistent is
grouped behind one boundary. This repository takes a few of its ideas, not the whole toolbox.

## Why this repo uses it

The hard part of a flash sale is not the HTTP. It is a handful of rules that must hold at every moment: a sale never
sells more than its stock, a shopper buys at most one item, a hold ends on time, and only an admitted shopper may hold.
DDD gives those rules a home ([`apps/flash-be/src/domain/`](../../../apps/flash-be/src/domain)) and a vocabulary that is the same in the scenarios, the code,
the Redis keys and the docs. A reader who knows the word "hold" from a scenario finds `holdRequest`, `HoldGate` and
`sale:<saleId>:holds`.

We took three ideas: the shared language, pure domain rules, and the sale as the aggregate whose row lock is the
consistency boundary. We did not adopt the rest, on purpose:

- **No domain events bus.** Nothing in the API publishes "item sold" for others to react to. The live streams read
  their source on a timer and send only changes ([live updates](../../explanation/live-updates.md)). Each use case
  runs its steps in one call, which is easier to follow and to test than handlers that react to events.
- **No CQRS.** Reads and writes use the same tables. The only read model is a short in-process cache in front of the
  sale reads for shoppers' pages ([`sale-cache.ts`](../../../apps/flash-be/src/application/sale-cache.ts)); a rule that decides a write always reads the sale fresh.
- **No generic repository per entity.** Each port has the methods its use case needs. `PurchaseRepository` has one
  write, `commit`, that does the whole purchase step under the lock, not a `save(entity)`.
- **No rich entity objects.** The sale rules are functions over plain types, not methods on a `Sale` class. A class
  would suggest that a `Sale` in memory guards its own stock, but two shoppers paying at once each read their own
  copy. The guard is the row lock and the walls in Postgres
  ([the sale as the consistency boundary](../../explanation/hexagonal-architecture.md#the-sale-as-the-consistency-boundary)).

What it costs: the stock rule lives in three copies (the domain function, the SQL and the Redis Lua script), and the
copies must be kept in step ([decision 002](../../explanation/decisions/002-redis-gate-postgres-last-word.md)). A
shopper also has two names, `Username` and `UserId`, which a reader must keep apart.

## How it looks here

**1. One language, everywhere.** The words are **sale**, **hold**, **purchase**, **queue**, **ticket**, **shopper**
and **operator**. A hold is the shopper's word; its record is a reservation (the row, the route `/reservations`, its
id). They are the same thing. The scenario
[`reserving.feature`](../../../specs/apps/flash/be/behaviours/reservation/reserving.feature) reads:

```gherkin
Feature: Reserving an item
  Scenario: An admitted shopper reserves an item
```

and the domain type uses the same words ([`domain/reservation.ts`](../../../apps/flash-be/src/domain/reservation.ts)):

```ts
// The hold as the stores keep it. The purchase checks its id, and the rules check its end time.
export type Reservation = {
	saleId: string;
	user: Username;
	reservationId: string;
	expiresAt: Date;
};
```

**2. Value types that cannot be mixed up.** A user name and a user id are both text. Each is branded, so the compiler
refuses one where the other is meant, and only named functions make one
([`domain/user.ts`](../../../apps/flash-be/src/domain/user.ts)):

```ts
export type Username = string & { readonly __brand: "Username" };
export type UserId = string & { readonly __brand: "UserId" };

export function normalizeUser(raw: string): Username | undefined {
	const user = raw.trim().toLowerCase();
	return USERNAME_PATTERN.test(user) ? (user as Username) : undefined;
}
```

**3. Pure rules about a sale.** The status of a sale depends on the window first and the stock second. The reason a
shopper cannot hold is decided from the status alone. Both take values and return values
([`domain/sale.ts`](../../../apps/flash-be/src/domain/sale.ts)):

```ts
export function saleStatus(sale: Sale, now: Date): SaleStatus {
	if (now < sale.startsAt) return "upcoming";
	if (now >= sale.endsAt) return "ended";
	return sale.sold >= sale.stock ? "sold_out" : "active";
}

export function reserveBlock(status: SaleStatus): ReserveBlock | undefined {
	switch (status) {
		case "upcoming":
			return "sale_not_started";
		// ...
```

**4. The stock rule and the current sale.** `hasRoom` is the rule that the Postgres fallback and the memory copies
use; the Redis script does the same count in Lua. `pickCurrent` answers "which sale now": the running one, else the
next to open ([decision 010](../../explanation/decisions/010-one-sale-at-a-time.md)); the
[TypeScript crash course](typescript.md#nouncheckedindexedaccess-an-index-may-be-empty) shows it. Both are in
[`domain/sale.ts`](../../../apps/flash-be/src/domain/sale.ts):

```ts
export function hasRoom(
	sold: number,
	liveHolds: number,
	stock: number,
): boolean {
	return sold + liveHolds < stock;
}
```

**5. The sale is the aggregate.** Its row is the root; its holds and purchases belong to it by `sale_id`. Every write
that can break the stock or the one-item rule takes the sale row lock first. That lock is the consistency boundary,
and a shopper waits only behind shoppers of the same sale. The lock is `lockLiveSale`, shown in
[transactions and the row lock](postgres-and-kysely.md#transactions-and-the-row-lock).

**6. Use cases ask the domain, then call ports.** The purchase service decides nothing a domain function can decide.
It asks `confirmBlock` whether the sale is over and `holdRefusalOf` whether the hold is still good, and only then
charges ([`purchase-service.ts`](../../../apps/flash-be/src/application/purchase-service.ts), `refusalOf`):

```ts
if (await repository.findByUser(sale.id, user)) return "already_purchased";
const ended = confirmBlock(sale, clock());
if (ended !== undefined) return ended;
const hold = await repository.findReservation(sale.id, user);
return holdRefusalOf(hold, reservationId, clock());
```

## Try it here

The domain needs no Redis, no Postgres and no fake. Run the sale rules from `apps/flash-be`:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts --reporter=verbose src/domain/sale_tests.ts
```

Trimmed output:

```text
 ✓ |unit| src/domain/sale_tests.ts > sale rules > derives the status from the window first and the stock second
 ✓ |unit| src/domain/sale_tests.ts > sale rules > blocks a reservation unless the sale is active
 ✓ |unit| src/domain/sale_tests.ts > sale rules > has room for one more hold while sold and live holds stay under the stock
 ✓ |unit| src/domain/sale_tests.ts > pickCurrent > picks the sale whose window holds now, else the next to open
 Test Files  1 passed (1)
      Tests  8 passed (8)
```

To add a rule, start here: write a failing test next to the domain file, make it pass with a pure function, and only
then call it from a service.

## Read next

- Martin Fowler, [DDD Aggregate](https://martinfowler.com/bliki/DDD_Aggregate.html): the aggregate and its root in
  one short page.
- Eric Evans, [DDD Reference](https://www.domainlanguage.com/ddd/reference/): the definitions of the patterns, with a
  free PDF.
- Our pages: [hexagonal architecture](../../explanation/hexagonal-architecture.md) (the sale as the consistency
  boundary, and the two names of a shopper), the [concurrency control crash course](concurrency-control.md), and
  [hexagonal architecture crash course](hexagonal-architecture.md).
