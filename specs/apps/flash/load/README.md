# flash-load Specifications

The specification of the load test, `apps/flash-load`. It sends shoppers at three `flash-be` instances behind nginx with
k6, then decides the verdict from Postgres and Redis, not from what k6 reports. The load test has no Gherkin scenarios.
Its rules are written here, and the code reads the same numbers from `apps/flash-load/k6/profiles.ts`.

## Rules

- A run must prove the invariants of the sale: no oversell, no second item for one shopper, and k6 and the database agree.
- A run is judged on speed and errors, except the chaos profile, which breaks Redis on purpose.
- The limits are fixed before a run. A failed run is a finding to investigate. Never change a limit to make a run pass.
- The load test runs only on demand. It needs Docker and is never part of the pre-push hook.

## Commands

| Command                  | Profile    |
| ------------------------ | ---------- |
| `npx nx load:smoke`      | smoke      |
| `npx nx load:full`       | full       |
| `npx nx load:chaos`      | chaos      |
| `npx nx load:burst`      | burst      |
| `npx nx load:contention` | contention |

Each command is run as `npx nx <target> flash-load`.

## Directory Map

- [profiles.md](profiles.md) - what each profile sends and what it is for.
- [limits.md](limits.md) - the speed and error limits a run must meet, and which profiles they apply to.
- [checks.md](checks.md) - the checks that decide the verdict of a run.

The numbers are in [`apps/flash-load/k6/profiles.ts`](../../../../apps/flash-load/k6/profiles.ts). The steps to run the
test are in [how to: run the load test](../../../../docs/how-to/run-the-load-test.md).
