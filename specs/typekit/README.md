# typekit Specifications

The behaviour of `@flash/typekit`, the typed `Result`, `Option`, `attempt`, `pipe` and exhaustive-match helpers in
[`libs/typekit`](../../libs/typekit/README.md). It is a TypeScript port of
[py-typekit](https://github.com/wahidyankf/py-typekit).

Every scenario is bound at the unit layer in `libs/typekit/src/bdd`. The library is pure and opens no resource, so each
scenario is exempt from the integration and end-to-end layers, with its unit binding as the alternative proof. Type-level
scenarios are proved by `@ts-expect-error` lines, which the strict `tsc` run fails on when the error disappears.

## Directory Map

- [result/](result/README.md) - transforming and chaining a `Result`, and its immutability.
- [option/](option/README.md) - transforming an `Option`, and nested absence.
- [attempt/](attempt/README.md) - turning a throwing call or a promise into a `Result`.
- [pipe/](pipe/README.md) - chaining functions left to right.
- [match/](match/README.md) - exhaustive matching on a `Result`, an `Option` and a union.
