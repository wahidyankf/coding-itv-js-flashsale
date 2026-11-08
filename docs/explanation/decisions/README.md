# Decision records

A decision record states one choice that was hard to reverse or that would surprise the next reader. It gives the
context, the decision, the alternatives that were weighed and why they lost, what the choice costs and buys, and the
signal that would make us look again. The decision of an accepted record is never changed: a later record replaces it and says so. A fact in it that is no
longer true of the code (a path, a name, a count) is corrected in place, and a line in its Status says so:
`Amended YYYY-MM-DD: what changed`.

The pages in the [explanation](../README.md) folder say how each part works. These records say why it was chosen over
the other options, and link to those pages.

## Directory Map

- [001-queue-hold-pay.md](001-queue-hold-pay.md) - a purchase is three calls (join the queue, hold an item, pay), not one buy call.
- [002-redis-gate-postgres-last-word.md](002-redis-gate-postgres-last-word.md) - Redis decides fast, and Postgres refuses any sale that breaks the stock or the one-item rule.
- [003-keep-selling-without-redis.md](003-keep-selling-without-redis.md) - when Redis is down the queue fails open and Postgres reserves under a row lock.
- [004-hexagon-in-the-api-only.md](004-hexagon-in-the-api-only.md) - `flash-be` is a hexagon, and `flash-web` stays a plain React app.
- [005-failures-as-values.md](005-failures-as-values.md) - failures are `Result` values, and product code has no `catch`.
- [006-browser-talks-to-web-server-only.md](006-browser-talks-to-web-server-only.md) - the browser calls only its own web server, which passes on an allow-list.
- [007-accounts-and-cookie-sessions.md](007-accounts-and-cookie-sessions.md) - accounts with passwords and two-cookie sessions, though the task asks only for a user identifier.
- [008-server-sent-events.md](008-server-sent-events.md) - the page follows the sale over Server-Sent Events, not polling or WebSockets.
- [009-in-process-mock-payment.md](009-in-process-mock-payment.md) - the payment is a mock in the process, with real idempotency, refund and retry rules.
- [010-one-sale-at-a-time.md](010-one-sale-at-a-time.md) - the current sale is the running one, else the next to open, and windows may not overlap.
- [011-soft-delete-everywhere.md](011-soft-delete-everywhere.md) - nothing is hard-deleted; every table has six audit columns and partial unique indexes.
- [012-load-verdict-from-the-data.md](012-load-verdict-from-the-data.md) - the load verdict is read from Postgres and Redis, and k6 is compared with it.
- [013-nx-as-a-command-runner.md](013-nx-as-a-command-runner.md) - Nx runs commands only, with no plugins.
- [014-gherkin-scenarios-at-three-layers.md](014-gherkin-scenarios-at-three-layers.md) - scenarios are bound at unit, integration and end-to-end level, and a check finds the gaps.
- [015-code-structure-limits.md](015-code-structure-limits.md) - size and nesting limits come from Biome's built-in rules; doc comments are kept by review.
- [016-dry-rule-of-three.md](016-dry-rule-of-three.md) - logic used in three places becomes one piece; shared behaviour lives in `libs/flash-commons`; test oracles keep their own copies.
- [017-retry-backoff-jitter.md](017-retry-backoff-jitter.md) - every retry uses exponential backoff, full jitter and a max attempt count, except the Redis reconnect.
- [018-decode-payloads-at-the-edge.md](018-decode-payloads-at-the-edge.md) - every request body, reply and stream event is decoded at the edge with a small kit in flash-commons.
- [019-api-version-prefix.md](019-api-version-prefix.md) - every API route is under `/api/v1`, and one path table in `flash-commons` names them all.
