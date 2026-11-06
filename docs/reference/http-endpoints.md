# HTTP endpoints

The routes of the two services, and the rules that a schema cannot say. The shape of every request and reply, and every
status a route answers with, is in the contract ([the library](contract.md)) and in the generated
[openapi.json](openapi.json); this page does not repeat them. The API routes are registered in
`apps/flash-be/src/adapters/inbound/http/routes.ts`. The web routes are in `apps/flash-web/src/routes/`.

Every error is `{"errorCode": "<code>", "errorMessage": "<sentence>"}`, whether the route refused the request, the route
does not exist (`404` `not_found`), the body is not JSON (`400` `invalid_request`) or the server failed (`500` `internal`).
The status is the HTTP status of the reply and is not repeated in the body. `errorMessage` is one fixed English sentence per
code, for a developer. A `500` never says what failed; the cause goes to the log. A `429` also has `retryAfterSeconds`.

```json
{ "errorCode": "sold_out", "errorMessage": "No items are left." }
```

## flash-be (API, port 8080)

| Method | Path                           | Checks             | Notes                                                     |
| ------ | ------------------------------ | ------------------ | --------------------------------------------------------- |
| GET    | `/health`                      | none; no I/O       | always `200`                                              |
| GET    | `/ready`                       | Postgres and Redis | `200`, or `503` when a check fails                        |
| GET    | `/sales/current`               | Postgres           | `404` `sale_not_found` when no sale exists                |
| GET    | `/sales/:saleId`               | Postgres           | `404` `sale_not_found` for an unknown or malformed id     |
| POST   | `/sales/:saleId/queue`         | Postgres, Redis    | `201` on a new place, `200` when the user already has one |
| GET    | `/sales/:saleId/queue/:userId` | Postgres, Redis    | needs the `x-queue-ticket` header                         |
| POST   | `/admin/sales`                 | Postgres           | operator only; needs `Authorization: Bearer <token>`      |

`/ready` returns `503` when a check fails. Each failing check is `"error"`, and `status` is `"unavailable"`. For
example, with Postgres stopped:

```json
{ "status": "unavailable", "checks": { "database": "error", "redis": "ok" } }
```

## The sale

`GET /sales/current` and `GET /sales/:saleId` answer with the same body (`SaleView`).

The current sale is the one that opens last. `remaining` is `stock` minus the items already sold, never below `0`.

| `status`   | When                                                     |
| ---------- | -------------------------------------------------------- |
| `upcoming` | the sale has not opened yet                              |
| `active`   | the window is open and items remain                      |
| `sold_out` | the window is open and no item remains                   |
| `ended`    | the window has closed, whether or not the stock sold out |

The scenarios are in [`specs/apps/flash/be/behaviours/sale/status.feature`](../../specs/apps/flash/be/behaviours/sale/status.feature).

### Caching

Both sale reads come from a short in-process cache. `SALE_CACHE_MS` sets its time (1000 by default, 0 turns it off). A
cached `200` carries `Cache-Control: public, max-age=<seconds>`, rounded up. A `404` is never cached, and the write
routes never read the cache. Why `remaining` may be that old is in [the sale read cache](../explanation/sale-read-cache.md).

The scenarios are in [`specs/apps/flash/be/behaviours/sale/caching.feature`](../../specs/apps/flash/be/behaviours/sale/caching.feature).

## Creating a sale (operator)

`POST /admin/sales` creates a sale from a stock and a window, so an operator needs no shell on the server. It is the
only operator route. The web server never passes it on, so it is reached on the API port only.

```json
{
	"stock": 100,
	"startsAt": "2026-06-01T12:00:00.000Z",
	"endsAt": "2026-06-01T13:00:00.000Z"
}
```

`name` (default `Flash sale`), `holdSeconds` (default `120`) and `admitPerSecond` (default `50`) are optional. The reply
is `201` with the new sale (`SaleView`).

| Status | `errorCode`           | When                                                                                     |
| ------ | --------------------- | ---------------------------------------------------------------------------------------- |
| `404`  | `not_found`           | `ADMIN_TOKEN` is not set: the admin routes are off and look as if they were not there    |
| `401`  | `invalid_admin_token` | the `Authorization: Bearer` header is missing or holds another token                     |
| `400`  | `invalid_sale`        | the stock, hold or admission rate is not a positive whole number, or the window is empty |
| `409`  | `sale_overlaps`       | the window overlaps the window of another sale (a window may open when another closes)   |
| `429`  | `rate_limited`        | too many tries from one address; the token is checked after the count                    |

The token is checked before the body is read. The scenarios are in
[`specs/apps/flash/be/behaviours/sale/admin.feature`](../../specs/apps/flash/be/behaviours/sale/admin.feature). See
[admin and sale windows](../explanation/admin-and-sale-windows.md) for why it only creates and where the overlap rule
stops.

## The waiting queue

Shoppers join a queue before they can reserve. The queue admits them in order, at the rate set on the sale
(`admit_per_second`, 50 by default).

