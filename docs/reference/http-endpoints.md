# HTTP endpoints

The routes of the two services. The API routes are in `apps/flash-be/src/routes.ts`. The web routes are in
`apps/flash-web/src/routes/`.

## flash-be (API, port 8080)

| Method | Path      | Checks             | Response                                                        |
| ------ | --------- | ------------------ | --------------------------------------------------------------- |
| GET    | `/health` | none; no I/O       | `200` `{"status":"ok"}`                                         |
| GET    | `/ready`  | Postgres and Redis | `200` `{"status":"ok","checks":{"database":"ok","redis":"ok"}}` |

`/ready` returns `503` when a check fails. Each failing check is `"error"`, and `status` is `"unavailable"`. For
example, with Postgres stopped:

```json
{ "status": "unavailable", "checks": { "database": "error", "redis": "ok" } }
```

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
