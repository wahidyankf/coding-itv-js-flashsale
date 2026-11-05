import type { APIResponse, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
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

// One request per scenario. Workers run one at a time (see playwright.config.ts), so this is safe.
let response: APIResponse | undefined;

export function current(): APIResponse {
	if (!response) throw new Error("no request was sent in this scenario");
	return response;
}

export function setResponse(next: APIResponse): void {
	response = next;
}

const { Given, When, Then, After } = createBdd();

// Every scenario cleans up what it started: its private flash-be, its database, and where the web server leads.
After(async () => {
	response = undefined;
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

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Given("flash-be cannot be reached", async ({}) => {
	await cutWebServerOff();
});

Given(
	/^flash-be answers \/health with status (\d+)$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, status: string) => {
		await answerWith(Number(status), '{"error":"nope"}');
	},
);

// Opens the page. A scenario that picked no place for the API gets its own flash-be, empty or with its sale.
async function openPage(page: Page): Promise<void> {
	await connectWebServer();
	await page.goto("/");
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
	response = await request.get(path);
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the response status is (\d+)$/, async ({}, status: string) => {
	expect(current().status()).toBe(Number(status));
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the body has status "([^"]+)"$/, async ({}, status: string) => {
	expect(await current().json()).toEqual({ status });
});
