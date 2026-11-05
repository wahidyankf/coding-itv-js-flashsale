# Add a behaviour

First check that it is a behaviour: a shopper or an operator would see the difference if it broke. If only a developer
cares, write a plain test next to the code instead (see [scenario or plain test](../explanation/scenario-or-plain-test.md)).

Write the scenario first. Then bind it to the tests, so each layer proves what it can. This guide uses `flash-be`.
The steps are the same for `flash-web`, with its own folders.

## 1. Write the scenario

Add it to a feature file under `specs/flash/be/behaviours/`. Put it in the folder for its area, for example
`health/` or `config/`. If the folder has no feature file for this behaviour yet, create one and link it from the
folder's `README.md`:

```markdown
- [shutdown.feature](shutdown.feature) - what the API does when it is asked to stop.
```

Every `.feature` file must be linked from the `README.md` next to it. The check fails without the link.

## 2. Bind the unit layer

Every scenario needs a unit binding. Add it to `apps/flash-be/src/bdd/<area>_tests.ts`. The title must match the
scenario title exactly:

```ts
describeFeature(
	await loadFeature(specFile("flash/be/behaviours/health/shutdown.feature")),
	({ Scenario }) => {
		Scenario("The API stops when asked", ({ Given, When, Then }) => {
			// Steps go here.
		});
	},
);
```

Run the unit tests:

```bash
npx nx test:unit flash-be
```

## 3. Bind the integration layer

Unless the scenario is tagged `@integration-exempt`, bind it in `apps/flash-be/src/bdd/<area>_integration_tests.ts`.
Integration tests use the real Postgres and Redis from the dev stack. Start the stack first:

```bash
npx nx db:up flash-be
npx nx test:integration flash-be
```

## 4. Bind the end-to-end layer

Unless the scenario is tagged `@e2e-exempt`, its steps must match a step definition in `apps/flash-be-e2e/steps/`.
Each step is a regex or exact text. Run the browser-less API tests:

```bash
npx nx test:e2e flash-be-e2e
```

## 5. Exempt a layer only with a reason

If a layer cannot prove the scenario, tag it and write the comment directly above the tag. The format is fixed:

```gherkin
# Exemption(e2e): <why this layer cannot prove it>; alternative-proof: flash-be:integration / <scenario name>
@e2e-exempt
Scenario: The API stops when asked
```

The alternative proof must name a scenario that is bound at a different layer. The unit layer cannot be exempt.
Do not exempt a layer because the tests are slow or the work is not finished.

## 6. Check the corpus

```bash
npm run bdd:check
```

The check prints `behaviour coverage: N/N (100%)` when every scenario is bound. It also writes
`generated-reports/behaviour-status.md`, which lists each scenario and its layers. The check runs in the pre-push hook.
