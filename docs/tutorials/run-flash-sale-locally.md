# Run the flash sale locally

This tutorial takes you from a fresh clone to buying an item in the browser. Postgres and Redis run in Docker. The two
apps run on your machine.

You need [Volta](https://volta.sh/), Docker, and Git. Volta pins the Node and npm versions for this repository.

## 1. Install the dependencies

From the repository root:

```bash
npm install
```

`npm install` also installs the Git hooks.

## 2. Create the local env file

```bash
[ -f .env ] || cp .env.example .env
```

The values in `.env` are for local development only. Do not use them anywhere else.

## 3. Start Postgres and Redis

```bash
npm run docker:dev:up
```

The output ends with the two containers, `flash-dev-postgres-1` and `flash-dev-redis-1`, marked as healthy.

## 4. Apply the migrations

```bash
npx nx db:migrate flash-be
```

Nx reports `1 task: 1 succeeded`. The migration command prints nothing when the schema is already current.

## 5. Start the API

Run this in its own terminal and leave it running:

```bash
npx nx dev flash-be
```

In another terminal, check the two API endpoints:

```bash
curl localhost:8080/health
```

The response is `{"status":"ok"}`.

```bash
curl localhost:8080/ready
```

The response is `{"status":"ok","checks":{"database":"ok","redis":"ok"}}`.

## 6. Seed a sale

```bash
npx nx db:seed-sale flash-be --stock=3 --starts-in-minutes=0 --duration-minutes=60 --hold-seconds=60
```

The command prints the id of the new sale, such as `seeded sale ed225112-64e6-40d8-8cf3-30c4fe023bdb`. Read it back:

```bash
curl -s localhost:8080/sales/current
```

The body shows `"status":"active"`, `"stock":3` and `"remaining":3`.

## 7. Start the web app

Run this in a third terminal and leave it running:

```bash
npx nx dev flash-web
```

Open <http://localhost:3000>. The page shows **Flash Sale**, the status **On sale**, the times the sale **Opens** and
**Closes**, **Items left: 3** and the line **Backend: ok**.

## 8. Sign up and buy an item

1. The page shows **Log in to buy** instead of the buying buttons. Choose **I am new**, type `ana` in **Username** and a
   password of at least 8 characters (for example `a long password`), and press **Sign up**. You are logged in at once and
   the page says **Signed in as ana**. The login is two cookies that the browser keeps; the page never sees the tokens.
2. Press **Buy Now**. The shopper is let in at once, because nobody is waiting. The page says **An item is held for you.
   Confirm within 60 seconds.** (the hold time you seeded) and the seconds count down.
3. Press **Confirm purchase**. The page says **You got it! Your purchase is confirmed.**, shows the **Purchase ID** (the
   id of the purchase row), and **Items left** drops to 2.
4. Press **Buy Now** again. The page says **You already bought an item.** One shopper can buy one item.
5. Press **Log out**, choose **I am new** and sign up as `ben` to see a shopper who has nothing: the page says **You
   have no purchase and no hold.** after **Check my status**.

A wrong password says **Wrong name or password.**, and a name that is taken says **That name is taken. Choose another
one.** If your login ends while the page is open (the access cookie lasts 15 minutes and the page renews it by itself),
the page says **Your login has ended. Please log in again.** See [explanation: authentication](../explanation/authentication.md).

When the last item is bought, the status changes to **Sold out** and **Buy Now** is disabled. The page follows the sale
by itself, so you do not need to reload it.

If more shoppers arrive than the queue lets in each second, the page shows the place in line instead, and moves on when
the shopper is admitted. See [explanation: the waiting queue](../explanation/waiting-queue.md).

When the window of the sale closes, a page that is open shows **Ended**. After that, a reload shows the next sale if one is
scheduled, and says that no sale is open if none is. The page shows only the running sale, or else the next one to open.

The page follows your system color scheme, light or dark.

## 9. Stop everything

Press Ctrl+C in the two `nx dev` terminals. Then stop the containers:

```bash
npm run docker:dev:down
```

## Next steps

- To learn the tools and patterns the code is built with, read the [crash courses](crash-courses/README.md).
- To add a behaviour, read [how-to: add a behaviour](../how-to/add-a-behaviour.md).
- To see every endpoint, read [reference: HTTP endpoints](../reference/http-endpoints.md).
