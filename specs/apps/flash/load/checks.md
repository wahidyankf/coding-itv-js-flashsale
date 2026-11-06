# Checks

The checks that decide the verdict of a load run. The runner reads Postgres and Redis after k6 finishes, then compares
k6 with them. The implementation is in `apps/flash-load/scripts/run.ts`.

| Check                    | Passes when                                               | Profiles      |
| ------------------------ | --------------------------------------------------------- | ------------- |
| k6 started every shopper | k6 dropped no planned iteration                           | all           |
| No oversell              | the sold count is at most the stock                       | all           |
| Sold count is true       | the sold count equals the number of purchase rows         | all           |
| One item per user        | no shopper has more than one purchase                     | all           |
| k6 and Postgres agree    | the purchases k6 saw confirmed equal the purchase rows    | all           |
| The stock sold out       | the sold count equals the stock                           | all           |
| Floods are limited       | flooders received `429` replies, not errors               | all           |
| Redis and Postgres agree | the size of the Redis buyers set equals the purchase rows | all but chaos |
| Speed and errors         | the limits in [limits](limits.md) hold                    | all but chaos |

## Reading a failed check

A failed check is a finding about the system and is investigated. The invariant checks (no oversell, one item per user)
are never acceptable to fail. A failure there is a bug in the sale path, and a scenario must be added for it before the
fix.

Results are written to `generated-reports/load/` (ignored by Git): `<profile>.md` with the verdict table,
`<profile>-k6.json` with the k6 summary, and `<profile>-k6.log` with the k6 output.
