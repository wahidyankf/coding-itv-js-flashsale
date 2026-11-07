# 016: DRY by the rule of three

## Status

Accepted. Logic or a value used in three or more places becomes one named piece. Two copies are fine.

## Context

A copy that drifts is a bug that no test sees. But a shared piece used twice is often the wrong shape, and a shared
package that holds everything couples every app to every change. Time units and HTTP status tables had grown in four or
more places before this rule.

## Decision

- **Three places make one piece.** The same logic or value in 3 or more places gets one name. Two copies stay as they are.
- **Start inside the app,** in the layer or folder that owns it. Count again afterwards: if it is still used in 3 or more
  places across apps (places, not apps), it moves to `libs/`.
- **`libs/flash-commons`** (`@flash/flash-commons`) is the shared behaviour library. It is pure: no timers, randomness or
  I/O of its own. `libs/typekit` stays a kit of `Result` and the `attempt` wrappers. They are
  runtime code, but only the shape of a failure; typekit never gets a rule, a value or a helper of the apps.
- **Test oracles are the exception.** The e2e steps, the k6 script and the prod smoke script write the API's paths, header
  names, error codes and expected statuses themselves. Values that are not our contract (time units, the standard HTTP
  status numbers) are shared from `flash-commons`.
- **Two places stay copied.** The sale id rule, the password limits and the ticket header are used by `flash-be` and
  `flash-web` only. `apps/flash-web/src/same_as_be_tests.ts` fails if a copy drifts.

## Alternatives considered

- **A shared contract package for everything.** A test that imports the server's constants cannot fail when the server
  changes them. A renamed header or path would pass every test while real clients break. Oracles must be independent.
- **No rule, review only.** Copies drift, and a reviewer sees one change at a time.
- **One copy per app, always.** The time and status tables were already in four or more places.

## Consequences

- It costs a count that people must do by hand, a second step (app first, then `libs/`), and some copies that stay on
  purpose. A copy of a contract value in a test is not a smell here.
- It buys small shared code with a clear owner, tests that still fail when the contract changes, and a drift check
  for the two-place copies.

## Revisit when

- A third product app needs the contract values: a shared contract package then costs less than the copies.
- A drift bug gets past `same_as_be_tests.ts`.

## Related

- [`libs/flash-commons/README.md`](../../../libs/flash-commons/README.md), the [typekit reference](../../reference/typekit.md) and [004](004-hexagon-in-the-api-only.md).
- Code: [`libs/flash-commons/`](../../../libs/flash-commons/), [`same_as_be_tests.ts`](../../../apps/flash-web/src/same_as_be_tests.ts).
