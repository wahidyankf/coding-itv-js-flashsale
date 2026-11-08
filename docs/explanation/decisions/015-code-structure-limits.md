# 015: Code-structure limits from Biome's built-in rules only

## Status

Accepted. Size and nesting limits are set in [`biome.json`](../../../biome.json) with built-in rules. File headers and doc comments are kept by a rule in AGENTS.md and by review.

Amended 2026-11-07: migrations are exempt from the function line limit only; the routes file has been split.

## Context

The code is read by people who did not write it. The checks already stop wrong types, wrong imports and swallowed
errors. Nothing stopped a function or a file from growing. The file of HTTP routes reached about 690 lines before it was
split into a folder.

## Decision

- These Biome rules are errors in product code (Biome 2.6.4):
  - `noExcessiveCognitiveComplexity`: 15.
  - `noExcessiveLinesPerFunction`: 80 lines, blank lines not counted.
  - `useMaxParams`: 5 parameters.
  - `noExcessiveNestedCallbacks`: 4 levels.
  - `noNestedTernary`.
  - `noExcessiveLinesPerFile`: 400 lines.
- Test files are exempt from both line limits, because a scenario binding is one long callback by nature. Migrations are exempt from the function line limit only, because a migration reads best as one script.
- Every file starts with a header comment, and every export has a doc comment. Biome has no built-in rule that requires a doc comment: its only JSDoc rule, `useSingleJsDocAsterisk`, checks the style of a comment that exists. So AGENTS.md states the rule and `swe-reviewer` checks it.
- A limit is never raised to pass a check. A function over a limit is split.

## Alternatives considered

- **ESLint with a JSDoc plugin.** It could require doc comments. But AGENTS.md allows Biome only, and a second linter means a second config, a second run and two places for a rule.
- **A custom Biome (GritQL) plugin for doc comments.** Ruled out, to keep the limits to built-in rules. The one plugin in the repo, [`no-catch.grit`](../../../.biome/no-catch.grit), guards a correctness rule.
- **No limits, review only.** Review sees one change at a time, and a file grows by many small changes.
- **Lower numbers (for example 40 lines a function).** They would split code to meet a number, not to read better. The limits are meant to catch outliers.

## Consequences

- It costs splits of code that was over a limit, a few more files, and the work of finding good names for the parts.
- It buys limits that fail the push (`npm run lint`), so a reviewer does not have to count lines.
- The doc comment rule is the weak part. No command checks it, so it depends on review.

## Revisit when

- Biome adds a rule that requires doc comments: turn it on, and drop the AGENTS.md rule.
- Splits made to meet a limit make the code harder to follow, or the same few places ask for an exemption.

## Related

- [Hexagonal architecture](../hexagonal-architecture.md), which keeps the splits in the right layer, and [failures as values](../failures-as-values.md), which is the other rule set kept by Biome.
- Code: [`biome.json`](../../../biome.json) and [AGENTS.md](../../../AGENTS.md).
