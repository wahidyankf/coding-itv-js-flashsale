import { type APIRequestContext, expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { confirm } from "./purchase.steps.js";
import { join, shoppers } from "./queue.steps.js";
import { reserve } from "./reservation.steps.js";
import { currentResponse } from "./support/response.js";
import { world } from "./support/world.js";

const { Given, When, Then } = createBdd();

// Sends one write request by the name a scenario uses for it, and notes how it was answered.
async function send(request: APIRequestContext, kind: string, user: string) {
	if (kind === "join the queue") await join(request, user);
	else if (kind === "reserve an item") await reserve(request, user);
	else if (kind === "confirm a purchase") {
		await confirm(request, user, { reservationId: "not-an-id" });
	} else throw new Error(`unknown request "${kind}"`);
	const reply = currentResponse();
	shoppers().replies.push({
		status: reply.status(),
		retryAfter: reply.headers()["retry-after"],
	});
}

Given(
	/^the limit is (\d+) requests per user in each (\d+) seconds$/,
	async ({ request: _request }, requests: string, seconds: string) => {
		world.apiEnv = {
			...world.apiEnv,
			RATE_LIMIT_PER_USER: requests,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		};
	},
);

Given(
	/^the limit is (\d+) requests per address in each (\d+) seconds$/,
	async ({ request: _request }, requests: string, seconds: string) => {
		world.apiEnv = {
			...world.apiEnv,
			RATE_LIMIT_PER_IP: requests,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		};
	},
);

Given(
	/^"([^"]+)" has tried to join the queue (\d+) times$/,
	async ({ request }, user: string, times: string) => {
		for (let attempt = 0; attempt < Number(times); attempt++) {
			await send(request, "join the queue", user);
		}
	},
);

When(
	/^"([^"]+)" tries to (.+) (\d+) times$/,
	async ({ request }, user: string, kind: string, times: string) => {
		for (let attempt = 0; attempt < Number(times); attempt++) {
			await send(request, kind, user);
		}
	},
);

When(
	/^(\d+) different shoppers join the queue from one address$/,
	async ({ request }, count: string) => {
		for (let index = 0; index < Number(count); index++) {
			await send(request, "join the queue", `visitor${index}`);
		}
	},
);

Then(
	/^the first (\d+) requests are not limited$/,
	async ({ request: _request }, count: string) => {
		const first = shoppers().replies.slice(0, Number(count));
		expect(first.map((reply) => reply.status)).not.toContain(429);
	},
);

Then(
	/^a Retry-After header of at least (\d+) second is given$/,
	async ({ request: _request }, seconds: string) => {
		expect(
			Number(currentResponse().headers()["retry-after"]),
		).toBeGreaterThanOrEqual(Number(seconds));
	},
);

Then(
	/^(\d+) requests are accepted$/,
	async ({ request: _request }, count: string) => {
		expect(
			shoppers().replies.filter((reply) => reply.status !== 429),
		).toHaveLength(Number(count));
	},
);

Then(
	/^(\d+) requests are limited$/,
	async ({ request: _request }, count: string) => {
		expect(
			shoppers().replies.filter((reply) => reply.status === 429),
		).toHaveLength(Number(count));
	},
);
