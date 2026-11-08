# Gherkin scenarios crash course

Gherkin is a plain-language format for behaviour: a `Feature` holds `Scenario`s, and each scenario is a list of
`Given`, `When` and `Then` steps. This repository writes each behaviour of the apps once, as a scenario, and runs that
one text at three layers. [Decision 014](../../explanation/decisions/014-gherkin-scenarios-at-three-layers.md) records
the choice.

## Why this repo uses Gherkin

**The problem.** A rule such as "a shopper who already bought cannot buy again" is worth proving with in-memory fakes
(unit), against the real stores (integration), and over HTTP or in a browser (end-to-end). Three hand-written tests
of the same rule would slowly say three different things. One scenario, bound at each layer, keeps them the same.

**What we did not pick.** Decision 014 turned down plain tests only (no shared contract), a scenario at the end-to-end
layer only (too slow for the pre-push hook), a scenario for every detail ([`specs/`](../../../specs) would become unreadable), and a
separate Cucumber runner (a second setup for coverage and watch mode).

**What it costs.** Up to three bindings per scenario, and a written reason for each layer that is skipped. The check
that guards it reads source text, so it proves that a binding exists, not that its steps assert anything useful.
Review covers that. The order of the work is drawn in [add a behaviour](../../how-to/add-a-behaviour.md).

## The ideas this repo uses

### The feature file is the contract

Features live in `specs/apps/flash/be/behaviours/<area>/` and `specs/apps/flash/web/behaviours/<area>/`. When they
disagree with [`docs/`](../..), the specs win. From
[`queue/joining.feature`](../../../specs/apps/flash/be/behaviours/queue/joining.feature):

```gherkin
  Scenario: Joining twice keeps the place and the ticket
    Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour
    And "ana" has joined the queue
    And "ben" has joined the queue
    When "ana" joins the queue again
    Then the response status is 200
    And the place in line is 1
    And the ticket is the one "ana" had before
```

### Unit and integration bindings with vitest-cucumber

[`@amiceli/vitest-cucumber`](https://amiceli.github.io/vitest-cucumber-docs) turns a feature into Vitest tests. Each
layer has its own test file that names the scenarios, as
[`queue_joining_tests.ts`](../../../apps/flash-be/src/bdd/queue_joining_tests.ts) does:

```ts
const steps = bindQueueJoining(unitShopLayer());

describeFeature(
	await loadFeature(specFile("flash/be/behaviours/queue/joining.feature")),
	({ Scenario, ScenarioOutline }) => {
		// ...
		Scenario("Joining twice keeps the place and the ticket", steps.joinsTwice);
```

[`queue_joining_integration_tests.ts`](../../../apps/flash-be/src/bdd/queue_joining_integration_tests.ts) is the same,
with `integrationShopLayer(real.scenario)` in place of `unitShopLayer()`.

### Shared binders hold the steps once

The step bodies are in `bind-<area>.ts`, in
[`flash-be/src/bdd/support/`](../../../apps/flash-be/src/bdd/support/) and
[`flash-web/src/bdd/support/`](../../../apps/flash-web/src/bdd/support/). A binder takes the layer and returns one
function per scenario. Steps use Cucumber expressions such as `{string}` and `{int}`, and an outline reads its row
from `examples` ([`bind-queue-joining.ts`](../../../apps/flash-be/src/bdd/support/bind-queue-joining.ts)):

```ts
When("{string} joins the queue", joinUser(world));

Then("the response status is {int}", statusIs(world));

// ... in a scenario outline:
And('the error is "<error>"', () => {
	expect(responseOf(world).json().errorCode).toBe(examples.error);
});
```

`flash-web` passes a world in place of a layer: the unit world runs the page in memory with fake time, and the
integration world uses real HTTP and real time. How to add a binder is in
[add a behaviour](../../how-to/add-a-behaviour.md#2-bind-the-unit-layer).

### End-to-end bindings with playwright-bdd

[`playwright-bdd`](https://vitalets.github.io/playwright-bdd/) generates Playwright tests from the same features. The
e2e configs skip the exempt scenarios
([`flash-be-e2e/playwright.config.ts`](../../../apps/flash-be-e2e/playwright.config.ts)):

```ts
const testDir = defineBddConfig({
	featuresRoot: "../../specs/apps/flash/be/behaviours",
	features: "../../specs/apps/flash/be/behaviours/**/*.feature",
	steps: ["./steps/**/*.steps.ts"],
	tags: "not @e2e-exempt",
});
```

The steps there are regular expressions or exact text, matched against every feature
([Playwright crash course](playwright.md)).

### Exempt a layer only with a reason

`@integration-exempt` or `@e2e-exempt` skips a layer, and a comment above the tag names the scenario that proves it
elsewhere. The format is in [add a behaviour](../../how-to/add-a-behaviour.md#5-exempt-a-layer-only-with-a-reason).

### Scenario or plain test

Ask: if this breaks, does a shopper or an operator see the difference? If not, write a plain Vitest test. The reasons
are in [scenario or plain test](../../explanation/scenario-or-plain-test.md).

## Try it here

Check that every scenario is bound, from the repository root:

```bash
npm run bdd:check
```

```text
behaviour coverage: 250/250 (100%)
```

The list of scenarios and their layers is in `generated-reports/behaviour-status.md`. Then run one scenario at the
unit layer from `apps/flash-be`. `-t` filters by name, and each step is one test:

```bash
cd apps/flash-be
npx vitest run --config vitest.config.ts --reporter=verbose -t "Joining twice" src/bdd/queue_joining_tests.ts
```

```text
 ✓ |unit| src/bdd/queue_joining_tests.ts > Feature: Joining the queue > Scenario: Joining twice keeps the place and the ticket > Given a sale with stock 10 and 0 sold that opens 1 hour ago and closes in 1 hour 1ms
 ✓ |unit| ... > Scenario: Joining twice keeps the place and the ticket > When "ana" joins the queue again 0ms
 ✓ |unit| ... > Scenario: Joining twice keeps the place and the ticket > Then the response status is 200 0ms

 Test Files  1 passed (1)
      Tests  7 passed | 25 skipped (32)
```

## Traps to avoid

- **Steps that repeat a pattern.** When one scenario uses a pattern several times (`"ana" joins the queue`, then
  `"ben" joins the queue`), [`bind-queue-joining.ts`](../../../apps/flash-be/src/bdd/support/bind-queue-joining.ts)
  binds each line by its exact text, "so each one finds its own line".
- **Titles stay as plain strings in the layer's file.** The binders return steps only; the titles stay in the test
  file, "where the behaviour checker reads them". The check reads source, so a title built at run time fails it.
- **`And` has no binding of its own at end-to-end.** `createBdd` in playwright-bdd gives `Given`, `When` and `Then`
  only. "Matching is by step text, so an And line binds to When or Then"
  ([`be.steps.ts`](../../../apps/flash-be-e2e/steps/be.steps.ts)).

## Read next

- [Gherkin reference](https://cucumber.io/docs/gherkin/reference/) and
  [Cucumber expressions](https://github.com/cucumber/cucumber-expressions#readme).
- [vitest-cucumber docs](https://amiceli.github.io/vitest-cucumber-docs) (8.x installed) and
  [playwright-bdd docs](https://vitalets.github.io/playwright-bdd/) (9.x installed).
- Here: [add a behaviour](../../how-to/add-a-behaviour.md),
  [test layers and coverage](../../reference/test-layers-and-coverage.md#behaviour-coverage), and the
  [`specs/` index](../../../specs/README.md).
