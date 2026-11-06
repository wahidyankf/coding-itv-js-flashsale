# @flash/typekit

Typed `Result`, `attempt`, `pipe` and exhaustive-match helpers for TypeScript. A failure is a value the caller must
handle. It is a TypeScript port of [py-typekit](https://github.com/wahidyankf/py-typekit), with no runtime dependencies.

It is a workspace package used by `flash-be` and `flash-web`. Build it first with `npx nx build typekit`; the apps'
Nx targets do that for you.

## What it has

| Name                      | What it is                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `Result<T, E>`            | `Ok<T, E> \| Err<T, E>`, frozen and covariant, with `map`, `mapErr`, `flatMap`, `flatMapErr`, `tap`, `tapErr` and `match` |
| `attempt`, `attemptAsync` | turn a throwing call or a promise into a `Result` that names exactly the failures you expect                              |
| `satisfying`              | wraps a type predicate so it can be a guard for a thrown value that is not an error class                                 |
| `pipe`                    | chains one to nine functions left to right, each typed from the one before                                                |
| `assertNever`             | closes a `switch` over a union, so a forgotten case is a type error                                                       |
| `result`                  | namespace of the curried combinators that are the stages of `pipe`                                                        |

```ts
import { attempt, pipe, result } from "@flash/typekit";

const parse = (text: string) =>
	attempt(() => JSON.parse(text) as number, SyntaxError);

const doubled = pipe(
	parse("21"),
	result.map((n: number) => n * 2),
);

doubled.match({
	ok: (n) => console.log(n),
	err: (error) => console.error(error.message),
});
```

## The rules it is built for

- Product code has no `catch` clause and no `.catch(` call; `attempt` and `attemptAsync` are the only places that catch,
  and a Biome rule enforces it.
- Name the failure you expect. A thrown value that no guard accepts is thrown on, so a bug is not hidden.
- Close every `switch` over a union with `assertNever`, or use `match`. A missing case fails the type check.
- A value that may be missing is `T | undefined`. TypeScript's strict options make the check impossible to forget.

The behaviour is specified in [specs/typekit](../../specs/typekit/README.md). Every name is in the
[reference](../../docs/reference/typekit.md), the steps are in
[how to handle failures with Result](../../docs/how-to/handle-failures-with-result.md), and the reasons are in
[failures as values](../../docs/explanation/failures-as-values.md).

## Commands

```bash
npx nx build typekit           # tsc to dist/
npx nx test:quick typekit      # typecheck + lint + unit tests
npx nx test:coverage typekit   # unit tests with the 99% floor
```
