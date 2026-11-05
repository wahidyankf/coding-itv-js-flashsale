import type { APIResponse } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createClient } from "redis";

// One request per scenario. Workers run one at a time (see playwright.config.ts), so this is safe.
let response: APIResponse | undefined;

function current(): APIResponse {
	if (!response) throw new Error("no request was sent in this scenario");
	return response;
}

// createBdd exposes Given, When and Then only. Matching is by step text, so an And line binds to When or Then.
const { Given, When, Then } = createBdd();

// Any path, so each feature can name the route it calls.
When(/^a client sends GET (\/\S*)$/, async ({ request }, path: string) => {
	response = await request.get(path);
});

Given("the API is running and Redis answers", async ({ request }) => {
	expect((await request.get("/ready")).status()).toBe(200);
});

When("Redis drops the API's connection", async () => {
	// CLIENT KILL with SKIPME leaves this connection open and drops the API's normal connection.
	// The e2e stack runs one flash-be and no other Redis clients, so no other test loses its link.
	const redis = createClient({
		url: process.env.REDIS_URL ?? "redis://localhost:6379",
	});
	await redis.connect();
	try {
		await redis.sendCommand([
			"CLIENT",
			"KILL",
			"TYPE",
			"normal",
			"SKIPME",
			"yes",
		]);
	} finally {
		await redis.close();
	}
});

When("Redis reconnects", async ({ request }) => {
	const deadline = Date.now() + 10_000;
	while (Date.now() < deadline) {
		// A crashed API refuses connections; keep polling until it answers again.
		try {
			if ((await request.get("/ready")).status() === 200) return;
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 200));
	}
	throw new Error("flash-be did not recover its Redis connection");
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the response status is (\d+)$/, async ({}, status: string) => {
	expect(current().status()).toBe(Number(status));
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the body has status "([^"]+)"$/, async ({}, status: string) => {
	expect(await current().json()).toEqual({ status });
});

Then(
	/^the readiness checks report database "([^"]+)" and redis "([^"]+)"$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, database: string, redis: string) => {
		expect((await current().json()).checks).toEqual({ database, redis });
	},
);
