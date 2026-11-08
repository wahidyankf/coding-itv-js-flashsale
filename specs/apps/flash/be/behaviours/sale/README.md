# Sale

Scenarios for the sale itself: the status a shopper reads, how reads are cached, how the seed command and an operator (through the API) create a sale, and how the operator changes, removes and lists sales.

## Directory Map

- [status.feature](status.feature) - `GET /api/v1/sales/:saleId` reports the sale and its status; `GET /api/v1/sales/current` is the running sale, else the next one to open, else none.
- [caching.feature](caching.feature) - sale reads are answered from a short cache; writes never read it.
- [seeding.feature](seeding.feature) - the seed command creates a sale with a stock and a window.
- [admin.feature](admin.feature) - an operator, logged in, creates a sale through the API; windows that overlap are refused.
- [operating.feature](operating.feature) - a logged-in operator changes, removes and lists sales; a started sale keeps its start and its stock, a sale with a purchase stays, a removed sale is gone for shoppers, and an unknown sale is refused.
