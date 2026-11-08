# Postgres and Kysely crash course

Postgres is the database of `flash-be`, and Kysely is a typed SQL query builder for TypeScript. Kysely writes SQL from
method calls and checks table and column names against a type, but it adds no model layer. This page explains why the
sale is kept this way and how the code uses both. The official docs teach the rest.

## Why this repo uses them

**The problem.** The task says the stock must never be oversold, and a shopper may buy one item. Hundreds of shoppers
can ask for the last items in the same moment, and Redis, the fast gate in front, can be wrong, empty or down. Something
must refuse a bad sale whatever Redis said.

**What Postgres gives us here.** Three walls that hold under any load: a guarded update that raises `sold` only while
`sold < stock`, a check constraint that `sold` never passes `stock`, and one live purchase and one live hold per shopper
and sale, kept by unique indexes. A row lock on the sale
makes the steps of one purchase take turns. This is decision
[002](../../explanation/decisions/002-redis-gate-postgres-last-word.md).

**What we did not pick.**

- Redis only, optimistic locking with retries, or Redis first with a late write to Postgres. Decision 002 says why each
  was weighed and left.
- An ORM. The walls are a few exact SQL statements, and Kysely keeps them visible and typed (see "What was left out" in
  the [root README](../../../README.md)).
- A hard delete. Rows are marked deleted instead ([011](../../explanation/decisions/011-soft-delete-everywhere.md)).

**What it costs us.** Every purchase raises `sold` on one row, so one sale is capped by what that row can take. Every
hold is written twice, to Redis and to Postgres. Every read must add the `deleted_at` filter. Each API instance opens a
pool of ten connections, so more instances need a higher `max_connections`.

## The ideas this repo uses

### The `Database` type

Kysely knows the tables only through one type. [`database.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/database.ts)
has one entry per table, and every table shares the audit columns. `Generated<T>` marks a column the database fills, so
an insert may leave it out:

```ts
sales: Audit & {
	id: Generated<string>;
	// ... product_id, name, starts_at, ends_at ...
	stock: number;
	sold: Generated<number>;
	// ...
};
```

The migrations change the tables; this type must follow them by hand. [`schema_integration_tests.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/schema_integration_tests.ts) checks both.

### The query builder, and `sql` for the rest

A query is a chain of calls, and a wrong column name is a type error. Where SQL says it better, the `sql` template adds
a raw piece with safe parameters. [`queries.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/queries.ts):

```ts
export function purchasesWithBuyer(from: Kysely<Database>) {
	return from
		.selectFrom("purchases")
		.innerJoin("users", "users.id", "purchases.user_id")
		.selectAll("purchases")
		.select("users.username")
		.where(live("purchases"))
		.where(live("users"));
}
```

### Soft delete with `live()`

Nothing is erased. A removal sets `deleted_at`, and every read adds `live(table)`, which is `<table>.deleted_at is null`.
The unique indexes are partial, so a removed row frees its key.
[Migration 0003](../../../apps/flash-be/src/adapters/outbound/postgres/migrations/0003_users_products_audit.ts) writes
them in plain SQL:

```ts
await sql`create unique index purchases_one_per_user on purchases (sale_id, user_id) where deleted_at is null`.execute(
	db,
);
```

Why the repo never hard-deletes is in decision 011.

### Transactions and the row lock

`db.transaction().execute(async (trx) => ...)` commits when the function returns and rolls back when it throws.
`lockLiveSale` takes `SELECT ... FOR UPDATE` on the sale row, so a second transaction on the same sale waits at that line
until the first one ends:

```ts
export function lockLiveSale(trx: Kysely<Database>, saleId: string) {
	return trx
		.selectFrom("sales")
		.selectAll()
		.where("id", "=", saleId)
		.where(live("sales"))
		.forUpdate()
		.executeTakeFirst();
}
```

[`commitPurchase`](../../../apps/flash-be/src/adapters/outbound/postgres/purchase-repository.ts) takes the lock first,
and then runs its steps in a fixed order. The order is the rule:

1. Lock the sale row.
2. A purchase for this reservation already exists: return it again (a retried payment).
3. The shopper already bought: answer `already_purchased`.
4. The guarded update below finds no item left: answer `sold_out`.
5. Insert the purchase and mark the hold spent. The transaction commits.

### The guarded update

`takeItem` raises `sold` only while items remain. Postgres checks the `WHERE` and writes in one step, so two
transactions cannot both take the last item. The `CHECK (sold <= stock)` from
[migration 0002](../../../apps/flash-be/src/adapters/outbound/postgres/migrations/0002_create_sales.ts) repeats the rule:

```ts
const updated = await trx
	.updateTable("sales")
	.set({
		sold: sql`sold + 1`,
		updated_at: dbNow,
		updated_by: userId,
	})
	.where("id", "=", saleId)
	.where(live("sales"))
	.where(sql<boolean>`sold < stock`)
	.executeTakeFirst();
return updated.numUpdatedRows !== 0n;
```

### Hand-written migrations

Each file in [`migrations/`](../../../apps/flash-be/src/adapters/outbound/postgres/migrations/) exports `up` and `down`.
[`migrator.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/migrator.ts) gives the folder to Kysely's
`Migrator` with a `FileMigrationProvider`, which runs them in name order and records each one in `kysely_migration`.
`npx nx db:migrate flash-be` applies them.