`POST /sales/:saleId/queue` takes the user id and answers with the place and a `ticket`. `GET /sales/:saleId/queue/:userId`
with the header `x-queue-ticket: <ticket>` answers with the place.

`state` is `waiting` (with `place`, counted from 1) or `admitted`. An admission stays valid for
`ADMISSION_TTL_SECONDS` (600 by default).

A user id is trimmed and lowercased, then must match `[a-z0-9][a-z0-9._@+-]{0,63}`. Joining again returns the same place
and the same ticket.

| Status | `errorCode`      | When                                                                     |
| ------ | ---------------- | ------------------------------------------------------------------------ |
| `400`  | `invalid_user`   | the user id is missing or does not match the rule above                  |
| `401`  | `invalid_ticket` | the ticket is missing or is not the one issued for this sale and user    |
| `404`  | `sale_not_found` | the sale id is unknown or malformed                                      |
| `404`  | `not_in_queue`   | the ticket is right but the queue has no place for the user (join again) |
| `409`  | `sale_ended`     | the window has closed; the queue takes no new shoppers                   |
| `409`  | `sold_out`       | no item remains; the queue takes no new shoppers                         |

The scenarios are in [`specs/apps/flash/be/behaviours/queue/`](../../specs/apps/flash/be/behaviours/queue/README.md).

## Reservations

An admitted shopper holds one item for the sale's hold time (`reservation_ttl_seconds`, 120 by default).

`POST /sales/:saleId/reservations` takes the user id and the header `x-queue-ticket: <ticket>`, and answers with the
`reservationId` and when the hold ends (`expiresAt`).

Asking again while the hold lasts returns `200` with the same body. A hold that has expired stops counting at once, and
the item can go to someone else.

| Status | `errorCode`         | When                                                                       |
| ------ | ------------------- | -------------------------------------------------------------------------- |
| `400`  | `invalid_user`      | the user id is missing or invalid                                          |
| `401`  | `invalid_ticket`    | the ticket is missing or is not the one issued for this sale and user      |
| `403`  | `not_admitted`      | the user is still waiting, or has no place in the queue and has not bought |
| `404`  | `sale_not_found`    | the sale id is unknown or malformed                                        |
| `409`  | `sale_not_started`  | the window has not opened yet                                              |
| `409`  | `sale_ended`        | the window has closed                                                      |
| `409`  | `sold_out`          | no item is free: sold items plus live holds fill the stock                 |
| `409`  | `already_purchased` | the user already bought an item in this sale                               |
| `503`  | `unavailable`       | the reservation state could not be rebuilt in time; try again              |

A sale that is not selling answers before the ticket is checked. The scenarios are in
[`specs/apps/flash/be/behaviours/reservation/`](../../specs/apps/flash/be/behaviours/reservation/README.md).

## Purchases

`POST /sales/:saleId/purchases` pays for the held item. The body holds the user id and the reservation id from the
reservation reply.

The reservation id is the idempotency key. Sending the same request again returns `200` with the same purchase, and the
shopper is charged once.

