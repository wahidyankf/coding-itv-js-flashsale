# @flash/typekit

Typed `Result` and `attempt` helpers for TypeScript: a failure is a value the caller must handle. The failures a function
can return are in its type, so the compiler finds a case nobody handled, and a bug that throws is never caught by
mistake. It has no runtime dependencies, and it holds nothing else.
Shared behaviour such as retry lives in [flash-commons](../flash-commons/README.md).

It is a workspace package used by `flash-be`, `flash-web`, `flash-be-e2e`, `flash-load` and `flash-commons`. Build it
with `npx nx build typekit`; the apps' Nx targets do that for you.

```ts
import { attempt } from "@flash/typekit";

const parse = (text: string) =>
	attempt(() => JSON.parse(text) as number, SyntaxError);

parse("21").match({
	ok: (n) => console.log(n * 2),
	err: (error) => console.error(error.message),
});
```

## Result

`type Result<T, E> = Ok<T, E> | Err<T, E>`. Both classes are frozen: a field cannot be written, and a write is a type
error. Both carry both type parameters, so every method has the same signature on `Ok` and on `Err`.

| Member                 | On `Ok`          | On `Err`         |
| ---------------------- | ---------------- | ---------------- |
| `new Ok(value)`        | holds `value`    | -                |
| `new Err(error)`       | -                | holds `error`    |
| `.value` / `.error`    | the value        | the fault        |
| `.isOk()` / `.isErr()` | `true` / `false` | `false` / `true` |
| `.map(f)`              | `Ok(f(value))`   | itself           |
| `.mapErr(f)`           | itself           | `Err(f(error))`  |
| `.match({ ok, err })`  | `ok(value)`      | `err(error)`     |

A value that may be missing is `T | undefined`, not a wrapper type: strict TypeScript makes the caller check it.

## attempt and attemptAsync

```ts
attempt(call, guard, ...moreGuards): Result<T, Caught>
attemptAsync(call, guard, ...moreGuards): Promise<Result<T, Caught>>
```

They are the only places in product code that catch; a Biome rule refuses any other `catch` or `.catch(`. `call` takes
no arguments; bind them with an arrow function.

- A guard is an error class, matched with `instanceof`, a subclass included.
- A thrown value that a guard accepts becomes `Err(thrown)`. The fault is the thrown value itself.
- Any other thrown value is thrown on unchanged, so a bug is not hidden.
- There is no default guard. Naming none is a type error, and a `TypeError` at run time.
- The fault type is the union of what the guards accept.
- `attemptAsync` also catches a call that throws before it returns a promise.

The steps are in [how to handle failures with Result](../../docs/how-to/handle-failures-with-result.md), and the reasons
are in [failures as values](../../docs/explanation/failures-as-values.md). Its tests are plain Vitest tests next to the
source (`src/*_tests.ts`), with no Gherkin.

## Commands

```bash
npx nx build typekit           # tsc to dist/, then remove what this run did not write
npx nx test:quick typekit      # typecheck + lint + unit tests
npx nx test:coverage typekit   # unit tests with the 99% floor
```
