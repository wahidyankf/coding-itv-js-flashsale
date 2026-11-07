# 009: An in-process mock payment with real rules

## Status

Accepted. The payment provider is a mock in the API process. The rules around it (idempotency, refund, retry) are real.

## Context

The brief is about the sale, not about money. But paying is the step that must be safe to repeat and safe to fail, and
the load test needs a payment that is slow like a real one.

## Decision

- The `Payment` port has `charge` and `refund`. The mock waits `PAYMENT_LATENCY_MS` (150 by default) and declines
  `PAYMENT_FAILURE_RATE` (2 percent by default) of the charges.
- The reservation id is the idempotency key: a repeated request does not charge again. A declined charge is forgotten, so a retry is a new attempt, and the hold stays.
- If the commit in Postgres says `sold_out` or `already_purchased`, the charge is refunded and the shopper gets `409`.
- The check of the hold runs before the charge. A hold that ends during the payment is sold if the item is still free.

## Alternatives considered

- **A real provider's sandbox (for example a test mode account).** It needs an account and keys, and the network in every
  test. A load test of thousands of charges would hit the provider's rate limits and measure the provider, not the sale.
- **A payment that always succeeds.** The refund path and the decline path would never run, and they are the risky part.
- **No payment step.** The hold would turn into a purchase with nothing to fail, and the order of steps (charge, then
  commit, then refund on refusal) would not be tested.

## Consequences

- It costs honesty about what is proved: nothing about a real provider. The mock keeps its charges in the process, so two
  instances do not share them, and across instances the commit and the unique constraint hold the idempotency. The mock
  cannot fail a refund. There is no price, only the reservation id.
- It buys a flow that is tested end to end with no outside service, and a latency (150 ms) that shows in the purchase p95 of the load runs.

## Revisit when

- A real provider is wanted: implement the same port, use the provider's own idempotency key, and queue refunds so a failed one is retried.
- A product has a price: the charge needs an amount and a currency.

## Related

- [Payment, idempotency and refunds](../payment-and-refunds.md).
- Code: [`mock-payment.ts`](../../../apps/flash-be/src/adapters/outbound/payment/mock-payment.ts), [`purchase-service.ts`](../../../apps/flash-be/src/application/purchase-service.ts), [`ports/`](../../../apps/flash-be/src/application/ports/).
