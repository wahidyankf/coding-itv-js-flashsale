# Lint Rules Specifications

The two rules Biome enforces on product code (`apps/*/src` and `libs/*/src`, not tests or `src/bdd`): no `catch` clause
and no `.catch(` call, and every `switch` over a union lists every case. The first is the plugin
[`.biome/no-catch.grit`](../../../.biome/no-catch.grit); the second is Biome's `useExhaustiveSwitchCases`. The only
place that catches is `libs/typekit/src/boundary.ts`.

## Directory Map

- [behaviours/](behaviours/README.md) - the scenarios, bound at the unit layer in `scripts/lint`.
