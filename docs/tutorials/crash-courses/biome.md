# Biome crash course

Biome is one tool that formats and lints JavaScript, TypeScript, JSON and Markdown. It is the only formatter and linter
in this repository, set up in one file, [`biome.json`](../../../biome.json). The repository installs
`@biomejs/biome@2.6.4`.

## Why this repo uses it

**The problem.** Several rules of the codebase must not depend on a reviewer's eye: no `any`, no magic numbers, no
`catch` in product code, a `switch` that names every case, and limits on the size of functions and files. Biome turns
each one into an error that fails `npm run lint`, and the pre-push hook runs that first.

**What we did not pick.**

- Prettier and ESLint: AGENTS.md allows Biome only. A second linter means a second config, a second run and two places
  for a rule ([015](../../explanation/decisions/015-code-structure-limits.md)).
- A rule kept only in a style guide: conventions drift, so each rule is a check that fails the push
  ([005](../../explanation/decisions/005-failures-as-values.md)).
- Review alone for size: review sees one change at a time, and a file grows by many small changes
  ([015](../../explanation/decisions/015-code-structure-limits.md)).

**What it costs.** Code that goes over a limit must be split, and a few rules use Biome's `nursery` group, which is newer
and may change with an upgrade. Doc comments have no Biome rule, so `swe-reviewer` checks them by hand.

## The ideas this repo uses

### One config: format and lint

```json
"formatter": { "enabled": true, "indentStyle": "tab" },
"javascript": { "formatter": { "quoteStyle": "double" } },
"linter": { "enabled": true, "rules": { "preset": "recommended", ... } }
```

`biome check` runs both, plus the `organizeImports` assist. `npm run lint` is `biome check --error-on-warnings .`, so a
warning fails too. The `lint` targets of the apps and libraries run `biome lint` only, without the formatter.

### The rules this repo turns into errors

From the `linter.rules` block of [`biome.json`](../../../biome.json):

- `style.noMagicNumbers`: a number must have a name, such as `const REBUILD_LOCK_MS = 10_000;` in
  [`reservation-service.ts`](../../../apps/flash-be/src/application/reservation-service.ts), with a comment that says why.
- `suspicious.noExplicitAny`, together with `noImplicitAny` in every `tsconfig.json`.
- `style.useImportType` and `style.noNonNullAssertion`.
- `nursery.noFloatingPromises`, `nursery.noMisusedPromises` and `nursery.useExhaustiveSwitchCases`.

### Size limits, and who is exempt

```json
"noExcessiveCognitiveComplexity": { "level": "error", "options": { "maxAllowedComplexity": 15 } },
"noExcessiveLinesPerFunction": { "level": "error", "options": { "maxLines": 80, "skipBlankLines": true, "skipIifes": true } },
"useMaxParams": { "level": "error", "options": { "max": 5 } },
"noExcessiveNestedCallbacks": { "level": "error", "options": { "max": 4 } }
```

`noNestedTernary` and `noExcessiveLinesPerFile` (400 lines) complete the set. The `overrides` turn the two line limits
off for test files and the function limit off for migrations. They also turn `noMagicNumbers` off for tests, `src/bdd`
and the e2e apps, where a literal is the expected value. The reasons are in
[015](../../explanation/decisions/015-code-structure-limits.md).

### A GritQL plugin: no `catch` in product code

Biome has no built-in rule for `catch`, so [`.biome/no-catch.grit`](../../../.biome/no-catch.grit) matches each form of
`try ... catch` and each `.catch(` call, and reports it. One of its patterns:

```text
`try { $_ } catch { $_ }` as $c where {
	register_diagnostic(span=$c, message="Do not catch here. Return a Result with attempt or attemptAsync from @flash/typekit.", severity="error")
},
```

The last override applies it to `apps/*/src/**` and `libs/*/src/**`, minus tests, `src/bdd` and
[`libs/typekit/src/boundary.ts`](../../../libs/typekit/src/boundary.ts), the one file that catches so that no other file has to.
[`scripts/lint/lint-rules_tests.mjs`](../../../scripts/lint/lint-rules_tests.mjs) lints small samples with the real
config and checks that the plugin and the exhaustive switch rule still fire.

### Markdown is formatted too

`biome check .` checks the format of the Markdown files as well, and `biome format --write` fixes it.
`files.includes` skips [`.claude/`](../../../.claude), because the Markdown formatter would break the YAML frontmatter of the agent files.

## Try it here

Check one library, format and lint together:

```bash
npx biome check libs/typekit
```

```text
Checked 13 files in 299ms. No fixes applied.
```

Run the tests of the lint rules themselves:

```bash
npm run lint:rules:test
```

```text
 Test Files  1 passed (1)
      Tests  5 passed (5)
```

## Traps to avoid

- **A git-ignored file is skipped.** `vcs.useIgnoreFile` is on, so `npx biome lint local-tmp/x.ts` reports
  "No files were processed". Try a rule on a file in a tracked folder instead.
- **Never `biome-ignore`.** AGENTS.md forbids silencing `noExplicitAny`, `noMagicNumbers` or the no-catch rule, and
  forbids raising a limit to pass. Name the number, narrow the `unknown`, use `attempt`, or split the function.

## Read next

- Official: [configuration](https://biomejs.dev/reference/configuration/), [formatter](https://biomejs.dev/formatter/),
  [`noMagicNumbers`](https://biomejs.dev/linter/rules/no-magic-numbers/), [plugins](https://biomejs.dev/linter/plugins/)
  and [GritQL](https://biomejs.dev/reference/gritql/).
- Ours: [decision 015](../../explanation/decisions/015-code-structure-limits.md),
  [failures as values](../../explanation/failures-as-values.md) and the [Git hooks crash course](git-hooks.md).
