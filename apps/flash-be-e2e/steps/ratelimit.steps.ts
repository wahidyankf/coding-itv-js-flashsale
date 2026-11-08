// Steps for the rate limits: how many write requests and logins a shopper or an address may send in a window, and what a
// refused one looks like (429 with a Retry-After). Binds rate-limit/limiting.feature. The requests are sent with the join, reserve and
// confirm calls of support/shoppers.ts, and each answer is kept for the counting steps.

import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { routes, send } from "./support/api.js";
import { ensureDatabase } from "./support/database.js";
import { E2E_REDIS_URL, withRedis } from "./support/processes.js";
import { currentResponse, setResponse } from "./support/response.js";
import { confirm, join, reserve, shoppers } from "./support/shoppers.js";
import { setApiEnv } from "./support/world.js";

const { Given, When, Then } = createBdd();

// Sends one write request by the name a scenario uses for it, and notes how it was answered.
async function sendKind(
	request: APIRequestContext,
	kind: string,
	user: string,
) {
	if (kind === "join the queue") await join(request, user);
	else if (kind === "reserve an item") await reserve(request, user);
	else if (kind === "confirm a purchase") {
		await confirm(request, user, { reservationId: "not-an-id" });
	} else if (kind === "log in") {
		await ensureDatabase();
		setResponse(
			await send(request, routes.login, {
				body: { username: user, password: "not the password" },
			}),
		);
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
		setApiEnv({
			RATE_LIMIT_PER_USER: requests,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		});
	},
);

Given(
	/^the limit is (\d+) requests per address in each (\d+) seconds$/,
	async ({ request: _request }, requests: string, seconds: string) => {
		setApiEnv({
			RATE_LIMIT_PER_IP: requests,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		});
	},
);

// The auth count is by address alone, and every scenario logs in from this one, so the counts earlier scenarios left in
// the shared Redis are dropped first.
Given(
	/^the limit is (\d+) logins per address in each (\d+) seconds$/,
	async ({ request: _request }, requests: string, seconds: string) => {
		setApiEnv({
			AUTH_RATE_LIMIT_PER_IP: requests,
			RATE_LIMIT_WINDOW_SECONDS: seconds,
		});
		await withRedis(E2E_REDIS_URL, async (redis) => {
			const counts = await redis.keys("ratelimit:address:auth:*");
			if (counts.length > 0) await redis.del(counts);
		});
	},
);

Given(
	/^"([^"]+)" has tried to join the queue (\d+) times$/,
	async ({ request }, user: string, times: string) => {
		for (let attempt = 0; attempt < Number(times); attempt++) {
			await sendKind(request, "join the queue", user);
		}
	},
);

When(
	/^"([^"]+)" tries to (.+) (\d+) times$/,
	async ({ request }, user: string, kind: string, times: string) => {
		for (let attempt = 0; attempt < Number(times); attempt++) {
			await sendKind(request, kind, user);
		}
	},
);

When(
	/^(\d+) different shoppers join the queue from one address$/,
	async ({ request }, count: string) => {
		for (let index = 0; index < Number(count); index++) {
			await sendKind(request, "join the queue", `visitor${index}`);
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
