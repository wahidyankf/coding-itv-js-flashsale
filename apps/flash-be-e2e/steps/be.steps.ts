import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createClient } from "redis";
import { currentResponse, setResponse } from "./support/response.js";
import { world } from "./support/world.js";

// createBdd exposes Given, When and Then only. Matching is by step text, so an And line binds to When or Then.
const { Given, When, Then } = createBdd();

// Any path, so each feature can name the route it calls.
// A scenario that started its own API (for example one whose Postgres does not answer) is asked there; the others ask
// the shared one.
When(/^a client sends GET (\/\S*)$/, async ({ request }, path: string) => {
	setResponse(await request.get(`${world.api?.url ?? ""}${path}`));
});

// A write whose body is sent as given, so a scenario can send what the API must refuse.
When(
	/^a client sends POST (\/\S*) with a body that is not JSON$/,
	async ({ request }, path: string) => {
		setResponse(
			await request.post(`${world.api?.url ?? ""}${path}`, {
				headers: { "content-type": "application/json" },
				// Playwright wraps a string that is not JSON in quotes; a buffer is sent as it is.
				data: Buffer.from("{oops"),
			}),
		);
	},
);

When(
	/^a client sends POST (\/\S*) with the body (.+)$/,
	async ({ request }, path: string, body: string) => {
		setResponse(
			await request.post(`${world.api?.url ?? ""}${path}`, {
				headers: { "content-type": "application/json" },
				data: body,
			}),
		);
	},
);

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
	expect(currentResponse().status()).toBe(Number(status));
});

// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
Then(/^the body has status "([^"]+)"$/, async ({}, status: string) => {
	expect(await currentResponse().json()).toEqual({ status });
});

Then(
	/^the readiness checks report database "([^"]+)" and redis "([^"]+)"$/,
	// biome-ignore lint/correctness/noEmptyPattern: playwright-bdd needs an object pattern as the first argument
	async ({}, database: string, redis: string) => {
		expect((await currentResponse().json()).checks).toEqual({
			database,
			redis,
		});
	},
);
