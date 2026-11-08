# Queue

Scenarios for the waiting queue in front of the sale: how a shopper joins and reads their place, and how the queue
lets shoppers in.

## Directory Map

- [joining.feature](joining.feature) - `POST /api/v1/sales/:saleId/queue` gives a ticket and a place, and refuses what it cannot take.
- [admission.feature](admission.feature) - the queue admits shoppers in order at the sale's rate, the running sale is served while a later sale is scheduled, and a ticket proves whose place it is.
