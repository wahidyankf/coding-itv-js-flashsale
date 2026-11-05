import type { APIResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";

const backendUrl = process.env.FLASH_BE_URL ?? "http://localhost:8080";

// One request per scenario. Workers run one at a time (see playwright.config.ts), so this is safe.
let response: APIResponse | undefined;

function current(): APIResponse {
	if (!response) throw new Error("no request was sent in this scenario");
	return response;
}

const { Given, When, Then } = createBdd();

Given(
	/^flash-be reports status "([^"]+)"$/,
	async ({ request }, status: string) => {
		// The real backend must already say what the scenario assumes. A wrong stack fails here.
		const reply = await request.get(`${backendUrl}/health`);
		expect(await reply.json()).toEqual({ status });
	},
);

When("a visitor opens the home page", async ({ page }) => {
	await page.goto("/");
});

Then('the page heading is "Flash Sale"', async ({ page }) => {
	await expect(page.locator("h1")).toHaveText("Flash Sale");
});

Then('the page says "Backend: ok"', async ({ page }) => {
	await expect(page.getByText("Backend:")).toContainText("ok");
});

When(/^a client sends GET \/api\/health$/, async ({ request }) => {
	response = await request.get("/api/health");
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the response status is (\d+)$/, async ({}, status: string) => {
	expect(current().status()).toBe(Number(status));
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the body has status "([^"]+)"$/, async ({}, status: string) => {
	expect(await current().json()).toEqual({ status });
});
