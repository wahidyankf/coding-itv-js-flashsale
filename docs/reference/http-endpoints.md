# HTTP endpoints

The routes of the two services. The API routes are in `apps/flash-be/src/routes.ts`. The web routes are in
`apps/flash-web/src/routes/`.

## flash-be (API, port 8080)

| Method | Path                           | Checks             | Response                                                                                   |
| ------ | ------------------------------ | ------------------ | ------------------------------------------------------------------------------------------ |
| GET    | `/health`                      | none; no I/O       | `200` `{"status":"ok"}`                                                                    |
| GET    | `/ready`                       | Postgres and Redis | `200` `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`                            |
| GET    | `/sales/current`               | Postgres           | `200` with the sale (see below), or `404` `{"error":"sale_not_found"}` when no sale exists |
| GET    | `/sales/:saleId`               | Postgres           | `200` with the sale, or `404` `{"error":"sale_not_found"}` for an unknown or malformed id  |
| POST   | `/sales/:saleId/queue`         | Postgres, Redis    | `201` on a new place, `200` when the user already has one; see "The waiting queue"         |
| GET    | `/sales/:saleId/queue/:userId` | Postgres, Redis    | `200` with the place, or an error; needs the `x-queue-ticket` header                       |

`/ready` returns `503` when a check fails. Each failing check is `"error"`, and `status` is `"unavailable"`. For
example, with Postgres stopped:

```json
{ "status": "unavailable", "checks": { "database": "error", "redis": "ok" } }
```

## The sale

`GET /sales/current` and `GET /sales/:saleId` answer with the same body:

```json
{
	"id": "ea6856b4-0cee-40c5-9cc9-deb80867039a",
	"name": "Flash sale",
	"status": "active",
	"startsAt": "2026-11-05T13:41:17.105Z",
	"endsAt": "2026-11-05T14:41:17.105Z",
	"stock": 100,
	"remaining": 100
}
```

The current sale is the one that opens last. `remaining` is `stock` minus the items already sold, never below `0`.

| `status`   | When                                                     |
| ---------- | -------------------------------------------------------- |
| `upcoming` | the sale has not opened yet                              |
| `active`   | the window is open and items remain                      |
| `sold_out` | the window is open and no item remains                   |
| `ended`    | the window has closed, whether or not the stock sold out |

The scenarios are in [`specs/flash/be/behaviours/sale/status.feature`](../../specs/flash/be/behaviours/sale/status.feature).

## The waiting queue

Shoppers join a queue before they can reserve. The queue admits them in order, at the rate set on the sale
(`admit_per_second`, 50 by default).

`POST /sales/:saleId/queue` with the body `{"userId":"ana"}`:

```json
{
	"userId": "ana",
	"ticket": "pc03pRm1ag85sBp2-ZZul1gSLLfj3s3W_1lbQkQZj8g",
	"state": "waiting",
	"place": 1
}
```

`GET /sales/:saleId/queue/:userId` with the header `x-queue-ticket: <ticket>`:

```json
{ "userId": "cai", "state": "admitted" }
```

`state` is `waiting` (with `place`, counted from 1) or `admitted`. An admission stays valid for
`ADMISSION_TTL_SECONDS` (600 by default).

A user id is trimmed and lowercased, then must match `[a-z0-9][a-z0-9._@+-]{0,63}`. Joining again returns the same place
and the same ticket.

| Status | `error`          | When                                                                     |
| ------ | ---------------- | ------------------------------------------------------------------------ |
| `400`  | `invalid_user`   | the user id is missing or does not match the rule above                  |
| `401`  | `invalid_ticket` | the ticket is missing or is not the one issued for this sale and user    |
| `404`  | `sale_not_found` | the sale id is unknown or malformed                                      |
| `404`  | `not_in_queue`   | the ticket is right but the queue has no place for the user (join again) |
| `409`  | `sale_ended`     | the window has closed; the queue takes no new shoppers                   |
| `409`  | `sold_out`       | no item remains; the queue takes no new shoppers                         |

The scenarios are in [`specs/flash/be/behaviours/queue/`](../../specs/flash/be/behaviours/queue/README.md).

## flash-web (port 3000)

| Method | Path          | Response                                                                                                                            |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`           | HTML home page. It shows `Backend: ok` when `flash-be` answers `GET /health` with `{"status":"ok"}`, and `Backend: down` otherwise. |
| GET    | `/api/health` | `200` `{"status":"ok"}`                                                                                                             |

The browser never sees the address of `flash-be`. The home page reads it in a server function.

## Configuration

Environment variables are listed in [`.env.example`](../../.env.example), with a comment for each one. The defaults for
local development are there too. `apps/flash-be/src/config.ts` builds the API configuration from them. In production,
the API stops at start-up when `DATABASE_URL`, `REDIS_URL` or `TICKET_SECRET` is missing.

## Manual requests

[`api.http`](../../api.http) holds the requests above in the kulala.nvim format.
