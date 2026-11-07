# Sale

Scenarios for the sale itself: the status a shopper reads, how reads are cached, how an operator creates a sale from the command line or through the API, and how the operator changes, removes and lists sales.

## Directory Map

- [status.feature](status.feature) - `GET /sales/:saleId` reports the sale and its status; `GET /sales/current` is the running sale, else the next one to open, else none.
- [caching.feature](caching.feature) - sale reads are answered from a short cache; writes never read it.
- [seeding.feature](seeding.feature) - the seed command creates a sale with a stock and a window.
- [admin.feature](admin.feature) - an operator creates a sale through the API with a token; windows that overlap are refused.
- [operating.feature](operating.feature) - an operator changes, removes and lists sales with a token; a started sale keeps its start and its stock, and a sale with a purchase stays.
