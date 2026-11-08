# Run the demo

Show the flash sale in about ten minutes: a shopper buys on the page, the API refuses what it must refuse, the sale
keeps selling while Redis is down, and a load run proves that nothing was sold twice. You need the tools from the
[tutorial](../tutorials/run-flash-sale-locally.md) (Volta, Docker, Git), `npm install` done once, and a `.env`
(`cp .env.example .env`).

The requests are in [`api-flash-demo.http`](../../api-flash-demo.http), in the
[kulala.nvim](https://github.com/wahidyankf/kulala.nvim) format, so you also need Neovim with kulala.nvim. Send them
one at a time from top to bottom.

## Before the audience arrives

```bash
npm run demo:reset   # wipes the local Postgres and Redis data, then migrates
npm run demo:setup   # starts Postgres and Redis, migrates, makes the operator ops, seeds a sale of 3 items
npm run demo:dev     # starts the API on :8080 and the web page on :3000; leave it running
```

`demo:reset` deletes every local account and sale. Skip it to keep them, but then an older sale that is still running
can be the current one, because one sale runs at a time and the seed command does not check for overlaps. The names
`ana` and `ben` can also be taken, because the e2e tests use the same database and the same names with another
password. Then sign up with new names.
`demo:setup` goes on when the operator `ops` already exists.

Open <http://localhost:3000> in two browser windows, one of them private, so that two shoppers have their own cookies.
Both show **On sale** and **Items left: 3**.

## 1. A shopper buys on the page

1. In the first window, choose **I am new**, sign up as `ana` with the password `a long password`, and press
   **Buy Now**. The page says **An item is held for you. Confirm within 60 seconds.** and counts down.
2. Press **Confirm purchase**. The page says **You got it! Your purchase is confirmed.** and shows the **Purchase ID**.
   **Check my status** shows the same ID after a reload.
3. Point at the second window: **Items left** went to 2 without a reload. The page follows a Server-Sent Events stream.
4. Press **Buy Now** again in the first window: **You already bought an item.**

What to say: the hold is taken by one Redis script, the purchase by one Postgres transaction that raises `sold` only
while `sold < stock`, and `UNIQUE(sale_id, user_id)` stops a second purchase whatever Redis says.

## 2. The API, request by request

Open [`api-flash-demo.http`](../../api-flash-demo.http) and send requests 1 to 25. The ones to stop at:

| Request | What it shows                                                                              |
| ------- | ------------------------------------------------------------------------------------------ |
| 3       | the login sets two `HttpOnly` cookies; the tokens are never in a body                      |
| 5       | `409 sale_overlaps`: the operator cannot open two sales at the same time                   |
| 8       | a removal is a soft delete; the row stays with `deleted_at` and `deleted_by`               |
| 13, 14  | the queue answers with a signed ticket and lets shoppers in each second                    |
| 16      | holding again gives the same hold, not a second item                                       |
| 19      | paying again gives the same purchase with `200`: the reservation id is the idempotency key |
| 21      | `409 already_purchased`                                                                    |
| 23, 25  | `403 forbidden` for a shopper on an operator route, `401 not_authenticated` with no login  |

The reply to request 8 has only the id. To show the row that stayed:

```bash
npm run demo:deleted-sale
```

It reads the last removed sale from Postgres and prints `Demo sale for later`, the time and `ops`.

This buys the second item, so one is left. Requests 26 to 30 go through the web server: the browser reaches only a
fixed list of routes, the operator routes answer `404`, and a `POST` from another site answers `403 cross_site`.

## 3. Redis goes down, the sale goes on

```bash
npm run demo:redis:stop
curl -s localhost:8080/ready
```

The answer is `{"status":"unavailable","checks":{"database":"ok","redis":"error"}}` with status `503`. In the second
window, sign up as `ben` with the password `a long password`, press **Buy Now** and **Confirm purchase**: the purchase
goes through on Postgres alone, under a row lock. It is the last item, so within a few seconds both windows change to
**Sold out** by themselves.

```bash
npm run demo:redis:start   # returns when Redis is healthy; /ready answers ok again
```

What to say: Redis is a fast gate that Postgres can rebuild, so losing it costs speed, not correctness. See
[serving without Redis](../explanation/serving-without-redis.md).

## 4. Proof under load

```bash
npm run demo:load
```

It takes a few minutes. It starts its own stack (three API instances behind nginx on port 8088), so it does not touch
the demo. 500 shoppers go for 20 items, and the runner then checks the data in Postgres and Redis. It exits `0` and
prints a table where every check passes: no oversell, no shopper bought twice, k6 and Postgres agree, and the shoppers
who flood the queue get `429`. The same table is written to `generated-reports/load/smoke.md`, so you can open it
while the audience looks. The rows are explained in [the load test reference](../reference/load-test.md).

## Afterwards

Stop `demo:dev` with Ctrl+C, then `npm run docker:dev:down`. To show the code, start from the table **Start here** in
the [README](../../README.md#start-here).

## If something goes wrong

| What you see                             | Why, and what to do                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- |
| sign up says "That name is taken"        | the name exists from an earlier run or the e2e tests: pick another name                             |
| request 4 answers `409 sale_overlaps`    | an earlier run stopped before request 8: delete that sale (its id is in request 6) and send 4 again |
| request 10 answers `409 username_taken`  | the shopper exists from an earlier run: send request 11 to log in                                   |
| request 14 says `waiting`                | the queue lets shoppers in each second: send 14 again                                               |
| request 18 answers `402 payment_failed`  | the mock payment declines about 2% of the time; the hold stays, send 18 again                       |
| the page shows an older or sold out sale | another sale is running: start again with `npm run demo:reset` and `npm run demo:setup`             |
| "run all" in kulala stops early          | it stops at the first refusal, and several are on purpose; send the requests one at a time          |
