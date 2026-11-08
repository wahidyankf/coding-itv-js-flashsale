# Concurrency control crash course

Concurrency control is how a system stays correct when many requests touch the same data at the same moment. Two
requests can both read "one item left" and both decide to take it. The fix is to make the read and the write one step
that nothing can split: an atomic script, a conditional update, a lock, or a constraint the database checks itself.

## Why this repo uses it

The stock must never be oversold, and a shopper may buy one item. In a flash sale hundreds of shoppers
ask for the last items in the same second, so a race is the normal case, not a rare bug. This repository answers it
in layers ([decision 002](../../explanation/decisions/002-redis-gate-postgres-last-word.md)): a Redis Lua script
decides fast who gets a hold, and Postgres has the last word with walls that stay whatever Redis says.

The purchase itself is three calls, queue then hold then pay
([decision 001](../../explanation/decisions/001-queue-hold-pay.md)), so the slow payment never runs inside a lock.

What we did not pick ([decision 002](../../explanation/decisions/002-redis-gate-postgres-last-word.md)): a Postgres
row lock only, where every hold would wait in line on the one sale row; Redis only, which a restart loses; and
optimistic locking, where most attempts fail and retry under contention. One buy call that charges and sells would hold
a lock across the payment (001). Overlapping sale windows are refused by an advisory lock and a check, not an exclusion
constraint, because fixtures and the seed command make overlaps on purpose
([decision 010](../../explanation/decisions/010-one-sale-at-a-time.md)).

What it costs: a second store, a second write for each hold, rebuild code, and three calls for the client. After a
Redis fault there can briefly be more holds than items; the payment step still refuses the extra buyer, and the
charge is refunded.

## How it looks here

```mermaid
flowchart LR
  accTitle: Queue, hold and pay with their guards
  accDescr: A shopper joins the queue and gets a ticket. An admitted shopper reserves, and a Redis script decides the hold in one step. Postgres keeps a copy of the hold. Paying charges first, then commits under the sale row lock, where the conditional update and the constraints refuse an oversell.
  queue["Join queue: ticket"]
  hold["Reserve: Lua script"]
  copy["Hold row in Postgres"]
  pay["Charge the payment"]
  commit["Commit under row lock"]
  queue -->|admitted| hold
  hold -->|written to| copy
  copy -->|shopper pays| pay
  pay -->|then| commit
  classDef redis fill:#DE8F05,stroke:#000000,color:#000000
  classDef pg fill:#0173B2,stroke:#000000,color:#FFFFFF
  classDef app fill:#029E73,stroke:#000000,color:#000000
  classDef default fill:#808080,stroke:#000000,color:#000000
  class queue,hold redis
  class copy,commit pg
  class pay app
```

