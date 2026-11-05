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

Use `pipe` with the curried combinators when the steps are pure. A missing sale, a bad name and a closed sale each stop
the chain, and the first failure is what comes out:

```ts
const open = pipe(
	found,
	option.okOr<SaleDetails, ReserveError>("sale_not_found"),
	result.flatMap((details: SaleDetails) =>
		pipe(
			normalizeUser(rawUser),
			option.okOr<string, ReserveError>("invalid_user"),
			result.map(() => details),
		),
	),
);
```

For steps that await, check the Result and return early, as in step 3.

## 5. Absent values

Return `Option<T>` from a lookup that may find nothing: `new Some(value)` or `undefined`. Convert a native optional at the
edge with `fromOptional(row)`. Keep parameters, optional object fields and JSON bodies native.

## 6. Close every switch

End a `switch` over a union with every case, or with `assertNever(value)` in the `default`. Biome's
`useExhaustiveSwitchCases` fails the lint when a case is missing.

## 7. Check it

```bash
npx nx run-many -t lint -p flash-be flash-web typekit
npm run lint:rules:test
```

The lint fails on a `catch` clause or a `.catch(` call in `apps/*/src` and `libs/*/src`. Tests and `src/bdd` are exempt.
