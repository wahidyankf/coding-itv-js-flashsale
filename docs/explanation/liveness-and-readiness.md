# Liveness and readiness

`flash-be` has two health endpoints with different jobs.

- `GET /health` is **liveness**. It answers that the process is running. It does not touch Postgres or Redis.
- `GET /ready` is **readiness**. It answers whether the API can do its work now. It pings Postgres and Redis, and it
  answers `503` with `"status": "stopping"` once the process has been asked to stop.

## Why liveness does no I/O

A liveness check should fail only when a restart would help. If the database is slow, restarting the API does not
make the database faster. A check that reads the database would make a healthy process look dead and trigger restarts
for no gain.

The image health check in `apps/flash-be/Dockerfile` therefore calls `/health`. The API container is marked unhealthy
only when the process stops answering.

## Why readiness checks both stores

Readiness answers a different question: should traffic reach this instance? Without Postgres the API cannot serve a
request; without Redis it still sells, but slower and less fairly ([serving without Redis](serving-without-redis.md)).
So `/ready` checks both. It returns `503` with the result of each check, so an operator can see which store failed. For
example, `{"status":"unavailable","checks":{"database":"error","redis":"ok"}}`.

Readiness is for operators, monitoring and a balancer with active health checks. The nginx of the production stack does
not read it: open-source nginx only notices a connection that fails. The Docker health check does not use it either.

## Stopping

On the first `SIGTERM` or `SIGINT` (a release, a scale-down, `docker compose stop`) the API stops in this order:

1. `/ready` answers `503` with `{"status":"stopping","checks":{...}}`, so a monitor or a balancer that reads it stops
   sending work. The admission timer stops.
2. For `SHUTDOWN_DRAIN_MS` (2000 by default) the API still answers every request, and each reply carries
   `Connection: close`. nginx and other clients then drop the connection they kept open to this instance, and their
   next request opens a new one.
3. The HTTP server closes: it stops listening, every open event stream is ended cleanly, the requests in flight get
   their answers (a payment that is running finishes), and idle connections are dropped. A new connection to this
   instance now fails, and nginx passes the request to another instance.
4. Redis closes, then Postgres, and the process exits with `0`.

A step that fails is logged and the exit code becomes `1`, but the next steps still run. If the whole stop takes longer
than `SHUTDOWN_TIMEOUT_MS` (10000 by default), the API logs it and exits with `1`. A second signal is logged and
ignored. The production compose file gives each API container `stop_grace_period: 15s`, more than that limit, so the
API's own limit fires before Docker kills it. The scenarios are in
[`health/shutdown.feature`](../../specs/apps/flash/be/behaviours/health/shutdown.feature).

## Redis connection drops

A Redis connection that drops after start-up does not stop the API. The Redis client emits an `error` event, and
[`apps/flash-be/src/adapters/outbound/redis/redis-client.ts`](../../apps/flash-be/src/adapters/outbound/redis/redis-client.ts) listens for it and lets the client reconnect. It watches the connection from before the first connect: a first connect
that fails logs one `redis not reachable, retrying` line, after the `flash-be config` line that names the Redis host
and port. Later it logs one `redis connection lost` line when the connection goes and one `redis connection back` line
when it returns, not one line per failed command. Without that listener, Node
ends the process on the first dropped socket.

The scenario "Readiness recovers after Redis drops the API's connection" in
[`specs/apps/flash/be/behaviours/health/readiness.feature`](../../specs/apps/flash/be/behaviours/health/readiness.feature) checks the recovery at unit, integration, and e2e level. The
integration and e2e bindings drop a real Redis connection with `CLIENT KILL`.
