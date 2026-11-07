# TypeScript crash course

TypeScript is JavaScript with types that are checked before the code runs. Every app and library here is written in it,
with the strictest flags turned on, and the repository installs TypeScript 7 (`typescript@7.0.2`), whose `tsc` is a
native binary.

## Why this repo uses it

**The problem.** In plain JavaScript, a forgotten case or a field that may be missing shows up only when a shopper hits
it, often in the middle of a sale. Here the types carry those cases: a function that can fail returns a `Result`, a lookup that may find nothing
returns `T | undefined`, and a `switch` that forgets a case does not build ([005](../../explanation/decisions/005-failures-as-values.md)).

**What we did not pick.**

- Exceptions with one error handler: the types would not list the errors ([005](../../explanation/decisions/005-failures-as-values.md)).
- A `Result` library from npm (neverthrow, fp-ts, Effect), or an `Option` type: a small library of our own in
  `libs/typekit` is enough ([005](../../explanation/decisions/005-failures-as-values.md)).
- Zod or Valibot to check payloads: a small decoder kit is enough for about a dozen shapes
  ([018](../../explanation/decisions/018-decode-payloads-at-the-edge.md)).

**What it costs.** A `typecheck` step in every app, and a build step for the two libraries, whose `dist` the apps
import. The strict flags also make some code longer, as the examples below show.

## The ideas this repo uses

### The same strict flags everywhere

Each of the seven `tsconfig.json` files (five apps, two libraries) turns on `strict`, `noImplicitAny`,
`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`,
`noUnusedParameters` and `verbatimModuleSyntax`, plus `noFallthroughCasesInSwitch` and `allowUnreachableCode: false`.
See [`libs/flash-commons/tsconfig.json`](../../../libs/flash-commons/tsconfig.json). They set `"noEmit": true`; the
`build` target uses a `tsconfig.build.json` that extends it and writes `dist`.

### `noUncheckedIndexedAccess`: an index may be empty

With this flag, `array[0]` has the type `T | undefined`. In [`sale.ts`](../../../apps/flash-be/src/domain/sale.ts),
`pickCurrent` takes the first sale of a sorted list, so its return type must admit "no sale":

```ts
export function pickCurrent(
	sales: readonly Sale[],
	now: Date,
): Sale | undefined {
	const notOver = sales.filter((sale) => now < sale.endsAt);
	return (
		notOver.find((sale) => sale.startsAt <= now) ??
		[...notOver].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime())[0]
	);
}
```

### `exactOptionalPropertyTypes`: absent is not `undefined`

With this flag, `ip?: string` means "the key may be missing", not "the key may hold `undefined`". A value read from a
request header can be `undefined`, so the port says so in
[`session-repository.ts`](../../../apps/flash-be/src/application/ports/session-repository.ts):

```ts
export type ClientInfo = {
	ip?: string | undefined;
	userAgent?: string | undefined;
};
```

The decoder kit follows the same rule: its `object` decoder leaves an optional key out of the result when the value is
`undefined`, instead of writing `key: undefined`.

### `verbatimModuleSyntax` and `import type`

TypeScript removes only imports marked as types, and keeps every other import as written. So a type must be imported with
`import type` or `type` inline, and Biome's `useImportType` rule enforces it. From
[`purchases.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/purchases.ts):

```ts
import type { FastifyInstance, FastifyReply } from "fastify";
import { createGuards, type SaleParams, shopperOf } from "./guards.js";
```

### No `any`: take `unknown` and narrow it

A payload from outside has an unknown shape. A [`Decoder<T>`](../../../libs/flash-commons/src/decode.ts) takes
`unknown` and returns a `Result`, so a bad value is a value the caller must handle:

```ts
export type Decoder<T> = (value: unknown) => Result<T, DecodeError>;

export const text: Decoder<string> = (value) =>
	typeof value === "string" ? new Ok(value) : fail("text");
```

Routes build their body decoders from it, for example `object({ reservationId: text })` in
[`bodies.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/bodies.ts).

### Unions with a tag, and a `switch` that names every case

An outcome is a union told apart by one field. From [`purchase.ts`](../../../apps/flash-be/src/domain/purchase.ts):

```ts
export type Outcome =
	| { state: "purchased"; purchase: Purchase }
	| { state: "holding"; reservationId: string; expiresAt: Date }
	| { state: "none" };
```

Inside `case "holding":` TypeScript knows that `outcome.expiresAt` exists. The `switch` in `outcomeReply`
([`purchases.ts`](../../../apps/flash-be/src/adapters/inbound/http/routes/purchases.ts)) names all three states and has
no `default`, so a new state fails Biome's `useExhaustiveSwitchCases` until its reply is written.

### Running `.ts` files without a build

- `flash-be` runs its source with tsx: `node ... --import tsx --watch src/main.ts` (the `dev` script in
  [`apps/flash-be/package.json`](../../../apps/flash-be/package.json)). Its imports end in `.js`, as `NodeNext` wants.
- `flash-load` runs its scripts with Node alone: `node scripts/run.ts smoke`. Node strips the types itself, so its
  [`tsconfig.json`](../../../apps/flash-load/tsconfig.json) adds `allowImportingTsExtensions` and its imports end in `.ts`.

## Try it here

Typecheck one library. Nx builds `typekit` first, because `flash-commons` imports its `dist`:

```bash
npx nx typecheck flash-commons --output-style=static
```

Trimmed output:

```text
> nx run typekit:build
> tsc -p tsconfig.build.json

> nx run flash-commons:typecheck
> tsc --noEmit -p tsconfig.json

 NX   Successfully ran target typecheck for project flash-commons and 1 task it depends on
```

## Traps to avoid

- **A cast hides a wrong shape.** `JSON.parse(text) as Sale` compiles, but a reply with a missing field would still go
  into the page state. So `flash-web` decodes every reply instead of casting it
  ([018](../../explanation/decisions/018-decode-payloads-at-the-edge.md)).
- **A stale library build.** The apps import `libs/typekit/dist` and `libs/flash-commons/dist`, not their source. Run the
  apps' checks through Nx, which builds both libraries first; a bare `tsc` in an app may read an old `dist`.
- **`as` is not a fix.** The two casts in `decode.ts` each have a comment that says why TypeScript cannot follow the
  type there. A cast without that reason usually hides a bug.

## Read next

- Official: [TSConfig reference](https://www.typescriptlang.org/tsconfig/),
  [narrowing](https://www.typescriptlang.org/docs/handbook/2/narrowing.html),
  [Node.js and TypeScript](https://nodejs.org/api/typescript.html) and [tsx](https://github.com/privatenumber/tsx).
- Ours: [failures as values](../../explanation/failures-as-values.md), [handle failures with Result](../../how-to/handle-failures-with-result.md),
  [`libs/typekit/README.md`](../../../libs/typekit/README.md) and [`libs/flash-commons/README.md`](../../../libs/flash-commons/README.md).
