# Vitest crash course

[Vitest](https://vitest.dev/) is a test runner for TypeScript and JavaScript. This repository uses it for every test
that is not end-to-end or load: the plain tests next to the code, the Gherkin scenarios at the unit and integration
layers, and the 99% coverage gate. The version installed is Vitest 5.

## Why this repo uses Vitest

**The problem.** The sale path must never oversell, and a change to it must be checked before every push. The checks
come in three kinds: plain tests of one function, scenarios over in-memory stores, and the same scenarios over a real
Postgres and Redis. Vitest runs all three, and it merges their coverage into one number for the 99% floor.

**What we did not pick.** No decision record compares Vitest with other runners.
[Decision 014](../../explanation/decisions/014-gherkin-scenarios-at-three-layers.md) turned down a separate Cucumber
runner: it would need a second setup for coverage and watch mode.

**What it costs.** `flash-be` and `flash-web` each have three Vitest configs to keep in step. The coverage gate of `flash-be` needs Docker, because its
integration tests use Postgres and Redis; `flash-web` fakes the API and needs none. Globals are off, so every file imports what it uses and cleans up after itself.

## The ideas this repo uses

### A test file sits next to its code

A unit test is `<name>_tests.ts` (or `.tsx`) beside the module it tests. This one is
[`queue_tests.ts`](../../../apps/flash-be/src/domain/queue_tests.ts), next to [`queue.ts`](../../../apps/flash-be/src/domain/queue.ts):

```ts
import { describe, expect, it } from "vitest";
import { reserveRefusalOf } from "./queue.js";

describe("who may reserve", () => {
	it("lets an admitted shopper reserve", () => {
		expect(reserveRefusalOf({ state: "admitted" }, false)).toBeUndefined();
	});
```

### One config for each layer

[`vitest.config.ts`](../../../apps/flash-be/vitest.config.ts) runs the unit tests and leaves the integration tests out.
[`vitest.integration.config.ts`](../../../apps/flash-be/vitest.integration.config.ts) runs only
`*_integration_tests.ts`, one file at a time, over a fresh database:

```ts
		include: ["src/**/*_integration_tests.ts"],
		fileParallelism: false,
		// A fresh database per run keeps runs apart. global-setup.ts drops it at the end.
		globalSetup: ["./src/bdd/support/global-setup.ts"],
```

`flash-web` has the same pair. Its unit tests run in `jsdom`, and its integration tests run in Node against a fake
`flash-be` served over real HTTP ([`vitest.integration.config.ts`](../../../apps/flash-web/vitest.integration.config.ts)).

### Coverage is judged on the combined run

[`vitest.coverage.config.ts`](../../../apps/flash-be/vitest.coverage.config.ts) runs both configs as Vitest
`projects`, so the lines each layer runs are merged. The 99% floor is set only here:

```ts
		projects: ["./vitest.config.ts", "./vitest.integration.config.ts"],
		coverage: {
			enabled: true,
			provider: "v8",
			// ...
			thresholds: { lines: 99, functions: 99, branches: 99, statements: 99 },
```

`npx nx test:coverage <app>` runs it; for `flash-be` it starts the dev stack first. What is left out of the count, and why, is in
[test layers and coverage](../../reference/test-layers-and-coverage.md#coverage-floor).

### Globals are off, so import and clean up

`describe`, `it`, `expect` and `afterEach` are imported from `vitest` in every file. Testing Library cleans up the DOM by
itself only when the runner offers a global `afterEach`, so a component test does it by hand, as
[`sale-time_tests.tsx`](../../../apps/flash-web/src/components/sale-time_tests.tsx) does:

```tsx
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);
```

### Memory stores for tests, memory adapters for the product

The unit layer replaces Redis and Postgres with stores in
[`src/bdd/support/`](../../../apps/flash-be/src/bdd/support/), such as `memoryHoldGate` and `fakeRepository`. They are
test code, and they copy the rules of the real store:

```ts
// The reservation state in memory, for unit tests. It follows the same rules as the Redis script.
export function memoryHoldGate(clock: Clock): MemoryHoldGate {
```

Do not confuse them with [`adapters/outbound/memory/`](../../../apps/flash-be/src/adapters/outbound/memory/). That
folder holds the rate-limit counter that the API uses when Redis is down, which is product code, and the memory
payment ledger, which only the unit tests use. A test reaches a store only
through a port, so the
[hexagon](../../explanation/hexagonal-architecture.md) lets a test pick the store without mocking a module.

### Watch mode

`npx nx test:unit:watch flash-be` keeps Vitest open and reruns the tests a change touches, without coverage.
`npx nx test:quick:watch flash-be` reruns the type check, lint and unit tests through `nx watch`. The apps with
unit tests and both libraries have both; the e2e apps have only the second.

## Try it here

Run one test file from `apps/flash-be`, with each test on its own line:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts --reporter=verbose src/domain/queue_tests.ts
```

The output, trimmed:

```text
 RUN  v5.1.0 .../apps/flash-be

 ✓ |unit| src/domain/queue_tests.ts > who may reserve > lets an admitted shopper reserve 1ms
 ✓ |unit| src/domain/queue_tests.ts > who may reserve > keeps a waiting shopper out until they are admitted 0ms
 ✓ |unit| src/domain/queue_tests.ts > who may reserve > tells a shopper outside the line whether they already bought 0ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

`|unit|` is the `name` of the config. Change `"admitted"` to `"waiting"` in the first test and run it again to see a
failure.

## Traps to avoid

- **Unit coverage is not the gate.** `test:unit` reports coverage with no floor, because the database code of
  `flash-be` is covered only by the integration tests. Run `test:coverage` before you trust the number.
- **A fake that shares rows lies.** `fakeRepository` in
  [`fake-sales.ts`](../../../apps/flash-be/src/bdd/support/fake-sales.ts) returns copies, "as the database does, so a cache
  never sees a later change to a stored row". Without the copy a cache test passes that fails against Postgres.
- **A memory store must follow its real store.** `memoryHoldGate` follows the Redis script "so one scenario gives the
  same reply in both layers". If it drifts, the unit layer proves a rule the product does not have.
- **Integration runs touch a shared server.** The global setup makes a new database for each run and empties only
  Redis index 15 ([`global-setup.ts`](../../../apps/flash-be/src/bdd/support/global-setup.ts)). Keep test data off index
  0, where the dev data lives. Run one integration or coverage run of `flash-be` at a time. A second run would empty index
  15 under the first, so the global setup takes a Postgres advisory lock first, and a second run stops with "another
  flash-be integration run is active; run one at a time". The lock ends with the process, even a killed one.

## Read next

- Vitest: [guide](https://vitest.dev/guide/), [projects](https://vitest.dev/guide/projects),
  [coverage](https://vitest.dev/guide/coverage).
- Testing Library: [`cleanup`](https://testing-library.com/docs/react-testing-library/api#cleanup).
- Here: [test layers and coverage](../../reference/test-layers-and-coverage.md),
  [scenario or plain test](../../explanation/scenario-or-plain-test.md), and the
  [Gherkin scenarios crash course](gherkin-scenarios.md).
