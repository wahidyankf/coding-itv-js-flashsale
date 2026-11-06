# Handle failures with Result

Use `@flash/typekit` so a failure is a value and product code has no `catch`. The names are listed in
[the typekit reference](../reference/typekit.md).

## 1. Wrap a call that may throw

Name the failure you expect. Use `attemptAsync` for a promise:

```ts
import { attemptAsync } from "@flash/typekit";

const asked = await attemptAsync(() => fetcher(url), Error);
if (asked.isErr()) return fallback;
const reply = asked.value;
```

A thrown value that no guard accepts is thrown on. For a thrown value that is not an error class, wrap a predicate with
`satisfying`.

A swallowed failure, like a Redis call that may fail, is the same call with the result left unread:

```ts
await attemptAsync(() => gate.confirm(saleId, user), Error);
```

## 2. Return a Result from a function

Return `new Ok(value)` or `new Err(error)`, and type the function as `Result<Value, ErrorCode>`. Keep the error a union of
string literals so a caller can match it:

```ts
type ReserveError = "sale_not_found" | "invalid_user" | "sold_out";
type ReserveResult = Result<Reserved, ReserveError>;
```

## 3. Read a Result

Return early on the failure, then use the value:

```ts
const reserved = await service.reserve(saleId, userId, ticket);
if (reserved.isErr()) return reply.code(STATUS[reserved.error]).send({ error: reserved.error });
const { reservationId } = reserved.value;
```

Make the table of statuses a `satisfies Record<ReserveError, number>`. A new error without a status then fails the
build. Use `.match({ ok, err })` when both sides produce a value of the same type.

## 4. Chain steps

Use `pipe` with the curried combinators to transform a Result that already exists, such as `result.map(f)`. To check
several things in a row, return early on each failure. The first failure is what comes out, and the code reads from top
to bottom:

```ts
const found = await sales.details(saleId);
if (found === undefined) return new Err("sale_not_found");
const user = normalizeUser(rawUser);
if (user === undefined) return new Err("invalid_user");
```

## 5. Absent values

Return `undefined` from a lookup that may find nothing, and type the return as `T | undefined`. Check it with `=== undefined`
before you read the value. Keep parameters, optional object fields and JSON bodies native.

## 6. Close every switch

End a `switch` over a union with every case, or with `assertNever(value)` in the `default`. Biome's
`useExhaustiveSwitchCases` fails the lint when a case is missing.

## 7. Check it

```bash
npx nx run-many -t lint -p flash-be flash-web typekit
npm run lint:rules:test
```

The lint fails on a `catch` clause or a `.catch(` call in `apps/*/src` and `libs/*/src`. Tests and `src/bdd` are exempt.
