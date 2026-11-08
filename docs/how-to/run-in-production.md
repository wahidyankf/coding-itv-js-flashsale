# Run in production

Run the whole system in containers, the way it is meant to be deployed: three API instances behind nginx, the web
server, Postgres and Redis, from [`compose.prod.yaml`](../../compose.prod.yaml). To work on the code, see [run in development](run-in-development.md)
instead.

You need Docker and a clone of the repository. The images build the apps, so the host needs Node.js only for the `npm run`
shortcuts below; each one is a plain `docker compose -f compose.prod.yaml ...` command you can run instead (see the
`docker:prod:*` scripts in [`package.json`](../../package.json)).

## What runs

| Service                      | What it does                                                                        | Published on the host  |
| ---------------------------- | ----------------------------------------------------------------------------------- | ---------------------- |
| `postgres`                   | Postgres 18, the source of truth. Data in the volume `postgres-data`                | no                     |
| `redis`                      | Redis 8, the fast gate and the queue. Data in the volume `redis-data`               | no                     |
| `flash-be-migrate`           | applies the migrations, then exits. The API instances start only after it succeeded | no                     |
| `flash-be-1` to `flash-be-3` | the API, three identical instances that share Postgres, Redis and `TICKET_SECRET`   | no                     |
| `nginx`                      | spreads the API requests over the three instances (least connections)               | `FLASH_BE_PORT`, 8080  |
| `flash-web`                  | the page and the `/api` pass-through to nginx. Shoppers only ever reach this        | `FLASH_WEB_PORT`, 3000 |

The Compose project is named `flash-prod`, so its containers and volumes never mix with the development ones.

## 1. Set the secrets

The stack reads its settings from `.env` at the root. It does not start when one of these is missing:

| Variable            | What to set                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `POSTGRES_USER`     | the database user                                                                         |
| `POSTGRES_PASSWORD` | a strong password                                                                         |
| `POSTGRES_DB`       | the database name                                                                         |
| `TICKET_SECRET`     | a long random value that signs the queue tickets, for example from `openssl rand -hex 32` |

Optional:

| Variable                          | Default        | What it does                                                                                                         |
| --------------------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `COOKIE_SECURE`                   | `true`         | the login cookies are `Secure`, so they need HTTPS. Set `false` only to try the stack over plain HTTP on one machine |
| `FLASH_BE_PORT`, `FLASH_WEB_PORT` | `8080`, `3000` | the host ports of nginx and of the web server                                                                        |

Never use the values of [`.env.example`](../../.env.example) outside your machine. The other settings (rate limits, payment mock, cache) keep
the defaults written in [`apps/flash-be/src/config.ts`](../../apps/flash-be/src/config.ts).

## 2. Start the stack

```bash
npm run docker:prod:up
```

This builds the two images, starts Postgres and Redis, runs the migrations, starts the three API instances, nginx and
the web server, and returns when every service is healthy. The first build takes a few minutes. Check it:

```bash
docker compose -f compose.prod.yaml ps -a   # every service healthy, flash-be-migrate "Exited (0)"
curl localhost:8080/ready                # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

## 3. Make the first operator and a sale

Nobody can sign up as an operator, so make the first one inside an API container. Choose your own password:

```bash
docker compose -f compose.prod.yaml exec flash-be-1 node dist/create-operator.js --username=ops --password='<a long password>'
```

Then create sales through the API with that login (`POST /api/v1/admin/sales`, see [seed a sale](seed-a-sale.md)), or seed one
that starts now:

```bash
docker compose -f compose.prod.yaml exec flash-be-1 node dist/seed-sale.js --stock=5 --duration-minutes=60
```

The first prints `created operator ops`, the second `seeded sale <id>`. Open <http://localhost:3000>: the page shows the
sale, and a shopper can sign up and buy.

## 4. Put HTTPS in front

The stack speaks plain HTTP. In a real deployment, put a TLS terminator (a load balancer or a reverse proxy) in front of
the web port, and keep `COOKIE_SECURE=true`. Shoppers need only the web port. The API port is for operators and
monitoring; do not expose it to the internet unless you need to. Behind nginx each instance reads the caller's address
from `X-Forwarded-For` (`TRUST_PROXY` is on in the stack), and the rate limit counts that address.

## Update to a new version

```bash
git pull
npm run docker:prod:up
```

The images are built again and `flash-be-migrate` runs before the new API instances start. The data stays in the volumes.

## Watch it

```bash
docker compose -f compose.prod.yaml logs -f flash-be-1   # one instance; leave out the name for every service
curl localhost:8080/health                               # the process answers
curl localhost:8080/ready                                # Postgres and Redis answer; 503 when Redis is down
```

The API logs one JSON line for each request and each reply.

When Redis is down, `/ready` answers `503` but the sale goes on, slower, on Postgres alone (see
[serving without Redis](../explanation/serving-without-redis.md) and [liveness and readiness](../explanation/liveness-and-readiness.md)).

## Stop

```bash
npm run docker:prod:down   # stops and removes the containers; the volumes and the data stay
```

To delete the data as well, run `docker compose -f compose.prod.yaml down -v`. It cannot be undone.

## Before you ship a change

`npm run smoke:prod` builds this stack under another name with random secrets, walks one shopper through it, and removes
it (see [the smoke test](smoke-test-the-production-stack.md)). Run it after a change to a Dockerfile,
[`compose.prod.yaml`](../../compose.prod.yaml) or [`nginx.prod.conf`](../../nginx.prod.conf).

This stack runs on one machine, with one Postgres and one Redis and no backups. What it takes to go further is in
[how it scales, and where it stops](../../README.md#how-it-scales-and-where-it-stops).
