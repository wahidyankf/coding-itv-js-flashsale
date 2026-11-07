# Seed a sale

Create a sale with a stock and a window, then read it back. You need the dev stack and the migrations
(`npx nx db:up flash-be` and `npx nx db:migrate flash-be`).

## Create the sale

```bash
npx nx db:seed-sale flash-be --stock=100 --starts-in-minutes=0 --duration-minutes=60
```

The command prints the id of the new sale:

```text
seeded sale ea6856b4-0cee-40c5-9cc9-deb80867039a
```

## Options

| Option                | Meaning                                 | Default      |
| --------------------- | --------------------------------------- | ------------ |
| `--stock`             | items for sale; a positive integer      | required     |
| `--name`              | name of the sale                        | `Flash sale` |
| `--starts-in-minutes` | minutes from now until the sale opens   | `0`          |
| `--duration-minutes`  | minutes the sale stays open             | `60`         |
| `--hold-seconds`      | how long a reservation holds an item    | `120`        |
| `--admit-per-second`  | users let in from the queue each second | `50`         |

A bad value stops the command with a message and exit code `1`, and nothing is written. For example, `--stock=0`
fails with `stock must be a positive integer`.

## Read it back

Start the API (`npx nx dev flash-be`), then:

```bash
curl -s http://localhost:8080/sales/current
```

The body is described in [HTTP endpoints](../reference/http-endpoints.md#the-sale).

The scenarios for this command are in
[`specs/apps/flash/be/behaviours/sale/seeding.feature`](../../specs/apps/flash/be/behaviours/sale/seeding.feature).

## Create the sale through the API instead

With `ADMIN_TOKEN` set for the API (at least 16 characters; see [`.env.example`](../../.env.example)), an operator can
create a sale over HTTP, with an absolute window:

```bash
curl -s -X POST http://localhost:8080/admin/sales \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"stock":100,"startsAt":"2030-01-01T12:00:00Z","endsAt":"2030-01-01T13:00:00Z"}'
```

The reply is `201` with the sale. A window that overlaps another sale is refused with `409` `sale_overlaps`. The seed
command above does not check this, so it can still create overlapping sales; the API is the safe way to set up a real
sale. See [admin and sale windows](../explanation/admin-and-sale-windows.md).

## Change, list or remove a sale

The same token works for three more routes. `<id>` is the `id` of the sale.

```bash
# every sale, the one that opens last first
curl -s http://localhost:8080/admin/sales -H "Authorization: Bearer $ADMIN_TOKEN"

# change a sale: send only the fields that change
curl -s -X PATCH http://localhost:8080/admin/sales/<id> \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"stock":150}'

# remove a sale
curl -s -X DELETE http://localhost:8080/admin/sales/<id> -H "Authorization: Bearer $ADMIN_TOKEN"
```

The rules, in short:

- A sale that has not started can change in every field.
- A running sale keeps its start and can only get more stock; its end, name, hold time and admission rate can change.
  A change that does not follow this is refused with `409` `sale_locked`.
- A sale that is over cannot change (`409` `sale_locked`).
- A window that would overlap another sale is refused with `409` `sale_overlaps`.
- A sale that has a purchase is not removed (`409` `sale_has_purchases`). Any other sale is removed with its holds.

The bodies and every error are in [HTTP endpoints](../reference/http-endpoints.md#changing-a-sale-operator). The scenarios
are in
[`specs/apps/flash/be/behaviours/sale/operating.feature`](../../specs/apps/flash/be/behaviours/sale/operating.feature).
