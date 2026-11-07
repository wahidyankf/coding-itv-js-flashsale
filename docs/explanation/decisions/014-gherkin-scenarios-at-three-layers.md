# 014: Gherkin scenarios bound at three layers, with a coverage check

## Status

Accepted. Behaviour is written once as a scenario, then bound at unit, integration and end-to-end level.

## Context

The brief asks for unit tests, integration tests and stress tests. A contract such as "a shopper who already bought cannot
buy again" is worth proving where a fake can lie (unit), against real stores (integration) and in a real browser or over
HTTP (end-to-end). The three proofs must not drift apart.

## Decision

- Scenarios are `.feature` files in `specs/apps/flash/be` and `web`. They are the canonical statement of behaviour.
- Unit and integration bindings use `@amiceli/vitest-cucumber` in `src/bdd/`, with memory ports at unit level and real Postgres
  and Redis at integration level. End-to-end bindings use `playwright-bdd` in the `*-e2e` apps.
- `npm run bdd:check` parses the features with `@cucumber/gherkin`, reads the binding source, and fails when a scenario is not
  bound where it must be. A layer is skipped only with `@integration-exempt` or `@e2e-exempt` and a comment that names an alternative proof.
- Unit and integration tests together must reach 99 percent coverage (`test:coverage`).
- A detail only a developer sees is a plain Vitest test, not a scenario.

## Alternatives considered

- **Plain tests only.** There would be no shared readable contract, and each layer would test something a little different.
- **A scenario at end-to-end level only.** It is the most real, but it needs servers and a browser, so it cannot run in the pre-push hook.
- **A scenario for every detail.** It would crowd `specs/` until nobody could read it. The question to ask is whether a shopper or an operator would see the difference.
- **A separate Cucumber runner.** It would run outside Vitest, so the unit and integration runs would need a second setup for coverage and watch mode.

## Consequences

- It costs up to three bindings per scenario, and exemptions that must be written and justified. `bdd:check` reads source
  text, so it proves that a binding with the title exists, not that its steps assert anything useful. Review covers that.
- It buys one source of truth for behaviour, a hook that stops an unbound scenario, and specs that win over docs.

## Revisit when

- Exemptions pile up in one app: the scenarios are probably details, so make them plain tests.
- Binding cost is more than the drift it prevents.

## Related

- [Scenario or plain test](../scenario-or-plain-test.md) and [test layers and coverage](../../reference/test-layers-and-coverage.md).
- Code: [`check-behaviour-coverage.mjs`](../../../scripts/bdd/check-behaviour-coverage.mjs), [`specs/apps/flash/`](../../../specs/apps/flash/README.md), [`flash-be/src/bdd/`](../../../apps/flash-be/src/bdd/).
