# Purchase

Scenarios for paying for a held item and for asking what came of it.

## Directory Map

- [confirming.feature](confirming.feature) - `POST /api/v1/sales/:saleId/purchases` turns a hold into a purchase, once, refuses an unknown sale, a sale that has ended or a shopper who already bought, refunds when the item is gone, and refuses a confirm whose charge another confirm gave back first, keeping the hold.
- [outcome.feature](outcome.feature) - `GET /api/v1/sales/:saleId/purchases/me` tells the shopper who is logged in whether they bought, still hold, or have nothing.
