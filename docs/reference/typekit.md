# typekit

`@flash/typekit` in `libs/typekit` is a TypeScript port of [py-typekit](https://github.com/wahidyankf/py-typekit). It has
no runtime dependencies and is used by `flash-be` and `flash-web`. The behaviour is specified in
[specs/typekit](../../specs/typekit/README.md). Why it exists is in
[failures as values](../explanation/failures-as-values.md).

```ts
import {
	assertNever,
	attempt,
	attemptAsync,
	Err,
	Ok,
	satisfying,
	type Result,
} from "@flash/typekit";
```

## Result

`type Result<T, E> = Ok<T, E> | Err<T, E>`. Both classes are frozen: a field cannot be written, and a write is a type
error. Both carry both type parameters, so every method has the same signature on `Ok` and on `Err`.

| Member                 | On `Ok`                      | On `Err`                     |
| ---------------------- | ---------------------------- | ---------------------------- |
| `new Ok(value)`        | holds `value`                | -                            |
| `new Err(error)`       | -                            | holds `error`                |
| `.value` / `.error`    | the value                    | the fault                    |
| `.isOk()` / `.isErr()` | `true` / `false`             | `false` / `true`             |
| `.map(f)`              | `Ok(f(value))`               | itself                       |
| `.mapErr(f)`           | itself                       | `Err(f(error))`              |
| `.flatMap(step)`       | `step(value)`                | itself                       |
| `.flatMapErr(step)`    | itself                       | `step(error)`                |
| `.tap(f)`              | calls `f(value)`, returns it | returns itself               |
| `.tapErr(f)`           | returns itself               | calls `f(error)`, returns it |
| `.match({ ok, err })`  | `ok(value)`                  | `err(error)`                 |

`._tag` is `"ok"` or `"err"`, so a `switch` on it narrows.

## Absence

A value that may be missing is `T | undefined`. There is no wrapper type: a lookup that finds nothing returns
`undefined`, and strict TypeScript makes the caller check before it reads the value.

## attempt and attemptAsync

```ts
attempt(call, guard, ...moreGuards): Result<T, Caught>
attemptAsync(call, guard, ...moreGuards): Promise<Result<T, Caught>>
```

They are the only places in product code that catch. `call` takes no arguments; bind them with an arrow function.

- A guard is an error class (matched with `instanceof`, a subclass included) or `satisfying(predicate)` for a thrown
  value that is not an instance of a class, such as a string.
- A thrown value that a guard accepts becomes `Err(thrown)`. The fault is the thrown value itself.
- Any other thrown value is thrown on unchanged, so a bug is not hidden.
- There is no default guard. Naming none is a type error, and a `TypeError` at run time.
- The fault type is the union of what the guards accept.
- `attemptAsync` also catches a call that throws before it returns a promise.

## assertNever

`assertNever(value: never): never` throws `Unexpected value: ...`. Put it in the `default` of a `switch`, or at the end
of an `if` chain: when a case is missing, the value is not `never` and the call is a type error.

## Commands

```bash
npx nx build typekit           # tsc to libs/typekit/dist
npx nx test:quick typekit      # typecheck, lint and unit tests
npx nx test:coverage typekit   # unit tests with the 99% floor
```
