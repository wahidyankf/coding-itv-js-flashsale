# Playwright crash course

[Playwright](https://playwright.dev/) runs tests against real servers: it can send HTTP requests and drive a real
browser. This repository uses it, through `playwright-bdd`, for the end-to-end layer of the Gherkin scenarios
([decision 014](../../explanation/decisions/014-gherkin-scenarios-at-three-layers.md)). The version installed is
`@playwright/test` 1.64.

## Why this repo uses Playwright

**The problem.** The unit and integration layers call the code in a test process. Only a built `flash-be` and a built
`flash-web`, reached over the network, show what a shopper meets: the real routes, the cookies, the page in a browser.
One tool covers both apps. The API tests use the `request` fixture and the page tests use `page`, and `webServer`
builds and starts the servers before the tests run.

**What we did not pick.** Decision 014 turned down a scenario at the end-to-end layer only: "it needs servers and a
browser, so it cannot run in the pre-push hook". So end-to-end is the third proof, never the only one, and it stays
out of the hooks. No decision record compares Playwright with another browser tool.

**What it costs.** Each run builds the apps it tests (the configs allow 120 and 240 seconds for start-up), needs the
dev stack, and needs Chromium once (`npx playwright install chromium`). Tests run one at a time, with one worker.
The steps also write the API's paths and statuses themselves, so a renamed route means editing the tests (see the
last idea below).

## The ideas this repo uses

### Two e2e apps

[`flash-be-e2e`](../../../apps/flash-be-e2e/README.md) tests the API with HTTP requests only, with no browser.
[`flash-web-e2e`](../../../apps/flash-web-e2e/README.md) opens the page in Chromium. A step receives Playwright's
fixtures as its first argument ([`be.steps.ts`](../../../apps/flash-be-e2e/steps/be.steps.ts)):

```ts
const { Given, When, Then } = createBdd();

When(/^a client sends GET (\/\S*)$/, async ({ request }, path: string) => {
	setResponse(await request.get(`${world.api?.url ?? ""}${path}`));
});
```

### `webServer` waits for a health route

Tests start only when the servers answer.
[`flash-web-e2e/playwright.config.ts`](../../../apps/flash-web-e2e/playwright.config.ts) starts both apps and waits for
`/health` on `flash-be` and `/api/health` on `flash-web`:

```ts
		{
			command:
				"npm --prefix ../flash-web run build && npm --prefix ../flash-web run start",
			// Wait for the health route, so tests start only when the app is ready.
			url: `${baseURL}/api/health`,
			env: { FLASH_BE_URL: FORWARDER_URL },
			reuseExistingServer: !process.env.CI,
```

`/ready` is checked by the steps, for example "the API is running and Redis answers". Keep all three routes working.
`reuseExistingServer` means that on your machine Playwright uses any server that already answers at that `url`.

### Step files and their support

Each app has `steps/<area>.steps.ts` for the steps and `steps/support/` for the helpers. `flash-web-e2e` imports the
shared helpers (time, logins, the database) from `flash-be-e2e/steps/support/`; it does not copy them. A hook in
[`world.steps.ts`](../../../apps/flash-be-e2e/steps/world.steps.ts) cleans up after every scenario:

```ts
const { After } = createBdd();

After(async () => {
	await cleanup();
});
```

### Find elements by the words a shopper reads

The page steps find a button by its role and name, and text by what is on screen
([`account.steps.ts`](../../../apps/flash-web-e2e/steps/account.steps.ts),
[`shopper.steps.ts`](../../../apps/flash-web-e2e/steps/shopper.steps.ts)):

```ts
await page.getByLabel("Username").fill(user);
await page.getByRole("button", { name: "Buy Now" }).click();
await expect(page.getByText(`Items left: ${left}`)).toBeVisible();
```

A changed label in `flash-web` changes the locator too. `expect(...).toBeVisible()` waits and retries by itself.

### Waits that back off

