# What the load runs found

The limits in [reference: load test](../reference/load-test.md) were fixed before the first run. This page records what
the runs showed and what was changed because of them. A limit was never changed to make a run pass.

## The invariants held every time

In every run of smoke, full and chaos, `sales.sold` equalled the number of `purchases` rows and never passed the stock.
No user bought twice. k6 and Postgres agreed on the number of purchases. After Redis came back, the Redis buyers set was
rebuilt to the same size as the rows in Postgres. This held even while Redis was stopped, because the Postgres path
takes a row lock and the database constraints refuse a second sale.

## Paying during a Redis outage was slow

The first chaos run kept every invariant and had no server errors, but the 95th percentile of a purchase was about
1.8 seconds, against a limit of 500 ms (the limit does not apply to chaos, but the number is a finding).

Cause: the Redis client is created with `disableOfflineQueue`, so a command sent while Redis is down fails at once.
A `MULTI`/`EXEC` is different. It waits for the connection first, and the wait grows with the length of the outage
(about 0.9 s, then 1.8 to 2 s). The hold gate used `MULTI` to record a purchase and to release a hold, so each payment
waited for it, even though the answer was thrown away.

Fix: `confirm` and `release` in `redis-hold-gate.ts` are single Lua scripts. A script fails at once when Redis is down,
like the other gate calls. The scenario "Paying while Redis is down is not slowed down" holds the outage for four
seconds and requires every confirmation to answer in under 500 ms. It failed before the fix (2,148 ms) and passes after.

The same chaos profile then gave a purchase p95 of 155 ms, which is the 150 ms of the mock payment plus the database.

## A buyer asking again during the outage gets a different refusal

In the chaos run, 12 to 15 of about 200 buyers who reserved a second time were refused with `403 not_admitted` and not
`409 already_purchased`, so k6 reports the check "a second reserve is refused" as failed for them. No second hold was
made and no invariant broke. The reserve route checks the queue place before it asks the gate, and the queue lives only
in Redis. The load stack runs Redis without persistence, so a stop and start empties the queue, and a shopper who bought
a moment ago is no longer admitted. This is likely, not proven. It is left as it is: the refusal is safe, and a lost
queue is the documented cost of keeping the queue in Redis (see
[serving without Redis](serving-without-redis.md)). The check stays in the script, so the number is visible in every
chaos run.

## How the runs went

| Profile | Stock sold     | Reserve p95 | Purchase p95 | Server errors |
| ------- | -------------- | ----------- | ------------ | ------------- |
| smoke   | 20 of 20       | 2.1 ms      | 156 ms       | 0             |
| full    | 100 of 100     | 1.6 ms      | 156 ms       | 0             |
| chaos   | 1,000 of 1,000 | 3.0 ms      | 155 ms       | 0             |

The client and the servers share one machine, so treat the times as relative. The correctness checks are exact.

## Harness changes the first runs forced

These were faults in the test, not in the system, and are listed so the numbers can be trusted.

- k6 dropped iterations when shoppers kept retrying a sold-out sale and held all virtual users. A shopper now reserves
  once and stops when the sale is sold out, and a dropped iteration fails the run.
- Shoppers who waited in the queue after the sell-out never finished. A waiting shopper now reads the sale and gives up
  when it is sold out or ended.
- Items freed by abandoned holds stayed unsold because arrivals ended before the last hold lapsed. Late shoppers now
  arrive after the holds have lapsed.
- The first chaos stock of 50 sold out before Redis stopped. The stock is now 1,000 and the outage starts at +4 s.
