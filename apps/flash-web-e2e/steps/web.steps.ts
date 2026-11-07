// Steps that drive the web server from outside: the status of flash-be the web server is shown, the page a visitor opens and
// what it says, and the plain requests a client sends to the web server. Binds home/app-router.feature,
// home/backend-status.feature and health/liveness.feature, and the page steps the other flash-web features share. Its After
// hook runs the shared cleanup, which clears the reply and the scenario's connections, so a scenario starts with neither.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import {
	currentResponse,
	setResponse,
} from "../../flash-be-e2e/steps/support/response.js";
import { FORWARDER_URL } from "./support/forwarder.js";
import {
	answerWith,
	cleanup,
	connectWebServer,
	cutWebServerOff,
	pointAtSharedBackend,
} from "./support/shop.js";

// The shared flash-be of the e2e stack, started by the Playwright config.
const sharedPort = Number(process.env.FLASH_BE_PORT ?? 8080);

const { Given, When, Then, After } = createBdd();

// Playwright-bdd passes a step's fixtures as its first argument and the values the step matches after them. A step that
// uses no fixture still takes the first argument, as `{ request: _request }`: the underscore says it is unused, and the
// values keep their place in the list.

// Every scenario cleans up what it started: its private flash-be, its database, where the web server leads, and the reply.
After(async () => {
	await cleanup();
});

Given(
	/^flash-be reports status "([^"]+)"$/,
	async ({ request }, status: string) => {
		if (status === "ok") {
			// The real, shared backend must already say what the scenario assumes. A wrong stack fails here.
			await pointAtSharedBackend(sharedPort);
			const reply = await request.get(`${FORWARDER_URL}/health`);
			expect(await reply.json()).toEqual({ status });
			return;
		}
		await answerWith(200, JSON.stringify({ status }));
	},
);

Given("flash-be cannot be reached", async ({ request: _request }) => {
	await cutWebServerOff();
});

Given(
	/^flash-be answers \/health with status (\d+)$/,
	async ({ request: _request }, status: string) => {
		await answerWith(
			Number(status),
			JSON.stringify({
				errorCode: "internal",
				errorMessage: "Something went wrong on the server.",
			}),
		);
	},
);

// Opens the page. A scenario that picked no place for the API gets its own flash-be, empty or with its sale.
async function openPage(page: Page): Promise<void> {
	await connectWebServer();
	await page.goto("/");
	// A sale page first asks who is logged in. The scenario goes on once it knows, so that what the scenario does next
	// (a login that ends, a press of a button) is not mixed up with that first question.
	await expect(page.getByText("Checking your login…")).toHaveCount(0);
}

When("a visitor opens the home page", async ({ page }) => {
	await openPage(page);
});

When(/^a visitor opens the page$/, async ({ page }) => {
	await openPage(page);
});

Given(/^a visitor has the page open$/, async ({ page }) => {
	await openPage(page);
});

Then('the page heading is "Flash Sale"', async ({ page }) => {
	await expect(page.locator("h1")).toHaveText("Flash Sale");
});

Then(/^the page says "(.+)"$/, async ({ page }, text: string) => {
	// A shopper may wait for the queue to admit them, so this waits longer than the default.
	await expect(page.locator("body")).toContainText(text, { timeout: 20_000 });
});

When(/^a client sends GET (\/.+)$/, async ({ request }, path: string) => {
	await connectWebServer();
	setResponse(await request.get(path));
});

Then(
	/^the response status is (\d+)$/,
	async ({ request: _request }, status: string) => {
		expect(currentResponse().status()).toBe(Number(status));
	},
);

Then(
	/^the body has status "([^"]+)"$/,
	async ({ request: _request }, status: string) => {
		expect(await currentResponse().json()).toEqual({ status });
	},
);
