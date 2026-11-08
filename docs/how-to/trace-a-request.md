# Read the logs and trace a request

Find what happened to one request: which API instance served it, what it answered, and how long it took. You need the
production stack running (`npm run docker:prod:up`, see [run in production](run-in-production.md)), or a smoke run.

## What writes a log line

| Service           | Line                                                                                                                 | Where the request id is      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| `nginx`           | one access line per request: address, time, request, status, bytes, seconds                                          | `request_id=<id>` at the end |
| `flash-web`       | one JSON line when the API cannot be reached (`"msg":"the API could not be reached"`, `502`)                         | `"requestId"`                |
| `flash-web`       | one warning, once per process, when a request has no caller address (`"msg":"a request has no caller address: ..."`) | `"requestId"`                |
| `flash-be-1`..`3` | JSON lines (pino): `incoming request` and `request completed` for each request, and the events below                 | `"reqId"`                    |

The API's events, one line each:

| Event                                                                      | Level              | When                                                                                            |
| -------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------- |
| `flash-be config` (port, Postgres and Redis as host and port, limits)      | info               | once at start, before Redis connects; it holds no password or secret                            |
| `redis not reachable, retrying` (with `cause`)                             | warn               | once, when the first connect at start fails; the API keeps trying                               |
| `redis connection lost`, `redis connection back`                           | warn, info         | once when the connection goes, once when it returns                                             |
| `sale gate rebuild started`, `sale gate rebuild done` (with `saleId`)      | info               | the gate of a sale is rebuilt from Postgres                                                     |
| `sale gate rebuild failed` (with `saleId` and `cause`)                     | warn               | the rebuild could not run; the request still answers                                            |
| `payment refunded: <ref>`                                                  | info               | a charge that lost the race for the last item is refunded                                       |
| `request failed`, `admission tick failed`, `event read failed`             | error, error, warn | an unexpected error, with `err`                                                                 |
| `SIGTERM received: stopping`, `draining for N ms`, `closed ...`, `stopped` | info               | the API stops (see [liveness and readiness](../explanation/liveness-and-readiness.md#stopping)) |
| `shutdown took longer than N ms: exiting`                                  | error              | the stop passed `SHUTDOWN_TIMEOUT_MS`                                                           |

`LOG_LEVEL` (`info` by default) sets which lines the API writes. No line holds a password, a token or a cookie: the
`cookie`, `authorization` and `set-cookie` headers are written as `[redacted]`, and a test fails if a login's secrets
reach a line.

## 1. Get the request id

Every reply carries an `x-request-id` header with a UUID. A shopper on the page can read it in the browser's network
panel; a script can print it:

```bash
curl -si localhost:3000/api/v1/sales/current | grep -i x-request-id   # through the web server
curl -si localhost:8080/api/v1/sales/current | grep -i x-request-id   # straight to nginx
```

The id is made once and passed on:

- Through the page, `flash-web` makes a new id for each request (it drops one the browser sent), sends it to nginx's
  internal port 8081, which passes it on, and returns it on its reply, its own `404`, `403` and `502` included.
- Straight to the API, nginx's public port 80 makes the id (it replaces one the caller sent) and returns it on every
  reply, its own `502` and `504` included.
- `flash-be` keeps an incoming id that is a UUID, makes one when there is none, logs it as `reqId` and returns it.

## 2. Find every line that holds it

```bash
npm run prod:trace -- 5e418b2b-55bb-5cfb-60fc-d083982aa487
```

It prints the lines of nginx, `flash-web` and the three API instances that hold the id, in time order, each with its
service name. The service name of the `flash-be` line tells you which instance served the request. It exits with `1`
when no line holds the id, and with `2` when the argument is not a UUID. For the stack of a running smoke test, add
`--project flash-smoke`.

## 3. Follow the logs live

```bash
npm run prod:logs                 # every service
npm run prod:logs -- flash-be-1   # one service
```

The API lines are JSON, so `jq` can pick from them:

```bash
docker compose -f compose.prod.yaml logs --no-log-prefix flash-be-1 | jq -c 'select(.msg == "request completed") | {reqId, status: .res.statusCode, ms: .responseTime}'
docker compose -f compose.prod.yaml logs --no-log-prefix flash-be-1 flash-be-2 flash-be-3 | grep -E 'redis connection|rebuild'
```

## In development

`npx nx dev flash-be` writes the same JSON lines to its terminal, and every reply carries `x-request-id` there too.
`npx nx dev flash-web` passes the id on the same way. There is no nginx in development, so search the two terminals for
the id.

## Related

- [Run in production](run-in-production.md): start, watch and stop the stack.
- [HTTP endpoints](../reference/http-endpoints.md#configuration): `LOG_LEVEL` and the request id header.
- [The web server in front of the API](../explanation/web-server-proxy.md).
