# Liveness and readiness

`flash-be` has two health endpoints with different jobs.

- `GET /health` is **liveness**. It answers that the process is running. It does not touch Postgres or Redis.
- `GET /ready` is **readiness**. It answers whether the API can do its work now. It pings Postgres and Redis.

## Why liveness does no I/O

A liveness check should fail only when a restart would help. If the database is slow, restarting the API does not
make the database faster. A check that reads the database would make a healthy process look dead and trigger restarts
for no gain.

The image health check in `apps/flash-be/Dockerfile` therefore calls `/health`. The API container is marked unhealthy
only when the process stops answering.

## Why readiness checks both stores

Readiness answers a different question: should traffic reach this instance? The API cannot serve a request without
Postgres and Redis, so `/ready` checks both. It returns `503` with the result of each check, so an operator can see
which store failed. For example, `{"status":"unavailable","checks":{"database":"error","redis":"ok"}}`.

Readiness is for operators and load balancers. The Docker health check does not use it.

## Redis connection drops

A Redis connection that drops after start-up does not stop the API. The Redis client emits an `error` event, and
`apps/flash-be/src/redis.ts` listens for it, logs the error, and lets the client reconnect. Without that listener, Node
ends the process on the first dropped socket.

The scenario "Readiness recovers after Redis drops the API's connection" in
`specs/flash/be/behaviours/health/readiness.feature` checks the recovery at unit, integration, and e2e level. The
integration and e2e bindings drop a real Redis connection with `CLIENT KILL`.
