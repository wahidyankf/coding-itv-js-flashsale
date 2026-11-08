# 011: Soft delete everywhere

## Status

Accepted. Nothing is hard-deleted. Every table has six audit columns, and unique indexes ignore deleted rows.

## Context

A flash sale is a record of who got what and who changed what. Operators can remove a sale, and sessions end. With real
accounts (see [007](007-accounts-and-cookie-sessions.md)) there is someone to name for every change.

## Decision

- Every table has `created_at`, `created_by`, `updated_at`, `updated_by`, `deleted_at` and `deleted_by`. The `*_by` columns point at `users`.
- A removal sets `deleted_at` and `deleted_by`. Every read adds `deleted_at IS NULL`. A removed sale takes its holds with it in one transaction, a spent hold is marked deleted by the buyer, and an expired hold that the shopper takes again is marked deleted by the shopper while a new row records the new hold.
- Unique indexes are partial (`WHERE deleted_at IS NULL`), so a removed row frees its key.
- [`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts) fails if product code calls `deleteFrom(`. [`schema_integration_tests.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/schema_integration_tests.ts) checks that each table has the six columns and a `Database` type entry.
- No row is ever hard-deleted. The only hard deletes are in `down` migrations, which are not part of the shipped process.

## Alternatives considered

- **Hard delete.** It is simpler, but a removed sale, a replayed session or a spent hold leaves no trace, and `deleted_by` has nothing to say.
- **A history table or triggers.** They duplicate each table and hide who did what in the database, away from the code.
- **Event sourcing.** It is much more than a flash sale needs, and it makes every read a replay or a projection.

## Consequences

- It costs a filter on every read, and a missed filter shows deleted data. Tables only grow. A column such as
  `purchases.reservation_id` keeps a plain unique constraint, which is safe because a hold is spent once.
- It buys a record of every change and removal with its author, and an unchanged key rule: a name or a session hash is free again after its row is removed.

## Revisit when

- A rule says that data must be erased, not marked: add an erase process for personal data.
- Reads forget the filter more than once: put the filter in a view.
- Table size slows a query: archive old rows.

## Related

- [Admin and sale windows](../admin-and-sale-windows.md), [authentication](../authentication.md) and the C4 [data model](../../../specs/apps/flash/c4/data-model.md).
- Code: [`migrations/`](../../../apps/flash-be/src/adapters/outbound/postgres/migrations/), [`database.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/database.ts), [`architecture_tests.ts`](../../../apps/flash-be/src/architecture_tests.ts).
