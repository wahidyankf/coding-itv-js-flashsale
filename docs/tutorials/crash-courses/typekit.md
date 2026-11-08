# typekit crash course

`@flash/typekit` ([`libs/typekit`](../../../libs/typekit/)) is this repository's own small library for failures as
values: a `Result` type with `Ok` and `Err`, and `attempt` and `attemptAsync`, which turn a call that may throw into a
`Result`. `flash-be`, `flash-web`, `flash-be-e2e`, `flash-load` and `flash-commons` use it, and product code has no
`catch` of its own. This page is a guided first walk through it;
the [typekit README](../../../libs/typekit/README.md) is the full API.

## Why this repo uses it

**The problem.** On the sale path, "sold out", "hold expired" and "payment declined" are normal answers, each with its own
status code. A thrown error does not show in a function's type, so a caller can forget one, and a new error code can
ship without a status. With `Result`, the failures are in the signature, and the build fails until a route maps each one.

**What we did not pick.** [Decision 005](../../explanation/decisions/005-failures-as-values.md) weighs exceptions with one
error handler, a Result library from npm (neverthrow, fp-ts, Effect), a style-guide rule with no lint check, and an
`Option` type for absence.

**What it costs.** Each `Result` is a small object, and `await` and `Result` do not chain, so code checks each step and
returns early ([decision 005](../../explanation/decisions/005-failures-as-values.md#consequences)).
[Failures as values](../../explanation/failures-as-values.md) gives the full reasons.

## The ideas this repo uses

### A Result is Ok or Err

[`result.ts`](../../../libs/typekit/src/result.ts) has two frozen classes and the union `Result<T, E>`. A function says
what can fail in its type. The reservation service names every refusal as a string literal
([`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts)):

```ts
export type ReserveError =
	| "sale_not_found"
	| "invalid_ticket"
	| "not_admitted"
	// ...
	| "unavailable";

export type ReserveResult = Result<Reserved, ReserveError>;
```

It answers with `new Ok(value)` or `new Err("sold_out")`.

### Narrow with isOk and isErr

`value` and `error` are reachable only after a check narrows the union. The route replies go through one helper in
[`routes/reply.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/reply.ts). Its error type must extend
`ErrorCode`, so a service error that has no status in [`errors.ts`](../../../apps/flash-be/src/adapters/inbound/http/errors.ts) does not compile:

```ts
return result.isErr() ? sendError(reply, result.error) : onOk(result.value);
```

### match when both sides make a value

`match` is a method on the `Result`, not a separate function. `loadSale` in
[`sale/load.ts`](../../../apps/flash-web/src/sale/load.ts) turns the API answer into what the first render shows:

```ts
return found.match({
	ok: (sale): SaleLoad => ({ state: "ok", sale }),
	err: (failure): SaleLoad =>
		failure.errorCode === "sale_not_found"
			? { state: "none" }
			: { state: "error" },
});
```

### attempt names the failure it expects

[`boundary.ts`](../../../libs/typekit/src/boundary.ts) is the one place that catches. You pass the error classes you
expect; only an instance of one of them becomes `Err`, and anything else is thrown on, so a bug is not hidden. The proxy
in [`proxy.ts`](../../../apps/flash-web/src/proxy.ts) reads a sale id that may be badly encoded:

```ts
attempt(() => decodeURIComponent(value), URIError).match({
	ok: (decoded) => decoded,
	err: () => "",
});
```

Naming no class at all is a type error, and a `TypeError` at run time.

### attemptAsync for a promise

The same rule for a call that returns a promise. The proxy turns any failed call to the API into its own reply
([`proxy.ts`](../../../apps/flash-web/src/proxy.ts)):

```ts
const answered = await attemptAsync(async (): Promise<Response> => { /* fetch and copy headers */ }, Error);
if (answered.isOk()) return answered.value;
// A browser that left aborts the call; only a real failure is logged.
if (!request.signal.aborted) {
	logUnreachable(requestId, request, answered.error);
}
return refuse("backend_unavailable", requestId);
```

`/ready` in [`routes/health.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/health.ts) wraps each store check
the same way, and writes `ok` or `error` for each one.

### No catch in product code

A Biome plugin fails the lint on any other `catch` clause or `.catch(` call in product code. `try` with `finally` and no
`catch` is allowed, because it only cleans up. How the plugin works is in the
[Biome crash course](biome.md#a-gritql-plugin-no-catch-in-product-code).

## Try it here

Run the library's tests:

```bash
npx nx test:unit typekit --output-style=static
```

```text
 Test Files  4 passed (4)
      Tests  26 passed (26)
Statements   : 100% ( 33/33 )
```

The README example runs as a test too: from `libs/typekit`,
`npx vitest run --config vitest.config.ts src/example_tests.ts` passes 2 tests.

## Traps to avoid

- **Text that is not JSON.** `JSON.parse` throws a `SyntaxError`, so `readBody` in
  [`api.ts`](../../../apps/flash-web/src/api.ts) wraps it in `attempt(..., SyntaxError)`. A 2xx reply whose body does not
  decode becomes the same `unexpected` failure, so the page never shows a value of the wrong shape
  ([decision 018](../../explanation/decisions/018-decode-payloads-at-the-edge.md)).
- **A bad escape in the address.** `decodeURIComponent` throws a `URIError` on a broken `%` escape. The proxy turns it into
  `""`, which no pattern accepts, so the answer is `404 not_found`, not a crash.
- **A failure you mean to ignore.** Leave the result unread. A stream that drops mid-read in
  [`sale/sse.ts`](../../../apps/flash-web/src/sale/sse.ts) is wrapped in `attemptAsync(..., Error)`. The error is not read:
  what decides the retry is whether any frame arrived.
- **A change in `src` that the apps do not see.** The package resolves to `dist`. The apps' Nx targets build it first;
  a direct `vitest` run in an app needs `npx nx build typekit` after you change the library.

## Read next

- [typekit README](../../../libs/typekit/README.md): the full API.
- [How to handle failures with Result](../../how-to/handle-failures-with-result.md): the steps for new code.
- [Failures as values](../../explanation/failures-as-values.md) and
  [decision 005](../../explanation/decisions/005-failures-as-values.md): the reasons.
- [TypeScript handbook: narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html), for how `isOk` and
  `isErr` narrow the union.
- [React and TanStack Start crash course](react-and-tanstack-start.md), where `callApi` returns a `Result` to the page.