| Status | `errorCode`             | When                                                                                              |
| ------ | ----------------------- | ------------------------------------------------------------------------------------------------- |
| `400`  | `invalid_user`          | the user id is missing or invalid                                                                 |
| `400`  | `invalid_reservation`   | the reservation id is missing or is not an id                                                     |
| `402`  | `payment_failed`        | the payment provider declined; the hold stays, so the shopper can try again until it ends         |
| `404`  | `sale_not_found`        | the sale id is unknown or malformed                                                               |
| `404`  | `reservation_not_found` | no hold of this user has this id (also for somebody else's reservation id)                        |
| `409`  | `hold_expired`          | the hold ended before the payment started                                                         |
| `409`  | `already_purchased`     | the user already bought an item in this sale                                                      |
| `409`  | `sale_ended`            | the window has closed                                                                             |
| `409`  | `sold_out`              | the hold ended during the payment and the last item went to someone else; the payment is refunded |

`GET /sales/:saleId/purchases/:userId` answers "did I get it?". `state` is one of:

| `state`     | Meaning                                              |
| ----------- | ---------------------------------------------------- |
| `purchased` | the shopper bought an item; the body is the purchase |
| `holding`   | the shopper holds an item that has not expired       |
| `none`      | nothing, also when the hold has expired              |

The scenarios are in [`specs/apps/flash/be/behaviours/purchase/`](../../specs/apps/flash/be/behaviours/purchase/README.md).

## Live updates (Server-Sent Events)

| Method | Path                                  | What it streams                                                                            |
| ------ | ------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/sales/:saleId/events`               | `event: sale`, with the same body as `GET /sales/:saleId`                                  |
| GET    | `/sales/:saleId/queue/:userId/events` | `event: place`, with the body of `GET /sales/:saleId/queue/:userId`; send `x-queue-ticket` |

The frames are written and read by the codec of the contract (`formatFrame`, `parseFrames`).

Both answer `Content-Type: text/event-stream`. The first event comes at once. Later events come only when the data
changed, checked every `EVENTS_INTERVAL_MS` (1000). When nothing changes for 15 seconds, a `: keep-alive` comment line is
sent. If the sale or the ticket is wrong, the answer is a normal JSON error (`404 sale_not_found`, `401 invalid_ticket`)
and no stream opens. If a shopper's place is lost while watching, the stream sends `{"state":"absent"}`.

The scenarios are in [`specs/apps/flash/be/behaviours/events/`](../../specs/apps/flash/be/behaviours/events/README.md).

## Rate limits

The three write routes (`POST .../queue`, `POST .../reservations` and `POST .../purchases`) count each request against
the user id in the body and against the client address. Reads are not limited. When either count passes its limit in
the current window, the answer is `429` `rate_limited`, with `retryAfterSeconds` in the body and a `Retry-After` header that
holds the same number of seconds (at least 1). The window starts at
the first request, not at a fixed clock tick. The limits are `RATE_LIMIT_PER_USER` (30), `RATE_LIMIT_PER_IP` (600) and
`RATE_LIMIT_WINDOW_SECONDS` (10). Set `TRUST_PROXY=true` only behind a proxy you control, so that the client address is
read from `X-Forwarded-For`.

The scenarios are in [`specs/apps/flash/be/behaviours/rate-limit/`](../../specs/apps/flash/be/behaviours/rate-limit/README.md).

## While Redis is down

`POST .../queue` answers `200` with a ticket and `"state":"admitted"`, `GET .../queue/:userId` answers `admitted` for a
valid ticket, and reservations are decided by Postgres alone. `GET /ready` answers `503` with `"redis":"error"`. The rest
of the API behaves as usual. See [serving without Redis](../explanation/serving-without-redis.md).

The scenarios are in [`specs/apps/flash/be/behaviours/degraded/`](../../specs/apps/flash/be/behaviours/degraded/README.md).

## flash-web (port 3000)

| Method | Path           | Response                                                                                                                             |
| ------ | -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/`            | HTML page. It shows the current sale, a form to buy, and `Backend: ok` when `flash-be` answers `GET /health` with `{"status":"ok"}`. |
| GET    | `/api/health`  | `200` `{"status":"ok"}`                                                                                                              |
| any    | `/api/sales/*` | The routes below, passed on to `flash-be`. Anything else under this path answers `404` with `errorCode` `not_found`.                 |

### The sale routes

The browser reaches the sale only through `/api/sales`. The web server passes each request to `flash-be` at
`/sales/...` and sends the answer back, including event streams. The allowed method and path pairs are:

| Method | Path under `/api/sales`         | Passed to              |
| ------ | ------------------------------- | ---------------------- |
| GET    | `/current`                      | the current sale       |
| GET    | `/:saleId`                      | one sale               |
| GET    | `/:saleId/events`               | the sale event stream  |
| POST   | `/:saleId/queue`                | join the waiting queue |
| GET    | `/:saleId/queue/:userId`        | a place in the queue   |
| GET    | `/:saleId/queue/:userId/events` | the place event stream |
| POST   | `/:saleId/reservations`         | hold an item           |
| POST   | `/:saleId/purchases`            | pay for the held item  |
| GET    | `/:saleId/purchases/:userId`    | "did I get it"         |

Only `content-type`, `accept`, `x-queue-ticket` and `x-forwarded-for` are sent on. Only `content-type`,
`cache-control` and `retry-after` come back. When `flash-be` cannot be reached the answer is `502`
with `errorCode` `backend_unavailable`. The address of `flash-be` is read on the server and never reaches the page. See
[the web server in front of the API](../explanation/web-server-proxy.md).

The scenarios are in [`specs/apps/flash/web/behaviours/proxy/`](../../specs/apps/flash/web/behaviours/proxy/README.md) and
[`sale/`](../../specs/apps/flash/web/behaviours/sale/README.md).

## Configuration

Environment variables are listed in [`.env.example`](../../.env.example), with a comment for each one. The defaults for
local development are there too. `apps/flash-be/src/config.ts` builds the API configuration from them. In production,
the API stops at start-up when `DATABASE_URL`, `REDIS_URL` or `TICKET_SECRET` is missing. `PAYMENT_LATENCY_MS` (150) and
`PAYMENT_FAILURE_RATE` (0.02) tune the mock payment provider. The `RATE_LIMIT_*` and `TRUST_PROXY` variables tune the
rate limits. `SALE_CACHE_MS` (1000) sets the sale read cache. `EVENTS_INTERVAL_MS` (1000) sets how often an event stream reads. `ADMIN_TOKEN` (at least 16 characters) turns on
`POST /admin/sales`; without it the route answers `404`.

## Manual requests

[`api-flash-be.http`](../../api-flash-be.http) and [`api-flash-web.http`](../../api-flash-web.http) hold the requests above in the kulala.nvim format, one file per app. Every route of the contract is in the first file, and every route the web server passes on is in the second. The create-sale request reads `ADMIN_TOKEN` from `.env` with `$dotenv`, so set it there first (see [`.env.example`](../../.env.example)).
