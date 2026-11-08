# Run in development

Run the two apps on your machine with Postgres and Redis in Docker, so a change to the code shows at once. The first
time, follow [the tutorial](../tutorials/run-flash-sale-locally.md); it explains each step and ends with a purchase in
the browser. This page is the daily loop.

You need [Volta](https://volta.sh/), Docker and Git, and once per clone:

```bash
npm install                          # also installs the Git hooks
[ -f .env ] || cp .env.example .env  # local values only; never use them anywhere else
```

## Start the data stores

```bash
npm run docker:dev:up        # Postgres on :5432 and Redis on :6379 (compose.dev.yaml), waits until both are healthy
npx nx db:migrate flash-be   # applies the new migrations, prints nothing when the schema is current
```

The data lives in Docker volumes, so it is still there after a restart.

## Make an operator and a sale

```bash
npx nx db:create-operator flash-be --username=ops --password=correct-horse-battery
npx nx db:seed-sale flash-be --stock=3 --starts-in-minutes=0 --duration-minutes=60 --hold-seconds=60
```

The first prints `created operator ops`, or `the user ops already exists`. The second prints `seeded sale <id>`. The
seed command does not check for overlaps, so on old data another running sale may still be the current one. Every
option, and how to create a sale through the API, is in [seed a sale](seed-a-sale.md).

## Run the apps

Each command stays in the foreground, so give each its own terminal:

```bash
npx nx dev flash-be    # the API on http://localhost:8080
npx nx dev flash-web   # the page on http://localhost:3000
```

Or run both in one terminal, with their output mixed:

```bash
npm run demo:dev
```

Both build `libs/typekit` and `libs/flash-commons` first. `flash-be` runs under `node --watch` and restarts when a file
it loads changes. `flash-web` runs on the Vite dev server, which updates the open page in place. A change in a library
shows only after you start the app again, because the apps load the library's built `dist/` and the start builds it.

Check that the API is up and sees both stores:

```bash
curl localhost:8080/ready    # {"status":"ok","checks":{"database":"ok","redis":"ok"}}
```

The apps read `.env` at start. Restart an app after you change it. The values are explained in `.env.example`; the
ones you may want to change while you work are `PAYMENT_FAILURE_RATE` (set it to `0` so no payment is declined),
`PAYMENT_LATENCY_MS` and `SALE_CACHE_MS`.

## Test while you work

```bash
npx nx test:quick:watch flash-be    # typecheck, lint and unit tests again on each save
npx nx test:unit:watch flash-web    # only the unit tests
npx nx test:integration flash-be    # needs the data stores above
```

The watch targets keep running and test again when you save a file. They need a terminal: without one (in CI or a
script), Vitest runs the tests once and exits. `git push` runs the full set of checks (see [test layers and coverage](../reference/test-layers-and-coverage.md)).
To try requests by hand, use `api-flash-be.http` and `api-flash-web.http` in Neovim with
[kulala.nvim](https://github.com/wahidyankf/kulala.nvim), or `curl`; every route is in
[HTTP endpoints](../reference/http-endpoints.md).

## Look at the data

```bash
docker compose -f compose.dev.yaml exec postgres psql -U flash -d flash -c "SELECT name, stock, sold, starts_at, ends_at FROM sales WHERE deleted_at IS NULL"
docker compose -f compose.dev.yaml exec redis redis-cli --scan --pattern 'sale:*'
```

The tables and the Redis keys are described in [the data model](../../specs/apps/flash/c4/data-model.md).

## Start again from empty data

```bash
npm run demo:reset   # deletes every local account, sale and Redis key, then migrates
```

It cannot be undone. Make the operator and the sale again afterwards.

## Stop

Press Ctrl+C in each app terminal, then:

```bash
npm run docker:dev:down   # stops Postgres and Redis; the volumes and the data stay
```

To run the apps the way production does, in containers behind nginx, see [run in production](run-in-production.md).
