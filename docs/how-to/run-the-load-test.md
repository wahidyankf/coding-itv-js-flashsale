# Run the load test

Runs the stack with three API instances behind nginx, sends shoppers at it with k6, and checks that nothing was sold
twice or over the stock. Docker must be running. Nothing else needs to be installed, since k6 runs as a container.

## 1. Run a profile

```bash
npx nx load:smoke flash-load
```

The runner builds the API image, starts the stack, seeds a sale, runs k6, checks Postgres and Redis, and then removes the
stack and its data. It exits with `0` when every check passed and `1` when one failed. Pass `--keep` to leave the stack
up for a look: `npm run load:smoke --workspace flash-load -- --keep`. Stop it later with
`docker compose -f apps/flash-load/compose.yaml down -v`.

The other profiles are `load:full`, `load:chaos`, `load:burst` and `load:contention`. What each one sends is in the
[profile table](../reference/load-test.md#profiles).

## 2. Read the result

The runner prints a table and writes it to `generated-reports/load/<profile>.md`. Each row is one check with what was
expected and what was found. The row `requests per instance` shows how the three instances shared the work.

## If a check fails

Read the k6 log in the same folder first. A failed limit is a finding: record the real numbers, find the cause, and fix
the system. Do not change a limit in [`profiles.ts`](../../apps/flash-load/k6/profiles.ts) to make a run pass.

See [reference: load test](../reference/load-test.md) for the profiles, limits and checks.
