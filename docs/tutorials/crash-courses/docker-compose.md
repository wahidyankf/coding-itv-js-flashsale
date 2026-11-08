# Docker Compose crash course

Docker Compose starts a set of containers from one YAML file: their images, settings, ports, disks and start order.
This repository has three compose files, one for each way the system runs. The machine this page was written on has
Docker Compose v5.6.0.

## Why this repo uses it

**The problem.** The API needs Postgres and Redis to run at all, and its claim that it scales out needs several API
instances behind one door. A developer, the coverage gate, the smoke test and the load test each need that setup in
one command, and each needs to remove it again without touching the others.

**How each file answers it.**

- [`compose.dev.yaml`](../../../compose.dev.yaml) runs only Postgres and Redis. The apps run on the host through Nx,
  where `flash-be` reloads on each save (`node --watch`).
- [`compose.prod.yaml`](../../../compose.prod.yaml) runs the whole system in containers: three API instances behind
  nginx, the web server, and a one-off migration job, so scaling out can be tried on one machine.
- [`apps/flash-load/compose.yaml`](../../../apps/flash-load/compose.yaml) runs the same shape with its own Postgres and
  Redis and a k6 container, for the [load test](../../how-to/run-the-load-test.md).

**What it costs.** Docker must run for `test:coverage`, the pre-push hook, the load test and the smoke test. The load
test shares one machine's CPUs with every server, so its times are only relative
([012](../../explanation/decisions/012-load-verdict-from-the-data.md)). No decision record weighs Compose against
another tool; it is the plain choice for one machine.

## The ideas this repo uses

### A project name for each stack

Each file starts with `name:` (`flash-dev`, `flash-prod`, `flash-load`). Containers and volumes get that prefix, such as
`flash-dev-postgres-1` and `flash-dev_postgres-data`, so the three stacks never share a container or a disk. The smoke
test goes further and starts [`compose.prod.yaml`](../../../compose.prod.yaml) under its own name, `flash-smoke`
([smoke test the production stack](../../how-to/smoke-test-the-production-stack.md)).

### Healthchecks and start order

A service says how to tell it is ready, and another service waits for that:

```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 2s
  timeout: 3s
  retries: 15
```

In [`compose.prod.yaml`](../../../compose.prod.yaml) the API waits for `flash-be-migrate` with `condition: service_completed_successfully` and for
Redis with `service_healthy`. nginx waits until all three API instances are healthy. Their healthcheck lives in
[`apps/flash-be/Dockerfile`](../../../apps/flash-be/Dockerfile) and calls `/health`, not `/ready`
([liveness and readiness](../../explanation/liveness-and-readiness.md)). The `--wait` flag in the `up` commands makes
Compose return only when the services are healthy.

### Env interpolation: a default, or a hard stop

Compose fills `${...}` from the shell and from the root `.env`:

- `${POSTGRES_PORT:-5432}` in the dev file uses `5432` when the variable is unset. Every value in the dev file has a
  default, so the dev stack starts without a `.env`.
- `${TICKET_SECRET:?set TICKET_SECRET in .env}` in the prod file stops with that message when it is unset. A secret
  in production has no default.
- `$${POSTGRES_USER}` in a healthcheck escapes the `$`, so the container's shell reads the variable, not Compose.

### Three API instances from one block

[`compose.prod.yaml`](../../../compose.prod.yaml) writes the API service once as a YAML anchor and reuses it:

```yaml
x-api: &api
  image: flash-be:prod
  ...
services:
  flash-be-1:
    <<: *api
  flash-be-2:
    <<: *api
  flash-be-3:
    <<: *api
```

nginx is the only API port on the host. [`nginx.prod.conf`](../../../nginx.prod.conf) sends each request to the
instance with the fewest open requests (`least_conn`), and replaces `X-Forwarded-For` so a client cannot choose its own
address for the rate limit.

### Volumes, and what `down -v` deletes

The dev and prod files keep data in named volumes (`postgres-data`, `redis-data`), so `down` keeps your data.
`down -v` also deletes the volumes, so every sale, account and purchase is gone. The load stack keeps Postgres on a
`tmpfs` and starts Redis with `--save ""`, so it has nothing to keep.

### The scripts and targets that call Compose

| Command                                                | What it runs                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------- |
| `npm run docker:dev:up` or `npx nx db:up flash-be`     | `docker compose -f compose.dev.yaml up -d --wait`              |
| `npm run docker:dev:down` or `npx nx db:down flash-be` | `docker compose -f compose.dev.yaml down`                      |
| `npm run docker:prod:up`                               | `docker compose -f compose.prod.yaml up -d --build --wait`     |
| `npx nx db:reset flash-be`                             | `down -v`, then `up`, then the migrations: it wipes local data |

## Try it here

These commands only read. See what runs in the dev stack:

```bash
docker compose -f compose.dev.yaml ps
```

Output, with some columns left out:

```text
NAME                   IMAGE                SERVICE    STATUS
flash-dev-postgres-1   postgres:18-alpine   postgres   Up 8 hours (healthy)
flash-dev-redis-1      redis:8-alpine       redis      Up 6 hours (healthy)
```

See the `:?` stop at work, by reading the prod file with an empty env file:

```bash
docker compose --env-file /dev/null -f compose.prod.yaml config --services
```

One of the error lines, for the secret named above:

```text
error while interpolating services.flash-be-1.environment.TICKET_SECRET: required variable TICKET_SECRET is missing a value: set TICKET_SECRET in .env
```

## Traps to avoid

- **`down -v` is not a restart.** It deletes the volumes. `npm run demo:reset` and `npx nx db:reset flash-be` run it, so
  never run them unless you mean to wipe the local data. Use `docker:dev:down` to stop the stack and keep it.
- **A Secure cookie over plain HTTP.** The prod stack sets `COOKIE_SECURE` to `true` by default, and a browser drops
  such a cookie over `http://`. Set `COOKIE_SECURE=false` in `.env` to try the stack on one machine, as the comment in
  [`compose.prod.yaml`](../../../compose.prod.yaml) says.

## Read next

- Official: [Docker Compose](https://docs.docker.com/compose/),
  [variable interpolation](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/),
  [services reference](https://docs.docker.com/reference/compose-file/services/) and
  [`docker compose down`](https://docs.docker.com/reference/cli/docker/compose/down/).
- Ours: [run the flash sale locally](../run-flash-sale-locally.md),
  [smoke test the production stack](../../how-to/smoke-test-the-production-stack.md) and
  [run the load test](../../how-to/run-the-load-test.md).
