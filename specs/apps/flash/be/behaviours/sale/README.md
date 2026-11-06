# Sale

Scenarios for the sale itself: the status a shopper reads, how reads are cached, and how an operator creates a sale from the command line or through the API.

## Directory Map

- [status.feature](status.feature) - `GET /sales/:saleId` and `GET /sales/current` report the sale and its status.
- [caching.feature](caching.feature) - sale reads are answered from a short cache; writes never read it.
- [seeding.feature](seeding.feature) - the seed command creates a sale with a stock and a window.
- [admin.feature](admin.feature) - an operator creates a sale through the API with a token; windows that overlap are refused.
