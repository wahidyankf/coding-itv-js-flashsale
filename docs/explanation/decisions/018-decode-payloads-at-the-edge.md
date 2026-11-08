# 018: Every payload is decoded at the edge with a small kit

## Status

Accepted. A payload that crosses a process boundary is decoded before the app uses it: request bodies in `flash-be`,
every reply and every stream event in `flash-web`. The decoders are a small kit in `@flash/flash-commons`.

## Context

A request body and an API reply arrive as `unknown`. Checking fields one at a time spreads the checks over many
functions, and casting a reply to the type the caller names lets a missing field or a field of the wrong type go
straight into the page state. The page and the API ship together, but a proxy, a half-finished deploy or a bug can still
send a shape the other side does not expect.

## Decision

- `@flash/flash-commons` holds a decoder kit: a `Decoder<T>` takes `unknown` and returns a `Result` with the value or a
  `DecodeError` that names the path and what was expected. It has only what the apps use: text (`text`, `nonEmptyText`), integers
  (`integer`, `nonNegativeInteger`), ISO dates (kept as text), UUIDs, fixed values (`literal`, `oneOf`), `refine` for an
  extra rule on a decoded value, `optional`, `object`, `tagged` for a union told apart by one field (`state`), and `both`
  for a reply that joins two shapes. There is no `array`, because no payload has a list it reads. Extra keys are ignored, so a new field in a reply breaks nothing.
- Each app writes its own shapes next to the types they build. `flash-web` decodes every reply in `callApi` and every
  stream event; a reply that does not decode is the same "unexpected" failure as a reply that is not JSON, and the
  shopper reads the general "try again" sentence. A stream event that does not decode is dropped, and it does not count
  as a live frame, so a stream that sends only such events gives up like a dead one. `flash-be`
  decodes a body in the route, and a use case gets typed values only.
- The kit is pure, so it sits on the main entry, and the domain may use it.

## Alternatives considered

- **Zod or Valibot in each app.** Declarative and well known, with less code of our own. But it is a new dependency
  for about a dozen shapes, it throws or needs a wrapper to give a `Result`, and Zod is large in the browser bundle.
- **Hand-written guards in each app.** No shared code, but the same checks (text, integer, enum) would be written many
  times in two apps, which breaks the rule of three ([016](016-dry-rule-of-three.md)).
- **No validation of replies.** The two apps ship together, so this looks safe. But it leaves a corrupted reply
  free to break the page in ways no test shows.

## Consequences

- It costs about 150 lines of our own code to keep, and a decoder to update when a reply changes, next to the view type.
- It buys one place per shape where a wrong payload stops, a `Result` instead of a crash, and an error that says which
  field was wrong. In `flash-web` that error is reported once ([`decode-report.ts`](../../../apps/flash-web/src/decode-report.ts), `console.warn` by default) with the URL
  or stream event, the path and what was expected, never the value.
- The test oracles (the e2e apps, k6 and the smoke test) do not use the kit: they check the replies themselves.

## Revisit when

- The number of shapes grows past what reads well by hand, or a published API needs a schema file (OpenAPI): then a
  schema library that also writes the file is worth its weight.

## Related

- [failures as values](../failures-as-values.md), [005](005-failures-as-values.md), [016](016-dry-rule-of-three.md).
- Code: [`libs/flash-commons/`](../../../libs/flash-commons/), [`apps/flash-web/src/api.ts`](../../../apps/flash-web/src/api.ts).
