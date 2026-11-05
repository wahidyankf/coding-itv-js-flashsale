# HTTP endpoints

The routes of the two services. The API routes are in `apps/flash-be/src/routes.ts`. The web routes are in
`apps/flash-web/src/routes/`.

## flash-be (API, port 8080)

| Method | Path             | Checks             | Response                                                                                   |
| ------ | ---------------- | ------------------ | ------------------------------------------------------------------------------------------ |
| GET    | `/health`        | none; no I/O       | `200` `{"status":"ok"}`                                                                    |
| GET    | `/ready`         | Postgres and Redis | `200` `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`                            |
| GET    | `/sales/current` | Postgres           | `200` with the sale (see below), or `404` `{"error":"sale_not_found"}` when no sale exists |
| GET    | `/sales/:saleId` | Postgres           | `200` with the sale, or `404` `{"error":"sale_not_found"}` for an unknown or malformed id  |

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

## flash-web (port 3000)

| Method | Path          | Response                                                                                                                            |
| ------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/`           | HTML home page. It shows `Backend: ok` when `flash-be` answers `GET /health` with `{"status":"ok"}`, and `Backend: down` otherwise. |
| GET    | `/api/health` | `200` `{"status":"ok"}`                                                                                                             |

The browser never sees the address of `flash-be`. The home page reads it in a server function.

## Configuration

Environment variables are listed in [`.env.example`](../../.env.example), with a comment for each one. The defaults for
local development are there too. `apps/flash-be/src/config.ts` builds the API configuration from them. In production,
the API stops at start-up when `DATABASE_URL` or `REDIS_URL` is missing.

## Manual requests

[`api.http`](../../api.http) holds the requests above in the kulala.nvim format.
