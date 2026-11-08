# 002: A Redis hold gate, with Postgres as the last word

## Status

Accepted. Redis decides fast who gets an item. Postgres refuses any sale that breaks the stock or the one-item rule.

## Context

The task says stock is limited and "must never be oversold", and a user may buy one item. Hundreds of shoppers can ask
for the last items in the same moment. The rule must hold even if the fast path is wrong or empty.

## Decision

- One Lua script in Redis counts buyers plus live holds and adds a hold, as one step. Two requests cannot take the last item.
- Postgres keeps three walls that stay whatever Redis says: `UPDATE sales SET sold = sold + 1 ... WHERE sold < stock`,
  `CHECK (sold <= stock)`, and a unique index on `(sale_id, user_id)` for purchases and for holds.
- Every hold is also written to Postgres, so Redis can be rebuilt from it. A hold that ends stops counting by its expiry time.

## Alternatives considered

- **A Postgres row lock only.** It is correct and simple. But every reserve then waits in line on the one sale row. The
  script keeps a rush off that row. No load run has measured a Postgres-only design, so this reason is a design argument, not a measurement.
- **Redis only.** Fast, but a restart loses it, and nothing catches a bug in the script.
- **Optimistic locking (a version column and retries).** Under hundreds of requests for a few items most attempts fail
  and retry, so the load on the one row grows with the contention.
- **Redis first, Postgres later (write-behind).** A crash could lose sales that were already confirmed.

## Consequences

- It costs a second store, a second write for each hold, and rebuild code. Postgres counts `sold`, not holds, so after a
  Redis fault there can briefly be more holds than items. The payment step still refuses the extra buyer, and the charge is refunded.
- It buys a sale that cannot oversell or sell one shopper twice, whatever Redis holds. The `smoke`, `full`, `chaos`, `burst` and
  `contention` runs kept `sold` equal to the purchase rows every time.

## Revisit when

- The `sold` row of one sale is the limit. Every purchase updates it, so one sale is capped by what that row can take.
- The Redis script becomes hard to keep in step with the Postgres rules.

## Related

- [Reservations and recovery](../reservations-and-recovery.md) and [payment and refunds](../payment-and-refunds.md).
- Code: [`redis-hold-gate.ts`](../../../apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts), [`purchase-repository.ts`](../../../apps/flash-be/src/adapters/outbound/postgres/purchase-repository.ts) and the [migrations](../../../apps/flash-be/src/adapters/outbound/postgres/migrations/).
