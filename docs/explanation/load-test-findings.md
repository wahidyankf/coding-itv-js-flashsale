# What the load runs found

The limits in [reference: load test](../reference/load-test.md) were fixed before the first run. This page records what
the runs showed and what was changed because of them. A limit was never changed to make a run pass.

## The invariants held every time

In every run of smoke, full and chaos, `sales.sold` equalled the number of `purchases` rows and never passed the stock.
No user bought twice. k6 and Postgres agreed on the number of purchases. After Redis came back, the Redis buyers set was
rebuilt to the same size as the rows in Postgres. This held even while Redis was stopped, because the Postgres path
takes a row lock and the database constraints refuse a second sale.

## A herd of 700 in one second

`smoke`, `full` and `chaos` send shoppers over many seconds, so the queue smooths the load before it reaches the sale.
Two profiles, `burst` and `contention`, were added to send everyone inside one second. Their size and the reason for it
are in `profiles.ts` and were written before they ran. The limits are the same as for every other run.

**The first try never began.** With 2,000 shoppers k6 stopped starting virtual users at 1,186 of 2,070 on a Docker VM with
7.7 GiB, about 6 MiB for each user with a schema library bundled into the script (the script has since been made plain code). That is a limit of the machine
that runs the load generator, not a result about the system. The herd was cut to 700, close to the 670 users that `full`
starts. The runner now reports a missing k6 summary as a load-generator failure and removes the stack.

**The invariants held.** In four runs (two of each profile) `sales.sold` equalled the number of purchase rows and never
passed the stock (100 of 100 in `burst`, 50 of 50 in `contention`), no shopper bought twice, k6, Postgres and Redis agreed,
the flooding users got `429`, and there were no server errors. Postgres never had a session waiting for a lock. The
`contention` profile is the first one that sends hundreds of reserves for 50 items in the same moment, and the Lua gate
and `UPDATE ... WHERE sold < stock` held.

**The speed limits failed, as k6 measures them.**

| Run          | Reserve p95 | Purchase p95 | Dropped | Note                                   |
| ------------ | ----------- | ------------ | ------- | -------------------------------------- |
| burst 1      | 2,379 ms    | 1,949 ms     | 3       |                                        |
| burst 2      | 701 ms      | 724 ms       | 0       | API logs kept                          |
| contention 1 | 349 ms      | 213 ms       | 0       | reserve over the limit, purchase under |
| contention 2 | 551 ms      | 194 ms       | 0       | API logs kept                          |

**Where the time is not.** In the runs with logs, the API logged a reserve at a median of 1.5 ms and a 95th percentile of
5.3 to 5.5 ms (largest 46 ms). A purchase took 155 ms in the median, which is the 150 ms of the mock payment. A join took
13 to 38 ms at the 95th percentile. So the handlers are not slow, and the database is not the wait. The gap between 5 ms
and 350 to 2,400 ms is outside the handler: 700 to 770 virtual users running in k6's JavaScript runtime, nginx, and three
Node processes all share six CPUs, and the run-to-run spread (701 against 2,379 ms for the same profile) says the machine is
the noisy part.

**What this does not show.** The API logs time a request from when Node hands it to the server. They do not include the
time a request waits before that, in nginx, in the network or in a busy event loop. So the logs lower the suspicion on the
handlers, but they do not prove that a real client would see 5 ms. A faithful speed result needs the load generator on
another machine. Until then the two profiles are judged on speed with the fixed limits, and they fail on this machine; a
limit was not changed or switched off to make them pass.

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

## A buyer asking again during the outage was refused with the wrong error

In the first chaos runs, 12 to 15 of about 200 buyers who reserved a second time were refused with `403 not_admitted`
and not `409 already_purchased`, so k6 reported the check "a second reserve is refused" as failed for them. No second
hold was made and no invariant broke, so the refusal was safe, but the error was wrong.

Cause: the reserve route checks the queue place before it asks the gate, and the queue lives only in Redis. The load
stack runs Redis without persistence, so a stop and start empties the queue, and a shopper who bought a moment ago was
no longer admitted.

Fix: when the queue has no place for the shopper, the route asks Postgres whether they already bought, and answers
`409 already_purchased` if so. The query runs only for shoppers the queue does not know, not on the hot path. The
scenario "A buyer is told so when the queue was lost" binds it at unit, integration and end-to-end level. After the fix
the chaos run passed all 1,384 k6 checks. The check was not loosened.

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
