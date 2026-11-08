// Steps shared by most flash-be features: a client that asks for a path (with or without a body), the status and body of a
// reply, and the Redis connection the API keeps (cut and restored). Binds health/liveness.feature, health/readiness.feature,
// routing/unknown-routes.feature and readiness' Redis steps. The other features use the request and reply steps.

import { PROBE_PATHS } from "@flash/flash-commons";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { DEV_REDIS_URL, withRedis } from "./support/processes.js";
import { currentResponse, setResponse } from "./support/response.js";
import { pollUntil } from "./support/time.js";
import { world } from "./support/world.js";

// createBdd exposes Given, When and Then only. Matching is by step text, so an And line binds to When or Then.
const { Given, When, Then } = createBdd();

// Any path, so each feature can name the route it calls, sent with GET or with POST and no body.
// A scenario that started its own API (for example one whose Postgres does not answer) is asked there; the others ask
// the shared one.
When(
	/^a client sends (GET|POST) (\/\S*)$/,
	async ({ request }, method: string, path: string) => {
		const url = `${world.api?.url ?? ""}${path}`;
		setResponse(
			method === "GET" ? await request.get(url) : await request.post(url),
		);
	},
);

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
	expect((await request.get(PROBE_PATHS.ready)).status()).toBe(200);
});

When("Redis drops the API's connection", async () => {
	// CLIENT KILL with SKIPME leaves this connection open and drops the API's normal connection.
	// The e2e stack runs one flash-be and no other Redis clients, so no other test loses its link.
	await withRedis(DEV_REDIS_URL, (redis) =>
		redis.sendCommand(["CLIENT", "KILL", "TYPE", "normal", "SKIPME", "yes"]),
	);
});

When("Redis reconnects", async ({ request }) => {
	// A crashed API refuses connections; keep polling until it answers again.
	await pollUntil(
		async () => {
			try {
				return (await request.get(PROBE_PATHS.ready)).status() === 200;
			} catch {
				return false;
			}
		},
		{
			withinMs: 10_000,
			everyMs: 200,
			failure: "flash-be did not recover its Redis connection",
		},
	);
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

Then(
	/^the readiness checks report database "([^"]+)" and redis "([^"]+)"$/,
	async ({ request: _request }, database: string, redis: string) => {
		expect((await currentResponse().json()).checks).toEqual({
			database,
			redis,
		});
	},
);