**1. The hold is one Redis script.** A Lua script runs as one Redis call, so no other command runs between its count
and its write. It refuses a buyer, gives a shopper back their own live hold, counts buyers plus live holds, and only
then adds the hold. If Redis has no state for the sale yet, it answers `{4}` and the service rebuilds the gate from
Postgres first. The script is in the [Redis crash course](redis.md#lua-scripts-with-eval).

**2. The payment runs outside the lock.** `chargeAndCommit` charges first and commits after. A commit that finds the
sale sold out, or the shopper already a buyer, refunds the charge
([`purchase-service.ts`](../../../apps/flash-be/src/application/purchase-service.ts)):

```ts
const charge = await payment.charge(reservationId);
if (charge.isErr()) return new Err("payment_failed");
// ...
if (result.kind !== "purchased") {
	await payment.refund(ref);
	return new Err(result.kind);
}
```

**3. The commit locks the sale row, and a retry is safe.** Two confirmations for one sale take turns on
`SELECT ... FOR UPDATE` (`lockLiveSale`). The reservation id is the idempotency key: a retried payment finds its
purchase and writes nothing twice. The steps of the commit are in
[transactions and the row lock](postgres-and-kysely.md#transactions-and-the-row-lock).

**4. The sold count moves only while items remain.** `takeItem` is `UPDATE ... WHERE sold < stock`. Zero rows updated
means sold out ([the guarded update](postgres-and-kysely.md#the-guarded-update)).

**5. The database checks the rules itself.** Even if the code above had a bug, Postgres refuses the row:
`CHECK (sold <= stock)` on the sale, and a partial unique index on `(sale_id, user_id)` for purchases and for holds, so
one shopper has one live row of each ([soft delete with `live()`](postgres-and-kysely.md#soft-delete-with-live)).

**6. Without Redis, the same rule runs under the row lock.** `reserveUnderLock` takes the sale lock, then calls the
domain's two steps of `decideReservation`, so the fallback cannot hold more than the stock either
([`reservation-repository.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/reservation-repository.ts)).

**7. Sale windows take an advisory lock.** An advisory lock is a lock on a number the application picks, not on a row:
Postgres only makes sure two transactions never hold the same number at once. Two operators who send overlapping
windows at once must not both pass the overlap check, so every create and change takes one transaction-scoped advisory
lock first
([`sale-admin.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/sale-admin.ts)):

```ts
const SALE_WINDOW_LOCK = 7_204_001;

// Takes the sale-window lock for this transaction.
async function lockSaleWindows(trx: Transaction<Database>): Promise<void> {
	await sql`select pg_advisory_xact_lock(${sql.lit(SALE_WINDOW_LOCK)})`.execute(
		trx,
	);
}
```

## Try it here

Two scenarios send many shoppers at once: 30 shoppers for 10 items. Run their unit bindings from `apps/flash-be`:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts --reporter=verbose src/bdd/reservation_reserving_tests.ts src/bdd/purchase_confirming_tests.ts
```

Trimmed output:

```text
 ✓ ... Scenario: Many buyers confirming at once sell exactly the stock > Then 10 purchases are made
 ✓ ... Scenario: Many buyers confirming at once sell exactly the stock > And 0 items remain
 ✓ ... Scenario: Many shoppers reserving at once never hold more than the stock > Then 10 reservations are granted
 ✓ ... Scenario: Many shoppers reserving at once never hold more than the stock > And 20 shoppers are told the item is sold out
 Test Files  2 passed (2)
      Tests  151 passed (151)
```

The unit layer uses the memory copies of the ports; the integration binding of the same scenarios runs them against
real Postgres and Redis. With the dev stack up (`npx nx db:up flash-be`), you can read the walls straight from Postgres.
This query only reads:

```bash
docker compose -f compose.dev.yaml exec postgres psql -U flash -d flash \
  -c "select conname, pg_get_constraintdef(oid) from pg_constraint where conrelid = 'sales'::regclass and contype = 'c' order by conname;" \
  -c "select indexname, indexdef from pg_indexes where indexname like '%one_per_user';"
```

Trimmed output:

```text
 sales_sold_within_stock  | CHECK ((sold <= stock))
 purchases_one_per_user    | CREATE UNIQUE INDEX purchases_one_per_user ON public.purchases USING btree (sale_id, user_id) WHERE (deleted_at IS NULL)
 reservations_one_per_user | CREATE UNIQUE INDEX reservations_one_per_user ON public.reservations USING btree (sale_id, user_id) WHERE (deleted_at IS NULL)
```

## Read next

- PostgreSQL, [Explicit Locking](https://www.postgresql.org/docs/current/explicit-locking.html): row-level locks
  (`FOR UPDATE`) and advisory locks.
- Redis, [Scripting with Lua](https://redis.io/docs/latest/develop/programmability/eval-intro/): why a script runs
  atomically.
- Our pages: [reservations and recovery](../../explanation/reservations-and-recovery.md),
  [payment and refunds](../../explanation/payment-and-refunds.md), the
  [Postgres and Kysely crash course](postgres-and-kysely.md) and the [resilience crash course](resilience.md).
