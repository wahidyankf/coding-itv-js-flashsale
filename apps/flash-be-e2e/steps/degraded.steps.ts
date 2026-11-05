import { expect } from "@playwright/test";
import { createBdd } from "playwright-bdd";
import { createClient } from "redis";
import { E2E_REDIS_URL, startApi, world } from "./support/world.js";

const { Given } = createBdd();

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// /ready answers 503 while the API cannot reach Redis and 200 once it can. Waiting for it makes the step exact.
async function waitForReady(url: string, ready: boolean): Promise<void> {
	const deadline = Date.now() + 15_000;
	while (Date.now() < deadline) {
		const status = (await fetch(`${url}/ready`)).status;
		if ((status === 200) === ready) return;
		await sleep(50);
	}
	throw new Error(`the API did not become ${ready ? "ready" : "not ready"}`);
}

function proxy() {
	if (!world.redisProxy) throw new Error("the API was not started");
	return world.redisProxy;
}

// The address has no listener, so every connection is refused at once, as with a Postgres that is down.
const DEAD_POSTGRES = "postgres://flash:flash@127.0.0.1:1/flash";

Given("Postgres does not answer", async ({ request: _request }) => {
	world.apiEnv = { ...world.apiEnv, DATABASE_URL: DEAD_POSTGRES };
	await startApi();
});

Given("Redis does not answer", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().down();
	await waitForReady(url, false);
});

Given("Redis is down", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().down();
	await waitForReady(url, false);
});

Given("Redis is back with the data it had", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().up();
	await waitForReady(url, true);
});

Given("Redis is back with no data", async ({ request: _request }) => {
	const url = await startApi();
	await proxy().up();
	await waitForReady(url, true);
	const redis = createClient({ url: E2E_REDIS_URL });
	await redis.connect();
	try {
		await redis.flushDb();
	} finally {
		await redis.close();
	}
	expect(world.redisProxy).toBeDefined();
});
