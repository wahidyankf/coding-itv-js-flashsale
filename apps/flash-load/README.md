# flash-load

The stress test. k6 sends many shoppers at three `flash-be` instances behind nginx, then the runner reads Postgres and
Redis and gives a verdict from the data: no oversell, no shopper bought twice, k6 and Postgres agree
([why from the data](../../docs/explanation/decisions/012-load-verdict-from-the-data.md)). The rules and limits are in
[specs/apps/flash/load](../../specs/apps/flash/load/README.md).

## Where things are

```text
k6/
  profiles.ts      the profiles (smoke, full, chaos, burst, contention) and the limits a run must meet
  shop.ts          the k6 script: one iteration is one shopper's visit, in named steps
scripts/
  run.ts           runs one profile end to end, as a list of phases
  compose.ts       the one place that talks to the stack (docker compose, psql, redis-cli)
  chaos.ts         stops and starts Redis during the chaos profile
  sampler.ts       samples Postgres locks and sessions while k6 runs
  collect.ts       reads what Postgres, Redis and the k6 summary say
  verdict.ts       judges each check
  report.ts        writes generated-reports/load/<profile>.md
  *_tests.ts       unit tests of the pure parts (verdict, sampler, report); vitest.config.ts runs them
  bundle.ts        bundles k6/shop.ts into one file for the k6 container
compose.yaml       the stack: Postgres, Redis, three API instances, nginx on :8088, k6
nginx.conf         the load balancer in front of the API
```

## To add something

| To add …               | Put it in …                                                                                 | Also update …                                                            |
| ---------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| a profile              | `k6/profiles.ts`, and a `load:<name>` target                                                | `specs/apps/flash/load/profiles.md` and `limits.md`                      |
| a check                | `scripts/collect.ts` (the data) and `scripts/verdict.ts`, with a case in `verdict_tests.ts` | `specs/apps/flash/load/checks.md`                                        |
| a step of a shopper    | a named step in `k6/shop.ts`                                                                | the paths it calls stay written here, as an independent check of the API |
| a command on the stack | `scripts/compose.ts`                                                                        | nothing else should call `docker compose` itself                         |

A failed run is a finding. A limit is never changed to make a run pass.

## Commands

```bash
npx nx test:quick flash-load      # typecheck, lint and the unit tests of the runner
npx nx load:smoke flash-load      # a few minutes; report in generated-reports/load/smoke.md
npx nx load:chaos flash-load      # Redis goes down and comes back during the run
```
