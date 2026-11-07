# Sequences

Three flows that cross the parts of `flash-be`. The sequence diagrams show the order of the calls. The prose below each
one states the rule behind it. A request from the shopper is written with its method and path, where `:id` is the
sale id. The paths are in the [endpoint reference](../../../../docs/reference/http-endpoints.md).

## Reserve and pay

```mermaid
sequenceDiagram
  accTitle: Reserve and pay
  accDescr: The shopper joins the queue and receives a ticket. After admission the shopper reserves an item. The API asks the Redis gate, which counts buyers and live holds, then writes the hold to Postgres. The shopper then confirms. The API charges the payment provider, commits the purchase in one Postgres transaction, and tells the gate.
  participant S as Shopper
  participant A as flash-be
  participant R as Redis
  participant P as Postgres
  S->>A: POST /sales/:id/queue
  A->>R: add to the line
  A-->>S: ticket and place
  A->>R: admit the next shoppers
  S->>A: POST /sales/:id/reservations
  A->>R: gate script
  A->>P: save the hold
  A-->>S: reservation id and end
  S->>A: POST /sales/:id/purchases
  A->>A: charge the mock payment
  A->>P: lock, count, insert
  A->>R: mark the buyer
  A-->>S: purchase id
```

- The line and the admission live in Redis. A tick admits shoppers at the sale's rate; one instance wins each tick.
- The gate script runs as one step in Redis. It refuses when buyers plus live holds reach the stock. An expired hold
  stops counting by its time, so nothing sweeps it.
- The hold is written to Postgres too. Without that row, a Redis that lost its data could not give the hold back.
- Confirming is safe to repeat. The reservation id is the key for the charge and for the purchase.

## The hold ends during payment

```mermaid
sequenceDiagram
  accTitle: The hold ends during payment
  accDescr: The shopper confirms and the API charges the provider. While the charge runs, the hold ends and another shopper takes the last item. The commit sees that no item is left, so the API refunds the charge and answers sold out.
  participant S as Shopper
  participant A as flash-be
  participant Y as Payment
  participant P as Postgres
  S->>A: POST /sales/:id/purchases
  A->>P: check the hold
  A->>Y: charge
  Note over A,P: the hold ends, another shopper buys
  Y-->>A: charge accepted
  A->>P: lock, count, insert
  P-->>A: no item left
  A->>Y: refund
  A-->>S: 409 sold_out
```

- The hold is checked before the charge, but the commit decides. Postgres guards `sold < stock` under the sale row lock.
- A charge that cannot become a purchase is always refunded, so a shopper never pays for nothing.

## Redis goes away

```mermaid
sequenceDiagram
  accTitle: Redis goes away
  accDescr: When Redis fails, the API admits the shopper without a line. A reservation is decided in Postgres under the sale row lock, which counts sold items and live holds. When Redis returns, the next reservation marks the gate not ready, one instance rebuilds it from Postgres, and the gate is used again.
  participant S as Shopper
  participant A as flash-be
  participant R as Redis
  participant P as Postgres
  S->>A: POST /sales/:id/reservations
  A->>R: gate script
  R--xA: connection refused
  A->>P: lock the sale row
  A->>P: count sold and holds
  A->>P: save the hold
  A-->>S: reservation id and end
  Note over A,R: Redis returns
  S->>A: POST /sales/:id/reservations
  A->>R: mark not ready
  A->>P: rebuild buyers and holds
  A->>R: restore and mark ready
  A->>R: gate script
  A-->>S: answer from the gate
```

- The client fails at once while disconnected, so a request learns of the outage in milliseconds.
- Joining the queue returns a valid ticket and admits the shopper: the line only protects fairness, and the stock does
  not depend on it.
- After a failure the sale is marked stale in the process. The next reservation deletes the `ready` key, which makes one
  instance rebuild buyers and live holds from Postgres under the sale row lock.
