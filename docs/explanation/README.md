# Explanation

Pages that explain why the system is built the way it is. They give the reasons and the trade-offs. For the exact
behaviour, read the specs.

## Directory Map

Read the sale path in order: it follows one shopper from the queue to the purchase.

The sale path:

- [waiting-queue.md](waiting-queue.md) - why shoppers queue before they reserve, and how the queue admits them.
- [reservations-and-recovery.md](reservations-and-recovery.md) - how a hold is counted, why Postgres has the last word, and how Redis is rebuilt.
- [payment-and-refunds.md](payment-and-refunds.md) - how a hold becomes a purchase, why it is safe to repeat, and when a charge is refunded.
- [live-updates.md](live-updates.md) - why the page hears about changes over Server-Sent Events, and what a stream costs.
- [sale-read-cache.md](sale-read-cache.md) - why sale reads may be one second old, and why writes never are.

When something fails:

- [serving-without-redis.md](serving-without-redis.md) - what each step does when Redis is down, and how Redis catches up when it returns.
- [liveness-and-readiness.md](liveness-and-readiness.md) - why `/health` checks nothing and `/ready` checks the stores.
- [rate-limiting.md](rate-limiting.md) - why write requests are counted per user and per address, and what happens when Redis is down.
- [load-test-findings.md](load-test-findings.md) - the result of each load profile, and what the runs measured that shaped the code and the test.

Accounts and operators:

- [authentication.md](authentication.md) - why a login is two cookies, how tokens and passwords are stored, and what roles may do.
- [admin-and-sale-windows.md](admin-and-sale-windows.md) - how the operator routes change a sale, who may use them, and why windows may not overlap.

How the code is built:

- [hexagonal-architecture.md](hexagonal-architecture.md) - how `flash-be` is split into domain, application and adapters, and how the split is enforced.
- [web-server-proxy.md](web-server-proxy.md) - why the browser talks to its own web server, and what that server lets through.
- [failures-as-values.md](failures-as-values.md) - why failures and absences are values, and how the lint rules keep it so.
- [scenario-or-plain-test.md](scenario-or-plain-test.md) - when a test is a Gherkin scenario and when it is a plain Vitest test.

Why each choice won:

- [decisions/](decisions/README.md) - decision records: the choices that were hard to reverse, the alternatives that lost, and when to look again.
