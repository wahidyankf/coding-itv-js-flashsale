# Checks

The checks that decide the verdict of a load run. The runner reads Postgres and Redis after k6 finishes, then compares
k6 with them. The data is read in [`apps/flash-load/scripts/collect.ts`](../../../../apps/flash-load/scripts/collect.ts) and the checks are judged in
[`apps/flash-load/scripts/verdict.ts`](../../../../apps/flash-load/scripts/verdict.ts); [`run.ts`](../../../../apps/flash-load/scripts/run.ts) runs the phases in order.

The names in the first column are the names the verdict table of a run prints.

| Check                                       | Passes when                                               | Profiles      |
| ------------------------------------------- | --------------------------------------------------------- | ------------- |
| k6 started every planned shopper            | k6 dropped no planned iteration                           | all           |
| k6 had an account for every shopper         | k6 found a signed-up account for every shopper it started | all           |
| no oversell: sold is at most the stock      | the sold count is at most the stock                       | all           |
| the sold count equals the purchases         | the sold count equals the number of purchase rows         | all           |
| no shopper bought twice                     | no shopper has more than one purchase                     | all           |
| k6 and Postgres agree on purchases          | the purchases k6 saw confirmed equal the purchase rows    | all           |
| the stock sold out                          | the sold count equals the stock                           | all           |
| the shopper who floods the queue is limited | the flooders received at least one `429` reply            | all           |
| Redis and Postgres agree on buyers          | the size of the Redis buyers set equals the purchase rows | all but chaos |
| reserve p95, purchase p95 and server errors | the limits in [limits](limits.md) hold                    | all but chaos |

The row "Redis and Postgres agree on buyers" is left out of the verdict, not failed, when Redis does not answer a
`PING` once k6 has finished: the runner then has no count of buyers to compare.

## Reading a failed check

A failed check is a finding about the system and is investigated. The invariant checks (no oversell, one item per user)
are never acceptable to fail. A failure there is a bug in the sale path, and a scenario must be added for it before the
fix.

Where a run writes its results is in [reference: load test](../../../../docs/reference/load-test.md#output).
