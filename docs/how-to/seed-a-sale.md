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

| Option                | Meaning                                        | Default      |
| --------------------- | ---------------------------------------------- | ------------ |
| `--stock`             | items for sale; a positive integer             | required     |
| `--name`              | name of the sale; spaces around it are dropped | `Flash sale` |
| `--starts-in-minutes` | minutes from now until the sale opens          | `0`          |
| `--duration-minutes`  | minutes the sale stays open                    | `60`         |
| `--hold-seconds`      | how long a reservation holds an item           | `120`        |
| `--admit-per-second`  | users let in from the queue each second        | `50`         |

A bad value stops the command with a message and exit code `1`, and nothing is written. For example, `--stock=0`
fails with `stock must be a positive integer`. A name of only spaces or of more than 120 characters, or a window too far
in the future to be a date, fails with `the sale is not usable: its name, window or holds are out of range`.

## Read it back

Start the API (`npx nx dev flash-be`), then:

```bash
curl -s http://localhost:8080/sales/current
```

The body is described in [HTTP endpoints](../reference/http-endpoints.md#the-sale). If another sale is running too,
`/sales/current` shows the one that started first. Read the new sale by the id the command printed instead:

```bash
curl -s http://localhost:8080/sales/<id>
```

The scenarios for this command are in
[`specs/apps/flash/be/behaviours/sale/seeding.feature`](../../specs/apps/flash/be/behaviours/sale/seeding.feature).

## Create the sale through the API instead

An operator creates a sale over HTTP, with an absolute window, after logging in. The first operator is made on the server,
because nobody can become one through the API (the password has 8 to 128 characters; the Nx target needs one without spaces):

```bash
npx nx db:create-operator flash-be --username=ops --password=correct-horse-battery
```

It prints `created operator ops`. If `ops` is already there (the demo makes it), it prints `the user ops already exists`;
log in with it as below. In the production image the same command is
`node dist/create-operator.js --username ops --password "..."`.

Then log in. `-c` saves the cookies in a file and `-b` sends them back:

```bash
curl -s -c cookies.txt -X POST http://localhost:8080/auth/login \
  -H "Content-Type: application/json" -d '{"username":"ops","password":"correct-horse-battery"}'
curl -s -b cookies.txt -X POST http://localhost:8080/admin/sales \
  -H "Content-Type: application/json" \
  -d '{"stock":100,"startsAt":"2030-01-01T12:00:00Z","endsAt":"2030-01-01T13:00:00Z"}'
```

The access cookie lasts 15 minutes. To renew it, send the refresh cookie and save the new cookies in the same file
(`-b` and `-c`), because a refresh token works only once:

```bash
curl -s -b cookies.txt -c cookies.txt -X POST http://localhost:8080/auth/refresh
```

The local [`.env.example`](../../.env.example) sets `COOKIE_SECURE=false`, because a `Secure` cookie is not sent over plain HTTP.

The reply is `201` with the sale. A window that overlaps another sale is refused with `409` `sale_overlaps`. If a sale
already uses that hour (you ran this before, or the request in the root [`README.md`](../../README.md)), pick another day in `startsAt` and
`endsAt`. The seed command above does not check overlaps, so it can still create overlapping sales; the API is the safe
way to set up a real sale. See [admin and sale windows](../explanation/admin-and-sale-windows.md).

## Change, list or remove a sale

The same login works for three more routes. `<id>` is the `id` of the sale.

```bash
# every sale, the one that opens last first
curl -s -b cookies.txt http://localhost:8080/admin/sales

# change a sale: send only the fields that change
curl -s -b cookies.txt -X PATCH http://localhost:8080/admin/sales/<id> \
  -H "Content-Type: application/json" \
  -d '{"stock":150}'

# remove a sale
curl -s -b cookies.txt -X DELETE http://localhost:8080/admin/sales/<id>
```

What each state of a sale lets you change, the bodies and every error are in
[HTTP endpoints](../reference/http-endpoints.md#changing-a-sale-operator); why is in
[admin and sale windows](../explanation/admin-and-sale-windows.md). The scenarios
are in
[`specs/apps/flash/be/behaviours/sale/operating.feature`](../../specs/apps/flash/be/behaviours/sale/operating.feature).
