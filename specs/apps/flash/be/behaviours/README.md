# flash-be Behaviours

The Gherkin corpus for the API, grouped by business area.

## Directory Map

- [health/](health/README.md) - liveness and readiness.
- [db/](db/README.md) - the database schema and its migrations.
- [auth/](auth/README.md) - accounts and logins: sign up, log in, the two cookies, refreshing and logging out.
- [sale/](sale/README.md) - the sale status a shopper reads, how reads are cached, the command that seeds a sale, and how an operator creates, changes, removes and lists sales.
- [degraded/](degraded/README.md) - serving shoppers while Redis is down, and the rebuild when it returns.
- [events/](events/README.md) - live updates of the sale and of a shopper's place over Server-Sent Events.
- [queue/](queue/README.md) - the waiting queue: joining, tickets, and admission.
- [reservation/](reservation/README.md) - holding an item: who may reserve, the hold time, and the stock.
- [rate-limit/](rate-limit/README.md) - the limit on write requests per user and per address.
- [purchase/](purchase/README.md) - paying for a hold, refunds, and the outcome a shopper can ask for.
- [recovery/](recovery/README.md) - rebuilding the reservation state in Redis from Postgres.
- [routing/](routing/README.md) - paths the API does not serve.
