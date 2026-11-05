# flash-be Behaviours

The Gherkin corpus for the API, grouped by business area.

## Directory Map

- [health/](health/README.md) - liveness and readiness.
- [config/](config/README.md) - how the API reads its settings.
- [db/](db/README.md) - the database schema and its migrations.
- [sale/](sale/README.md) - the sale status a shopper reads, and the command that seeds a sale.
- [queue/](queue/README.md) - the waiting queue: joining, tickets, and admission.
- [reservation/](reservation/README.md) - holding an item: who may reserve, the hold time, and the stock.
- [purchase/](purchase/README.md) - paying for a hold, refunds, and the outcome a shopper can ask for.
- [recovery/](recovery/README.md) - rebuilding the reservation state in Redis from Postgres.
- [routing/](routing/README.md) - paths the API does not serve.
