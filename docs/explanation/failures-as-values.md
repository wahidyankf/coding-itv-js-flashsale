# Failures as values

`flash-be` and `flash-web` return failures and absences instead of throwing or returning `undefined` by habit. The
library is [`@flash/typekit`](../reference/typekit.md), a port of
[py-typekit](https://github.com/wahidyankf/py-typekit).

## Why not exceptions

A thrown error is invisible in a function's type. A caller can forget it, and nothing says which errors can come out.
On the sale path that is costly: "sold out", "hold expired" and "payment declined" are normal answers, not accidents, and
each has its own status code. A `Result<Purchase, ConfirmError>` lists them in the type, so the route must map every one,
and a new error fails the build until it is mapped.

Exceptions still exist for what the code does not expect: a bug, or a store that is down. `attempt` catches only what a
call site names, and anything else goes on. That is why there is no catch-all by default.

## Why Option has no methods

TypeScript already tracks `undefined`. `Option<T>` is `Some<T> | undefined`, so a caller must check before it reads, and
strict mode enforces it. `Some` exists only so `Some(undefined)` can mean "present, and the value is empty". The cost is
one small object per present value, paid for a lookup that crosses a port, not for a value inside a function.

## Why exhaustive match

TypeScript has no `match` statement. A `switch` over a union that ends without a case is silent unless the build checks it.
`assertNever`, the `match` methods and Biome's `useExhaustiveSwitchCases` turn a forgotten case into an error at build
time, which is when a new error code or a new sale status is added.

## How the rules are kept

- **No `catch` in product code.** A Biome plugin, `.biome/no-catch.grit`, errors on a `catch` clause and on a `.catch(` call
  in `apps/*/src` and `libs/*/src`. `try` with `finally` is allowed, because it cleans up and handles nothing. Tests,
  `src/bdd` and the library's own `boundary.ts` are exempt.
- **Exhaustive switches.** `useExhaustiveSwitchCases` is an error.
- **Inner layers may use it.** The domain and application layers import `@flash/typekit`, because it has no dependency and
  no I/O. `architecture_tests.ts` allows that one package and no other.
- **The rules have tests.** `npm run lint:rules:test` runs the real linter on sample code. It runs in the pre-push hook.

## What it costs

A `Result` is an object, so a hot path allocates a little more. The load test shows no change in its limits. `await` and
`Result` do not chain by themselves: pure steps use `pipe`, and steps that await check the result and return early. The
library is small, and its types are the part that matters.
