# Explanation

Pages that explain why the system is built the way it is. They give the reasons and the trade-offs. For the exact
behaviour, read the specs.

## Directory Map

- [liveness-and-readiness.md](liveness-and-readiness.md) - why `/health` checks nothing and `/ready` checks the stores.
- [waiting-queue.md](waiting-queue.md) - why shoppers queue before they reserve, and how the queue admits them.
- [reservations-and-recovery.md](reservations-and-recovery.md) - how a hold is counted, why Postgres has the last word, and how Redis is rebuilt.
- [payment-and-refunds.md](payment-and-refunds.md) - how a hold becomes a purchase, why it is safe to repeat, and when a charge is refunded.
- [rate-limiting.md](rate-limiting.md) - why write requests are limited twice, and what happens when Redis is down.
