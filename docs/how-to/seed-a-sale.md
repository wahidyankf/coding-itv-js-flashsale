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
[`specs/flash/be/behaviours/sale/seeding.feature`](../../specs/flash/be/behaviours/sale/seeding.feature).
