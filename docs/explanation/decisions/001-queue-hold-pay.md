# 001: Queue, hold, pay instead of one buy call

## Status

Accepted. A purchase is three calls (join the queue, hold an item, pay), not one.

## Context

The task asks for "an endpoint to attempt a purchase". A flash sale gets most of its traffic in the first seconds, the
stock is small, and payment is slow and can fail (the mock takes 150 ms and declines 2 percent by default). A shopper must
never be charged for an item that is gone.

## Decision

- `POST /sales/:saleId/queue` joins and returns a signed ticket. Each second one instance admits the next shoppers.
- `POST /sales/:saleId/reservations` takes a hold on one item for a limited time. Only an admitted shopper may call it.
- `POST /sales/:saleId/purchases` pays for the hold. **Buy Now** in the page makes the first two calls; **Confirm purchase** makes the third.

## Alternatives considered

- **One buy call that charges and sells.** It must either keep a lock across the 150 ms payment, or charge first and refund
  when the item is gone. Both put the slow step in the contended path.
- **Hold and pay with no queue.** The gate is cheap, but a burst would still reach Postgres for every hold, and there
  would be no order. The queue gives a fair order and a steady flow.
- **A broker (Kafka, RabbitMQ) as the queue.** Another service to run for a list of place numbers. A Redis sorted set
  does it, and Redis is already there. A lost place costs a rejoin, because purchases live in Postgres.
- **Pay first, claim after.** The shopper pays for an item that may be gone.

## Consequences

- It costs three calls for the client, stock that a hold keeps from others until it ends, a wait of up to one tick in a
  quiet sale, and a place lost on a Redis restart (the shopper gets `404 not_in_queue` and joins again).
- It buys a charge only for an item the shopper holds, a Postgres lock that is never held across the payment, a reserve
  route that cannot be skipped, and a declined payment that keeps the hold for another try.

## Revisit when

- Many holds expire unpaid and real buyers see "sold out" while items sit in holds: shorten the hold time first.
- A queue place must survive a Redis restart: persist places, or move them to Postgres.

## Related

- [The waiting queue](../waiting-queue.md), [reservations and recovery](../reservations-and-recovery.md) and [payment and refunds](../payment-and-refunds.md).
- Code: [`queue-service.ts`](../../../apps/flash-be/src/application/queue-service.ts), [`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts), [`purchase-service.ts`](../../../apps/flash-be/src/application/purchase-service.ts), and the routes in [`adapters/inbound/http/`](../../../apps/flash-be/src/adapters/inbound/http/).
