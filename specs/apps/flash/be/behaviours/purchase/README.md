# Purchase

Scenarios for paying for a held item and for asking what came of it.

## Directory Map

- [confirming.feature](confirming.feature) - `POST /sales/:saleId/purchases` turns a hold into a purchase, once, and refunds when the item is gone.
- [outcome.feature](outcome.feature) - `GET /sales/:saleId/purchases/:userId` tells a shopper whether they bought, still hold, or have nothing.