### The pool

`createDb` builds `new Kysely<Database>` over a `PostgresDialect` with a `pg.Pool`. The pool keeps the default size of
ten. The app and the commands close it with `db.destroy()`.

## Try it here

Start the dev stack, or check that it runs. It does not touch your data:

```bash
npx nx db:up flash-be
docker compose -f compose.dev.yaml exec postgres psql -U flash -d flash -c '\d sales'
```

The `Check constraints` part of the output shows the walls:

```text
Check constraints:
    "sales_sold_within_stock" CHECK (sold <= stock)
    "sales_stock_not_negative" CHECK (stock >= 0)
    "sales_window_is_ordered" CHECK (ends_at > starts_at)
```

Run `\d purchases` the same way to see the partial index `purchases_one_per_user`. Then run the purchase tests
against a real Postgres. The integration setup creates a fresh database for the run and drops it at the end:

```bash
cd apps/flash-be
npx vitest run --config vitest.integration.config.ts src/adapters/outbound/postgres/purchase_integration_tests.ts --reporter=verbose
```

```text
 ✓ |integration| ... > committing a purchase > returns the same purchase for the same reservation, without selling twice 47ms
 ✓ |integration| ... > committing a purchase > refuses a second purchase by the same user 7ms
 ✓ |integration| ... > committing a purchase > refuses a purchase when no item is left 7ms
      Tests  3 passed (3)
```

## Traps to avoid

- **`ON CONFLICT` must name the partial index.** A partial unique index is matched only when the conflict target repeats
  its `WHERE`. `upsertHold` in
  [`reservation-repository.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/reservation-repository.ts) writes
  `.columns(["sale_id", "user_id"]).where("deleted_at", "is", null)` for this reason.
- **Counts and row counts are not plain numbers.** `numUpdatedRows` is a `bigint`, so the code compares with `0n`. A
  `count(*)` comes back as text, so `countHoldsOfOthers` reads it with `countAll<string>()` and `Number(...)`.
- **A missed `live()` shows deleted data.** Decision 011 names it as the cost. The shared queries in [`queries.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/queries.ts) add the
  filter for both joined tables, so the repositories cannot disagree about what "live" means.
- **A rebuild snapshot must hold the lock.** The Redis rebuild reads holds inside a transaction that locks the sale, so
  no hold is written between the read and the restore (see
  [reservations and recovery](../../explanation/reservations-and-recovery.md#when-redis-loses-its-state)).
- **A migration never reads live code.** Migration 0002 freezes its defaults (`HOLD_SECONDS_DEFAULT = 120`) in the file,
  or an old database would change with the code.

## Read next

- Kysely docs: [getting started](https://kysely.dev/docs/intro),
  [transactions](https://kysely.dev/docs/examples/transactions/simple-transaction) and
  [migrations](https://kysely.dev/docs/migrations). The site documents the current release; this repo has 0.29.
- PostgreSQL 18 docs: [row-level locks](https://www.postgresql.org/docs/18/explicit-locking.html#LOCKING-ROWS) and
  [partial indexes](https://www.postgresql.org/docs/18/indexes-partial.html).
- node-postgres: [the pool](https://node-postgres.com/apis/pool).
- [Serving without Redis](../../explanation/serving-without-redis.md) for the reserve path that runs on Postgres alone,
  and [payment and refunds](../../explanation/payment-and-refunds.md) for what happens around the commit.
