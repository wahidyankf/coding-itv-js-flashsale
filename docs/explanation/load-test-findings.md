# What the load runs found

The limits in [specification: limits](../../specs/apps/flash/load/limits.md) were fixed before the first run and are
never changed to make a run pass. This page gives the results of each profile, then each thing the runs measured that
shaped the code or the test, with what the code does about it now.

## The results

One run of each profile on one laptop, where k6 and every server share six CPUs on a Docker VM:

| Profile    | Result             | Stock sold     | Reserve p95 | Purchase p95 | Dropped |
| ---------- | ------------------ | -------------- | ----------- | ------------ | ------- |
| smoke      | every check passed | 20 of 20       | 2.6 ms      | 158.9 ms     | 0       |
| full       | every check passed | 100 of 100     | 4.4 ms      | 167.4 ms     | 0       |
| contention | every check passed | 50 of 50       | 3.0 ms      | 160.8 ms     | 0       |
| chaos      | every check passed | 1,000 of 1,000 | 131.7 ms    | 365.0 ms     | 0       |

`burst` ran five times. Each run sold 100 of 100 with no dropped shopper and every data check green. Four runs passed
every check, with a reserve p95 of 3.1 to 9.1 ms and a purchase p95 of 159.6 to 179.5 ms. One run failed the purchase
speed limit: 519.8 ms against 500 ms. In that run the whole distribution was slower, not only the tail (median 243 ms,
reserve p95 19.2 ms), and other projects' containers shared the VM, with a load average of about 16.7 when it was
checked. The cause is not proven. It is an open finding, and the limit stays.

In every run `sales.sold` equalled the number of `purchases` rows and never passed the stock, no shopper bought twice,
k6 and Postgres agreed on the purchases, and the flooding shopper got `429`. In `chaos`, Redis stops at +4 s and starts
again, and the Redis buyers set is rebuilt to the same size as the rows in Postgres. The invariants hold while Redis is
stopped, because the Postgres path takes a row lock and the database constraints refuse a second sale. Chaos is judged on
the data only, so its speed is for information: while Redis is down, every reserve takes the slower Postgres path.

A purchase p95 of about 160 ms is the 150 ms of the mock payment plus the database.

## What the times mean

The client and the servers share one machine, so the times are relative and move with whatever else the machine runs.
The correctness checks are exact. The API logs time a request from when Node hands it over; they do not include a wait
in nginx, in the network or in a busy event loop. A faithful speed result needs the load generator on another machine.

## Paying during a Redis outage answers at once

The Redis client is created with `disableOfflineQueue`, so a command sent while Redis is down fails at once. A
`MULTI`/`EXEC` does not: it waits for the connection, and the wait grows with the outage. A chaos run with `MULTI` in the
hold gate measured a purchase p95 of about 1.8 seconds, because each payment waited for it.

So `confirm` and `release` in
[`redis-hold-gate.ts`](../../apps/flash-be/src/adapters/outbound/redis/redis-hold-gate.ts) are single Lua scripts, which
fail at once like the other gate calls. The scenario "Paying while Redis is down is not slowed down" holds the outage
for four seconds and requires every confirmation to answer in under 500 ms; with `MULTI` it measured 2,148 ms.

## A buyer who asks again while the queue is lost is told they bought

The reserve route checks the queue place before it asks the gate, and the queue lives only in Redis. The load stack runs
Redis without persistence, so a stop and start empties the queue, and a shopper who had just bought would get
`403 not_admitted` on a second reserve instead of `409 already_purchased`. No second hold could be made, but the error
was wrong for 12 to 15 of about 200 buyers in a chaos run.

So when the queue has no place for the shopper, the route asks Postgres whether they already bought, and answers
`409 already_purchased` if so. The query runs only for shoppers the queue does not know, not on the hot path. The
scenario "A buyer is told so when the queue was lost" binds it at unit, integration and end-to-end level.

## Shoppers sign up before the sale, not during it

A sign-up hashes the password with scrypt at the cost Node uses by default, about 32 ms of CPU. `full` sends 250 shoppers
a second, so sign-ups during the run would need about 8 CPU-seconds every second on six CPUs. Measured that way, `full`
sold every item but had a purchase p95 of 641 to 673 ms, and k6 started up to 563 shoppers late; all requests together
had a p95 of 3.7 s while reserve stayed at about 41 ms. That measures the hashing, not the sale, and a real shopper signs
up before a sale opens.

So the runner signs every account up before k6 starts
([`scripts/accounts.ts`](../../apps/flash-load/scripts/accounts.ts)), and k6 reads the tokens from a file. A check fails
the run if a shopper has no account.

## The pool of virtual users is larger than the herd

`burst` and `contention` send 700 shoppers within one second, and a visit lasts more than a second, because the first
poll of the place waits 1 to 2 seconds. With a pool equal to the herd, 700, k6 had no free user for the last arrivals and
dropped 1 or 2 of them in three of five `burst` runs ("Insufficient VUs"), which fails the check that k6 started every
planned shopper. The pool is 800, five `burst` runs with it dropped no shopper, and
[`profiles_tests.ts`](../../apps/flash-load/k6/profiles_tests.ts) keeps it above the herd.

The pool has a ceiling that the machine sets, not the system: on the 7.7 GiB Docker VM, k6 stopped starting virtual users
at 1,186 of 2,070 (about 6 MiB each), so the herd is 700, close to the 670 users that `full` starts. The runner reports a
missing k6 summary as a load-generator failure and removes the stack.

## Latecomers take the items that abandoned holds give back

One shopper in twenty walks away with a hold on purpose, and the item comes back when the hold lapses. Latecomers arrive
after that to buy it, so the stock sells out. Two details make that hold in every run:

- A latecomer never walks away with a hold. Theirs are the last holds, and nobody comes after them, so an abandoned
  latecomer hold would leave its item unsold (a run then sells 99 of 100).
- Latecomers start 5 seconds after the last herd hold could have lapsed. In `burst` the herd is admitted up to about
  1.3 seconds after its last arrival and polls up to 2 seconds later, so a latecomer who came earlier could meet a live
  hold and leave with nothing.

The report prints how many shoppers and latecomers walked away, for information.

## How the harness keeps a run honest

- A shopper reserves once and stops when the sale is sold out, so shoppers who keep retrying a sold-out sale do not hold
  every virtual user. A dropped iteration fails the run.
- A shopper who is still waiting in the queue reads the sale and gives up when it is sold out or ended.
- The chaos stock is 1,000 and the outage starts at +4 s, so items are still for sale when Redis stops.
- The verdict is read from Postgres and Redis after the run, not from what k6 saw
  ([decision 012](decisions/012-load-verdict-from-the-data.md)).
