# 010: One sale at a time

## Status

Accepted. The current sale is the one running, else the next to open. Windows of sales may not overlap.

## Context

The task sells one product in limited quantity inside one configurable window. The page and the queue need to know which
sale "now" means. If two sales could run together, "current" would be a guess.

## Decision

- The current sale is the one whose window holds now, else the one that opens next, else none. A sale that is over is not
  current, but it can still be read by its id. `GET /api/v1/sales/current` and `admitCurrentSale` (the admission timer)
  both ask `findCurrent` in [`sale-repository.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/sale-repository.ts),
  which writes the rule in SQL. `pickCurrent` in the domain is the same rule for the memory copy of the store, and
  `sale-rules_integration_tests.ts` keeps the two in step.
- The operator routes refuse a window that overlaps another sale (`409 sale_overlaps`), on create and on change. The check
  and the write run in one transaction under a Postgres advisory lock, so two operators who send the same window get one sale.
- A sale may open at the moment another one closes. The seed command does not check overlap.

## Alternatives considered

- **Several sales at once.** The data would allow it, because every Redis key and table row has the sale id. But the page,
  the "current" endpoint and the queue timer would need a choice of sale. The task does not ask for it.
- **"The sale that opens last" as current.** A later sale would take the page from the one that is running.
- **A database exclusion constraint on the window.** It would make the rule absolute, but many fixtures and the seed
  command create overlapping sales on purpose. They would need to change first.
- **Leave overlap to the operator.** One mistake would leave two sales that both claim to be current.

## Consequences

- It costs a rule that lives in the admin routes only. A sale made by the seed command or by a fixture can overlap, and
  then `findCurrent` still answers (the running sale that started first), but the rule is not held by the database.
- It buys a simple model for the page, the queue and the operator: one answer to "which sale".

## Revisit when

- Two products must be on sale at once: the page and the timer need a sale chosen by the shopper, not by time.
- The seed command or a script is used on real data: add the exclusion constraint and change the fixtures first.

## Related

- [Admin and sale windows](../admin-and-sale-windows.md) and [the waiting queue](../waiting-queue.md).
- Code: [`domain/sale.ts`](../../../apps/flash-be/src/domain/sale.ts), [`admission.ts`](../../../apps/flash-be/src/application/admission.ts), [`sale-admin.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/sale-admin.ts).