Some states have no element to wait for, such as an admission done by the API's own timer. `pollUntil` in
[`support/time.ts`](../../../apps/flash-be-e2e/steps/support/time.ts) checks at once, then waits with backoff and full
jitter (`retryAsync`) up to one second between checks, until a deadline. `pollUntilAdmitted` in
[`support/shoppers.ts`](../../../apps/flash-be-e2e/steps/support/shoppers.ts) is the one admission wait of both apps:

```ts
export function pollUntilAdmitted(
	readState: () => Promise<string | undefined>,
	options: { withinMs: number; everyMs: number; failure: string },
): Promise<void> {
	return pollUntil(async () => (await readState()) === "admitted", options);
}
```

The numbers of every retry are in [retry policies](../../reference/retry-policies.md).

### The forwarder lets a scenario cut the API

The web server reaches `flash-be` through a forwarder on port 18082
([`forwarder.ts`](../../../apps/flash-web-e2e/steps/support/forwarder.ts)). Each scenario sets where it leads: a
private `flash-be`, the shared one, nowhere, or a canned reply. So a scenario can break the API without touching
another test ([how the web end-to-end tests control the API](../../reference/test-layers-and-coverage.md#how-the-web-end-to-end-tests-control-the-api)).

### The tests write the API's paths themselves

[`support/api.ts`](../../../apps/flash-be-e2e/steps/support/api.ts) lists every route by hand, such as
`joinQueue: route<JoinedView>("POST", "/sales/:saleId/queue")`. The e2e apps are test oracles: if they imported the
paths from `flash-be`, a renamed route would pass every test while real clients break
([decision 016](../../explanation/decisions/016-dry-rule-of-three.md)).

## Try it here

Generate the tests from the features and list them. Listing does not start the servers or run anything:

```bash
cd apps/flash-be-e2e
npx bddgen
npx playwright test --list
```

The output, trimmed:

```text
Listing tests:
  auth/accounts.feature.spec.js:6:3 › Accounts of shoppers › A new shopper signs up and is logged in
  queue/joining.feature.spec.js:25:3 › Joining the queue › Joining twice keeps the place and the ticket
  queue/joining.feature.spec.js:43:5 › Joining the queue › A sale that cannot sell any more does not take new shoppers › Example #1
Total: 156 tests in 20 files
```

Open `.features-gen/queue/joining.feature.spec.js` to see each Gherkin line turned into a call such as
`await When('"ana" joins the queue', null, { request })`. To run a suite, use `npx nx test:e2e flash-be-e2e`, which
starts the dev stack itself, or `npx nx test:e2e flash-web-e2e` after `npx nx db:up flash-be`. How to bind a step is in
[add a behaviour](../../how-to/add-a-behaviour.md#4-bind-the-end-to-end-layer).

## Traps we hit

- **The page first asks who is logged in.** A step that clicks before that answer arrives races with it.
  `openPage` in [`web.steps.ts`](../../../apps/flash-web-e2e/steps/web.steps.ts) waits until "Checking your login…" is
  gone.
- **A random payment decline flakes scenarios.** The mock payment declines 2 percent by default. The private API of a
  scenario runs with `PAYMENT_FAILURE_RATE: "0"`, unless a step sets another rate
  ([`processes.ts`](../../../apps/flash-be-e2e/steps/support/processes.ts)).
- **A crashed API throws, it does not answer.** While `flash-be` restarts, `request.get` throws. The "Redis
  reconnects" step catches that inside its `pollUntil` check and returns `false`, so the poll keeps going.
- **A string body is not sent as written.** "Playwright wraps a string that is not JSON in quotes; a buffer is sent as
  it is." The step that sends broken JSON uses `Buffer.from("{oops")`.

## Read next

- Playwright: [web server](https://playwright.dev/docs/test-webserver), [locators](https://playwright.dev/docs/locators),
  [API testing](https://playwright.dev/docs/api-testing).
- [playwright-bdd docs](https://vitalets.github.io/playwright-bdd/) (9.x installed).
- Here: [Gherkin scenarios crash course](gherkin-scenarios.md),
  [test layers and coverage](../../reference/test-layers-and-coverage.md#how-the-api-end-to-end-tests-break-a-dependency).
