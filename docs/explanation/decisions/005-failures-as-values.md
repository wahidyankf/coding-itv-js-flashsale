# 005: Failures as values

## Status

Accepted. A function that can fail returns a `Result`. Product code has no `catch`.

## Context

On the sale path, "sold out", "hold expired" and "payment declined" are normal answers, each with its own status code. A
thrown error is invisible in a function's type, so a caller can forget it, and nothing says which errors can come out.

## Decision

- `@flash/typekit` (`libs/typekit`) has `Ok`, `Err`, `Result` and `attempt`. A call that may throw goes through `attempt`
  or `attemptAsync`, which name the failure they expect. Anything else keeps going up and becomes a `500 internal`.
- A lookup that may find nothing returns `T | undefined`. There is no `Option` type.
- A Biome plugin (`.biome/no-catch.grit`) rejects `catch` and `.catch(` in product code. `useExhaustiveSwitchCases` makes a
  new error code fail the build until a route maps it. `npm run lint:rules:test` tests these rules.

## Alternatives considered

- **Exceptions with one error handler.** The types do not list the errors, and a new error code can be missed without a build failure.
- **A Result library from npm (neverthrow, fp-ts, Effect).** They would work. The code needs only `Ok`, `Err`, `map`, `match`
  and `attempt`, so it carries a small port of the author's own library with no dependency, which the domain layer may import.
- **A convention in the style guide, without a lint rule.** Conventions drift, so the rule is a check that fails the push.
- **An `Option` type for absence.** It would be a second way to say what `T | undefined` already says under strict TypeScript.

## Consequences

- It costs a few more allocations on the hot path (the load limits did not change), and steps that check each result and
  return early, because `await` and `Result` do not chain by themselves. `try ... finally` is still allowed, because it only cleans up.
- It buys error cases that are in the type, so a route must map every one. The library is small, and its types are the part that matters.

## Revisit when

- Code keeps writing the same early-return steps: add an async Result type to the library.
- Biome adds a built-in rule for `catch`: replace the plugin.

## Related

- [Failures as values](../failures-as-values.md) and the [typekit reference](../../reference/typekit.md).
- Code: [`libs/typekit/src/`](../../../libs/typekit/src/), [`no-catch.grit`](../../../.biome/no-catch.grit), [`errors.ts`](../../../apps/flash-be/src/adapters/inbound/http/errors.ts).
